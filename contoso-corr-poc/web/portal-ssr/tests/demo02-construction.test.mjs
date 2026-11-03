import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readBoundFile } from "../../../tools/verification/files.mjs";
import * as construction from "../../../tools/verification/adapters/demo02-runtime.mjs";

const code = expected => error => error?.code === expected;
async function contracts() {
  return {
    map: JSON.parse((await readBoundFile("contracts\\expected-boundary-map.v1.json")).toString("utf8")),
    catalog: JSON.parse((await readBoundFile("demos\\catalog.json")).toString("utf8"))
  };
}
function context() {
  return { schema: "contoso.demo-context.v1", demoId: "02", runId: randomUUID(), mode: "LocalValidate",
    spec: { id: "02", scenario: "SYNC", assertion: "ssr" }, requestedBusinessInvocationId: randomUUID(),
    signal: new AbortController().signal };
}

test("positive: Demo02 trigger input selects its actual Portal form and never claims the requested business ID as observed", () => {
  const input = context();
  const spec = construction.demo02PortalSpec(input, "CONTOSO-DEMO02");
  assert.deepEqual(spec, { schemaVersion: 1, runId: input.runId, demoId: 2, kind: "portal", sku: "CONTOSO-DEMO02", quantity: 1 });
  assert.equal("businessInvocationId" in spec, false);
  assert.equal("observationOrigin" in spec, false);
  assert.equal("schema" in spec, false);
  assert.throws(() => { spec.demoId = 1; }, TypeError);
});
test("negative: inherited Demo01 context, wrong scenario, missing lease input and aborted trigger cannot become Demo02", () => {
  for (const mutate of [
    value => { value.demoId = "01"; },
    value => { value.runId = "not-a-run-id"; },
    value => { value.mode = "native-runtime"; },
    value => { value.spec.id = "01"; },
    value => { value.spec.scenario = "RETRY"; },
    value => { value.spec.assertion = "sync"; }
  ]) {
    const input = context(); mutate(input);
    assert.throws(() => construction.demo02PortalSpec(input, "CONTOSO-DEMO02"), code("D_DEMO02_INPUT"));
  }
  assert.throws(() => construction.demo02PortalSpec(context(), "caller/private/value"), code("D_DEMO02_INPUT"));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => construction.demo02PortalSpec({ ...context(), signal: controller.signal }, "CONTOSO-DEMO02"), code("D_DEMO02_ABORTED"));
});
test("positive: actual Demo02 catalog and map require both SSR joins and explain page-view context separately", async () => {
  const { map, catalog } = await contracts();
  const snapshot = JSON.stringify({ map, catalog });
  const result = construction.inspectDemo02BoundaryContract(map, catalog);
  assert.equal(result.sourceKind, "expected-boundary-contract-only");
  assert.equal(result.nativeExecution, "NOT RUN");
  assert.equal(result.browserPageTelemetryRole, "contoso-storefront-spa");
  assert.equal(result.serverRenderRole, "contoso-portal-ssr");
  assert.equal(result.separateRootBoundary, "portal.request");
  assert.deepEqual(result.requiredParentEdges, [
    { from: "portal.request", to: "portal.gateway", path: "ssr" },
    { from: "portal.gateway", to: "gateway.request", path: "ssr" },
    { from: "storefront.http", to: "gateway.request", path: "spa" }
  ]);
  assert.match(result.browserPageViewIdentity, /32-hex display Id is not a request\/dependency span/);
  assert.match(result.observedRoots, /NOT CAPTURED/);
  assert.equal(JSON.stringify({ map, catalog }), snapshot);
});
test("negative: role substitution, missing SSR parent, invented browser parent and fake native catalog authority fail", async () => {
  const source = await contracts();
  for (const mutate of [
    value => { value.map.spans.find(item => item.id === "portal.request").roleName = "contoso-storefront-spa"; },
    value => { value.map.spans.find(item => item.id === "portal.gateway").semanticKind = "SERVER"; },
    value => { value.map.edges = value.map.edges.filter(item => !(item.from === "portal.gateway" && item.to === "gateway.request")); },
    value => { value.map.edges.push({ ...value.map.edges.find(item => item.from === "portal.gateway" && item.to === "gateway.request") }); },
    value => { value.map.edges.push({ from: "storefront.http", to: "portal.request", type: "parent", path: "ssr" }); },
    value => { value.map.deliberateRoots = value.map.deliberateRoots.filter(item => item.boundary !== "portal.request"); },
    value => { value.catalog.sourceAcceptanceIsCertification = true; },
    value => { value.catalog.nativeExecution = "PASS"; },
    value => { value.catalog.demos.find(item => item.id === "02").assertion = "sync"; },
    value => { value.catalog.demos.push(value.catalog.demos.find(item => item.id === "02")); }
  ]) {
    const fixture = structuredClone(source); mutate(fixture);
    assert.throws(() => construction.inspectDemo02BoundaryContract(fixture.map, fixture.catalog),
      error => ["D_DEMO02_BOUNDARY", "D_DEMO02_CATALOG"].includes(error?.code));
  }
});
test("positive: concrete shipped Demo02 interfaces remain BLOCKED without native operations and stale predecessor pins are not repinned", async () => {
  const report = await construction.inspectDemo02Construction();
  assert.equal(report.schema, "contoso.demo02-runtime-construction.v1");
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.runnableDemoAdapter, false);
  assert.equal(report.nativeExecution, "NOT RUN");
  assert.equal(report.certificationStatus, "NOT CERTIFIED");
  assert.equal(report.sourceAcceptanceIsCertification, false);
  assert.deepEqual(report.sources.map(item => item.path), construction.DEMO02_SOURCE_PATHS);
  assert.equal(report.coupledDemo01Source.nativeReadinessInherited, false);
  assert.equal(report.coupledDemo01Source.sourceBindingMatches,
    report.coupledDemo01Source.authorFrozenAppSha256 === report.coupledDemo01Source.currentAppSha256);
  assert.deepEqual(report.blockingInterfaces.map(item => item.id), [
    "approved-deployed-portal-and-storefront", "independent-two-root-and-gateway-observation",
    "native-query-and-privacy-capability", "native-sampling-and-drain", "run-owned-baseline-and-reset",
    "durable-authenticated-recovery", "reviewed-native-dem00-predecessor"
  ]);
  assert.equal(typeof construction.createAdapter, "undefined");
  assert.equal(typeof construction.adapter, "undefined");
  assert.equal(Object.isFrozen(report.blockingInterfaces[0]), true);
});
test("negative: forged source closure, callbacks, fixture rows and mode JSON cannot enroll a native adapter", async () => {
  const report = await construction.inspectDemo02Construction();
  for (const candidate of [
    report.sources.slice(1),
    report.sources.map((item, index) => index ? item : { ...item, sha256: "f".repeat(64) }),
    report.sources.map((item, index) => index ? item : report.sources[1]),
    report.sources.map((item, index) => index ? item : { ...item, path: "..\\outside.mjs" }),
    report.sources.map((item, index) => index ? item : { ...item, nativeEvidence: true })
  ]) await assert.rejects(construction.verifyDemo02Sources(candidate), code("D_DEMO02_SOURCE"));
  for (const input of [{ execute: () => ({ observationOrigin: "native-runtime" }) },
    { spanRows: [], nativeExecution: "PASS" }, { mode: "Certify", sourceReviewed: true }])
    await assert.rejects(construction.inspectDemo02Construction(input), code("D_ARGUMENT"));
});
test("negative: awaited source verification returns only the internal verified snapshot after caller mutation", async () => {
  const report = await construction.inspectDemo02Construction();
  const candidate = structuredClone(report.sources);
  const verification = construction.verifyDemo02Sources(candidate);
  candidate[0].path = "forged.mjs"; candidate[0].sha256 = "f".repeat(64);
  assert.deepEqual(await verification, report.sources);
});
test("negative: only source check runs; CLI remains non-runnable BLOCKED with no hosted, native or reset side effect", async () => {
  for (const args of [[], ["--run"], ["--check", "--mode", "Certify"], ["--check", "--allow-azure-writes"]])
    await assert.rejects(construction.demo02ConstructionMain(args), code("D_ARGUMENT"));
  const file = fileURLToPath(new URL("../../../tools/verification/adapters/demo02-runtime.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [file, "--check"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, "BLOCKED");
  assert.equal(report.runnableDemoAdapter, false);
  const invalid = spawnSync(process.execPath, [file, "--run"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.equal(invalid.stderr.trim(), "D_ARGUMENT");
});
