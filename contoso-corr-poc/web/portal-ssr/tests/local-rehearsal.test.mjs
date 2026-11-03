import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLocalParentJoin, buildLocalBrowser, createLocalForwarder, localDemo01Spec, loopbackOrigin,
  observeCorsDenial, observeExcludedOrigin, readLocalPair, repositoryPath, runLocalRehearsal, sanitizeBrowserEnvelope, SOURCE_INPUTS, startLocalSurface
} from "../scripts/local-rehearsal.mjs";

const portalRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = resolve(portalRoot, "..", "..");
async function server(handler) {
  const instance = createServer(handler);
  await new Promise((accept, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", accept);
  });
  return { origin: `http://127.0.0.1:${instance.address().port}`, async close() {
    instance.closeAllConnections();
    await new Promise(accept => instance.close(accept));
  } };
}
async function scratch() {
  const path = join(projectRoot, ".cache", "r2-local-rehearsal", randomUUID());
  await mkdir(path, { recursive: true });
  return path;
}
const traceId = "12".repeat(16);
const browserSpan = "34".repeat(8);
const ordersSpan = "56".repeat(8);
const carrier = `00-${traceId}-${browserSpan}-01`;
const approvedOrigin = "http://127.0.0.1:19321";

test("LOCAL REHEARSAL rejects non-loopback, credential, query and path destinations", () => {
  assert.equal(loopbackOrigin("http://127.0.0.1:19320/"), "http://127.0.0.1:19320");
  assert.equal(loopbackOrigin("http://[::1]:19320"), "http://[::1]:19320");
  for (const value of ["https://127.0.0.1:19320", "http://localhost:19320", "http://127.0.0.1.evil.invalid",
    "https://example.invalid", "http://127.0.0.1:19320/path", "http://127.0.0.1:19320/?a=1",
    "http://user:password@127.0.0.1:19320/", "http://127.0.0.1:19320/#x"])
    assert.throws(() => loopbackOrigin(value), /LOCAL_REHEARSAL_LOOPBACK_REQUIRED/);
  assert.throws(() => repositoryPath("..\\outside-local-rehearsal"), /REPOSITORY_PATH_REQUIRED/);
  assert.throws(() => localDemo01Spec("not-a-run-id"), /LOCAL_REHEARSAL_RUN_ID_REQUIRED/);
});

test("LOCAL REHEARSAL source closure is immutable and cannot be weakened by a caller", () => {
  const declared = [...SOURCE_INPUTS];
  assert.equal(Object.isFrozen(SOURCE_INPUTS), true);
  assert.throws(() => SOURCE_INPUTS.pop(), TypeError);
  assert.deepEqual(SOURCE_INPUTS, declared);
});

