import {
  ContosoError, isUuid4, parseIdentityView, parseWorkflowMutationView, parseWorkflowView, validateDemoRequest, validateOrderRequest,
  type ApiCollection, type ContosoPublicRuntimeConfigV1, type DemoRunRequestV1,
  type IdentityViewV1, type OrderRequestV1, type WorkflowViewV1
} from "./contracts.js";
import { operationDeadline, raceWithAbort } from "./deadline.js";

export type BrowserTokenProvider = (signal?: AbortSignal) => Promise<string>;
export interface ContosoBrowserApi {
  order(body: OrderRequestV1): Promise<WorkflowViewV1>;
  demo(body: DemoRunRequestV1): Promise<WorkflowViewV1>;
  workflow(collection: ApiCollection, id: string): Promise<WorkflowViewV1>;
  identity(): Promise<IdentityViewV1>;
}
export async function readApiResponse(response: Response): Promise<{ value: unknown; businessInvocationId: string }> {
  const businessInvocationId = response.headers.get("x-business-invocation-id");
  if (!isUuid4(businessInvocationId) || response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    throw new ContosoError("API_RESPONSE_INVALID", 502);
  const reader = response.body?.getReader();
  if (!reader) throw new ContosoError("API_RESPONSE_INVALID", 502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        throw new ContosoError("API_RESPONSE_INVALID", 502);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return { value, businessInvocationId };
  } catch (error: unknown) {
    if (error instanceof ContosoError) throw error;
    throw new ContosoError("API_RESPONSE_INVALID", 502);
  } finally { reader.releaseLock(); }
}
export function guardedApiUrl(config: ContosoPublicRuntimeConfigV1, path: string): URL {
  if (!/^\/(?:orders|me|demo-runs)(?:\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/.test(path))
    throw new ContosoError("API_ROUTE_REJECTED");
  const url = new URL(`${config.api.basePath}${path}`, config.api.origin);
  if (url.origin !== config.api.origin || url.search || url.hash || url.username || url.password)
    throw new ContosoError("API_ROUTE_REJECTED");
  return url;
}
export function createBrowserApi(
  config: ContosoPublicRuntimeConfigV1,
  tokenProvider: BrowserTokenProvider,
  beforeRequest: () => void = () => undefined,
  timeoutMs = 10000
): ContosoBrowserApi {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new ContosoError("CONFIG_INVALID");
  async function request(
    path: string, method: "GET" | "POST", body?: OrderRequestV1 | DemoRunRequestV1
  ): Promise<{ value: unknown; businessInvocationId: string }> {
    const url = guardedApiUrl(config, path);
    beforeRequest();
    const deadline = operationDeadline(config, timeoutMs);
    try {
    let token: string;
    try { token = await raceWithAbort(tokenProvider(deadline.signal), deadline.signal); }
    catch (error: unknown) {
      if (error instanceof ContosoError) throw error;
      throw new ContosoError("AUTH_FAILED", 401);
    }
    if (typeof token !== "string" || !token || token.length > 32000 || /[\x00-\x20\x7f]/.test(token))
      throw new ContosoError("AUTH_REQUIRED", 401);
    deadline.check();
    beforeRequest();
    try {
      const response = await fetch(url.href, {
        method, credentials: "omit", mode: "cors", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: deadline.signal
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ContosoError("API_REQUEST_FAILED", response.status);
      }
      const value = await readApiResponse(response);
      deadline.check();
      return value;
    } catch (error: unknown) {
      if (deadline.signal.aborted) throw new ContosoError("API_REQUEST_FAILED", 504);
      if (error instanceof ContosoError) throw error;
      throw new ContosoError("API_REQUEST_FAILED", 502);
    }
    } finally { deadline.close(); }
  }
  function workflowResult(
    response: { value: unknown; businessInvocationId: string }, expectedId?: string, mutation = false
  ): WorkflowViewV1 {
    const view = mutation ? parseWorkflowMutationView(response.value) : parseWorkflowView(response.value);
    if ((expectedId && view.id !== expectedId) || (mutation && view.businessInvocationId !== response.businessInvocationId))
      throw new ContosoError("API_RESPONSE_INVALID", 502);
    return view;
  }
  return {
    async order(body) {
      const command = validateOrderRequest(body);
      return workflowResult(await request("/orders", "POST", command), command.orderId, true);
    },
    async demo(body) {
      const command = validateDemoRequest(body);
      return workflowResult(await request("/demo-runs", "POST", command), command.runId, true);
    },
    async workflow(collection, id) {
      if (!isUuid4(id)) throw new ContosoError("REQUEST_INVALID");
      return workflowResult(await request(`/${collection}/${id}`, "GET"), id);
    },
    async identity() {
      const response = await request("/me", "GET");
      const view = parseIdentityView(response.value);
      if (view.businessInvocationId !== response.businessInvocationId) throw new ContosoError("API_RESPONSE_INVALID", 502);
      return view;
    }
  };
}
