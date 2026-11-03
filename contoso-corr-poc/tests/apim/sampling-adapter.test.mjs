import test from "node:test";
import assert from "node:assert/strict";
import { createApimSamplingAdapter, APIM_SAMPLING_OWNED_FIELDS } from "../../tools/protocol.mjs";

const runId = "11111111-2222-4333-8444-555555555555";
const resourceId = "/subscriptions/99999999-aaaa-4bbb-8ccc-dddddddddddd/resourceGroups/contoso-test/providers/Microsoft.ApiManagement/service/contoso-test-apim/diagnostics/applicationinsights";
const serviceId = resourceId.slice(0, -"/diagnostics/applicationinsights".length);
const apiId = `${serviceId}/apis/contoso-orders`;
const lease = {
  runId, startsAtUtc: "2026-11-01T05:00:00Z", expiresAtUtc: "2026-11-01T05:10:00Z",
  drainAtUtc: "2026-11-01T05:09:00Z", restoreDeadlineUtc: "2026-11-01T05:12:00Z"
};

function fixture({ authorized = false } = {}) {
  const message = () => ({ body: { bytes: 0 }, headers: [], dataMasking: { queryParams: [{ mode: "Hide", value: "token" }] } });
  const state = {
    time: Date.parse("2026-11-01T05:00:30Z"), etag: '"1"', calls: [], overrides: [],
    apis: [{ id: apiId }], diagnostics: [{ id: resourceId }],
    properties: {
      loggerId: `${serviceId}/loggers/contoso-appinsights`, httpCorrelationProtocol: "W3C", alwaysLog: "allErrors",
      sampling: { samplingType: "fixed", percentage: 10 }, verbosity: "error",
      logClientIp: false, metrics: false, operationNameFormat: "Name",
      frontend: { request: message(), response: message() }, backend: { request: message(), response: message() }
    }
  };
  const request = async command => {
    state.calls.push(structuredClone(command));
    const url = new URL(command.url);
    assert.equal(command.redirect, "error");
    assert.equal(url.origin, "https://management.azure.com");
    assert.equal(url.searchParams.get("api-version"), "2024-05-01");
    const ok = body => ({ status: 200, headers: { ETag: state.etag }, body });
    if (command.method === "GET") {
      if (url.pathname === `${serviceId}/diagnostics`) return ok({ value: state.diagnostics, ...(state.nextLink ? { nextLink: state.nextLink } : {}) });
      if (url.pathname === `${serviceId}/apis`) {
        if (url.searchParams.has("$skiptoken")) return ok({ value: state.nextApis ?? [] });
        return ok({ value: state.apis, ...(state.apiNextLink ? { nextLink: state.apiNextLink } : {}) });
      }
      if (url.pathname.endsWith("/apis/contoso-orders/diagnostics")) return ok({ value: state.overrides });
      if (url.pathname.endsWith("/apis/second/diagnostics")) return ok({ value: state.secondOverrides ?? [] });
      if (url.pathname === resourceId) return ok({ id: resourceId, properties: structuredClone(state.properties) });
    }
    if (command.method === "PATCH" && url.pathname === resourceId) {
      if (command.headers["If-Match"] !== state.etag) return { status: 412, headers: {}, body: {} };
      assert.equal(command.body.properties.loggerId, state.properties.loggerId);
      Object.assign(state.properties, structuredClone(command.body.properties));
      state.etag = `"${Number(state.etag.replaceAll('"', "")) + 1}"`;
      return ok({ id: resourceId, properties: structuredClone(state.properties) });
    }
    throw new Error("Unexpected local management fixture request.");
  };
  return {
    state, request,
    adapter: createApimSamplingAdapter({
      diagnosticResourceId: resourceId, request, now: () => state.time,
      allowAzureWrites: authorized, azureWriteApprovalRef: authorized ? "synthetic-unit-test-only" : ""
    })
  };
}

const fullPatch = snapshot => ({ ...snapshot.baselineOwnedConfiguration, "properties.sampling.percentage": 100 });

