import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { contextDecision, isCanonicalInvocationId } from "../../tools/protocol.mjs";

const trace = "11111111111111111111111111111111";
const parent = "2222222222222222";
const sampled = `00-${trace}-${parent}-01`;
const unsampled = `00-${trace}-${parent}-00`;
const portal = "11111111-2222-4333-8444-555555555555";
const alphaPortal = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const workloadClaims = { azp: portal, idtyp: "app", roles: ["Portal.Invoke"] };

test("actual deployed C# context, auth-shape and business guards execute in the local CLR", t => {
  const command = process.env.CONTOSO_APIM_POWERSHELL ?? "pwsh";
  const available = spawnSync(command, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
  if (available.error?.code === "ENOENT") { t.skip("PowerShell/.NET is unavailable; APIM expression execution is not verified."); return; }
  assert.equal(available.status, 0, "PowerShell must be responsive.");
  const carriers = [
    ["sampled", sampled, "contoso=one"], ["unsampled", unsampled, "contoso=one"],
    ["future-prefix", `01-${trace}-${parent}-01-future`, "contoso=one"],
    ["invalid-state", sampled, "contoso=one,contoso=two"],
    ["combined-state", sampled, ["contoso=one", "vendor=two"]],
    ["empty-state-members", sampled, ", \t,contoso=one"],
    ["absent", undefined, undefined], ["orphan-state", undefined, "contoso=one"],
    ["duplicate", [sampled, sampled], "contoso=one"], ["folded", `${sampled},${sampled}`, undefined],
    ["zero-trace", `00-${"0".repeat(32)}-${parent}-01`, undefined],
    ["zero-parent", `00-${trace}-${"0".repeat(16)}-01`, undefined],
    ["forbidden-version", `ff-${trace}-${parent}-01`, undefined],
    ["uppercase", sampled.toUpperCase().replace(trace, "A".repeat(32)), undefined],
    ["leading-space", ` ${sampled}`, undefined], ["trailing-control", `${sampled}\n`, undefined],
    ["oversized", `01-${trace}-${parent}-01-${"x".repeat(256)}`, undefined],
    ["bad-future-separator", `01-${trace}-${parent}-01future`, undefined],
    ["state-33-members", sampled, Array.from({ length: 33 }, (_, i) => `v${i}=x`).join(",")],
    ["state-512", sampled, `a=${"x".repeat(253)},b=${"y".repeat(254)}`],
    ["state-513", sampled, `a=${"x".repeat(253)},b=${"y".repeat(255)}`],
    ["state-control", sampled, "contoso=x\ty"]
  ];
  const vectors = carriers.map(([caseId, traceparent, tracestate]) => ({
    caseId, headers: { ...(traceparent === undefined ? {} : { TraceParent: traceparent }), ...(tracestate === undefined ? {} : { tracestate }) }
  }));
  vectors.push(
    { caseId: "trusted-business", headers: { "x-business-invocation-id": portal }, claims: workloadClaims },
    { caseId: "untrusted-business", headers: { "x-business-invocation-id": portal } },
    { caseId: "duplicate-business", headers: { "x-business-invocation-id": [portal, portal] }, claims: workloadClaims },
    { caseId: "invalid-business", headers: { "x-business-invocation-id": portal.toUpperCase().replace("5555", "AAAA") }, claims: workloadClaims },
    { caseId: "delegated-business", headers: { "x-business-invocation-id": portal }, claims: { azp: portal, scp: "Orders.Invoke other" } },
    { caseId: "app-with-scope", headers: {}, claims: { ...workloadClaims, scp: "Orders.Invoke" } },
    { caseId: "duplicate-scope", headers: {}, claims: { scp: ["Orders.Invoke", "other"] } },
    { caseId: "conflicting-client", headers: {}, claims: { ...workloadClaims, appid: "99999999-aaaa-4bbb-8ccc-dddddddddddd" } },
    { caseId: "duplicate-client", headers: {}, claims: { ...workloadClaims, azp: [portal, portal] } },
    { caseId: "null-roles", headers: {}, claims: { ...workloadClaims, roles: null } },
    { caseId: "missing-app-type", headers: {}, claims: { azp: portal, roles: ["Portal.Invoke"] } },
    { caseId: "wrong-role", headers: {}, claims: { ...workloadClaims, roles: ["Gateway.Invoke"] } },
    { caseId: "upper-config-lower-claim", headers: {}, claims: { ...workloadClaims, azp: alphaPortal } },
    { caseId: "upper-config-upper-claim", headers: {}, claims: { ...workloadClaims, azp: alphaPortal.toUpperCase(), appid: alphaPortal } },
    { caseId: "upper-config-foreign-claim", headers: {}, claims: { ...workloadClaims, azp: "99999999-aaaa-4bbb-8ccc-dddddddddddd" } },
    { caseId: "valid-authorization-shape", headers: { Authorization: "Bearer synthetic-test-only" } },
    { caseId: "duplicate-authorization", headers: { Authorization: ["Bearer one-test-only", "Bearer two-test-only"] } },
    { caseId: "folded-authorization", headers: { Authorization: "Bearer one-test-only,Bearer two-test-only" } }
  );
  const run = spawnSync(command, ["-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./Invoke-PolicyExpressions.ps1", import.meta.url))], {
    encoding: "utf8", input: JSON.stringify({ vectors, portalClientIds: [portal, alphaPortal.toUpperCase()] }), timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message || "CLR expression probe failed.");
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.sourceKind, "local-clr-policy-expression");
  assert.equal(result.apimRuntimeVerified, false);
  assert.equal(result.jwtSignaturesVerified, false);
  assert.equal(result.parsedFragmentCount, 9);
  for (const [caseId, traceparent, tracestate] of carriers) {
    const row = result.results.find(row => row.caseId === caseId);
    const expected = contextDecision(traceparent, tracestate);
    assert.equal(row.parentDisposition, expected.parent.disposition, caseId);
    assert.equal(row.stateValid, expected.state.valid, caseId);
    assert.deepEqual(row.deletedHeaders, expected.deleteHeaders, caseId);
  }
  for (const row of result.results) assert.equal(isCanonicalInvocationId(row.businessId), true, row.caseId);
  const row = id => result.results.find(row => row.caseId === id);
  assert.equal(row("trusted-business").businessId, portal);
  assert.equal(row("trusted-business").businessDisposition, "accepted-trusted");
  assert.equal(row("trusted-business").trustedIssuer, true);
  assert.equal(row("delegated-business").delegated, true);
  assert.equal(row("delegated-business").trustedIssuer, false);
  for (const id of ["untrusted-business", "duplicate-business", "invalid-business", "delegated-business"]) {
    assert.notEqual(row(id).businessDisposition, "accepted-trusted", id);
  }
  for (const id of ["app-with-scope", "duplicate-scope", "conflicting-client", "duplicate-client", "null-roles", "missing-app-type", "wrong-role"]) {
    assert.equal(row(id).trustedIssuer, false, id);
  }
  assert.equal(row("app-with-scope").delegated, false);
  assert.equal(row("duplicate-scope").delegated, false);
  assert.equal(row("upper-config-lower-claim").trustedIssuer, true);
  assert.equal(row("upper-config-upper-claim").trustedIssuer, true);
  assert.equal(row("upper-config-foreign-claim").trustedIssuer, false);
  assert.equal(row("valid-authorization-shape").authorizationHeaderValid, true);
  assert.equal(row("duplicate-authorization").authorizationHeaderValid, false);
  assert.equal(row("folded-authorization").authorizationHeaderValid, false);
});
