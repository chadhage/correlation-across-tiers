import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  certificationActive, ContosoError, parseIdentityView, parsePublicConfig, parseWorkflowView,
  validateDemoRequest, validateOrderRequest
} from "../dist/shared/contracts.js";
import { guardedApiUrl, createBrowserApi } from "../dist/shared/browser-api.js";
import { inlineConfig } from "../dist/config.js";
import { safeTraceparent } from "../dist/browser-adapter.js";
import { fixtureConfig } from "./fixture-config.ts";

test("FIXTURE config enforces real version/origin/audience/scope/window invariants", () => {
  const config = fixtureConfig();
  assert.equal(parsePublicConfig(config).telemetry.tracingMode, "W3C_TRACE");
  assert.equal(certificationActive(config), true);
  assert.throws(() => parsePublicConfig({ ...config, unknown: "not accepted" }), ContosoError);
  assert.throws(() => parsePublicConfig({ ...config, identity: { ...config.identity, apiAudience: randomUUID() } }), ContosoError);
  assert.throws(() => parsePublicConfig({ ...config, telemetry: { ...config.telemetry, approvedCorrelationOrigins: ["http://127.0.0.1:41003"] } }), ContosoError);
  assert.throws(() => parsePublicConfig({ ...config, certification: { ...config.certification, endsAtUtc: new Date(0).toISOString() } }), ContosoError);
});
test("FIXTURE bootstrap escaping never permits script breakout", () => {
  const config = fixtureConfig();
  config.deploymentStamp = "</script><script>not executable</script>";
  const html = inlineConfig(config);
  assert.equal(html.split("</script>").length, 2);
  assert.ok(html.includes("\\u003c"));
});
test("FIXTURE privileged API route rejection happens before obtaining a credential", async () => {
  const config = fixtureConfig();
  assert.throws(() => guardedApiUrl(config, "//unapproved/credential"), ContosoError);
  assert.throws(() => guardedApiUrl(config, "/orders?token=not-accepted"), ContosoError);
  let credentialCalls = 0;
  const api = createBrowserApi(config, async () => { credentialCalls++; return randomUUID(); });
  await assert.rejects(api.workflow("orders", "invalid"), ContosoError);
  assert.equal(credentialCalls, 0);
});
test("FIXTURE R4 request DTOs reject unknown fields and unsafe values", () => {
  assert.deepEqual(validateOrderRequest({ schemaVersion: 1, sku: "CONTOSO-001", quantity: 2 }),
    { schemaVersion: 1, sku: "CONTOSO-001", quantity: 2 });
  assert.throws(() => validateOrderRequest({ schemaVersion: 1, sku: "CONTOSO-001", quantity: 101 }), ContosoError);
  assert.throws(() => validateOrderRequest({ schemaVersion: 1, sku: "CONTOSO-001", quantity: 1, businessInvocationId: randomUUID() }), ContosoError);
  assert.equal(validateDemoRequest({ schemaVersion: 1, runId: randomUUID(), demoId: 2, scenario: "SYNC", failureBudget: 0 }).demoId, 2);
  assert.throws(() => validateDemoRequest({ schemaVersion: 1, demoId: 2, scenario: "ARBITRARY" }), ContosoError);
});
test("FIXTURE actual staged result is preserved and sensitive metadata is removed", () => {
  const id = randomUUID();
  const businessInvocationId = randomUUID();
  const view = parseWorkflowView({ schemaVersion: 1, id, businessInvocationId, state: "DURABLE_STAGED",
    details: { operation: "ORDER", credential: "not retained", source: "fixture" } });
  assert.equal(view.state, "DURABLE_STAGED");
  assert.equal(view.details.credential, undefined);
  assert.throws(() => parseWorkflowView({ ...view, id: "invalid" }), ContosoError);
});
test("FIXTURE workload identity cannot acquire a fabricated human pseudonym", () => {
  const view = parseIdentityView({ schemaVersion: 1, actorType: "WORKLOAD", businessInvocationId: randomUUID(),
    pseudonym: `h1.fixture.${"a".repeat(43)}` });
  assert.equal(view.actorType, "WORKLOAD");
  assert.equal(view.pseudonym, undefined);
});
test("FIXTURE evidence retains only valid nonzero W3C parents", () => {
  const valid = "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-00";
  assert.equal(safeTraceparent(valid), valid);
  assert.equal(safeTraceparent("unapproved context"), undefined);
  assert.equal(safeTraceparent("00-" + "0".repeat(32) + "-" + "b".repeat(16) + "-01"), undefined);
});
