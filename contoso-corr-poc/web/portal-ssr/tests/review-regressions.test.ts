import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createContosoServer } from "../dist/server.js";
import { runtimeWindow } from "../dist/config.js";
import { MAX_CERT_WINDOW_SECONDS, parsePublicConfig, type WorkflowViewV1 } from "../dist/shared/contracts.js";
import { fixtureConfig } from "./fixture-config.ts";

test("LOCAL agreed certification maximum is enforced by environment and public configuration", async () => {
  const profiles: unknown = JSON.parse(await readFile(new URL("../../../config/sampling-profiles.v1.json", import.meta.url), "utf8"));
  assert.ok(typeof profiles === "object" && profiles !== null && "windowLimits" in profiles
    && typeof profiles.windowLimits === "object" && profiles.windowLimits !== null && "maximumSeconds" in profiles.windowLimits);
  assert.equal(MAX_CERT_WINDOW_SECONDS, profiles.windowLimits.maximumSeconds);
  const config = fixtureConfig();
  const start = Date.now() - 1000;
  config.certification.startsAtUtc = new Date(start).toISOString();
  config.certification.endsAtUtc = new Date(start + 4 * 60 * 60_000).toISOString();
  const environment = () => ({ CONTOSO_CERT_START: config.certification.startsAtUtc ?? "",
    CONTOSO_CERT_END: config.certification.endsAtUtc ?? "", CONTOSO_CERT_WINDOW_ID: config.certification.windowId ?? "" });
  assert.throws(() => parsePublicConfig(config), { code: "CONFIG_INVALID" });
  assert.throws(() => runtimeWindow(environment()), { code: "CONFIG_INVALID" });
  config.certification.endsAtUtc = new Date(start + MAX_CERT_WINDOW_SECONDS * 1000).toISOString();
  assert.equal(parsePublicConfig(config).telemetry.samplingPercentage, 100);
  assert.equal(runtimeWindow(environment()).windowId, config.certification.windowId);
  config.certification.startsAtUtc = config.certification.startsAtUtc.replace("Z", "+00:00");
  assert.throws(() => parsePublicConfig(config), { code: "CONFIG_INVALID" });
});

test("FIXTURE real HTTP controls reject foreign leases and permit only the original expired lease to dispatch drain", async () => {
  const config = fixtureConfig();
  const ownId = config.certification.windowId;
  let shutdowns = 0;
  const server = createContosoServer({ env: {}, config, authorizeControl: async () => undefined,
    shutdownTelemetry: async () => { shutdowns++; } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const control = (path: string, runId: string) => fetch(`${origin}/portal/${path}`, {
    method: "POST", headers: { Origin: config.portal.origin, "Content-Type": "application/json", Authorization: "Bearer fixture-control" },
    body: JSON.stringify({ schemaVersion: 1, runId, revision: `cert-${runId}` })
  });
  try {
    assert.equal((await control("runtime-stop-traffic", randomUUID())).status, 403);
    assert.equal((await control("runtime-drain", randomUUID())).status, 403);
    assert.equal(shutdowns, 0);
    config.certification.endsAtUtc = new Date(Date.now() - 1).toISOString();
    assert.ok(ownId);
    // No SDK status is substituted: this only proves authorized dispatch, not a native observation ACK.
    assert.equal((await control("runtime-drain", ownId)).status, 503);
    assert.equal(shutdowns, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  const baseline = fixtureConfig();
  baseline.certification = { enabled: false, startsAtUtc: null, endsAtUtc: null, windowId: null };
  baseline.telemetry.samplingPercentage = 10;
  const restored = createContosoServer({ env: {}, config: baseline, authorizeControl: async () => undefined,
    shutdownTelemetry: async () => { shutdowns++; } });
  await new Promise<void>(resolve => restored.listen(0, "127.0.0.1", resolve));
  const restoredAddress = restored.address();
  assert.ok(restoredAddress && typeof restoredAddress !== "string");
  try {
    const stale = await fetch(`http://127.0.0.1:${restoredAddress.port}/portal/runtime-drain`, {
      method: "POST", headers: { Origin: baseline.portal.origin, "Content-Type": "application/json", Authorization: "Bearer fixture-control" },
      body: JSON.stringify({ schemaVersion: 1, runId: ownId, revision: `cert-${ownId}` })
    });
    assert.equal(stale.status, 403);
    assert.equal(shutdowns, 1);
  } finally {
    restored.closeAllConnections();
    await new Promise<void>(resolve => restored.close(() => resolve()));
  }
});

test("FIXTURE delayed Portal read cannot replace a newer completed order in the same authorized session", async () => {
  const config = fixtureConfig();
  const orderA = randomUUID();
  const orderB = randomUUID();
  const values = new Map<string, WorkflowViewV1>();
  let started!: () => void;
  let release!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const server = createContosoServer({ env: {}, config, authorizeControl: async () => undefined,
    gateway: {
      async createOrder(body, businessInvocationId) {
        const value: WorkflowViewV1 = { schemaVersion: 1, id: body.orderId ?? randomUUID(), businessInvocationId,
          workflowBusinessInvocationId: businessInvocationId, state: "DURABLE_STAGED", details: {} };
        values.set(value.id, value);
        return value;
      },
      async readOrder(id) {
        if (id === orderA) { started(); await blocked; }
        const value = values.get(id);
        assert.ok(value);
        return value;
      }
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(`${origin}/portal/session`, { method: "POST",
      headers: { Origin: config.portal.origin, "Content-Type": "application/json", Authorization: "Bearer fixture-control" },
      body: JSON.stringify({ schemaVersion: 1 }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const page = await (await fetch(`${origin}/portal/`, { headers: { Cookie: cookie } })).text();
    const csrf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const post = (id: string, token: string) => fetch(`${origin}/portal/orders`, { method: "POST",
      headers: { Cookie: cookie, Origin: config.portal.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ schemaVersion: "1", runId: id, csrf: token, sku: "CONTOSO-001", quantity: "1" }) });
    const first = await post(orderA, csrf(page));
    assert.equal(first.status, 200);
    const firstHtml = await first.text();
    const oldGet = fetch(`${origin}/portal/`, { headers: { Cookie: cookie } });
    await reading;
    await new Promise<void>(resolve => setTimeout(resolve, 1100));
    assert.equal((await post(orderB, csrf(firstHtml))).status, 200);
    release();
    assert.equal((await oldGet).status, 409);
    const latest = await (await fetch(`${origin}/portal/`, { headers: { Cookie: cookie } })).text();
    assert.ok(latest.includes(orderB));
    assert.ok(!latest.includes(orderA));
  } finally {
    release();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
