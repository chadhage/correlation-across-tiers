import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseTraceparent, parseTracestate, contextDecision, resolveBusinessInvocationId,
  verifyBackendHeaderContract, corsPreflight, validatePublicUrl, validateModuleParameters,
  validateSecretReference, validateDiagnosticSettings, assertW3cOnlyMode, verifySdkSourcePin
} from "../../tools/protocol.mjs";

const trace = "11111111111111111111111111111111";
const parent = "2222222222222222";
const sampled = `00-${trace}-${parent}-01`;
const unsampled = `00-${trace}-${parent}-00`;
const business = "11111111-2222-4333-8444-555555555555";
const generated = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const origin = "https://contoso-web-legal.azurewebsites.net";

test("valid carriers preserve raw flags/IDs rather than synthesizing or rewriting them", () => {
  for (const raw of [sampled, unsampled, `00-${trace}-${parent}-03`]) {
    const parsed = parseTraceparent(raw);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.raw, raw);
    assert.equal(parsed.traceId, trace);
    assert.equal(parsed.parentId, parent);
  }
  assert.equal(parseTraceparent(unsampled).sampled, false);
  assert.equal(parseTraceparent(sampled).sampled, true);
});

test("version-forward-compatible known prefix accepts extensions without parsing them", () => {
  assert.equal(parseTraceparent(`01-${trace}-${parent}-01`).valid, true);
  assert.equal(parseTraceparent(`01-${trace}-${parent}-01-future`).valid, true);
  assert.equal(parseTraceparent(`01-${trace}-${parent}-01future`).valid, false);
  assert.equal(parseTraceparent(`${sampled}-future`).valid, false);
  assert.equal(parseTraceparent(`ff-${trace}-${parent}-01`).valid, false);
});

test("malformed/zero/duplicate/oversized parent controls leave root creation to the tracer", () => {
  const invalid = [
    `00-${"0".repeat(32)}-${parent}-01`,
    `00-${trace}-${"0".repeat(16)}-01`,
    sampled.replace("1111", "GGGG"), sampled.replace(trace, "a".repeat(32)).toUpperCase(), sampled.slice(1),
    sampled + "x", sampled + ", " + sampled, " " + sampled,
    `01-${trace}-${parent}-01-${"x".repeat(256)}`
  ];
  for (const value of invalid) assert.equal(parseTraceparent(value).valid, false, value);
  assert.equal(parseTraceparent([sampled, sampled]).disposition, "duplicate");
  const missing = contextDecision(undefined, "contoso=cert03");
  assert.equal(missing.tracerRootRequired, true);
  assert.equal("traceId" in missing.parent, false);
  assert.deepEqual(missing.deleteHeaders, ["traceparent", "tracestate"]);
});

test("invalid state drops state only and never invalidates a valid parent", () => {
  const decision = contextDecision(sampled, "contoso=value,contoso=other");
  assert.equal(decision.parent.valid, true);
  assert.equal(decision.tracerRootRequired, false);
  assert.deepEqual(decision.deleteHeaders, ["tracestate"]);
  assert.deepEqual(contextDecision(unsampled, "contoso=value").deleteHeaders, []);
  assert.equal(contextDecision(unsampled, "contoso=value").parent.raw, unsampled);
});

test("line breaks in state keys discard only state and preserve the valid parent's flags", () => {
  for (const raw of [sampled, unsampled]) {
    for (const lineBreak of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
      const decision = contextDecision(raw, `contoso${lineBreak}=one`);
      assert.equal(decision.state.valid, false, JSON.stringify(lineBreak));
      assert.equal(decision.parent.raw, raw);
      assert.equal(decision.tracerRootRequired, false);
      assert.deepEqual(decision.deleteHeaders, ["tracestate"]);
    }
  }
});

test("Demo03 carrier manifest describes policy behavior without fabricated telemetry", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../apim/demo03-cases.v1.json", import.meta.url), "utf8"));
  assert.equal(manifest.publicOperation, "/contoso/v1/demo-runs");
  assert.equal(manifest.liveAcceptance, "To Do");
  assert.equal(manifest.requestBody.demoId, 3);
  for (const vector of manifest.cases) {
    assert.deepEqual(contextDecision(vector.headers.traceparent, vector.headers.tracestate).deleteHeaders, vector.expectedPolicyDeletion);
    assert.equal(Object.hasOwn(vector, "spanRows"), false);
  }
});

