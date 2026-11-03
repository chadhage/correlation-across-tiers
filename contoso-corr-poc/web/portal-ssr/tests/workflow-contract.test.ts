import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createContosoServer } from "../dist/server.js";
import { fixtureConfig } from "./fixture-config.ts";

test("LOCAL Portal HTML preserves current action B and refreshes using original workflow A", async () => {
  const config = fixtureConfig();
  const original = randomUUID();
  let id = "";
  const server = createContosoServer({ env: {}, config, authorizeControl: async () => undefined,
    gateway: {
      async createOrder(body, businessInvocationId) {
        id = body.orderId ?? randomUUID();
        return { schemaVersion: 1, id, businessInvocationId, workflowBusinessInvocationId: original, state: "QUEUED", details: {} };
      },
      async readOrder(value) {
        assert.equal(value, id);
        return { schemaVersion: 1, id, businessInvocationId: original, state: "COMPLETED", details: {} };
      }
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(`${origin}/portal/session`, { method: "POST",
      headers: { Origin: config.portal.origin, "Content-Type": "application/json", Authorization: `Bearer fixture-${randomUUID()}` },
      body: JSON.stringify({ schemaVersion: 1 }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const landing = await (await fetch(`${origin}/portal/`, { headers: { Cookie: cookie } })).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(landing)?.[1];
    assert.ok(csrf);
    const mutation = await fetch(`${origin}/portal/orders`, { method: "POST",
      headers: { Cookie: cookie, Origin: config.portal.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ schemaVersion: "1", runId: randomUUID(), csrf, sku: "CONTOSO-001", quantity: "1" }) });
    assert.equal(mutation.status, 200);
    const current = mutation.headers.get("x-business-invocation-id");
    assert.notEqual(current, original);
    const html = await mutation.text();
    assert.ok(html.includes(`id="result-business-id">${current}`));
    assert.ok(html.includes(`id="result-workflow-business-id">${original}`));
    const refreshed = await fetch(`${origin}/portal/`, { headers: { Cookie: cookie } });
    assert.equal(refreshed.status, 200);
    const refreshedHtml = await refreshed.text();
    assert.ok(refreshedHtml.includes("COMPLETED"));
    assert.ok(refreshedHtml.includes(`id="result-business-id">${original}`));
    assert.ok(refreshedHtml.includes(`id="result-workflow-business-id">${original}`));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
