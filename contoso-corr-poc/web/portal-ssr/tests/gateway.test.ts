import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createPortalGateway } from "../dist/gateway.js";
import { approvedGatewayRequest } from "../dist/telemetry.js";
import { ContosoError } from "../dist/shared/contracts.js";
import { fixtureConfig } from "./fixture-config.ts";

test("LOCAL native Gateway destination guard requires exact origin, safe path and explicit protocol", () => {
  const config = fixtureConfig();
  const approved = { hostname: "127.0.0.1", port: 41002, protocol: "http:", path: "/contoso/v1/orders", method: "POST" };
  assert.equal(approvedGatewayRequest(config, approved), true);
  for (const patch of [
    { port: 41003 }, { protocol: "https:" }, { path: "/contoso/v1/orders?not-retained=private" },
    { path: "/metadata/identity/oauth2/token" }, { hostname: "login.microsoftonline.com" },
    { auth: "not-accepted" }, { method: "DELETE" }, { protocol: undefined }
  ]) assert.equal(approvedGatewayRequest(config, { ...approved, ...patch }), false);
  const ipv6 = fixtureConfig("http://[::1]:41001", "http://[::1]:41002");
  assert.equal(approvedGatewayRequest(ipv6, { ...approved, hostname: "::1" }), true);
});

test("LOCAL LOOPBACK Portal HTTP transport preserves GET durable identity and rejects conflicting POST responses", async () => {
  const id = randomUUID();
  const businessInvocationId = randomUUID();
  const workflowBusinessInvocationId = randomUUID();
  let variant = "valid";
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    assert.ok(request.headers.authorization);
    assert.equal(request.headers["x-business-invocation-id"], businessInvocationId);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("x-business-invocation-id", request.method === "GET" || variant === "mismatch" ? randomUUID() : businessInvocationId);
    if (variant === "redirect") { response.writeHead(307, { Location: "/not-followed" }); response.end(); return; }
    if (variant === "oversize") { response.end("x".repeat(65537)); return; }
    response.end(JSON.stringify({ schemaVersion: 1, id: variant === "stale" ? randomUUID() : id,
      businessInvocationId: request.method === "GET" ? workflowBusinessInvocationId : businessInvocationId,
      ...(request.method === "POST" && variant !== "missing-durable"
        ? { workflowBusinessInvocationId: variant === "invalid-durable" ? "invalid" : workflowBusinessInvocationId } : {}),
      state: "DURABLE_STAGED", details: {} }));
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = fixtureConfig("http://127.0.0.1:41001", `http://127.0.0.1:${address.port}`);
  let credentials = 0;
  const gateway = createPortalGateway(config, async () => { credentials++; return `local-fixture-${randomUUID()}`; });
  const command = { schemaVersion: 1 as const, orderId: id, sku: "CONTOSO-001", quantity: 1 };
  try {
    const created = await gateway.createOrder(command, businessInvocationId);
    assert.equal(created.businessInvocationId, businessInvocationId);
    assert.equal(created.workflowBusinessInvocationId, workflowBusinessInvocationId);
    assert.equal((await gateway.readOrder(id, businessInvocationId)).businessInvocationId, workflowBusinessInvocationId);
    for (const current of ["mismatch", "stale", "oversize", "missing-durable", "invalid-durable"]) {
      variant = current;
      await assert.rejects(gateway.createOrder(command, businessInvocationId), { code: "API_RESPONSE_INVALID" });
    }
    const before = calls;
    variant = "redirect";
    await assert.rejects(gateway.createOrder(command, businessInvocationId), { code: "API_REQUEST_FAILED", status: 307 });
    assert.equal(calls, before + 1);
    const beforeCredentials = credentials;
    assert.throws(() => gateway.createOrder({ ...command, sku: "unsafe" }, businessInvocationId), { code: "REQUEST_INVALID" });
    assert.equal(credentials, beforeCredentials);
    let accepting = true;
    const guarded = createPortalGateway(config, async () => { accepting = false; return randomUUID(); }, 1000,
      () => { if (!accepting) throw new ContosoError("CERT_WINDOW_INACTIVE", 409); });
    await assert.rejects(guarded.createOrder(command, businessInvocationId), { code: "CERT_WINDOW_INACTIVE" });
    assert.equal(calls, before + 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await assert.rejects(gateway.createOrder(command, businessInvocationId), { code: "API_REQUEST_FAILED" });
});

test("LOCAL LOOPBACK absolute Gateway deadline stops a continuously active response and noncooperating credential provider", async () => {
  const id = randomUUID();
  const businessInvocationId = randomUUID();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "Content-Type": "application/json", "x-business-invocation-id": businessInvocationId });
    const timer = setInterval(() => response.write(" "), 5);
    const end = setTimeout(() => response.end(JSON.stringify({ schemaVersion: 1, id, businessInvocationId,
      state: "DURABLE_STAGED", details: {} })), 1000);
    response.on("close", () => { clearInterval(timer); clearTimeout(end); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = fixtureConfig("http://127.0.0.1:41001", `http://127.0.0.1:${address.port}`);
  const command = { schemaVersion: 1 as const, orderId: id, sku: "CONTOSO-001", quantity: 1 };
  try {
    const started = performance.now();
    await assert.rejects(createPortalGateway(config, async () => randomUUID(), 40).createOrder(command, businessInvocationId),
      { code: "API_REQUEST_FAILED", status: 504 });
    assert.ok(performance.now() - started < 500);
    const before = requests;
    await assert.rejects(createPortalGateway(config, async () => new Promise<string>(resolve => setTimeout(() => resolve(randomUUID()), 150)), 40)
      .createOrder(command, businessInvocationId), { code: "API_REQUEST_FAILED", status: 504 });
    await new Promise<void>(resolve => setTimeout(resolve, 170));
    assert.equal(requests, before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("LOCAL LOOPBACK repeated Portal mutation keeps stored A and accepts each current action B", async () => {
  const id = randomUUID();
  let stored: string | undefined;
  const server = createServer((request, response) => {
    const current = request.headers["x-business-invocation-id"];
    assert.equal(typeof current, "string");
    stored ??= current as string;
    response.writeHead(200, { "Content-Type": "application/json", "x-business-invocation-id": current as string });
    response.end(JSON.stringify({ schemaVersion: 1, id,
      businessInvocationId: request.method === "POST" ? current : stored,
      ...(request.method === "POST" ? { workflowBusinessInvocationId: stored } : {}),
      state: "QUEUED", details: {} }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = fixtureConfig("http://127.0.0.1:41001", `http://127.0.0.1:${address.port}`);
  const gateway = createPortalGateway(config, async () => randomUUID());
  const command = { schemaVersion: 1 as const, orderId: id, sku: "CONTOSO-001", quantity: 1 };
  const a = randomUUID();
  const b = randomUUID();
  try {
    assert.equal((await gateway.createOrder(command, a)).workflowBusinessInvocationId, a);
    const repeated = await gateway.createOrder(command, b);
    assert.equal(repeated.businessInvocationId, b);
    assert.equal(repeated.workflowBusinessInvocationId, a);
    const get = await gateway.readOrder(id, randomUUID());
    assert.equal(get.businessInvocationId, a);
    assert.equal("workflowBusinessInvocationId" in get, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