test("native ARM substrate snapshots, conditionally patches and restores without claiming a runtime ACK", async () => {
  const { adapter, state } = fixture({ authorized: true });
  const snapshot = await adapter.prepare({ lease });
  assert.deepEqual(Object.keys(snapshot.baselineOwnedConfiguration), APIM_SAMPLING_OWNED_FIELDS);
  assert.equal(snapshot.runtimeAcknowledgement, false);
  assert.equal(snapshot.apiCount, 1);
  const beforeMask = structuredClone(state.properties.frontend.request.dataMasking);
  const patch = fullPatch(snapshot);
  const applied = await adapter.apply({ lease, snapshot, ownedPatch: patch });
  assert.equal(applied.sourceKind, "management-plane-observation");
  assert.equal(applied.runtimeAcknowledgement, false);
  assert.equal(applied.nativeSamplingEffective, "To Do");
  assert.equal(applied.gatewayWireParentage, "To Do");
  assert.equal(applied.percentage, 100);
  assert.equal(applied.matches, true);
  assert.equal(state.properties.verbosity, "error");
  assert.deepEqual(state.properties.frontend.request.dataMasking, beforeMask);
  assert.equal(state.calls.find(call => call.method === "PATCH").headers["If-Match"], '"1"');
  const observed = await adapter.observe({ lease, ownedPatch: patch });
  assert.equal(observed.configSha256, applied.configSha256);
  state.time = Date.parse(lease.expiresAtUtc) + 1000;
  const restored = await adapter.restore({ lease, snapshot, appliedOwnedPatch: patch });
  assert.equal(restored.percentage, 10);
  assert.equal(restored.matches, true);
  assert.equal(restored.activeTrafficWindow, false);
  assert.equal(restored.restoreWithinDeadline, true);
  const writes = state.calls.filter(call => call.method === "PATCH").length;
  await adapter.restore({ lease, snapshot, appliedOwnedPatch: patch });
  assert.equal(state.calls.filter(call => call.method === "PATCH").length, writes, "Restore is idempotent.");
});

test("default adapter cannot perform cloud writes even after read-only preparation", async () => {
  const { adapter, state } = fixture();
  const snapshot = await adapter.prepare({ lease });
  const calls = state.calls.length;
  await assert.rejects(adapter.apply({ lease, snapshot, ownedPatch: fullPatch(snapshot) }), /WRITES_NOT_AUTHORIZED/);
  await assert.rejects(adapter.restore({ lease, snapshot, appliedOwnedPatch: fullPatch(snapshot) }), /WRITES_NOT_AUTHORIZED/);
  assert.equal(state.calls.length, calls);
  assert.equal(state.calls.some(call => call.method !== "GET"), false);
  assert.throws(() => createApimSamplingAdapter({ diagnosticResourceId: resourceId }), /TARGET_INVALID/);
});

test("overlapping service/API scopes, paging and foreign continuations fail closed", async () => {
  for (const mutate of [
    state => state.diagnostics.push({ id: `${serviceId}/diagnostics/other` }),
    state => state.overrides.push({ id: `${apiId}/diagnostics/applicationinsights` }),
    state => { state.apiNextLink = `https://management.azure.com${serviceId}/apis?api-version=2024-05-01&$skiptoken=second`; state.nextApis = [{ id: `${serviceId}/apis/second` }]; state.secondOverrides = [{}]; },
    state => state.nextLink = `https://untrusted.example${serviceId}/diagnostics?api-version=2024-05-01`,
    state => state.nextLink = `https://management.azure.com${serviceId}/diagnostics?api-version=2024-05-01`
  ]) {
    const { adapter, state } = fixture();
    mutate(state);
    await assert.rejects(adapter.prepare({ lease }), /CONFLICT|OVERRIDE|URL_INVALID|PAGINATION_INVALID/);
    assert.equal(state.calls.some(call => call.method !== "GET"), false);
    assert.equal(state.calls.some(call => new URL(call.url).origin !== "https://management.azure.com"), false);
  }
});

test("activation and restoration reject stale ETags and foreign owned-field changes", async () => {
  const { adapter, state } = fixture({ authorized: true });
  const snapshot = await adapter.prepare({ lease });
  state.etag = '"2"';
  await assert.rejects(adapter.apply({ lease, snapshot, ownedPatch: fullPatch(snapshot) }), /BASELINE_CONCURRENT_CHANGE/);
  assert.equal(state.calls.some(call => call.method === "PATCH"), false);
  state.etag = '"1"';
  const patch = fullPatch(snapshot);
  await adapter.apply({ lease, snapshot, ownedPatch: patch });
  state.properties.sampling.percentage = 50;
  const writes = state.calls.filter(call => call.method === "PATCH").length;
  await assert.rejects(adapter.restore({ lease, snapshot, appliedOwnedPatch: patch }), /RESTORE_CONCURRENT_CHANGE/);
  assert.equal(state.calls.filter(call => call.method === "PATCH").length, writes);
});