test("state order/multi-fields/empty OWS and strict member grammar", () => {
  assert.equal(parseTracestate(["contoso=one", "vendor=two"]).raw, "contoso=one,vendor=two");
  assert.equal(parseTracestate(", \t,contoso=one").valid, true);
  assert.equal(parseTracestate("").valid, true);
  assert.equal(parseTracestate("tenant1@contoso=value").valid, true);
  for (const value of ["Contoso=value", "1vendor=value", "contoso=", "contoso=a=b", "contoso=x\ty", "contoso=x\n", "contoso=é"]) {
    assert.equal(parseTracestate(value).valid, false, value);
  }
});

test("state accepts 32 and 512 but not 33/513; long values are bounded", () => {
  const members = Array.from({ length: 32 }, (_, index) => `v${index}=x`);
  assert.equal(parseTracestate(members.join(",")).valid, true);
  assert.equal(parseTracestate([...members, "v32=x"].join(",")).valid, false);
  const exact = `a=${"x".repeat(253)},b=${"y".repeat(254)}`;
  assert.equal(exact.length, 512);
  assert.equal(parseTracestate(exact).valid, true);
  assert.equal(parseTracestate(`${exact} `).valid, false);
  assert.equal(parseTracestate(`a=${"x".repeat(257)}`).valid, false);
});

test("business trust is separate; duplicates/untrusted/malformed input gets one UUIDv4", () => {
  assert.deepEqual(resolveBusinessInvocationId(business, { trustedInvocationIssuer: true }), { id: business, disposition: "accepted-trusted" });
  for (const input of [undefined, [business, business], business, generated.toUpperCase(), ` ${business}`, business.replace("-4333-", "-1333-"), business.replace("-8444-", "-7444-"), `${business},${business}`]) {
    const trustedInvocationIssuer = input !== business;
    const result = resolveBusinessInvocationId(input, { trustedInvocationIssuer, generate: () => generated });
    assert.equal(result.id, generated);
    assert.notEqual(result.disposition, "accepted-trusted");
  }
  assert.throws(() => resolveBusinessInvocationId(undefined, { generate: () => trace }), /UUIDv4/);
});

test("transport proof checks preserve caller Authorization and do not pretend to validate JWTs", () => {
  const before = { Authorization: "Bearer original-caller-fixture", "X-Contoso-Gateway-Authorization": "Bearer forged-fixture" };
  const after = { authorization: before.Authorization, "X-Contoso-Gateway-Authorization": "Bearer independently-issued-fixture", "x-business-invocation-id": business };
  assert.equal(verifyBackendHeaderContract(before, after).passed, true);
  assert.equal(verifyBackendHeaderContract(before, after).jwtValidation, "To Do");
  assert.equal(verifyBackendHeaderContract(before, { ...after, authorization: after["X-Contoso-Gateway-Authorization"] }).passed, false);
  assert.equal(verifyBackendHeaderContract(before, { ...after, "X-Contoso-Gateway-Authorization": before["X-Contoso-Gateway-Authorization"] }).passed, false);
});

test("case-variant/folded headers cannot hide duplicates or reuse caller identity as gateway proof", () => {
  const before = { Authorization: "Bearer synthetic-original-only" };
  const after = { Authorization: before.Authorization, "X-Contoso-Gateway-Authorization": "Bearer synthetic-gateway-only", "x-business-invocation-id": business };
  for (const patch of [
    { authorization: before.Authorization },
    { "x-contoso-gateway-authorization": after["X-Contoso-Gateway-Authorization"] },
    { "X-Business-Invocation-Id": business },
    { "X-Contoso-Gateway-Authorization": before.Authorization },
    { "X-Contoso-Gateway-Authorization": "Bearer synthetic-one,Bearer synthetic-two" },
    { Authorization: "Bearer synthetic-original-only\r\nX-Test: value" }
  ]) assert.equal(verifyBackendHeaderContract(before, { ...after, ...patch }).passed, false);
  assert.equal(verifyBackendHeaderContract({ ...before, authorization: before.Authorization }, after).passed, false);
  const errors = verifyBackendHeaderContract(null, null).errors;
  assert.equal(errors.some(error => error.includes("synthetic-original-only")), false);
});

