import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createBrowserApi, guardedApiUrl } from "../../portal-ssr/dist/shared/browser-api.js";
import { ContosoError } from "../../portal-ssr/dist/shared/contracts.js";
import { fixtureConfig } from "../../portal-ssr/tests/fixture-config.ts";

test("FIXTURE Storefront routes use the single approved public API prefix", () => {
  const config = fixtureConfig();
  assert.equal(guardedApiUrl(config, "/orders").pathname, "/contoso/v1/orders");
  assert.equal(guardedApiUrl(config, `/demo-runs/${randomUUID()}`).origin, config.api.origin);
  assert.throws(() => guardedApiUrl(config, "/api/orders"));
  assert.throws(() => guardedApiUrl(config, "/orders#not-allowed"));
});

test("LOCAL LOOPBACK browser transport validates response identity without confusing durable and ingress IDs", async () => {
  const id = randomUUID();
  const businessInvocationId = randomUUID();
  const workflowBusinessInvocationId = randomUUID();
  const ingressId = randomUUID();
  let variant = "valid";
  const observations: { authorization: boolean; businessHeader: boolean; path: string }[] = [];
  const server = createServer((request, response) => {
    observations.push({ authorization: Boolean(request.headers.authorization),
      businessHeader: "x-business-invocation-id" in request.headers, path: request.url ?? "" });
    response.setHeader("Content-Type", variant === "html" ? "text/html" : "application/json");
    if (variant !== "missing-header")
      response.setHeader("x-business-invocation-id", request.method === "GET" || variant === "mismatch" ? ingressId : businessInvocationId);
    if (variant === "unavailable") { response.writeHead(503); response.end("sensitive error body is not evidence"); return; }
    if (variant === "redirect") { response.writeHead(307, { Location: "/credential-destination" }); response.end(); return; }
    if (variant === "oversize") { response.end("x".repeat(65537)); return; }
    if (variant === "slow") { setTimeout(() => response.end("{}"), 100); return; }
    response.end(JSON.stringify({ schemaVersion: 1, id: variant === "stale" ? randomUUID() : id,
      businessInvocationId: request.method === "GET" ? workflowBusinessInvocationId : businessInvocationId,
      ...(request.method === "POST" && variant !== "missing-durable"
        ? { workflowBusinessInvocationId: variant === "invalid-durable" ? "invalid" : workflowBusinessInvocationId } : {}),
      state: "DURABLE_STAGED", details: { source: "local-loopback", token: "not retained" } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const config = fixtureConfig(origin, origin);
  const api = createBrowserApi(config, async () => `local-fixture-${randomUUID()}`);
  const command = { schemaVersion: 1 as const, orderId: id, sku: "CONTOSO-001", quantity: 1 };
  try {
    const created = await api.order(command);
    assert.equal(created.businessInvocationId, businessInvocationId);
    assert.equal(created.workflowBusinessInvocationId, workflowBusinessInvocationId);
    assert.equal(created.details.token, undefined);
    const read = await api.workflow("orders", id);
    assert.equal(read.businessInvocationId, workflowBusinessInvocationId);
    assert.equal("workflowBusinessInvocationId" in read, false);
    assert.notEqual(read.businessInvocationId, ingressId);
    for (const current of ["mismatch", "missing-header", "stale", "html", "oversize", "missing-durable", "invalid-durable"]) {
      variant = current;
      await assert.rejects(api.order(command), { code: "API_RESPONSE_INVALID" }, current);
    }
    variant = "unavailable";
    await assert.rejects(api.order(command), { code: "API_REQUEST_FAILED", status: 503 });
    variant = "redirect";
    await assert.rejects(api.order(command), { code: "API_REQUEST_FAILED" });
    assert.ok(!observations.some(item => item.path === "/credential-destination"));
    variant = "slow";
    await assert.rejects(createBrowserApi(config, async () => randomUUID(), () => undefined, 20).order(command),
      { code: "API_REQUEST_FAILED", status: 504 });
    assert.ok(observations.every(item => item.authorization && !item.businessHeader));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("LOCAL browser transport fences credentials and post-auth sends when quiesced", async () => {
  const config = fixtureConfig();
  let credentials = 0;
  let accepting = true;
  const api = createBrowserApi(config, async () => { credentials++; accepting = false; return randomUUID(); },
    () => { if (!accepting) throw new ContosoError("CERT_WINDOW_INACTIVE", 409); });
  await assert.rejects(api.workflow("orders", "invalid"), { code: "REQUEST_INVALID" });
  assert.equal(credentials, 0);
  await assert.rejects(api.order({ schemaVersion: 1, sku: "CONTOSO-001", quantity: 1 }), { code: "CERT_WINDOW_INACTIVE" });
  assert.equal(credentials, 1);
  const authFailure = createBrowserApi(config, async () => { throw new Error("sensitive provider diagnostic"); });
  await assert.rejects(authFailure.identity(), error => error instanceof ContosoError && error.code === "AUTH_FAILED"
    && !error.message.includes("sensitive"));
  await assert.rejects(createBrowserApi(config, async () => "invalid\ncredential").identity(), { code: "AUTH_REQUIRED" });
  await assert.rejects(createBrowserApi(config, async () => new Promise<string>(resolve => setTimeout(() => resolve(randomUUID()), 100)),
    () => undefined, 20).identity(), { code: "API_REQUEST_FAILED", status: 504 });
});

test("LOCAL LOOPBACK repeated order and demo POSTs retain workflow A without confusing fresh action B", async () => {
  const stored = new Map<string, string>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) as { orderId?: string; runId?: string } : undefined;
      const id = body?.orderId ?? body?.runId ?? request.url?.split("/").at(-1) ?? "";
      const current = randomUUID();
      const original = stored.get(id) ?? current;
      stored.set(id, original);
      response.writeHead(200, { "Content-Type": "application/json", "x-business-invocation-id": current });
      response.end(JSON.stringify({ schemaVersion: 1, id,
        businessInvocationId: request.method === "POST" ? current : original,
        ...(request.method === "POST" ? { workflowBusinessInvocationId: original } : {}),
        state: "QUEUED", details: {} }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const api = createBrowserApi(fixtureConfig(origin, origin), async () => randomUUID());
  try {
    for (const collection of ["orders", "demo-runs"] as const) {
      const id = randomUUID();
      const send = () => collection === "orders"
        ? api.order({ schemaVersion: 1, orderId: id, sku: "CONTOSO-001", quantity: 1 })
        : api.demo({ schemaVersion: 1, runId: id, demoId: 2, scenario: "SYNC", failureBudget: 0 });
      const first = await send();
      const repeated = await send();
      assert.notEqual(repeated.businessInvocationId, first.businessInvocationId);
      assert.equal(repeated.workflowBusinessInvocationId, first.workflowBusinessInvocationId);
      const get = await api.workflow(collection, id);
      assert.equal(get.businessInvocationId, first.workflowBusinessInvocationId);
      assert.equal("workflowBusinessInvocationId" in get, false);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
