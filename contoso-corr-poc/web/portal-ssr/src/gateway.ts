import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ManagedIdentityCredential } from "@azure/identity";
import {
  ContosoError, isUuid4, parseWorkflowMutationView, parseWorkflowView, validateOrderRequest,
  type ContosoPublicRuntimeConfigV1, type OrderRequestV1, type WorkflowViewV1
} from "./shared/contracts.js";
import { operationDeadline, raceWithAbort } from "./shared/deadline.js";

export type PortalTokenProvider = (signal?: AbortSignal) => Promise<string>;
export interface PortalGateway {
  createOrder(body: OrderRequestV1, businessId: string): Promise<WorkflowViewV1>;
  readOrder(orderId: string, businessId: string): Promise<WorkflowViewV1>;
}
export function managedIdentityTokenProvider(apiClientId: string, clientId?: string): PortalTokenProvider {
  const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
  return async signal => {
    try {
      const result = await credential.getToken(`api://${apiClientId}/.default`, signal ? { abortSignal: signal } : {});
      if (!result?.token) throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503);
      return result.token;
    } catch { throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503); }
  };
}
export function createPortalGateway(
  config: ContosoPublicRuntimeConfigV1,
  tokenProvider: PortalTokenProvider,
  timeoutMs = 10000,
  beforeRequest: () => void = () => undefined
): PortalGateway {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new ContosoError("CONFIG_INVALID");
  async function call(path: string, method: "GET" | "POST", businessId: string, body?: OrderRequestV1): Promise<WorkflowViewV1> {
    if (!/^\/orders(?:\/[0-9a-f-]{36})?$/.test(path) || !isUuid4(businessId)) throw new ContosoError("REQUEST_INVALID");
    const url = new URL(`${config.api.basePath}${path}`, config.api.origin);
    if (url.origin !== config.api.origin || url.search || url.hash || url.username || url.password)
      throw new ContosoError("API_ROUTE_REJECTED");
    beforeRequest();
    const deadline = operationDeadline(config, timeoutMs);
    try {
      let token: string;
      try { token = await raceWithAbort(tokenProvider(deadline.signal), deadline.signal); }
      catch (error: unknown) {
        if (error instanceof ContosoError) throw error;
        throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503);
      }
      if (typeof token !== "string" || !token || token.length > 32000 || /[\x00-\x20\x7f]/.test(token))
        throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503);
      deadline.check();
      beforeRequest();
    const bytes = body ? Buffer.from(JSON.stringify(body)) : undefined;
    return await new Promise<WorkflowViewV1>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(url, {
        method, signal: deadline.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "x-business-invocation-id": businessId,
          ...(bytes ? { "Content-Type": "application/json", "Content-Length": String(bytes.length) } : {})
        }
      }, response => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.destroy();
          reject(new ContosoError("API_REQUEST_FAILED", response.statusCode ?? 502));
          return;
        }
        const responseBusinessId = response.headers["x-business-invocation-id"];
        if (!isUuid4(responseBusinessId) || response.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
          response.destroy();
          reject(new ContosoError("API_RESPONSE_INVALID", 502));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 65536) {
            response.destroy();
            reject(new ContosoError("API_RESPONSE_INVALID", 502));
          } else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            deadline.check();
            const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const view = method === "POST" ? parseWorkflowMutationView(raw) : parseWorkflowView(raw);
            const expectedId = body?.orderId ?? (method === "GET" ? path.slice("/orders/".length) : undefined);
            if ((expectedId && view.id !== expectedId) || (method === "POST" && view.businessInvocationId !== responseBusinessId))
              throw new ContosoError("API_RESPONSE_INVALID", 502);
            resolve(view);
          } catch (error: unknown) {
            reject(error instanceof ContosoError ? error : new ContosoError("API_RESPONSE_INVALID", 502));
          }
        });
        response.on("error", () => reject(new ContosoError("API_REQUEST_FAILED", deadline.signal.aborted ? 504 : 502)));
      });
      req.on("error", () => reject(new ContosoError("API_REQUEST_FAILED", deadline.signal.aborted ? 504 : 502)));
      if (bytes) req.write(bytes);
      req.end();
    });
    } finally { deadline.close(); }
  }
  return {
    createOrder(body, businessId) { return call("/orders", "POST", businessId, validateOrderRequest(body)); },
    readOrder(id, businessId) {
      if (!isUuid4(id)) throw new ContosoError("REQUEST_INVALID");
      return call(`/orders/${id}`, "GET", businessId);
    }
  };
}
