import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  certificationActive, ContosoError, originalWorkflowInvocationId, parseIdentityView, parsePublicConfig, parseWorkflowMutationView, parseWorkflowView,
  validateDemoRequest, validateOrderRequest
} from "../dist/shared/contracts.js";
import { guardedApiUrl, createBrowserApi } from "../dist/shared/browser-api.js";
import { inlineConfig, runtimeWindow } from "../dist/config.js";
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
test("LOCAL runtime lease inputs reject partial, malformed and nonopaque fields before an observer can expose them", () => {
  assert.deepEqual(runtimeWindow({}), { startsAtUtc: null, endsAtUtc: null, windowId: null });
  const valid = { CONTOSO_CERT_START: new Date(Date.now() - 1000).toISOString(),
    CONTOSO_CERT_END: new Date(Date.now() + 1000).toISOString(), CONTOSO_CERT_WINDOW_ID: randomUUID() };
  assert.equal(runtimeWindow(valid).windowId, valid.CONTOSO_CERT_WINDOW_ID);
  for (const invalid of [
    { CONTOSO_CERT_START: valid.CONTOSO_CERT_START },
    { ...valid, CONTOSO_CERT_START: "not a safe timestamp" },
    { ...valid, CONTOSO_CERT_END: valid.CONTOSO_CERT_START },
    { ...valid, CONTOSO_CERT_WINDOW_ID: "not an opaque lease ID" }
  ]) assert.throws(() => runtimeWindow(invalid), ContosoError);
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
test("LOCAL mutation views require the stored workflow identity separately from the current action", () => {
  const workflowBusinessInvocationId = randomUUID();
  const businessInvocationId = randomUUID();
  const mutation = { schemaVersion: 1, id: randomUUID(), businessInvocationId, workflowBusinessInvocationId,
    state: "DURABLE_STAGED", details: {} };
  const parsed = parseWorkflowMutationView(mutation);
  assert.equal(parsed.businessInvocationId, businessInvocationId);
  assert.equal(parsed.workflowBusinessInvocationId, workflowBusinessInvocationId);
  assert.equal(originalWorkflowInvocationId(parsed), workflowBusinessInvocationId);
  const get = { schemaVersion: 1, id: mutation.id, businessInvocationId: workflowBusinessInvocationId,
    state: "DURABLE_STAGED", details: {} };
  assert.equal(originalWorkflowInvocationId(parseWorkflowView(get)), workflowBusinessInvocationId);
  assert.equal("workflowBusinessInvocationId" in parseWorkflowView(get), false);
  assert.throws(() => parseWorkflowMutationView(get), { code: "API_RESPONSE_INVALID" });
});
test("LOCAL missing or invalid durable mutation identity never falls back to the action identity", () => {
  const base = { schemaVersion: 1, id: randomUUID(), businessInvocationId: randomUUID(), state: "QUEUED", details: {} };
  assert.throws(() => parseWorkflowMutationView(base), { code: "API_RESPONSE_INVALID" });
  for (const workflowBusinessInvocationId of [undefined, null, "", "invalid", "00000000-0000-0000-0000-000000000000", 1, {}]) {
    const raw = { ...base, workflowBusinessInvocationId };
    assert.throws(() => parseWorkflowMutationView(raw), { code: "API_RESPONSE_INVALID" });
    assert.throws(() => parseWorkflowView(raw), { code: "API_RESPONSE_INVALID" });
  }
  for (const operation of ["orders", "demo-runs", "controls"]) {
    const mutation = parseWorkflowMutationView({ ...base, workflowBusinessInvocationId: randomUUID() });
    assert.notEqual(mutation.workflowBusinessInvocationId, mutation.businessInvocationId, operation);
  }
});
test("FIXTURE workload identity cannot acquire a fabricated human pseudonym", () => {
  const view = parseIdentityView({ schemaVersion: 1, actorType: "workload", businessInvocationId: randomUUID(),
    pseudonym: `h1:${"a".repeat(32)}:${"b".repeat(43)}` });
  assert.equal(view.actorType, "workload");
  assert.equal(view.pseudonym, undefined);
});
test("LOCAL public identity accepts only the frozen user/workload and colon HMAC ABI", () => {
  const pseudonym = `h1:${"a".repeat(32)}:${"b".repeat(43)}`;
  assert.equal(parseIdentityView({ schemaVersion: 1, actorType: "user", businessInvocationId: randomUUID(), pseudonym }).pseudonym, pseudonym);
  assert.equal(parseIdentityView({ schemaVersion: 1, actorType: "user", businessInvocationId: randomUUID(),
    pseudonym: `h1.legacy.${"b".repeat(43)}` }).pseudonym, undefined);
  assert.throws(() => parseIdentityView({ schemaVersion: 1, actorType: "HUMAN", businessInvocationId: randomUUID(), pseudonym }), ContosoError);
});
test("FIXTURE evidence retains only valid nonzero W3C parents", () => {
  const valid = "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-00";
  assert.equal(safeTraceparent(valid), valid);
  assert.equal(safeTraceparent("unapproved context"), undefined);
  assert.equal(safeTraceparent("00-" + "0".repeat(32) + "-" + "b".repeat(16) + "-01"), undefined);
});