test("LOCAL REHEARSAL forwarder preserves actual W3C carrier and body without creating a span", async () => {
  const received = [];
  const backend = await server((request, response) => {
    const parts = [];
    request.on("data", part => parts.push(part));
    request.on("end", () => {
      received.push({ url: request.url, traceparent: request.headers.traceparent, tracestate: request.headers.tracestate,
        caller: request.headers.authorization, proof: request.headers["x-contoso-gateway-authorization"],
        bytes: Buffer.concat(parts).toString("utf8") });
      response.writeHead(202, { "Content-Type": "application/json", "x-business-invocation-id": randomUUID() });
      response.end('{"source":"actual-unit-loopback-response"}');
    });
  });
  const forwarder = await createLocalForwarder({ ordersOrigin: backend.origin, approvedOrigin, gatewayAccessToken: "local-unit-gateway" });
  try {
    const bytes = '{"schemaVersion":1,"sku":"CONTOSO-001","quantity":1}';
    const response = await fetch(`${forwarder.origin}/contoso/v1/orders`, {
      method: "POST", headers: { Origin: approvedOrigin, "Content-Type": "application/json",
        Authorization: "Bearer local-unit-access", traceparent: carrier, tracestate: "contoso=cert" }, body: bytes
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("access-control-allow-origin"), approvedOrigin);
    assert.equal(response.headers.get("access-control-expose-headers"), "x-business-invocation-id");
    assert.equal(await response.text(), '{"source":"actual-unit-loopback-response"}');
    assert.deepEqual(received, [{ url: "/api/orders", traceparent: carrier, tracestate: "contoso=cert",
      caller: "Bearer local-unit-access", proof: "Bearer local-unit-gateway", bytes }]);
    assert.equal(forwarder.observations[0].forwardedTraceparent, carrier);
    assert.equal(forwarder.observations[0].forwardedTracestate, "contoso=cert");
    assert.equal(forwarder.observations[0].legacyRequestIdPresent, false);
    assert.equal(JSON.stringify(forwarder.observations).includes("local-unit-"), false);
    assert.equal("spanId" in forwarder.observations[0], false);
  } finally { await forwarder.close(); await backend.close(); }
});

test("LOCAL REHEARSAL excluded origins and unsafe CORS preflights never reach Orders", async () => {
  let calls = 0;
  const backend = await server((_request, response) => { calls++; response.end("{}"); });
  const forwarder = await createLocalForwarder({ ordersOrigin: backend.origin, approvedOrigin });
  try {
    for (const headers of [
      { Origin: "http://127.0.0.1:19322", "Access-Control-Request-Method": "POST" },
      { Origin: approvedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-contoso-gateway-authorization" },
      { Origin: approvedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-business-invocation-id" },
      { Origin: approvedOrigin, "Access-Control-Request-Method": "DELETE" }
    ]) {
      const response = await fetch(`${forwarder.origin}/contoso/v1/orders`, { method: "OPTIONS", headers });
      assert.equal(response.status, 403);
    }
    const allowed = await fetch(`${forwarder.origin}/contoso/v1/orders`, { method: "OPTIONS", headers: {
      Origin: approvedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,traceparent,tracestate"
    } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
    assert.equal((await fetch(`${forwarder.origin}/contoso/v1/orders?unapproved=1`, { headers: { Origin: approvedOrigin } })).status, 404);
    assert.equal((await fetch(`${forwarder.origin}/contoso/v1/me`, { headers: { Origin: approvedOrigin } })).status, 404);
    assert.equal(calls, 0);
    assert.equal(forwarder.observations.length, 0);
  } finally { await forwarder.close(); await backend.close(); }
});

test("LOCAL REHEARSAL does not manufacture absent context or retain unsafe carrier values", async () => {
  const received = [];
  const backend = await server((request, response) => { received.push(request.headers.traceparent); response.end("{}"); });
  const forwarder = await createLocalForwarder({ ordersOrigin: backend.origin, approvedOrigin });
  try {
    await fetch(`${forwarder.origin}/contoso/v1/orders`, { method: "POST", headers: { Origin: approvedOrigin }, body: "{}" });
    await fetch(`${forwarder.origin}/contoso/v1/orders`, { method: "POST", headers: {
      Origin: approvedOrigin, traceparent: "unit-sensitive-not-a-carrier", tracestate: "unit-sensitive-not-a-state"
    }, body: "{}" });
    assert.deepEqual(received, [undefined, "unit-sensitive-not-a-carrier"]);
    assert.equal(forwarder.observations[0].forwardedTraceparent, null);
    assert.equal(forwarder.observations[1].forwardedTraceparent, null);
    assert.equal(JSON.stringify(forwarder.observations).includes("unit-sensitive"), false);
  } finally { await forwarder.close(); await backend.close(); }
});

test("LOCAL REHEARSAL forwarder rejects redirects without following credential-bearing requests", async () => {
  const requests = [];
  const backend = await server((request, response) => {
    requests.push(request.url);
    response.writeHead(307, { Location: "https://example.invalid/credential-destination" }); response.end();
  });
  const forwarder = await createLocalForwarder({ ordersOrigin: backend.origin, approvedOrigin });
  try {
    const response = await fetch(`${forwarder.origin}/contoso/v1/orders`, { method: "POST",
      headers: { Origin: approvedOrigin, Authorization: "Bearer local-unit-access" }, body: "{}" });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(requests, ["/api/orders"]);
  } finally { await forwarder.close(); await backend.close(); }
});

function envelope(type = "RemoteDependencyData") {
  return { time: new Date().toISOString(), iKey: "not-retained",
    tags: { "ai.cloud.role": "contoso-storefront-spa", "ai.operation.id": traceId,
      "ai.operation.parentId": "78".repeat(8), "ai.user.id": "not-retained" },
    data: { baseType: type, baseData: { id: `|${traceId}.${browserSpan}.`, name: "POST /contoso/v1/orders",
      properties: { secret: "not-retained", "business.invocation_id": randomUUID() } } } };
}
test("UNIT FIXTURE browser envelope capture preserves original parent and time, never manufactures missing context", () => {
  const raw = envelope();
  const safe = sanitizeBrowserEnvelope(raw);
  assert.equal(safe.time, raw.time);
  assert.equal(safe.data.baseData.id, raw.data.baseData.id);
  assert.equal(safe.tags["ai.operation.parentId"], raw.tags["ai.operation.parentId"]);
  assert.equal(JSON.stringify(safe).includes("not-retained"), false);
  delete raw.tags["ai.operation.parentId"];
  assert.equal("ai.operation.parentId" in sanitizeBrowserEnvelope(raw).tags, false);
  raw.data.baseType = "PageviewData"; raw.data.baseData.id = traceId;
  assert.equal(sanitizeBrowserEnvelope(raw).data.baseData.id, traceId);
  assert.equal(sanitizeBrowserEnvelope(envelope("ExceptionData")), undefined);
  raw.tags["ai.operation.parentId"] = "unsafe parent";
  assert.throws(() => sanitizeBrowserEnvelope(raw), /BROWSER_PARENT_INVALID/);
  raw.tags["ai.operation.parentId"] = browserSpan;
  raw.data.baseData.name = "Bearer unit-sensitive";
  assert.throws(() => sanitizeBrowserEnvelope(raw), /BROWSER_NAME_INVALID/);
});

function joinFixture() {
  const runId = randomUUID();
  const businessInvocationId = randomUUID();
  const browser = envelope();
  const evidence = { executionMode: "local", evidenceKind: "local-observation", driverKind: "browser-spa",
    outcome: "staged", runId, invocationVersion: 1, businessInvocationId,
    observations: [{ method: "POST", path: "/contoso/v1/orders", status: 202, traceparent: carrier, tracestate: "contoso=cert", businessInvocationId }],
    dependencies: [{ traceId, spanId: browserSpan, runId, invocationVersion: 1 }] };
  const orders = { tags: { "ai.cloud.role": "contoso-orders-api", "ai.operation.id": traceId, "ai.operation.parentId": browserSpan },
    data: { baseType: "RequestData", baseData: { id: ordersSpan, name: "POST /api/orders" } } };
  const forwarded = [{ method: "POST", path: "/contoso/v1/orders", traceparent: carrier, forwardedTraceparent: carrier,
    targetPath: "/api/orders", status: 202, tracestate: "contoso=cert", forwardedTracestate: "contoso=cert",
    legacyRequestIdPresent: false, legacyCorrelationContextPresent: false }];
  const ingress = [{ schema: "contoso.local-pair-ingress.v1", profile: "LOCAL REHEARSAL", method: "POST", path: "/api/orders",
    traceparent: carrier, tracestate: "contoso=cert", sdkTraceId: traceId, sdkSpanId: ordersSpan, observedAtUtc: new Date().toISOString() }];
  return { evidence, browser: [browser], orders: [orders], forwarded, ingress };
}
test("UNIT FIXTURE exact browser dependency and Orders parent join is accepted only as a local structural assertion", () => {
  const input = joinFixture();
  const join = assertLocalParentJoin(input.evidence, input.browser, input.orders, input.forwarded, input.ingress);
  assert.deepEqual(join, { traceId, browserDependencySpanId: browserSpan, ordersRequestSpanId: ordersSpan,
    ordersParentId: browserSpan, ordersReceivedTraceparent: carrier, ordersReceivedTracestate: "contoso=cert",
    forwarderCreatesSpan: false });
  assert.equal("nativeEvidence" in join, false);
  delete input.evidence.observations[0].tracestate;
  delete input.forwarded[0].tracestate;
  input.forwarded[0].forwardedTracestate = null;
  delete input.ingress[0].tracestate;
  assert.equal("ordersReceivedTracestate" in assertLocalParentJoin(
    input.evidence, input.browser, input.orders, input.forwarded, input.ingress), false);
  input.ingress[0].tracestate = "contoso=cert";
  assert.throws(() => assertLocalParentJoin(input.evidence, input.browser, input.orders, input.forwarded, input.ingress),
    /LOCAL_REHEARSAL_ORDERS_RECEIVED_CARRIER_REQUIRED/);
});
test("UNIT FIXTURE missing exported dependency, wrong parent, stale run and rewritten carriers fail closed", () => {
  const mutations = [
    input => { input.browser = []; },
    input => { input.orders = []; },
    input => { input.orders[0].tags["ai.operation.parentId"] = "90".repeat(8); },
    input => { input.orders[0].tags["ai.cloud.role"] = "contoso-inventory-api"; },
    input => { input.evidence.dependencies[0].runId = randomUUID(); },
    input => { input.evidence.observations[0].traceparent = carrier.slice(0, -2) + "00"; },
    input => { input.evidence.observations.push({ ...input.evidence.observations[0] }); },
    input => { input.forwarded[0].forwardedTraceparent = `00-${traceId}-${ordersSpan}-01`; },
    input => { input.browser[0].data.baseType = "PageviewData"; },
    input => { input.evidence.executionMode = "live"; },
    input => { input.evidence.observations[0].businessInvocationId = randomUUID(); },
    input => { input.forwarded[0].status = 500; },
    input => { input.forwarded[0].targetPath = "/api/not-orders"; },
    input => { input.ingress = []; },
    input => { delete input.ingress[0].traceparent; },
    input => { input.ingress[0].traceparent = carrier.slice(0, -2) + "00"; },
    input => { input.ingress[0].traceparent = `00-${traceId}-${ordersSpan}-01`; },
    input => { delete input.ingress[0].tracestate; },
    input => { input.ingress[0].tracestate = "contoso=rewritten"; },
    input => { input.ingress[0].sdkSpanId = browserSpan; },
    input => { input.evidence.observations[0].contextRedacted = true; }
  ];
  for (const mutate of mutations) {
    const input = joinFixture(); mutate(input);
    assert.throws(() => assertLocalParentJoin(input.evidence, input.browser, input.orders, input.forwarded, input.ingress), /LOCAL_REHEARSAL_/);
  }
});

test("LOCAL REHEARSAL pair manifest requires ready local origins and never accepts persisted tokens", async () => {
  const path = await scratch();
  const file = join(path, "local-pair.json");
  const manifest = { schemaVersion: 1, profile: "LOCAL REHEARSAL", ready: true,
    ordersOrigin: "http://127.0.0.1:19341", inventoryOrigin: "http://127.0.0.1:19342",
    receiverOrigin: "http://127.0.0.1:19343", controlOrigin: "http://127.0.0.1:19344",
    telemetryPath: "telemetry.ndjson", ingressPath: "ingress.ndjson" };
  try {
    await writeFile(file, JSON.stringify(manifest));
    const pair = await readLocalPair(file);
    assert.equal(pair.tokenUrl, "http://127.0.0.1:19344/token");
    assert.equal(pair.telemetryPath, join(path, "telemetry.ndjson"));
    assert.equal(pair.ingressPath, join(path, "ingress.ndjson"));
    for (const changes of [{ ready: false }, { profile: "APIM" }, { accessToken: "never-persist-this" },
      { controlOrigin: "https://example.invalid" }, { ordersOrigin: "http://127.0.0.1:19341/api/orders" }]) {
      await writeFile(file, JSON.stringify({ ...manifest, ...changes }));
      await assert.rejects(readLocalPair(file), /LOCAL_REHEARSAL_/);
    }
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("LOCAL REHEARSAL unavailable synthetic token blocks the executable driver without fabricated evidence and restores environment", async () => {
  const path = await scratch();
  const requests = [];
  const backend = await server((request, response) => {
    requests.push(request.url); response.writeHead(503); response.end("LOCAL REHEARSAL token unavailable");
  });
  const manifestFile = join(path, "local-pair.json");
  const output = join(path, "driver-output");
  const environment = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH };
  try {
    await writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, profile: "LOCAL REHEARSAL", ready: true,
      ordersOrigin: backend.origin, inventoryOrigin: backend.origin, receiverOrigin: backend.origin,
      controlOrigin: backend.origin, telemetryPath: "telemetry.ndjson", ingressPath: "ingress.ndjson" }));
    await assert.rejects(runLocalRehearsal({ pairFile: manifestFile, outputDirectory: output }),
      /LOCAL_REHEARSAL_SYNTHETIC_TOKEN_UNAVAILABLE/);
    const receipt = JSON.parse(await readFile(join(output, "local-browser-rehearsal.json"), "utf8"));
    assert.equal(receipt.status, "BLOCKED");
    assert.equal(receipt.nativeEvidence, false);
    assert.equal(receipt.certificationEligible, false);
    assert.equal(receipt.sourceInputsStable, true);
    assert.deepEqual(receipt.cleanup, { browserClosed: true, loopbackServersClosed: true });
    assert.equal("parentJoin" in receipt, false);
    assert.deepEqual(requests, ["/token"]);
    for (const [key, value] of Object.entries(environment)) assert.equal(process.env[key], value);
  } finally { await backend.close(); await rm(path, { recursive: true, force: true }); }
});

test("LOCAL REHEARSAL real Demo 01 Run-demo click preserves SDK carrier and rejects excluded-origin Fetch and XHR injection", async () => {
  const output = await scratch();
  const work = join(output, "browser-work");
  await mkdir(work);
  const oldEnvironment = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH };
  process.env.TEMP = work; process.env.TMP = work; process.env.TMPDIR = work;
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(portalRoot, ".cache", "browsers");
  let browser;
  let surface;
  let backend;
  const received = [];
  try {
    const built = await buildLocalBrowser(output);
    backend = await server((request, response) => {
      const parts = [];
      request.on("data", part => parts.push(part));
      request.on("end", () => {
        const command = JSON.parse(Buffer.concat(parts).toString("utf8"));
        received.push({ traceparent: request.headers.traceparent, tracestate: request.headers.tracestate,
          path: request.url, orderId: command.orderId });
        const actionId = randomUUID();
        response.writeHead(202, { "Content-Type": "application/json", "x-business-invocation-id": actionId });
        response.end(JSON.stringify({ schemaVersion: 1, id: command.orderId, businessInvocationId: actionId,
          workflowBusinessInvocationId: randomUUID(), state: "DURABLE_STAGED", details: { source: "unit-loopback-not-JVM" } }));
      });
    });
    surface = await startLocalSurface({ ordersOrigin: backend.origin, assetsRoot: built.assetsRoot });
    const { chromium } = await import("@playwright/test");
    const { driveContosoBrowser } = await import(pathToFileURL(built.adapterFile).href);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.exposeBinding("contosoLocalRehearsalToken", source => {
      assert.equal(new URL(source.frame.url()).origin, surface.webOrigin);
      return "local-unit-browser-access";
    });
    const allowed = new Set([surface.webOrigin, surface.forwarderOrigin, surface.excludedOrigin]);
    let blocked = 0;
    await context.route("**/*", route => {
      if (!allowed.has(new URL(route.request().url()).origin)) { blocked++; return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${surface.webOrigin}/storefront/orders`);
    await page.evaluate(async () => window.contosoDemos?.ready);
    assert.equal(await page.getByTestId("contoso-run-demo").isEnabled(), true,
      "WEB-01.1 requires the admitted real Demo 01 Run demo control, not Create order");
    const spec = localDemo01Spec();
    assert.equal(spec.kind, "demo");
    assert.equal(spec.demoId, 1);
    const result = await driveContosoBrowser(page, spec);
    const control = await page.evaluate(() => window.contosoLocalRehearsalClickReceipt?.());
    assert.deepEqual(control, { control: "contoso-run-demo", trustedClicks: 1 });
    assert.equal(result.outcome, "staged");
    assert.equal(result.evidenceKind, "local-observation");
    assert.match(await page.locator("#execution-mode").textContent(), /^LOCAL REHEARSAL/);
    assert.match(await page.locator("#auth-state").textContent(), /synthetic identity.*no Entra authentication proof/);
    assert.match(await page.locator("#window-state").textContent(), /LOCAL REHEARSAL/);
    assert.equal(received.length, 1);
    assert.equal(result.dependencies.length, 1);
    assert.equal(received[0].path, "/api/orders");
    assert.equal(received[0].orderId, result.runId);
    const identity = result.dependencies[0];
    assert.equal(received[0].traceparent, `00-${identity.traceId}-${identity.spanId}-01`);
    assert.equal(surface.forwarderObservations[0].forwardedTraceparent, received[0].traceparent);
    assert.ok(surface.browserEnvelopes.some(item => item.data.baseType === "RemoteDependencyData"
      && item.data.baseData.id.includes(identity.spanId)));
    assert.deepEqual(await observeExcludedOrigin(page, surface),
      { fetchRequests: 1, xhrRequests: 1, contextHeaders: 0, authorizationHeaders: 0 });
    assert.deepEqual(await observeCorsDenial(context, surface), { deniedUnapprovedOrigin: true, forwardedRequests: 0 });
    assert.equal(received.length, 1);
    assert.equal(blocked, 0);
    assert.throws(() => assertLocalParentJoin(result, surface.browserEnvelopes, [], surface.forwarderObservations),
      /LOCAL_REHEARSAL_ORDERS_PARENT_JOIN_REQUIRED/);
    const serialized = JSON.stringify({ result, envelopes: surface.browserEnvelopes, observations: surface.forwarderObservations });
    assert.equal(serialized.includes("Bearer "), false);
    assert.equal(serialized.includes("InstrumentationKey="), false);
    assert.equal(serialized.includes("local-unit-browser-access"), false);
    if (process.env.CONTOSO_LOCAL_REHEARSAL_CAPTURE_DIRECTORY) {
      const capture = repositoryPath(process.env.CONTOSO_LOCAL_REHEARSAL_CAPTURE_DIRECTORY);
      await mkdir(capture, { recursive: false });
      await writeFile(join(capture, "browser-evidence.json"), `${JSON.stringify(result, null, 2)}\n`);
      await writeFile(join(capture, "browser-telemetry.ndjson"), surface.browserEnvelopes.map(item => JSON.stringify(item)).join("\n") + "\n");
      await writeFile(join(capture, "capture-scope.json"), `${JSON.stringify({
        profile: "LOCAL REHEARSAL", status: "BROWSER_ONLY_NOT_JVM_PARENT_JOIN", backend: "unit-loopback-not-JVM",
        nativeEvidence: false, certificationEligible: false, noOrdersSpanManufactured: true,
        browserVersion: result.browserVersion, excludedOriginRequests: 2, excludedOriginContextHeaders: 0,
        unapprovedOriginCorsDenied: true, forwardedUnapprovedOriginRequests: 0, entryControl: control
      }, null, 2)}\n`);
    }
    process.stdout.write(`# Browser runtime ${result.browserVersion}; actual local UI/SDK only; no JVM/APIM/Azure proof\n`);
  } finally {
    if (browser) await browser.close();
    if (surface) await surface.close();
    if (backend) await backend.close();
    for (const [key, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(output, { recursive: true, force: true });
  }
});