test("lease gates reject early/draining/expired activation but late restoration still ends full collection", async () => {
  const { adapter, state } = fixture({ authorized: true });
  const snapshot = await adapter.prepare({ lease });
  for (const time of [Date.parse(lease.startsAtUtc) - 1, Date.parse(lease.drainAtUtc), Date.parse(lease.expiresAtUtc)]) {
    state.time = time;
    await assert.rejects(adapter.apply({ lease, snapshot, ownedPatch: fullPatch(snapshot) }), /LEASE_INVALID/);
  }
  state.time = Date.parse(lease.startsAtUtc) + 1;
  await adapter.apply({ lease, snapshot, ownedPatch: fullPatch(snapshot) });
  state.time = Date.parse(lease.restoreDeadlineUtc) + 1;
  const restored = await adapter.restore({ lease, snapshot, appliedOwnedPatch: fullPatch(snapshot) });
  assert.equal(restored.percentage, 10);
  assert.equal(restored.restoreWithinDeadline, false, "A late restore is disclosed, never denied at the expense of leaving100.");
});

test("an expired prepared snapshot cannot be revived by shifting the same lease ID to a later window", async () => {
  const { adapter, state } = fixture({ authorized: true });
  const snapshot = await adapter.prepare({ lease });
  assert.deepEqual(snapshot.leaseBinding, lease);
  const shifted = {
    ...lease, startsAtUtc: "2026-11-01T06:00:00Z", expiresAtUtc: "2026-11-01T06:10:00Z",
    drainAtUtc: "2026-11-01T06:09:00Z", restoreDeadlineUtc: "2026-11-01T06:12:00Z"
  };
  state.time = Date.parse(shifted.startsAtUtc) + 1;
  await assert.rejects(adapter.apply({ lease: shifted, snapshot, ownedPatch: fullPatch(snapshot) }), /LEASE_BINDING_MISMATCH/);
  await assert.rejects(adapter.restore({ lease: shifted, snapshot, appliedOwnedPatch: fullPatch(snapshot) }), /LEASE_BINDING_MISMATCH/);
  assert.equal(state.calls.some(call => call.method === "PATCH"), false);
});

test("no privacy, RPS, protocol or snapshot tampering is admitted by native control", async () => {
  const { adapter, state } = fixture({ authorized: true });
  const snapshot = await adapter.prepare({ lease });
  for (const mutate of [
    patch => patch["properties.frontend.request.body.bytes"] = 1,
    patch => patch["properties.backend.request.headers"] = ["x-business-invocation-id"],
    patch => patch["properties.sampling.requestsPerSecond"] = 100,
    patch => patch["properties.httpCorrelationProtocol"] = "Legacy",
    patch => patch["properties.sampling.percentage"] = 100.5
  ]) {
    const patch = fullPatch(snapshot);
    mutate(patch);
    await assert.rejects(adapter.apply({ lease, snapshot, ownedPatch: patch }), /OWNED_PATCH/);
  }
  await assert.rejects(adapter.apply({ lease, snapshot: { ...snapshot, runId: "99999999-aaaa-4bbb-8ccc-dddddddddddd" }, ownedPatch: fullPatch(snapshot) }), /SNAPSHOT_INVALID/);
  assert.equal(state.calls.some(call => call.method === "PATCH"), false);
  state.properties.sampling.percentage = 100;
  await assert.rejects(adapter.prepare({ lease }), /OWNED_PATCH_UNSAFE/, "Unleased preexisting full collection cannot become a production snapshot.");
});

test("management failures omit response/credential data and require an actual GET ETag", async () => {
  const { request } = fixture();
  const leakingTransport = createApimSamplingAdapter({
    diagnosticResourceId: resourceId, request: async () => { throw new Error("sensitive-synthetic-credential-marker"); },
    now: () => Date.parse(lease.startsAtUtc) + 1
  });
  await assert.rejects(leakingTransport.prepare({ lease }), error => error.message === "APIM_MANAGEMENT_REQUEST_FAILED");
  const missingEtag = createApimSamplingAdapter({
    diagnosticResourceId: resourceId, request: async command => {
      const response = await request(command);
      response.headers = {};
      return response;
    }, now: () => Date.parse(lease.startsAtUtc) + 1
  });
  await assert.rejects(missingEtag.prepare({ lease }), /ETAG_REQUIRED/);
  for (const etag of ["*", " * ", '"1", *', '"1"\r\nX-Test: value']) {
    const unsafeEtag = createApimSamplingAdapter({
      diagnosticResourceId: resourceId, request: async command => ({ ...await request(command), headers: { ETag: etag } }),
      now: () => Date.parse(lease.startsAtUtc) + 1
    });
    await assert.rejects(unsafeEtag.prepare({ lease }), /ETAG_REQUIRED/);
  }
  assert.throws(() => createApimSamplingAdapter({
    diagnosticResourceId: resourceId.replace("/diagnostics/", "/apis/contoso-orders/diagnostics/"), request
  }), /TARGET_INVALID/);
});
