import { createServer as createNetServer } from "node:net";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";
import { fixtureConfig } from "../fixture-config.ts";
import { initializeTelemetry } from "../../dist/telemetry.js";
import { ContosoError, isRecord, isUuid4, validateDemoRequest, validateOrderRequest } from "../../dist/shared/contracts.js";

async function freePort(): Promise<number> {
  const server = createNetServer();
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("FIXTURE_PORT_UNAVAILABLE")); return; }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}
const webPort = Number(process.env.CONTOSO_FIXTURE_WEB_PORT ?? "41987");
const apiPort = await freePort();
const excludedPort = await freePort();
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const excludedOrigin = `http://127.0.0.1:${excludedPort}`;
const config = fixtureConfig(webOrigin, apiOrigin);
const telemetry = await initializeTelemetry(config, { CONTOSO_SERVER_SAMPLING_PERCENTAGE: "10" }, {
  async sendRequest(request) {
    const destination = new URL(request.url);
    const payload = typeof request.body === "string" || request.body instanceof Uint8Array ? request.body : undefined;
    if (destination.origin !== apiOrigin || destination.protocol !== "http:" || payload === undefined)
      throw new Error("FIXTURE_TRANSPORT_REJECTED");
    const { request: send } = await import("node:http");
    const { createHttpHeaders } = await import("@azure/core-rest-pipeline");
    return new Promise((resolveResponse, reject) => {
      const call = send(destination, { method: request.method, headers: request.headers.toJSON() }, response => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[name] = value;
            if (Array.isArray(value)) headers[name] = value.join(", ");
          }
          resolveResponse({ request, status: response.statusCode ?? 500, headers: createHttpHeaders(headers),
            bodyAsText: Buffer.concat(parts).toString("utf8") });
        });
        response.on("error", reject);
      });
      call.setTimeout(5000, () => { call.destroy(); reject(new Error("FIXTURE_TRANSPORT_TIMEOUT")); });
      call.on("error", reject);
      call.end(payload);
    });
  }
});
const { createServer } = await import("node:http");
const { createContosoServer } = await import("../../dist/server.js");
const { createPortalGateway } = await import("../../dist/gateway.js");
type Observation = { method: string; path: string; traceparent?: string; tracestate?: string; businessInvocationId?: string; actor: "fixture-user" | "fixture-workload" | "none" };
type Span = { type: string; id: string; operationId: string; parentId: string; role: string };
const observations: Observation[] = [];
const spans: Span[] = [];
const workflows = new Map<string, { schemaVersion: 1; id: string; businessInvocationId: string; state: string; details: Record<string, string> }>();
async function readBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    length += bytes.length;
    if (length > 1_000_000) throw new Error("FIXTURE_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  let bytes = Buffer.concat(chunks);
  if (request.headers["content-encoding"] === "gzip" || (bytes[0] === 0x1f && bytes[1] === 0x8b))
    bytes = gunzipSync(bytes, { maxOutputLength: 1_000_000 });
  if (request.headers["content-encoding"] === "deflate")
    bytes = inflateSync(bytes, { maxOutputLength: 1_000_000 });
  const text = bytes.toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text) as unknown; }
  catch { return text.split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown); }
}
function collect(items: unknown): void {
  const list: readonly unknown[] = Array.isArray(items) ? items : [items];
  for (const item of list) {
    if (!isRecord(item) || !isRecord(item.data) || !isRecord(item.data.baseData)) continue;
    const tags = isRecord(item.tags) ? item.tags : {};
    const base = item.data.baseData;
    if (typeof base.id !== "string") continue;
    spans.push({ type: String(item.data.baseType ?? ""), id: base.id,
      operationId: typeof tags["ai.operation.id"] === "string" ? tags["ai.operation.id"] : "",
      parentId: typeof tags["ai.operation.parentId"] === "string" ? tags["ai.operation.parentId"] : "",
      role: typeof tags["ai.cloud.role"] === "string" ? tags["ai.cloud.role"] : "" });
    if (spans.length > 500) spans.shift();
  }
}
const api = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", apiOrigin);
    if (request.headers.origin === webOrigin) {
      response.setHeader("Access-Control-Allow-Origin", webOrigin);
      response.setHeader("Access-Control-Allow-Methods", "GET,POST");
      response.setHeader("Access-Control-Allow-Headers", "authorization,content-type,traceparent,tracestate,x-business-invocation-id,request-context");
      response.setHeader("Access-Control-Expose-Headers", "x-business-invocation-id");
    }
    if (request.method === "OPTIONS") { response.writeHead(200); response.end(); return; }
    if (url.pathname.includes("track")) {
      collect(await readBody(request));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ itemsReceived: 1, itemsAccepted: 1, errors: [], appId: randomUUID() })); return;
    }
    const auth = request.headers.authorization ?? "";
    const actor = auth.startsWith("Bearer fixture-workload-") ? "fixture-workload"
      : auth.startsWith("Bearer fixture-user-") ? "fixture-user" : "none";
    const observation: Observation = { method: request.method ?? "", path: url.pathname, actor };
    if (typeof request.headers.traceparent === "string") observation.traceparent = request.headers.traceparent;
    if (typeof request.headers.tracestate === "string") observation.tracestate = request.headers.tracestate;
    const incoming = request.headers["x-business-invocation-id"];
    const business = actor === "fixture-workload" && isUuid4(incoming) ? incoming : randomUUID();
    observation.businessInvocationId = business;
    observations.push(observation);
    response.setHeader("x-business-invocation-id", business);
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/contoso/v1/me") {
      response.end(JSON.stringify({ schemaVersion: 1, actorType: actor === "fixture-workload" ? "WORKLOAD" : "HUMAN",
        businessInvocationId: business, ...(actor !== "fixture-workload" ? { pseudonym: `h1.fixture.${randomBytes(32).toString("base64url")}` } : {}) })); return;
    }
    if (actor === "none") { response.writeHead(401); response.end(JSON.stringify({ errorCode: "FIXTURE_AUTH_REQUIRED" })); return; }
    if (request.method === "POST") {
      const input = await readBody(request);
      const command = url.pathname === "/contoso/v1/orders" ? validateOrderRequest(input) : validateDemoRequest(input);
      if ("quantity" in command && command.quantity === 2)
        await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 500));
      const id = "orderId" in command && isUuid4(command.orderId) ? command.orderId
        : "runId" in command && isUuid4(command.runId) ? command.runId : randomUUID();
      const view = { schemaVersion: 1 as const, id, businessInvocationId: business, state: "DURABLE_STAGED",
        details: { operation: "ORDER", source: "fixture" } };
      workflows.set(id, view);
      response.writeHead(202); response.end(JSON.stringify(view)); return;
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    const found = workflows.get(id);
    if (found) response.end(JSON.stringify(found));
    else { response.writeHead(404); response.end(JSON.stringify({ errorCode: "FIXTURE_NOT_FOUND" })); }
  })().catch(() => { response.writeHead(400); response.end(JSON.stringify({ errorCode: "FIXTURE_INVALID" })); });
});
await new Promise<void>(resolveReady => api.listen(apiPort, "127.0.0.1", resolveReady));
const excluded = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", webOrigin);
  if (request.url === "/fixtures/rogue") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<html><body>FIXTURE rogue origin<script>
    window.contosoRogue=async()=>{try{await fetch(${JSON.stringify(apiOrigin + "/contoso/v1/orders")},{
    method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer fixture-only"},body:"{}"});
    return "unexpected";}catch{return "browser-blocked";}}</script></body></html>`); return;
  }
  const observation: Observation = { method: request.method ?? "", path: "/fixture-excluded", actor: "none" };
  if (typeof request.headers.traceparent === "string") observation.traceparent = request.headers.traceparent;
  if (typeof request.headers.tracestate === "string") observation.tracestate = request.headers.tracestate;
  if (typeof request.headers["x-business-invocation-id"] === "string") observation.businessInvocationId = request.headers["x-business-invocation-id"];
  observations.push(observation);
  response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ fixture: true }));
});
await new Promise<void>(resolveReady => excluded.listen(excludedPort, "127.0.0.1", resolveReady));
const fixtureHandler = (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): boolean => {
  const path = new URL(request.url ?? "/", webOrigin).pathname;
  if (path === "/fixtures/observations") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ fixture: true, observations, spans, excludedOrigin })); return true;
  }
  if (path === "/fixtures/storefront" || path === "/fixtures/veto-throw") {
    void (async () => {
      const template = await readFile(resolve("../storefront-spa/index.html"), "utf8");
      const script = JSON.stringify(config).replace(/</g, "\\u003c");
      const injected = `<script type="application/json" id="contoso-runtime-config">${script}</script>
        <script type="application/json" id="contoso-fixture-endpoints">${JSON.stringify({ excludedOrigin })}</script>`;
      const html = template.replace("<!--CONTOSO_RUNTIME_CONFIG-->", injected)
        .replace('<script type="module" src="/src/main.ts"></script>', '<script type="module" src="/fixtures/fixture.js"></script><link rel="stylesheet" href="/fixtures/style.css">');
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    })().catch(() => { response.writeHead(500); response.end("FIXTURE_BUILD_REQUIRED"); }); return true;
  }
  if (path === "/fixtures/fixture.js" || path === "/fixtures/style.css") {
    void readFile(resolve(".cache/fixture-web", path.endsWith(".js") ? "fixture.js" : "portal-ssr.css")).then(value => {
      response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css"); response.end(value);
    }).catch(() => { response.writeHead(404); response.end("FIXTURE_ASSET_MISSING"); }); return true;
  }
  return false;
};
const web = createContosoServer({
  env: {}, config, storefrontRoot: resolve("../storefront-spa/dist"), portalPublicRoot: resolve("dist/public"),
  gateway: createPortalGateway(config, async () => `fixture-workload-${randomUUID()}`),
  authorizeControl: async bearer => { if (!bearer.startsWith("fixture-control-")) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403); },
  fixtureConnectOrigins: [excludedOrigin], fixtureRequestHandler: fixtureHandler, telemetryStatus: () => telemetry.status()
});
await new Promise<void>(resolveReady => web.listen(webPort, "127.0.0.1", resolveReady));
process.stdout.write(`Contoso FIXTURE servers ready on ${webPort}; not Azure certification.\n`);
let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await new Promise<void>(resolveClose => web.close(() => resolveClose()));
  await telemetry.shutdown();
  await Promise.all([
    new Promise<void>(resolveClose => api.close(() => resolveClose())),
    new Promise<void>(resolveClose => excluded.close(() => resolveClose()))
  ]);
}
process.once("SIGTERM", () => { void close(); });
process.once("SIGINT", () => { void close(); });
