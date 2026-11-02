import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineConfig, runtimeConfig, type ContosoEnvironment } from "./config.js";
import { createPortalGateway, managedIdentityTokenProvider, type PortalGateway } from "./gateway.js";
import { portalControlAuthorizer, type PortalControlAuthorizer } from "./control-auth.js";
import type { ContosoServerTelemetryStatus } from "./telemetry.js";
import { THEME_SCRIPT } from "./shared/theme.js";
import {
  certificationActive, ContosoError, isUuid4, originalWorkflowInvocationId, parseWorkflowMutationView, safeErrorCode, validateOrderRequest,
  type ContosoErrorCode, type ContosoPublicRuntimeConfigV1, type WorkflowViewV1
} from "./shared/contracts.js";

export interface ContosoServerOptions {
  env: ContosoEnvironment;
  config?: ContosoPublicRuntimeConfigV1;
  gateway?: PortalGateway;
  authorizeControl?: PortalControlAuthorizer;
  storefrontRoot?: string;
  portalPublicRoot?: string;
  fixtureConnectOrigins?: readonly string[];
  fixtureRequestHandler?: (request: IncomingMessage, response: ServerResponse) => boolean;
  telemetryStatus?: () => { active: boolean; samplingPercentage: number } | ContosoServerTelemetryStatus;
  shutdownTelemetry?: () => Promise<void>;
}
interface PortalSession {
  csrf: string;
  authorized: boolean;
  expires: number;
  latest?: WorkflowViewV1;
  busy: boolean;
  lastActionAt: number;
  generation: number;
}
const MAX_BODY = 8192;
const MAX_PORTAL_SESSIONS = 100;
const PORTAL_SESSION_TTL_MS = 15 * 60_000;
const THEME_HASH = createHash("sha256").update(THEME_SCRIPT).digest("base64");
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? "");
}
function errorBody(code: ContosoErrorCode): string {
  return JSON.stringify({ schemaVersion: 1, errorCode: code });
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookies(request: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key) result[key] = value.join("=");
  }
  return result;
}
function portalHtml(config: ContosoPublicRuntimeConfigV1, session: PortalSession, error?: ContosoErrorCode, accepting = true): string {
  const enabled = accepting && config.portal.enabled && certificationActive(config) && session.authorized;
  const view = session.latest;
  const resultData = view ? `<script type="application/json" id="contoso-portal-backend-result">${JSON.stringify(view).replace(/</g, "\\u003c").replace(/&/g, "\\u0026")}</script>` : "";
  const rows = view
    ? `<h2 id="result-state">${escapeHtml(view.state)}</h2>
       <p>Actual backend state; a staged 202 is not broker/worker completion or certification.</p>
       <dl><dt>Order ID</dt><dd id="result-id">${escapeHtml(view.id)}</dd>
       <dt>${view.workflowBusinessInvocationId ? "Current action invocation ID" : "Workflow invocation ID"}</dt><dd id="result-business-id">${escapeHtml(view.businessInvocationId)}</dd>
       <dt>Original workflow invocation ID</dt><dd id="result-workflow-business-id">${escapeHtml(originalWorkflowInvocationId(view))}</dd></dl>`
    : `<h2 id="result-state">No workload order submitted</h2><p>The Portal will render the real Gateway result, never a fabricated order or human pseudonym.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>${THEME_SCRIPT}</script>
  <meta name="referrer" content="same-origin"><title>Contoso Portal — workload SSR</title><link rel="stylesheet" href="/portal/assets/portal.css"></head>
  <body>${inlineConfig({ ...config, surface: "portal-page", telemetry: { ...config.telemetry, roleName: "contoso-portal-ssr" } })}
  <header><a href="/storefront/">CONTOSO Storefront</a><strong>Contoso Portal</strong><span>WORKLOAD-ONLY · no delegated SSR login</span></header>
  <main><p class="eyebrow">CONTOSO DEMO 02</p><h1>Rendered by the server.<br>Authorized as a workload.</h1>
  <p>One public Node process cohosts the Storefront and this Portal. Its independent server provider traces native HTTP(S).
  The Portal uses managed identity and Portal.Invoke; no visitor is represented as a human API subject.</p>
  <p id="execution-mode">${escapeHtml(config.executionMode.toUpperCase())}${config.executionMode === "fixture" ? " · FIXTURE, NOT CERTIFICATION" : " · live certification To Do"}</p>
  ${error ? `<div role="alert" id="portal-error">${error}</div>` : ""}
  <section><h2>Submit a bounded synthetic workload order</h2><p>Demo mutation is enabled only by the operator's declared certification window. Public inputs cannot choose a trusted business ID.</p>
  <form method="post" action="/portal/orders" id="portal-order-form">
  <input type="hidden" name="schemaVersion" value="1"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
  <input type="hidden" name="runId" id="portal-run-id" value="${randomUUID()}">
  <label>Contoso SKU<input name="sku" value="CONTOSO-001" maxlength="48" required></label>
  <label>Quantity<input name="quantity" type="number" value="1" min="1" max="100" required></label>
  <button type="submit" data-testid="contoso-submit-ssr-order"${enabled ? "" : " disabled"}>Run Contoso workload SSR order</button></form>
  ${enabled ? "<p>Authenticated fixed-workload controller and bounded synthetic window are active.</p>" : "<p>Portal controls disabled: the fixed controller must authenticate in memory, and an approved window and Portal permission must be configured. A window flag alone is not authorization.</p>"}
  </section><section data-testid="contoso-run-result" id="portal-result" aria-live="polite">${rows}${resultData}<p>Driver: browser-ssr. There is deliberately no human HMAC pseudonym.</p></section>
  <footer>Raw Authorization, cookies, bodies and connection configuration are never evidence. Live workspace parentage remains To Do.</footer></main>
  <script type="module" src="/portal/assets/portal-client.js"></script></body></html>`;
}
async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += value.length;
    if (size > MAX_BODY) throw new ContosoError("REQUEST_TOO_LARGE", 413);
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".woff2")) return "font/woff2";
  throw new ContosoError("NOT_FOUND", 404);
}
async function staticAsset(root: string, subpath: string): Promise<Buffer> {
  if (subpath.includes("\\") || subpath.includes("..") || subpath.includes("\0") || subpath.endsWith(".map"))
    throw new ContosoError("NOT_FOUND", 404);
  const target = resolve(root, subpath);
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new ContosoError("NOT_FOUND", 404);
  try { return await readFile(target); } catch { throw new ContosoError("NOT_FOUND", 404); }
}
export function createContosoServer(options: ContosoServerOptions): Server {
  const base = dirname(fileURLToPath(import.meta.url));
  const storefrontRoot = options.storefrontRoot ?? resolve(base, "storefront");
  const portalPublicRoot = options.portalPublicRoot ?? resolve(base, "public");
  const sessions = new Map<string, PortalSession>();
  const config = options.config;
  const originalLeaseId = config?.certification.enabled ? config.certification.windowId : null;
  let quiesced = false;
  let inFlight = 0;
  const drained = new Set<() => void>();
  function requireTraffic(): void {
    if (quiesced || !config || !certificationActive(config) || (options.telemetryStatus && !options.telemetryStatus().active))
      throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
  }
  if (config?.executionMode !== "fixture" && (options.gateway || options.authorizeControl || options.fixtureConnectOrigins || options.fixtureRequestHandler))
    throw new ContosoError("CONFIG_INVALID", 503);
  const gateway = options.gateway ?? (config ? createPortalGateway(config,
    managedIdentityTokenProvider(config.identity.apiClientId, options.env.CONTOSO_PORTAL_MI_CLIENT_ID), 10000, requireTraffic) : undefined);
  const authorizeControl = options.authorizeControl ?? portalControlAuthorizer(options.env);
  function security(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader("X-Content-Type-Options", "nosniff");
    // no-referrer makes a native form POST's Origin opaque; same-origin keeps the strict CSRF origin check viable.
    response.setHeader("Referrer-Policy", ["/portal/", "/portal/orders"].includes(request.url ?? "") ? "same-origin" : "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    if (config) {
      const ingestion = config.telemetry.connectionString.split(";")
        .find(pair => pair.startsWith("IngestionEndpoint="))?.slice("IngestionEndpoint=".length);
      const telemetryOrigin = ingestion ? new URL(ingestion).origin : "";
      const fixtureOrigins = config.executionMode === "fixture" ? (options.fixtureConnectOrigins ?? []).join(" ") : "";
      response.setHeader("Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'sha256-${THEME_HASH}'; style-src 'self'; connect-src 'self' ${config.api.origin} ${telemetryOrigin} ${fixtureOrigins} https://login.microsoftonline.com; img-src 'self' data:; frame-src 'self' https://login.microsoftonline.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://login.microsoftonline.com`);
    }
  }
  function reapSessions(now: number): void {
    for (const [id, value] of sessions) if (value.expires <= now) sessions.delete(id);
  }
  function newSession(response: ServerResponse): PortalSession {
    const now = Date.now();
    reapSessions(now);
    if (sessions.size >= MAX_PORTAL_SESSIONS) throw new ContosoError("PORTAL_DISABLED", 429);
    const key = randomBytes(32).toString("base64url");
    const value: PortalSession = { csrf: randomBytes(32).toString("base64url"), authorized: true,
      expires: Math.min(now + PORTAL_SESSION_TTL_MS, Date.parse(config?.certification.endsAtUtc ?? "")),
      busy: false, lastActionAt: 0, generation: 0 };
    if (!Number.isFinite(value.expires) || value.expires <= now)
      throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
    sessions.set(key, value);
    const lifetimeSeconds = Math.max(1, Math.ceil((value.expires - now) / 1000));
    response.setHeader("Set-Cookie", `contoso-portal-session=${key}; Path=/portal; HttpOnly; SameSite=Strict${config?.executionMode === "live" ? "; Secure" : ""}; Max-Age=${lifetimeSeconds}`);
    return value;
  }
  function session(request: IncomingMessage): PortalSession {
    const now = Date.now();
    reapSessions(now);
    const id = cookies(request)["contoso-portal-session"];
    const existing = id ? sessions.get(id) : undefined;
    if (existing) return existing;
    return { csrf: "", authorized: false, expires: 0, busy: false, lastActionAt: 0, generation: 0 };
  }
  return createServer((request, response) => {
    security(request, response);
    if (config?.executionMode === "fixture" && options.fixtureRequestHandler?.(request, response)) return;
    const handle = async (): Promise<void> => {
      let url: URL;
      try { url = new URL(request.url ?? "/", config?.portal.origin ?? "http://localhost"); }
      catch { throw new ContosoError("REQUEST_INVALID"); }
      if (url.search || url.hash || url.username || url.password) throw new ContosoError("REQUEST_INVALID");
      if (["/health/live", "/health/ready"].includes(url.pathname) && request.method === "GET") {
        const status = options.telemetryStatus?.() ?? { active: false, samplingPercentage: 0 };
        const ready = Boolean(config && status.active);
        response.writeHead(url.pathname.endsWith("ready") && !ready ? 503 : 200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ schemaVersion: 1, service: "contoso-portal-ssr", live: true, ready,
          providerActive: status.active, samplingPercentage: status.samplingPercentage, liveCertification: "To Do" }));
        return;
      }
      if (url.pathname === "/" && request.method === "GET") {
        response.writeHead(302, { Location: "/storefront/" }); response.end(); return;
      }
      if (["/portal/runtime-state", "/portal/runtime-stop-traffic", "/portal/runtime-drain"].includes(url.pathname) && request.method === "POST") {
        if (!config) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
        if (request.headers.origin !== config.portal.origin || request.headers["content-type"]?.split(";")[0] !== "application/json")
          throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
        const authCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "authorization").length;
        const authorization = request.headers.authorization;
        if (authCount !== 1 || !authorization?.startsWith("Bearer ")) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
        await authorizeControl(authorization.slice("Bearer ".length));
        const raw: unknown = JSON.parse(await body(request));
        if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.keys(raw).length !== 3
          || !("schemaVersion" in raw) || raw.schemaVersion !== 1 || !("runId" in raw) || !isUuid4(raw.runId)
          || !("revision" in raw) || raw.revision !== `cert-${raw.runId}`) throw new ContosoError("REQUEST_INVALID");
        if (url.pathname !== "/portal/runtime-state") {
          if (!originalLeaseId || raw.runId !== originalLeaseId) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
          quiesced = true;
        }
        if (url.pathname === "/portal/runtime-drain") {
          if (inFlight > 0) await new Promise<void>(resolve => drained.add(resolve));
          if (!options.shutdownTelemetry) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
          await options.shutdownTelemetry();
        }
        const state = options.telemetryStatus?.();
        if (!state || !("runtimeInstanceId" in state)) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ schema: "contoso.sampling-runtime-observation.v1", schemaVersion: 1, operation: url.pathname.split("/").at(-1),
          runId: raw.runId, requestedRevision: raw.revision, ...state,
          effectiveSamplingPercentage: state.samplingPercentage, requestsPerSecond: null,
          actualRevision: state.revision, sourceKind: "contoso-node-sdk-runtime", nativeStateAvailable: true,
          ready: state.active, admitting: !quiesced && state.active, inFlightRemaining: inFlight, guard: null,
          admission: { state: quiesced || !state.active ? "quiesced" : "accepting", inFlight },
          restartMechanism: "process-restart", ownershipPending: true, certificationEligible: false, certification: "NOT_CERTIFIED" }));
        return;
      }
      if (["/storefront/runtime-config.v1.json", "/portal/runtime-config.v1.json"].includes(url.pathname) && request.method === "GET") {
        if (!config) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
        const surface = url.pathname.startsWith("/storefront/") ? "storefront-spa" : "portal-page";
        const value = { ...config, surface, telemetry: { ...config.telemetry, roleName: surface === "storefront-spa" ? "contoso-storefront-spa" : "contoso-portal-ssr" } };
        response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); return;
      }
      if (url.pathname.startsWith("/storefront/assets/") && request.method === "GET") {
        const path = decodeURIComponent(url.pathname.slice("/storefront/".length));
        const asset = await staticAsset(storefrontRoot, path);
        response.writeHead(200, { "Content-Type": contentType(path), "Cache-Control": "public, max-age=86400" });
        response.end(asset); return;
      }
      if (url.pathname === "/storefront/auth/redirect.html" && request.method === "GET") {
        const asset = await staticAsset(storefrontRoot, "auth/redirect.html");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(asset); return;
      }
      if (["/storefront/", "/storefront/orders", "/storefront/demos"].includes(url.pathname) && request.method === "GET") {
        let html: string;
        try { html = (await readFile(resolve(storefrontRoot, "index.html"))).toString("utf8"); }
        catch { throw new ContosoError("CONFIG_UNAVAILABLE", 503); }
        const injection = config ? inlineConfig({ ...config, surface: "storefront-spa", telemetry: { ...config.telemetry, roleName: "contoso-storefront-spa" } }) : "";
        if (!html.includes("<!--CONTOSO_RUNTIME_CONFIG-->")) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html.replace("<!--CONTOSO_RUNTIME_CONFIG-->", injection)); return;
      }
      if (url.pathname.startsWith("/portal/assets/") && request.method === "GET") {
        const path = decodeURIComponent(url.pathname.slice("/portal/assets/".length));
        const asset = await staticAsset(portalPublicRoot, path);
        response.writeHead(200, { "Content-Type": contentType(path), "Cache-Control": "public, max-age=86400" });
        response.end(asset); return;
      }
      if (url.pathname === "/portal/session" && request.method === "POST" && config) {
        if (!config.portal.enabled || !certificationActive(config)) throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
        if (request.headers.origin !== config.portal.origin || request.headers["content-type"]?.split(";")[0] !== "application/json")
          throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
        const count = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "authorization").length;
        const authorization = request.headers.authorization;
        if (count !== 1 || !authorization?.startsWith("Bearer ")) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
        const raw: unknown = JSON.parse(await body(request));
        if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.keys(raw).length !== 1
          || !("schemaVersion" in raw) || raw.schemaVersion !== 1) throw new ContosoError("REQUEST_INVALID");
        await authorizeControl(authorization.slice("Bearer ".length));
        if (!certificationActive(config)) throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
        const oldSession = cookies(request)["contoso-portal-session"];
        if (oldSession) sessions.delete(oldSession);
        const state = newSession(response);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ schemaVersion: 1, controller: "authorized", expiresAtUtc: new Date(state.expires).toISOString() }));
        return;
      }
      if ((url.pathname === "/portal/" || url.pathname === "/portal/orders") && config) {
        const state = session(request);
        if (url.pathname === "/portal/" && request.method === "GET") {
          if (state.latest && gateway && config.portal.enabled && certificationActive(config)) {
            requireTraffic();
            const previous = state.latest;
            const generation = state.generation;
            response.setHeader("x-business-invocation-id", previous.businessInvocationId);
            inFlight++;
            try {
              const refreshed = await gateway.readOrder(previous.id, previous.businessInvocationId);
              if (state.generation !== generation || state.latest?.id !== previous.id)
                throw new ContosoError("RUN_IN_PROGRESS", 409);
              if (refreshed.id !== previous.id || originalWorkflowInvocationId(refreshed) !== originalWorkflowInvocationId(previous))
                throw new ContosoError("API_RESPONSE_INVALID", 502);
              state.latest = refreshed;
            }
            finally {
              inFlight--;
              if (inFlight === 0) { for (const resolve of drained) resolve(); drained.clear(); }
            }
            response.setHeader("x-business-invocation-id", state.latest.businessInvocationId);
          }
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(portalHtml(config, state, undefined, !quiesced && (!options.telemetryStatus || options.telemetryStatus().active)));
          return;
        }
        if (url.pathname === "/portal/orders" && request.method === "POST") {
          requireTraffic();
          if (!config.portal.enabled) throw new ContosoError("PORTAL_DISABLED", 409);
          if (!state.authorized) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
          if (!gateway) throw new ContosoError("PORTAL_TOKEN_UNAVAILABLE", 503);
          if (request.headers.origin !== config.portal.origin || request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded")
            throw new ContosoError("PORTAL_CSRF_REJECTED", 403);
          const form = new URLSearchParams(await body(request));
          const allowed = ["schemaVersion", "csrf", "runId", "sku", "quantity"];
          if ([...form.keys()].some(key => !allowed.includes(key)) || allowed.some(key => form.getAll(key).length !== 1)
            || form.get("schemaVersion") !== "1" || !safeEqual(form.get("csrf") ?? "", state.csrf))
            throw new ContosoError("PORTAL_CSRF_REJECTED", 403);
          if (state.busy || Date.now() - state.lastActionAt < 1000) throw new ContosoError("PORTAL_DISABLED", 429);
          const runId = form.get("runId");
          if (!isUuid4(runId)) throw new ContosoError("REQUEST_INVALID");
          const order = validateOrderRequest({ schemaVersion: 1, orderId: runId, sku: form.get("sku"), quantity: Number(form.get("quantity")) });
          state.busy = true;
          state.generation++;
          inFlight++;
          state.lastActionAt = Date.now();
          try {
            // The workload chooses the invocation ID; no public form/header grants trusted-ID authority.
            const businessId = randomUUID();
            response.setHeader("x-business-invocation-id", businessId);
            const created = await gateway.createOrder(order, businessId);
            state.latest = parseWorkflowMutationView(created);
            state.csrf = randomBytes(32).toString("base64url");
            response.setHeader("x-business-invocation-id", state.latest.businessInvocationId);
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(portalHtml(config, state, undefined, !quiesced && (!options.telemetryStatus || options.telemetryStatus().active)));
            return;
          } finally {
            state.busy = false;
            inFlight--;
            if (inFlight === 0) { for (const resolve of drained) resolve(); drained.clear(); }
          }
        }
      }
      if (["/portal/", "/portal/orders"].includes(url.pathname) && !config) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
      throw new ContosoError("NOT_FOUND", 404);
    };
    void handle().catch((error: unknown) => {
      if (response.headersSent) { response.end(); return; }
      const code = safeErrorCode(error, "REQUEST_INVALID");
      const status = error instanceof ContosoError ? error.status : 400;
      response.writeHead(status, { "Content-Type": "application/json" }); response.end(errorBody(code));
    });
  });
}
export function configuredServer(options: Omit<ContosoServerOptions, "config">): Server {
  let config: ContosoPublicRuntimeConfigV1 | undefined;
  try { config = runtimeConfig(options.env, "storefront-spa"); } catch { config = undefined; }
  return createContosoServer({ ...options, ...(config ? { config } : {}) });
}