test("CORS grants only frontend origin/custom-header list and never grants the gateway proof", () => {
  const config = { frontendOrigins: [origin] };
  assert.equal(corsPreflight({ origin, method: "POST", requestedHeaders: ["Authorization", "traceparent", "tracestate", "x-business-invocation-id"] }, config).granted, true);
  for (const request of [
    { origin: "https://third-party.example", method: "POST" },
    { origin, method: "DELETE" },
    { origin, method: "POST", requestedHeaders: ["X-Contoso-Gateway-Authorization"] },
    { origin, method: "POST", requestedHeaders: ["Cookie"] }
  ]) {
    const result = corsPreflight(request, config);
    assert.equal(result.granted, false);
    assert.equal(result.status, 200);
    assert.equal(result.allowOrigin, null);
  }
  assert.equal(corsPreflight({ origin, method: "GET" }, { frontendOrigins: ["*"] }).granted, false);
  assert.equal(corsPreflight({ origin, method: "POST", requestedHeaders: [null] }, config).granted, false);
  assert.equal(corsPreflight({ origin, method: "POST", requestedHeaders: "Authorization" }, config).granted, false);
});

test("SDK appId metadata preflight remains permitted on a subsequent approved request", () => {
  const config = { frontendOrigins: [origin] };
  const initial = corsPreflight({ origin, method: "POST", requestedHeaders: ["Authorization", "traceparent", "tracestate"] }, config);
  const subsequent = corsPreflight({ origin, method: "POST", requestedHeaders: ["Authorization", "Request-Context", "traceparent", "tracestate"] }, config);
  assert.equal(initial.granted, true);
  assert.equal(subsequent.granted, true);
  assert.equal(corsPreflight({ origin, method: "POST", requestedHeaders: ["Request-Id"] }, config).granted, false);
  assert.equal(corsPreflight({ origin, method: "POST", requestedHeaders: ["X-Contoso-Gateway-Authorization"] }, config).granted, false);
});

test("public/backend path distinction rejects queries and invalid IDs without a clean telemetry claim", () => {
  for (const route of ["/orders", "/me", "/demo-runs", `/demo-runs/${business}/controls`]) {
    const result = validatePublicUrl(`https://contoso-gateway-legal.azure-api.net/contoso/v1${route}`);
    assert.equal(result.valid, true);
    assert.equal(result.nativeUrlPrivacy, "To Do");
  }
  for (const route of ["/api/orders", "/contoso/v1/orders?token=synthetic-marker", "/contoso/v1/orders#fragment", `/contoso/v1/orders/${business.replace("-4333-", "-1333-")}`]) {
    const result = validatePublicUrl(`https://contoso-gateway-legal.azure-api.net${route}`);
    assert.equal(result.valid, false);
    assert.notEqual(result.code, "VALID");
  }
});

test("source/version guard accepts only SDK3.4.5 W3C_TRACE18", async () => {
  const pin = JSON.parse(await readFile(new URL("../../apim/sdk-source-pin.json", import.meta.url), "utf8"));
  assert.equal(verifySdkSourcePin(pin), true);
  assert.doesNotThrow(() => assertW3cOnlyMode(18, "3.4.5", pin));
  assert.doesNotThrow(() => assertW3cOnlyMode("W3C_TRACE", "3.4.5", pin));
  for (const mode of [0, 1, 2, 17, "W3C", "AI_AND_W3C"]) assert.throws(() => assertW3cOnlyMode(mode, "3.4.5", pin));
  assert.throws(() => assertW3cOnlyMode(18, "latest", pin));
  assert.equal(verifySdkSourcePin({ ...pin, enumValue: 2 }), false);
});

function parameters() {
  return {
    serviceName: "contoso-corr-poc-apim-legal", tenantId: business,
    publicAudience: business, ordersTokenResource: `api://${business}`,
    ordersBackendBaseUrl: "https://contoso-orders-api-legal.azurewebsites.net/api",
    delegatedScope: "Orders.Invoke", allowedCallerClientIds: [business], portalClientIds: [business], frontendOrigins: [origin]
  };
}

