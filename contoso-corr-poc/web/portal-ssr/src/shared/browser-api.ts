import {
  ContosoError, isUuid4, parseIdentityView, parseWorkflowView, validateDemoRequest, validateOrderRequest,
  type ApiCollection, type ContosoPublicRuntimeConfigV1, type DemoRunRequestV1,
  type IdentityViewV1, type OrderRequestV1, type WorkflowViewV1
} from "./contracts.js";

export type BrowserTokenProvider = () => Promise<string>;
export interface ContosoBrowserApi {
  order(body: OrderRequestV1): Promise<WorkflowViewV1>;
  demo(body: DemoRunRequestV1): Promise<WorkflowViewV1>;
  workflow(collection: ApiCollection, id: string): Promise<WorkflowViewV1>;
  identity(): Promise<IdentityViewV1>;
}
export function guardedApiUrl(config: ContosoPublicRuntimeConfigV1, path: string): URL {
  if (!/^\/(?:orders|me|demo-runs)(?:\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/.test(path))
    throw new ContosoError("API_ROUTE_REJECTED");
  const url = new URL(`${config.api.basePath}${path}`, config.api.origin);
  if (url.origin !== config.api.origin || url.search || url.hash || url.username || url.password)
    throw new ContosoError("API_ROUTE_REJECTED");
  return url;
}
export function createBrowserApi(config: ContosoPublicRuntimeConfigV1, tokenProvider: BrowserTokenProvider): ContosoBrowserApi {
  async function request(path: string, method: "GET" | "POST", body?: OrderRequestV1 | DemoRunRequestV1): Promise<unknown> {
    const url = guardedApiUrl(config, path);
    const token = await tokenProvider();
    if (typeof token !== "string" || !token || token.length > 32000 || /[\r\n]/.test(token))
      throw new ContosoError("AUTH_REQUIRED", 401);
    let response: Response;
    try {
      response = await fetch(url.href, {
        method, credentials: "omit", mode: "cors", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch { throw new ContosoError("API_REQUEST_FAILED", 502); }
    if (!response.ok) throw new ContosoError("API_REQUEST_FAILED", response.status);
    const text = await response.text();
    if (text.length > 65536) throw new ContosoError("API_RESPONSE_INVALID", 502);
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch { throw new ContosoError("API_RESPONSE_INVALID", 502); }
  }
  return {
    async order(body) { return parseWorkflowView(await request("/orders", "POST", validateOrderRequest(body))); },
    async demo(body) { return parseWorkflowView(await request("/demo-runs", "POST", validateDemoRequest(body))); },
    async workflow(collection, id) {
      if (!isUuid4(id)) throw new ContosoError("REQUEST_INVALID");
      return parseWorkflowView(await request(`/${collection}/${id}`, "GET"));
    },
    async identity() { return parseIdentityView(await request("/me", "GET")); }
  };
}
