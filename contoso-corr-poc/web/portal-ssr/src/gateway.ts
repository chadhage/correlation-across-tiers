import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ManagedIdentityCredential } from "@azure/identity";
import {
  ContosoError, isUuid4, parseWorkflowView,
  type ContosoPublicRuntimeConfigV1, type OrderRequestV1, type WorkflowViewV1
} from "./shared/contracts.js";

export type PortalTokenProvider = () => Promise<string>;
export interface PortalGateway {
  createOrder(body: OrderRequestV1, businessId: string): Promise<WorkflowViewV1>;
  readOrder(orderId: string, businessId: string): Promise<WorkflowViewV1>;
}
export function managedIdentityTokenProvider(apiClientId: string, clientId?: string): PortalTokenProvider {
  const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
  return async () => {
    try {
      const result = await credential.getToken(`api://${apiClientId}/.default`);
      if (!result?.token) throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503);
      return result.token;
    } catch { throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503); }
  };
}
export function createPortalGateway(
  config: ContosoPublicRuntimeConfigV1,
  tokenProvider: PortalTokenProvider,
  timeoutMs = 10000
): PortalGateway {
  async function call(path: string, method: "GET" | "POST", businessId: string, body?: OrderRequestV1): Promise<WorkflowViewV1> {
    if (!/^\/orders(?:\/[0-9a-f-]{36})?$/.test(path) || !isUuid4(businessId)) throw new ContosoError("REQUEST_INVALID");
    const url = new URL(`${config.api.basePath}${path}`, config.api.origin);
    if (url.origin !== config.api.origin || url.search || url.hash || url.username || url.password)
      throw new ContosoError("API_ROUTE_REJECTED");
    const token = await tokenProvider();
    if (!token || token.length > 32000 || /[\r\n]/.test(token)) throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503);
    const bytes = body ? Buffer.from(JSON.stringify(body)) : undefined;
    return new Promise<WorkflowViewV1>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "x-business-invocation-id": businessId,
          ...(bytes ? { "Content-Type": "application/json", "Content-Length": String(bytes.length) } : {})
        }
      }, response => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new ContosoError("API_REQUEST_FAILED", response.statusCode ?? 502));
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
            const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolve(parseWorkflowView(raw));
          } catch { reject(new ContosoError("API_RESPONSE_INVALID", 502)); }
        });
        response.on("error", () => reject(new ContosoError("API_REQUEST_FAILED", 502)));
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new ContosoError("API_REQUEST_FAILED", 504)); });
      req.on("error", () => reject(new ContosoError("API_REQUEST_FAILED", 502)));
      if (bytes) req.write(bytes);
      req.end();
    });
  }
  return {
    createOrder(body, businessId) { return call("/orders", "POST", businessId, body); },
    readOrder(id, businessId) {
      if (!isUuid4(id)) throw new ContosoError("REQUEST_INVALID");
      return call(`/orders/${id}`, "GET", businessId);
    }
  };
}
