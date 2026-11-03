import test from "node:test";
import assert from "node:assert/strict";
import { createServer as netServer } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createContosoServer } from "../dist/server.js";
import { ContosoError } from "../dist/shared/contracts.js";
import { fixtureConfig } from "./fixture-config.ts";

test("FIXTURE leaf deployment artifact contains both public surfaces without resolved runtime config", async () => {
  const html = await readFile(new URL("../dist/storefront/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("<!--CONTOSO_RUNTIME_CONFIG-->"));
  assert.ok(!html.includes('id="contoso-runtime-config"'));
  const portal = await readFile(new URL("../dist/public/portal-client.js", import.meta.url), "utf8");
  assert.ok(portal.length > 0);
});

test("FIXTURE cohost requires a fixed controller, CSRF and live window before workload mutation", async () => {
  const reservation = netServer();
  const port = await new Promise<number>((resolvePort, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") { reject(new Error("FIXTURE_PORT")); return; }
      reservation.close(() => resolvePort(address.port));
    });

  });
  const origin = `http://127.0.0.1:${port}`;
  const config = fixtureConfig(origin);
  let mutations = 0;
  const server = createContosoServer({
    env: {}, config,
    authorizeControl: async bearer => { if (!bearer.startsWith("fixture-control-")) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403); },
    gateway: {
      async createOrder(body, businessInvocationId) {
        mutations++;
        return { schemaVersion: 1, id: body.orderId ?? randomUUID(), businessInvocationId,
          workflowBusinessInvocationId: businessInvocationId, state: "DURABLE_STAGED", details: { source: "fixture" } };
      },
      async readOrder(id, businessInvocationId) { return { schemaVersion: 1, id, businessInvocationId, state: "DURABLE_STAGED", details: {} }; }
    }
  });
  await new Promise<void>(resolveReady => server.listen(port, "127.0.0.1", resolveReady));
  try {
    const storefront = await fetch(`${origin}/storefront/`);
    assert.equal(storefront.status, 200);
    assert.ok((await storefront.text()).includes('id="contoso-runtime-config"'));
    const unauthorized = await fetch(`${origin}/portal/session`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1 })
    });
    assert.equal(unauthorized.status, 403);
    const authorization = await fetch(`${origin}/portal/session`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer fixture-control-${randomUUID()}` },
      body: JSON.stringify({ schemaVersion: 1 })
    });
    assert.equal(authorization.status, 200);
    const cookie = authorization.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const page = await fetch(`${origin}/portal/`, { headers: { Cookie: cookie } });
    const html = await page.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(csrf);
    const input = new URLSearchParams({ schemaVersion: "1", csrf, runId: randomUUID(), sku: "CONTOSO-001", quantity: "1" });
    const rejected = await fetch(`${origin}/portal/orders`, {
      method: "POST", headers: { Origin: "http://127.0.0.1:1", Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: input
    });
    assert.equal(rejected.status, 403);
    assert.equal(mutations, 0);
    const accepted = await fetch(`${origin}/portal/orders`, {
      method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: input
    });
    assert.equal(accepted.status, 200);
    assert.equal(mutations, 1);
    const result = await accepted.text();
    assert.ok(result.includes("DURABLE_STAGED"));
    assert.ok(!result.includes("h1."));
    const missingAsset = await fetch(`${origin}/portal/assets/missing.js`);
    assert.equal(missingAsset.status, 404);
    const query = await fetch(`${origin}/portal/?sensitive=not-retained`);
    assert.equal(query.status, 400);
    assert.ok(!(await query.text()).includes("not-retained"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});

test("FIXTURE anonymous landings cannot consume authenticated capacity and login reaps expired entries", async context => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const reservation = netServer();
  const port = await new Promise<number>((resolvePort, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") { reject(new Error("FIXTURE_PORT")); return; }
      reservation.close(() => resolvePort(address.port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const config = fixtureConfig(origin);
  config.certification.endsAtUtc = new Date(now + 60 * 60_000).toISOString();
  const server = createContosoServer({
    env: {}, config,
    authorizeControl: async bearer => { if (!bearer.startsWith("fixture-control-")) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403); },
    gateway: {
      async createOrder(body, businessInvocationId) {
        return { schemaVersion: 1, id: body.orderId ?? randomUUID(), businessInvocationId,
          workflowBusinessInvocationId: businessInvocationId, state: "DURABLE_STAGED", details: {} };
      },
      async readOrder(id, businessInvocationId) {
        return { schemaVersion: 1, id, businessInvocationId, state: "DURABLE_STAGED", details: {} };
      }
    }
  });

  await new Promise<void>(resolveReady => server.listen(port, "127.0.0.1", resolveReady));
  async function login(): Promise<Response> {
    return fetch(`${origin}/portal/session`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer fixture-control-${randomUUID()}` },
      body: JSON.stringify({ schemaVersion: 1 })
    });
  }
  try {
    for (let index = 0; index < 120; index++) {
      const landing = await fetch(`${origin}/portal/`);
      assert.equal(landing.status, 200);
      assert.equal(landing.headers.get("set-cookie"), null);
      await landing.arrayBuffer();
    }
    for (let index = 0; index < 100; index++) {
      const authorized = await login();
      assert.equal(authorized.status, 200);
      await authorized.arrayBuffer();
    }
    const overflow = await login();
    assert.equal(overflow.status, 429);
    assert.deepEqual(await overflow.json(), { schemaVersion: 1, errorCode: "PORTAL_DISABLED" });
    now += 16 * 60_000;
    const reclaimed = await login();
    assert.equal(reclaimed.status, 200);
    await reclaimed.arrayBuffer();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});