test("module parameter negatives enforce physical input, exact scope, fixed backend and caller subsets", () => {
  assert.equal(validateModuleParameters(parameters()).passed, true);
  assert.equal(validateModuleParameters({ ...parameters(), ordersBackendBaseUrl: "https://contoso-orders-api-hash.centralus-01.azurewebsites.net/api" }).passed, true);
  const upperClientId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
  assert.equal(validateModuleParameters({ ...parameters(), tenantId: upperClientId, publicAudience: upperClientId, allowedCallerClientIds: [upperClientId], portalClientIds: [upperClientId.toLowerCase()] }).passed, true);
  for (const patch of [{ serviceName: "" }, { delegatedScope: "Contoso.Invoke" }, { ordersBackendBaseUrl: "https://untrusted.example/api" }, { ordersBackendBaseUrl: "https://contoso-orders-api-legal.azurewebsites.net/contoso/v1" }, { ordersBackendBaseUrl: "https://contoso-orders-api-legal.azurewebsites.net:8443/api" }, { frontendOrigins: ["*"] }, { frontendOrigins: [origin, origin] }, { portalClientIds: [generated] }, { allowedCallerClientIds: [business, business] }, { allowedCallerClientIds: ["00000000-0000-0000-0000-000000000000"] }, { allowedCallerClientIds: [null] }]) {
    assert.equal(validateModuleParameters({ ...parameters(), ...patch }).passed, false);
  }
  for (const publicAudience of [undefined, "api://orders-fixture", `api://${business}`, "00000000-0000-0000-0000-000000000000", "not-a-guid"]) {
    assert.equal(validateModuleParameters({ ...parameters(), publicAudience }).passed, false);
  }
  assert.equal(validateModuleParameters({ ...parameters(), publicAudience: generated, ordersTokenResource: `api://${business}` }).passed, true);
  assert.equal(validateSecretReference("https://contoso-legal.vault.azure.net/secrets/appi-connection"), true);
  for (const reference of ["InstrumentationKey=fixture", "https://contoso-legal.vault.azure.net/secrets/appi-connection/version", "http://contoso-legal.vault.azure.net/secrets/appi-connection", "https://contoso-legal.vault.azure.net/secrets/appi-connection?token=fixture", "https://contoso-legal.vault.azure.net:8443/secrets/appi-connection", "https://contoso--legal.vault.azure.net/secrets/appi-connection", "https://contoso-legal.vault.azure.net/secrets/appi%2Dconnection", "https://contoso-legal.vault.azure.net/secrets/x/../appi-connection", "https://x.vault.azure.net/secrets/appi-connection"]) assert.equal(validateSecretReference(reference), false);
});

function diagnostic() {
  const message = () => ({ headers: [], body: { bytes: 0 } });
  return { httpCorrelationProtocol: "W3C", alwaysLog: "allErrors", logClientIp: false, metrics: false, operationNameFormat: "Name", sampling: { samplingType: "fixed", percentage: 10 }, frontend: { request: message(), response: message() }, backend: { request: message(), response: message() } };
}

test("all4 capture positions and timing approval controls; no unbounded 100% or fake clean status", () => {
  const settings = diagnostic();
  assert.equal(validateDiagnosticSettings(settings).passed, true);
  assert.equal(validateDiagnosticSettings(settings).nativeUrlPrivacy, "To Do");
  for (const side of ["frontend", "backend"]) for (const direction of ["request", "response"]) {
    const bad = structuredClone(settings);
    bad[side][direction].body.bytes = 1;
    assert.equal(validateDiagnosticSettings(bad).passed, false);
  }
  const raw = structuredClone(settings);
  raw.frontend.request.headers = ["x-business-invocation-id"];
  assert.equal(validateDiagnosticSettings(raw).passed, false);
  const backend = structuredClone(settings);
  backend.backend.request.headers = ["x-business-invocation-id"];
  assert.equal(validateDiagnosticSettings(backend).passed, false);
  assert.equal(validateDiagnosticSettings(backend, { captureEvidence: { verified: true, sha256: "a".repeat(64) } }).passed, true);
  assert.equal(validateDiagnosticSettings(backend, { captureEvidence: { verified: true, sha256: "0".repeat(64) } }).passed, false);
  const full = structuredClone(settings);
  full.sampling.percentage = 100;
  assert.equal(validateDiagnosticSettings(full).passed, false);
  assert.equal(validateDiagnosticSettings(full, { certificationWindow: { windowId: business, startsAtUtc: "2026-10-31T22:00:00Z", expiresAtUtc: "2026-10-31T23:00:00Z" } }).passed, true);
  for (const window of [
    { windowId: "not-a-uuid", startsAtUtc: "2026-10-31T22:00:00Z", expiresAtUtc: "2026-10-31T23:00:00Z" },
    { windowId: business, startsAtUtc: "2026-10-31T22:00:00+00:00", expiresAtUtc: "2026-10-31T23:00:00Z" },
    { windowId: business, startsAtUtc: "2026-10-31T22:00:00Z", expiresAtUtc: "2026-11-01T01:00:00Z" }
  ]) assert.equal(validateDiagnosticSettings(full, { certificationWindow: window }).passed, false);
});
