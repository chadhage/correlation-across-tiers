import { createServer, request as httpRequest } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateSync } from "node:zlib";

const portalRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = resolve(portalRoot, "..", "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRACE = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN = /^(?!0{16}$)[0-9a-f]{16}$/;
const CARRIER = /^00-((?!0{32}-)[0-9a-f]{32})-((?!0{16}-)[0-9a-f]{16})-01$/;
const REQUEST_HEADERS = new Set(["authorization", "content-type", "traceparent", "tracestate", "request-context"]);
const RESPONSE_HEADERS = ["content-type", "x-business-invocation-id"];
const SAFE_ID = /^(?:[0-9a-f]{16}|[0-9a-f]{32}|\|[0-9a-f]{32}\.[0-9a-f]{16}\.?)$/;
export const SOURCE_INPUTS = Object.freeze([
  "web\\storefront-spa\\src\\app.ts", "web\\storefront-spa\\src\\style.css", "web\\storefront-spa\\index.html",
  "web\\storefront-spa\\package.json", "web\\storefront-spa\\package-lock.json", "web\\storefront-spa\\tsconfig.json",
  "web\\portal-ssr\\src\\browser-adapter.ts", "web\\portal-ssr\\src\\shared\\contracts.ts",
  "web\\portal-ssr\\src\\shared\\browser-api.ts", "web\\portal-ssr\\src\\shared\\browser-telemetry.ts",
  "web\\portal-ssr\\src\\shared\\deadline.ts", "web\\portal-ssr\\scripts\\local-rehearsal.mjs",
  "web\\portal-ssr\\tests\\browser\\local-rehearsal-entry.ts", "web\\portal-ssr\\package.json",
  "web\\portal-ssr\\package-lock.json", "web\\portal-ssr\\tsconfig.json"
]);
async function sourceHashes() {
  return Promise.all(SOURCE_INPUTS.map(async path => ({
    path, sha256: createHash("sha256").update(await readFile(repositoryPath(path))).digest("hex")
  })));
}
function requireValue(condition, code) { if (!condition) throw new Error(code); }
export function repositoryPath(value, base = projectRoot) {
  requireValue(typeof value === "string" && value.length > 0, "LOCAL_REHEARSAL_PATH_REQUIRED");
  const path = resolve(base, value);
  const within = relative(projectRoot, path);
  requireValue(within !== ".." && !within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(within),
    "LOCAL_REHEARSAL_REPOSITORY_PATH_REQUIRED");
  return path;
}
export function loopbackOrigin(value) {
  requireValue(typeof value === "string", "LOCAL_REHEARSAL_LOOPBACK_REQUIRED");
  let url;
  try { url = new URL(value); } catch { throw new Error("LOCAL_REHEARSAL_LOOPBACK_REQUIRED"); }
  requireValue(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/",
  "LOCAL_REHEARSAL_LOOPBACK_REQUIRED");
  return url.origin;
}
export function localDemo01Spec(runId = randomUUID()) {
  requireValue(UUID.test(runId), "LOCAL_REHEARSAL_RUN_ID_REQUIRED");
  return { schemaVersion: 1, runId, demoId: 1, kind: "demo", sku: "CONTOSO-001", quantity: 1 };
}
export async function readLocalPair(manifestFile) {
  const path = repositoryPath(manifestFile);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  requireValue(manifest?.schemaVersion === 1 && manifest.profile === "LOCAL REHEARSAL" && manifest.ready === true,
    "LOCAL_REHEARSAL_PAIR_NOT_READY");
  requireValue(!["accessToken", "gatewayAccessToken", "token"].some(key => key in manifest), "LOCAL_REHEARSAL_TOKEN_MUST_STAY_IN_MEMORY");
  const ordersOrigin = loopbackOrigin(manifest.ordersOrigin);
  const inventoryOrigin = loopbackOrigin(manifest.inventoryOrigin);
  const receiverOrigin = loopbackOrigin(manifest.receiverOrigin);
  const controlOrigin = loopbackOrigin(manifest.controlOrigin);
  const tokenUrl = new URL("/token", controlOrigin);
  return { manifestFile: path, ordersOrigin, inventoryOrigin, receiverOrigin, tokenUrl: tokenUrl.href,
    telemetryPath: repositoryPath(manifest.telemetryPath, dirname(path)),
    ingressPath: repositoryPath(manifest.ingressPath, dirname(path)) };
}
async function body(request, max = 65536) {
  const parts = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    requireValue(size <= max, "LOCAL_REHEARSAL_BODY_TOO_LARGE");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function listen(server) {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  requireValue(address && typeof address !== "string", "LOCAL_REHEARSAL_PORT_UNAVAILABLE");
  return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise(accept => server.close(accept));
}
function fail(response, code, status = 400) {
  if (!response.headersSent) response.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  response.end(code);
}
export async function createLocalForwarder({ ordersOrigin, approvedOrigin, gatewayAccessToken }) {
  ordersOrigin = loopbackOrigin(ordersOrigin);
  approvedOrigin = loopbackOrigin(approvedOrigin);
  requireValue(gatewayAccessToken === undefined || (typeof gatewayAccessToken === "string" && gatewayAccessToken.length > 0
    && gatewayAccessToken.length < 32000 && !/[\x00-\x20\x7f]/.test(gatewayAccessToken)), "LOCAL_REHEARSAL_GATEWAY_TOKEN_INVALID");
  const observations = [];
  const pending = new Set();
  const server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const route = /^\/contoso\/v1\/orders(?:\/[0-9a-f-]{36})?$/.test(url.pathname);
      if (!route || url.search || url.hash) { fail(response, "LOCAL_REHEARSAL_ROUTE_REJECTED", 404); return; }
      if (incoming.headers.origin !== approvedOrigin) { fail(response, "LOCAL_REHEARSAL_ORIGIN_REJECTED", 403); return; }
      response.setHeader("Access-Control-Allow-Origin", approvedOrigin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "x-business-invocation-id");
      if (incoming.method === "OPTIONS") {
        const method = incoming.headers["access-control-request-method"];
        const headers = String(incoming.headers["access-control-request-headers"] ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!["GET", "POST"].includes(method) || headers.some(value => !REQUEST_HEADERS.has(value))) {
          fail(response, "LOCAL_REHEARSAL_PREFLIGHT_REJECTED", 403); return;
        }
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST",
          "Access-Control-Allow-Headers": [...REQUEST_HEADERS].join(",") });
        response.end(); return;
      }
      if (!["GET", "POST"].includes(incoming.method)) { fail(response, "LOCAL_REHEARSAL_METHOD_REJECTED", 405); return; }
      if (observations.length >= 100) { fail(response, "LOCAL_REHEARSAL_CAPACITY_EXCEEDED", 429); return; }
      const bytes = await body(incoming);
      const headers = {};
      for (const name of REQUEST_HEADERS)
        if (typeof incoming.headers[name] === "string") headers[name] = incoming.headers[name];
      if (gatewayAccessToken) headers["x-contoso-gateway-authorization"] = `Bearer ${gatewayAccessToken}`;
      headers["content-length"] = String(bytes.length);
      const targetPath = url.pathname.replace("/contoso/v1", "/api");
      const observation = { method: incoming.method, path: url.pathname, targetPath,
        legacyRequestIdPresent: "request-id" in incoming.headers,
        legacyCorrelationContextPresent: "correlation-context" in incoming.headers,
        bodySha256: createHash("sha256").update(bytes).digest("hex") };
      for (const [source, target] of [["traceparent", "traceparent"], ["tracestate", "tracestate"]]) {
        const value = incoming.headers[source];
        if (typeof value === "string" && (source === "traceparent" ? CARRIER.test(value) : value === "contoso=cert"))
          observation[target] = value;
      }
      observations.push(observation);
      await new Promise((accept, reject) => {
        const call = httpRequest(`${ordersOrigin}${targetPath}`, { method: incoming.method, headers, agent: false }, upstream => {
          if (upstream.statusCode >= 300 && upstream.statusCode < 400) {
            upstream.resume(); observation.status = 502;
            fail(response, "LOCAL_REHEARSAL_REDIRECT_REJECTED", 502); accept(); return;
          }
          observation.status = upstream.statusCode ?? 502;
          for (const name of RESPONSE_HEADERS)
            if (typeof upstream.headers[name] === "string") response.setHeader(name, upstream.headers[name]);
          response.writeHead(observation.status);
          upstream.pipe(response);
          upstream.once("end", accept);
          upstream.once("error", reject);
        });
        pending.add(call);
        call.once("close", () => pending.delete(call));
        call.setTimeout(10000, () => call.destroy(new Error("LOCAL_REHEARSAL_ORDERS_TIMEOUT")));
        call.once("error", reject);
        const forwardedParent = call.getHeader("traceparent");
        const forwardedState = call.getHeader("tracestate");
        observation.forwardedTraceparent = typeof forwardedParent === "string" && CARRIER.test(forwardedParent) ? forwardedParent : null;
        observation.forwardedTracestate = forwardedState === "contoso=cert" ? forwardedState : null;
        call.end(bytes);
      });
    })().catch(() => { fail(response, "LOCAL_REHEARSAL_FORWARD_FAILED", 502); });
  });
  const origin = await listen(server);
  return { origin, observations, async close() {
    for (const call of pending) call.destroy();
    await closeServer(server);
  } };
}
export function sanitizeBrowserEnvelope(item) {
  if (!["RemoteDependencyData", "PageviewData"].includes(item?.data?.baseType)) return undefined;
  const base = item.data.baseData;
  const tags = item.tags;
  requireValue(base && tags && tags["ai.cloud.role"] === "contoso-storefront-spa"
    && TRACE.test(tags["ai.operation.id"]) && SAFE_ID.test(base.id)
    && typeof item.time === "string" && Number.isFinite(Date.parse(item.time)), "LOCAL_REHEARSAL_BROWSER_ENVELOPE_INVALID");
  const safeTags = { "ai.cloud.role": tags["ai.cloud.role"], "ai.operation.id": tags["ai.operation.id"] };
  if (tags["ai.operation.parentId"] !== undefined) {
    requireValue(SAFE_ID.test(tags["ai.operation.parentId"]), "LOCAL_REHEARSAL_BROWSER_PARENT_INVALID");
    safeTags["ai.operation.parentId"] = tags["ai.operation.parentId"];
  }
  requireValue(typeof base.name === "string" && /^[A-Za-z0-9._ /:{}-]{1,160}$/.test(base.name)
    && !/Bearer\s|InstrumentationKey=|eyJ[A-Za-z0-9_-]+\./.test(base.name),
    "LOCAL_REHEARSAL_BROWSER_NAME_INVALID");
  const baseData = { id: base.id, name: base.name };
  if (UUID.test(base.properties?.["business.invocation_id"]))
    baseData.properties = { "business.invocation_id": base.properties["business.invocation_id"] };
  return { time: item.time, tags: safeTags, data: { baseType: item.data.baseType, baseData } };
}
function spanId(value, traceId) {
  if (typeof value !== "string") return undefined;
  if (SPAN.test(value)) return value;
  const match = /^\|([0-9a-f]{32})\.([0-9a-f]{16})\.?$/.exec(value);
  return match && match[1] === traceId && SPAN.test(match[2]) ? match[2] : undefined;
}
export function assertLocalParentJoin(evidence, browserEnvelopes, ordersEnvelopes, forwarded, ordersIngress = []) {
  requireValue(evidence.executionMode === "local" && evidence.evidenceKind === "local-observation"
    && evidence.driverKind === "browser-spa" && evidence.outcome === "staged" && UUID.test(evidence.runId)
    && UUID.test(evidence.businessInvocationId), "LOCAL_REHEARSAL_BROWSER_ACTION_REQUIRED");
  const actions = evidence.observations.filter(item => item.method === "POST" && item.path === "/contoso/v1/orders");
  requireValue(actions.length === 1 && actions[0].status >= 200 && actions[0].status < 300
    && actions[0].businessInvocationId === evidence.businessInvocationId && actions[0].contextRedacted !== true,
    "LOCAL_REHEARSAL_SINGLE_ACTION_REQUIRED");
  const carrier = CARRIER.exec(actions[0].traceparent ?? "");
  requireValue(carrier, "LOCAL_REHEARSAL_SAMPLED_BROWSER_CARRIER_REQUIRED");
  const [, traceId, browserSpanId] = carrier;
  const dependencies = evidence.dependencies.filter(item => item.traceId === traceId && item.spanId === browserSpanId
    && item.runId === evidence.runId && item.invocationVersion === evidence.invocationVersion);
  requireValue(dependencies.length === 1, "LOCAL_REHEARSAL_CURRENT_DEPENDENCY_REQUIRED");
  const browser = browserEnvelopes.filter(item => item.data?.baseType === "RemoteDependencyData"
    && item.tags?.["ai.cloud.role"] === "contoso-storefront-spa" && item.tags["ai.operation.id"] === traceId
    && spanId(item.data.baseData?.id, traceId) === browserSpanId);
  requireValue(browser.length >= 1, "LOCAL_REHEARSAL_EXPORTED_BROWSER_DEPENDENCY_REQUIRED");
  const hops = forwarded.filter(item => item.method === "POST" && item.path === "/contoso/v1/orders");
  requireValue(hops.length === 1 && hops[0].traceparent === actions[0].traceparent
    && hops[0].targetPath === "/api/orders" && hops[0].status === actions[0].status
    && hops[0].forwardedTraceparent === actions[0].traceparent && hops[0].tracestate === actions[0].tracestate
    && (hops[0].forwardedTracestate ?? undefined) === actions[0].tracestate
    && !hops[0].legacyRequestIdPresent && !hops[0].legacyCorrelationContextPresent,
  "LOCAL_REHEARSAL_PASS_THROUGH_REQUIRED");
  const orders = ordersEnvelopes.filter(item => item.data?.baseType === "RequestData"
    && item.tags?.["ai.cloud.role"] === "contoso-orders-api" && item.tags["ai.operation.id"] === traceId
    && spanId(item.tags["ai.operation.parentId"], traceId) === browserSpanId
    && spanId(item.data.baseData?.id, traceId)
    && (item.data.baseData.name === "POST /api/orders" || (() => {
      try { return new URL(item.data.baseData.url).pathname === "/api/orders"; } catch { return false; }
    })()));
  const ids = new Set(orders.map(item => spanId(item.data.baseData.id, traceId)));
  requireValue(ids.size === 1, "LOCAL_REHEARSAL_ORDERS_PARENT_JOIN_REQUIRED");
  const ordersRequestSpanId = [...ids][0];
  const ingress = ordersIngress.filter(item => item.schema === "contoso.local-pair-ingress.v1"
    && item.profile === "LOCAL REHEARSAL" && item.method === "POST" && item.path === "/api/orders"
    && item.traceparent === actions[0].traceparent);
  requireValue(ingress.length === 1 && ingress[0].tracestate === actions[0].tracestate
    && ingress[0].sdkTraceId === traceId && ingress[0].sdkSpanId === ordersRequestSpanId
    && (ingress[0].businessInvocationId === undefined || UUID.test(ingress[0].businessInvocationId))
    && typeof ingress[0].observedAtUtc === "string" && Number.isFinite(Date.parse(ingress[0].observedAtUtc)),
  "LOCAL_REHEARSAL_ORDERS_RECEIVED_CARRIER_REQUIRED");
  return { traceId, browserDependencySpanId: browserSpanId, ordersRequestSpanId,
    ordersParentId: spanId(orders[0].tags["ai.operation.parentId"], traceId),
    ordersReceivedTraceparent: ingress[0].traceparent,
    ...(ingress[0].tracestate !== undefined ? { ordersReceivedTracestate: ingress[0].tracestate } : {}),
    forwarderCreatesSpan: false };
}
export async function buildLocalBrowser(outputDirectory) {
  const out = repositoryPath(outputDirectory);
  const { build } = await import("vite");
  await build({ configFile: false, root: portalRoot, logLevel: "error", publicDir: false,
    build: { outDir: join(out, "assets"), emptyOutDir: true, sourcemap: false,
      lib: { entry: join(portalRoot, "tests", "browser", "local-rehearsal-entry.ts"),
        formats: ["es"], fileName: () => "storefront.js", cssFileName: "storefront" }, cssCodeSplit: false } });
  await build({ configFile: false, root: portalRoot, logLevel: "error", publicDir: false,
    build: { outDir: join(out, "driver"), emptyOutDir: true, sourcemap: false, ssr: join(portalRoot, "src", "browser-adapter.ts"),
      rollupOptions: { output: { entryFileNames: "browser-adapter.mjs" } } } });
  return { assetsRoot: join(out, "assets"), adapterFile: join(out, "driver", "browser-adapter.mjs") };
}
export async function startLocalSurface({ ordersOrigin, assetsRoot, gatewayAccessToken }) {
  ordersOrigin = loopbackOrigin(ordersOrigin);
  assetsRoot = repositoryPath(assetsRoot);
  const browserEnvelopes = [];
  const excludedObservations = [];
  let config;
  let forwarder;
  let webOrigin;
  const excluded = createServer((request, response) => {
    excludedObservations.push({ method: request.method, traceparentPresent: "traceparent" in request.headers,
      tracestatePresent: "tracestate" in request.headers, legacyRequestIdPresent: "request-id" in request.headers,
      legacyCorrelationContextPresent: "correlation-context" in request.headers,
      authorizationPresent: "authorization" in request.headers });
    response.writeHead(200, { "Access-Control-Allow-Origin": webOrigin, "Content-Type": "text/plain" });
    response.end("LOCAL REHEARSAL excluded-origin control");
  });
  const web = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", webOrigin).pathname;
      response.setHeader("Cache-Control", "no-store");
      if (path === "/storefront/orders" || path === "/storefront/") {
        const template = await readFile(resolve(portalRoot, "..", "storefront-spa", "index.html"), "utf8");
        const injected = `<script type="application/json" id="contoso-runtime-config">${JSON.stringify(config).replace(/</g, "\\u003c")}</script>`;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${webOrigin} ${forwarder.origin} ${excludedOrigin}; img-src 'self' data:; base-uri 'none'; form-action 'none'`);
        response.end(template.replace("<!--CONTOSO_RUNTIME_CONFIG-->", injected)
          .replace('<script type="module" src="/src/main.ts"></script>',
            '<script type="module" src="/local-rehearsal/storefront.js"></script><link rel="stylesheet" href="/local-rehearsal/storefront.css">'));
        return;
      }
      if (path === "/local-rehearsal/storefront.js" || path === "/local-rehearsal/storefront.css") {
        response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css");
        response.end(await readFile(join(assetsRoot, path.endsWith(".js") ? "storefront.js" : "storefront.css"))); return;
      }
      if (path === "/v2/track" && request.method === "POST") {
        let bytes = await body(request, 1_000_000);
        if (request.headers["content-encoding"] === "gzip" || (bytes[0] === 0x1f && bytes[1] === 0x8b))
          bytes = gunzipSync(bytes, { maxOutputLength: 1_000_000 });
        if (request.headers["content-encoding"] === "deflate") bytes = inflateSync(bytes, { maxOutputLength: 1_000_000 });
        const text = bytes.toString("utf8");
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text.split("\n").filter(Boolean).map(line => JSON.parse(line)); }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const safe = sanitizeBrowserEnvelope(item);
          if (safe) { requireValue(browserEnvelopes.length < 500, "LOCAL_REHEARSAL_TELEMETRY_CAPACITY"); browserEnvelopes.push(safe); }
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ itemsReceived: items.length, itemsAccepted: items.length, errors: [] })); return;
      }
      fail(response, "LOCAL_REHEARSAL_ROUTE_REJECTED", 404);
    })().catch(() => { fail(response, "LOCAL_REHEARSAL_SURFACE_FAILED", 500); });
  });
  let excludedOrigin;
  try {
    webOrigin = await listen(web);
    excludedOrigin = await listen(excluded);
    forwarder = await createLocalForwarder({ ordersOrigin, approvedOrigin: webOrigin, gatewayAccessToken });
    const apiClientId = randomUUID();
    config = { schemaVersion: 1, executionMode: "local", environment: "poc", surface: "storefront-spa",
      deploymentStamp: "local-rehearsal-current-source", api: { origin: forwarder.origin, basePath: "/contoso/v1" },
      identity: { tenantId: randomUUID(), spaClientId: randomUUID(), apiClientId, apiAudience: apiClientId,
        scopes: [`api://${apiClientId}/Orders.Invoke`], spaRedirectUri: `${webOrigin}/storefront/auth/redirect.html`,
        postLogoutRedirectUri: `${webOrigin}/storefront/` },
      portal: { origin: webOrigin, entryPath: "/portal/", authProfile: "workload-only", enabled: false },
      telemetry: { connectionString: `InstrumentationKey=${randomUUID()};IngestionEndpoint=${webOrigin}/`,
        roleName: "contoso-storefront-spa", tracingMode: "W3C_TRACE", samplingPercentage: 100,
        approvedCorrelationOrigins: [forwarder.origin], excludedCorrelationHosts: ["login.microsoftonline.com"] },
      certification: { enabled: true, startsAtUtc: new Date(Date.now() - 1000).toISOString(),
        endsAtUtc: new Date(Date.now() + 120000).toISOString(), windowId: randomUUID() },
      demos: { controllerVersion: 1, enabled: true, allowedDemoIds: [1] } };
    return { webOrigin, forwarderOrigin: forwarder.origin, excludedOrigin, browserEnvelopes, excludedObservations,
      forwarderObservations: forwarder.observations, async close() {
        await Promise.all([forwarder.close(), closeServer(web), closeServer(excluded)]);
      } };
  } catch (error) {
    if (forwarder) await forwarder.close();
    await Promise.all([closeServer(web), closeServer(excluded)]);
    throw error;
  }
}
export async function observeExcludedOrigin(page, surface) {
  await page.evaluate(async origin => {
    await fetch(`${origin}/fixture-excluded`, { mode: "cors", credentials: "omit", redirect: "error" });
    await new Promise((accept, reject) => {
      const call = new XMLHttpRequest();
      call.open("GET", `${origin}/fixture-excluded`);
      call.onload = accept; call.onerror = reject; call.send();
    });
  }, surface.excludedOrigin);
  requireValue(surface.excludedObservations.length === 2 && surface.excludedObservations.every(item => item.method === "GET"
    && !item.traceparentPresent && !item.tracestatePresent && !item.legacyRequestIdPresent
    && !item.legacyCorrelationContextPresent && !item.authorizationPresent), "LOCAL_REHEARSAL_EXCLUDED_ORIGIN_LEAK");
  return { fetchRequests: 1, xhrRequests: 1, contextHeaders: 0, authorizationHeaders: 0 };
}
export async function observeCorsDenial(context, surface) {
  const count = surface.forwarderObservations.length;
  const page = await context.newPage();
  try {
    await page.goto(`${surface.excludedOrigin}/fixture-excluded`);
    const denied = await page.evaluate(async origin => {
      try {
        await fetch(`${origin}/contoso/v1/orders`, { method: "POST",
          headers: { "Content-Type": "application/json" }, body: "{}", redirect: "error", credentials: "omit" });
        return false;
      } catch { return true; }
    }, surface.forwarderOrigin);
    requireValue(denied && surface.forwarderObservations.length === count, "LOCAL_REHEARSAL_CORS_DENIAL_REQUIRED");
    return { deniedUnapprovedOrigin: true, forwardedRequests: 0 };
  } finally { await page.close(); }
}
async function readEnvelopes(path) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
export async function runLocalRehearsal({ pairFile, outputDirectory }) {
  const pair = await readLocalPair(pairFile);
  const output = repositoryPath(outputDirectory);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const work = join(output, "browser-work");
  await mkdir(work);
  const sourcesBefore = await sourceHashes();
  await writeFile(join(output, "sources-before.json"), `${JSON.stringify(sourcesBefore, null, 2)}\n`);
  const environment = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH };
  process.env.TEMP = work; process.env.TMP = work; process.env.TMPDIR = work;
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(portalRoot, ".cache", "browsers");
  let browser;
  let surface;
  const receipt = { schema: "contoso.local-browser-rehearsal.v1", profile: "LOCAL REHEARSAL", status: "BLOCKED",
    nativeEvidence: false, certificationEligible: false,
    pairManifestFile: relative(projectRoot, pair.manifestFile), pairTelemetryFile: relative(projectRoot, pair.telemetryPath),
    pairIngressFile: relative(projectRoot, pair.ingressPath),
    browserEvidenceFile: "browser-evidence.json", browserTelemetryFile: "browser-telemetry.ndjson",
    cleanup: { browserClosed: true, loopbackServersClosed: true },
    limitations: ["Synthetic identity; no Entra proof", "H2 PostgreSQL mode and RESP substitutes are not real stores",
      "Pass-through forwarder is not APIM and creates no span", "No Azure traffic or native certification"] };
  try {
    const built = await buildLocalBrowser(output);
    const { chromium } = await import("@playwright/test");
    const { driveContosoBrowser } = await import(pathToFileURL(built.adapterFile).href);
    const tokenResponse = await fetch(pair.tokenUrl, { redirect: "error", signal: AbortSignal.timeout(10000) });
    requireValue(tokenResponse.ok, "LOCAL_REHEARSAL_SYNTHETIC_TOKEN_UNAVAILABLE");
    const tokenResult = await tokenResponse.json();
    requireValue([tokenResult.accessToken, tokenResult.gatewayAccessToken].every(value => typeof value === "string"
      && value.length > 0 && value.length < 32000 && !/[\x00-\x20\x7f]/.test(value)), "LOCAL_REHEARSAL_SYNTHETIC_TOKEN_INVALID");
    surface = await startLocalSurface({ ordersOrigin: pair.ordersOrigin, assetsRoot: built.assetsRoot,
      gatewayAccessToken: tokenResult.gatewayAccessToken });
    receipt.cleanup.loopbackServersClosed = false;
    browser = await chromium.launch({ headless: true });
    receipt.cleanup.browserClosed = false;
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.exposeBinding("contosoLocalRehearsalToken", source => {
      requireValue(new URL(source.frame.url()).origin === surface.webOrigin, "LOCAL_REHEARSAL_TOKEN_ORIGIN_REJECTED");
      return tokenResult.accessToken;
    });
    const allowed = new Set([surface.webOrigin, surface.forwarderOrigin, surface.excludedOrigin]);
    let blockedRequests = 0;
    await context.route("**/*", route => {
      if (!allowed.has(new URL(route.request().url()).origin)) { blockedRequests++; return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${surface.webOrigin}/storefront/orders`);
    const evidence = await driveContosoBrowser(page, localDemo01Spec());
    const control = await page.evaluate(() => window.contosoLocalRehearsalClickReceipt?.());
    requireValue(control?.control === "contoso-run-demo" && control.trustedClicks === 1, "LOCAL_REHEARSAL_REAL_DEMO01_CLICK_REQUIRED");
    const label = await page.locator("#execution-mode").textContent();
    requireValue(label?.startsWith("LOCAL REHEARSAL"), "LOCAL_REHEARSAL_LABEL_REQUIRED");
    await writeFile(join(output, "browser-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await writeFile(join(output, "browser-telemetry.ndjson"), surface.browserEnvelopes.map(item => JSON.stringify(item)).join("\n") + "\n");
    await writeFile(join(output, "forwarder-observations.json"), `${JSON.stringify(surface.forwarderObservations, null, 2)}\n`);
    const negative = await observeExcludedOrigin(page, surface);
    const corsNegative = await observeCorsDenial(context, surface);
    requireValue(blockedRequests === 0, "LOCAL_REHEARSAL_UNEXPECTED_BROWSER_DESTINATION");
    let parentJoin;
    let lastError;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try {
        const [jvm, ingress] = await Promise.all([readEnvelopes(pair.telemetryPath), readEnvelopes(pair.ingressPath)]);
        parentJoin = assertLocalParentJoin(evidence, surface.browserEnvelopes, jvm, surface.forwarderObservations, ingress);
        break;
      } catch (error) { lastError = error; await new Promise(accept => setTimeout(accept, 500)); }
    }
    if (!parentJoin) throw lastError ?? new Error("LOCAL_REHEARSAL_ORDERS_PARENT_JOIN_REQUIRED");
    Object.assign(receipt, { status: "PASS", runId: evidence.runId, observedAtUtc: new Date().toISOString(), browserLabel: label,
      parentJoin, excludedOriginControl: negative, corsControl: corsNegative, browserVersion: evidence.browserVersion,
      browserRequestsOutsideAllowlist: blockedRequests, entryControl: control });
  } catch (error) {
    receipt.blockedReason = error.message?.startsWith("LOCAL_") ? error.message : "LOCAL_REHEARSAL_FAILED";
    throw error;
  } finally {
    try { if (browser) await browser.close(); receipt.cleanup.browserClosed = true; }
    catch {
      receipt.status = "BLOCKED"; receipt.blockedReason = "LOCAL_REHEARSAL_BROWSER_CLEANUP_FAILED";
      throw new Error("LOCAL_REHEARSAL_BROWSER_CLEANUP_FAILED");
    }
    finally {
      try { if (surface) await surface.close(); receipt.cleanup.loopbackServersClosed = true; }
      catch {
        receipt.status = "BLOCKED"; receipt.blockedReason = "LOCAL_REHEARSAL_SERVER_CLEANUP_FAILED";
        throw new Error("LOCAL_REHEARSAL_SERVER_CLEANUP_FAILED");
      }
      finally {
        for (const [key, value] of Object.entries(environment)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        const sourcesAfter = await sourceHashes();
        receipt.sourceInputsStable = JSON.stringify(sourcesBefore) === JSON.stringify(sourcesAfter);
        if (!receipt.sourceInputsStable) { receipt.status = "BLOCKED"; receipt.blockedReason = "LOCAL_REHEARSAL_SOURCES_CHANGED"; }
        await writeFile(join(output, "sources-after.json"), `${JSON.stringify(sourcesAfter, null, 2)}\n`);
        await writeFile(join(output, "local-browser-rehearsal.json"), `${JSON.stringify(receipt, null, 2)}\n`);
      }
    }
  }
  requireValue(receipt.sourceInputsStable, "LOCAL_REHEARSAL_SOURCES_CHANGED");
  requireValue(receipt.cleanup.browserClosed && receipt.cleanup.loopbackServersClosed, "LOCAL_REHEARSAL_CLEANUP_REQUIRED");
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pairIndex = args.indexOf("--pair");
  const outIndex = args.indexOf("--out");
  try {
    requireValue(pairIndex >= 0 && outIndex >= 0 && args.length === 4, "USAGE: node web\\portal-ssr\\scripts\\local-rehearsal.mjs --pair <local-pair.json> --out <new-repository-directory>");
    const receipt = await runLocalRehearsal({ pairFile: args[pairIndex + 1], outputDirectory: args[outIndex + 1] });
    process.stdout.write(`LOCAL REHEARSAL PASS: browser dependency -> Orders parent join; Fetch/XHR excluded-origin controls clean; helpers stopped. ${receipt.runId}\n`);
  } catch (error) {
    process.stderr.write(`${error.message?.startsWith("LOCAL_") || error.message?.startsWith("USAGE:") ? error.message : "LOCAL_REHEARSAL_FAILED"}\n`);
    process.exitCode = 1;
  }
}
