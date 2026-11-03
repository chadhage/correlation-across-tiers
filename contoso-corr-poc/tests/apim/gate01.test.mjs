import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { inspectPolicyXml, parsePolicyXml, scanSource } from "../../tools/protocol.mjs";

const fixture = name => new URL(`./fixtures/${name}`, import.meta.url);
const policy = name => new URL(`../../apim/policies/${name}`, import.meta.url);

test("isolated rewrite and RequestId fixtures fail even behind a false flag", async () => {
  const rewrite = scanSource(await readFile(fixture("flag-rewrite.xml"), "utf8"), "fixtures/flag-rewrite.xml");
  assert.ok(rewrite.some(result => result.code === "SAMPLED_FLAG_SURGERY"));
  assert.ok(rewrite.some(result => result.code === "VALID_CONTEXT_WRITE"));
  const requestId = scanSource(await readFile(fixture("request-id-parent.xml"), "utf8"), "fixtures/request-id-parent.xml");
  assert.ok(requestId.some(result => result.code === "REQUEST_ID_PROVENANCE"));
});

test("legacy diagnostic/nonzero bodies and missing/unresolved protocol fail", async () => {
  const findings = scanSource(await readFile(fixture("legacy-diagnostic.json"), "utf8"), "fixtures/legacy-diagnostic.json");
  assert.ok(findings.some(result => result.code === "DIAGNOSTIC_PROTOCOL"));
  assert.ok(findings.some(result => result.code === "BODY_CAPTURE_NONZERO"));
  const omitted = scanSource(JSON.stringify({ type: "Microsoft.ApiManagement/service/apis/diagnostics", apiVersion: "2024-05-01", properties: {} }), "omitted.json");
  assert.ok(omitted.some(result => result.code === "DIAGNOSTIC_PROTOCOL"));
  assert.ok(omitted.some(result => result.code === "DIAGNOSTIC_SCOPE_OVERRIDE"));
});

test("composed flag surgery, dynamic headers, unguarded deletion and fixture deployment references fail", () => {
  assert.ok(scanSource("traceFlags = parsedFlags | 1;", "bad.ts").some(result => result.code === "SAMPLED_FLAG_SURGERY"));
  assert.ok(inspectPolicyXml('<fragment><set-header name="{{header}}" exists-action="override"><value>value</value></set-header></fragment>').some(result => result.code === "HEADER_NAME_DYNAMIC"));
  assert.ok(inspectPolicyXml('<fragment><set-header name="traceparent" exists-action="delete"/></fragment>').some(result => result.code === "CONTEXT_DELETE_UNGUARDED"));
  assert.ok(scanSource("var value = loadTextContent('../../tests/apim/fixtures/flag-rewrite.xml')", "bad.bicep").some(result => result.code === "FIXTURE_DEPLOYMENT_REFERENCE"));
  assert.ok(scanSource("resource diagnostic 'Microsoft.ApiManagement/service/diagnostics@2025-09-01-preview' = {}", "bad.bicep").some(result => result.code === "APIM_API_PIN"));
  assert.ok(scanSource("traceFlags = 1;", "bad.ts").some(result => result.code === "SAMPLED_FLAG_SURGERY"));
  assert.ok(scanSource("resource diagnostic 'Microsoft.ApiManagement/service/diagnostics@2024-05-01' = { properties: { loggerId: 'logger' } }", "bad.bicep").some(result => result.code === "DIAGNOSTIC_PROTOCOL"));
});

test("SDK numeric/symbol pins accepted; mixed/old/unresolved/wrong-version settings fail", () => {
  assert.deepEqual(scanSource("distributedTracingMode: 18,", "telemetry.ts", { sdkVersion: "3.4.5" }), []);
  assert.deepEqual(scanSource("distributedTracingMode: DistributedTracingModes.W3C_TRACE,", "telemetry.ts", { sdkVersion: "3.4.5" }), []);
  for (const expression of ["1", "2", "17", "DistributedTracingModes.W3C", "runtime.unverifiedMode"]) {
    assert.ok(scanSource(`distributedTracingMode: ${expression},`, "telemetry.ts", { sdkVersion: "3.4.5" }).some(result => result.code === "SDK_TRACING_MODE"));
  }
  assert.ok(scanSource("distributedTracingMode: 18,", "telemetry.ts", { sdkVersion: "3.4.6" }).some(result => result.code === "SDK_TRACING_MODE"));
  assert.ok(scanSource("new ApplicationInsights({ config: { samplingPercentage: 100 } });", "telemetry.ts", { sdkVersion: "3.4.5" }).some(result => result.code === "SDK_TRACING_MODE"));
});

test("all owned policy templates pass the protocol/security structure checks", async () => {
  const directory = policy("fragments/");
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".xml")) continue;
    const xml = await readFile(new URL(name, directory), "utf8");
    assert.deepEqual(inspectPolicyXml(xml, name), [], name);
  }
  for (const name of ["service-policy.xml", "api-policy.xml"]) {
    assert.deepEqual(inspectPolicyXml(await readFile(policy(name), "utf8"), name), [], name);
  }
});

test("caller/workload policy is post-validation, app-only and separate from raw-header trust", async () => {
  const authenticate = parsePolicyXml(await readFile(policy("fragments/contoso-authn-v1.xml"), "utf8"));
  const validate = authenticate.children.find(node => node.name === "validate-azure-ad-token");
  assert.equal(validate.attributes["header-name"], "Authorization");
  assert.equal(validate.attributes["output-token-variable-name"], "contoso.validatedCallerJwt");
  assert.equal(authenticate.children[0].attributes.name, "X-Contoso-Gateway-Authorization");
  assert.equal(authenticate.children[0].attributes["exists-action"], "delete");
  const authorize = parsePolicyXml(await readFile(policy("fragments/contoso-authz-v1.xml"), "utf8"));
  const trusted = authorize.children.find(node => node.attributes.name === "contoso.callerTrustedInvocationIssuer").attributes.value;
  assert.ok(trusted.includes("contoso.validatedCallerJwt"));
  assert.ok(trusted.includes('identityTypes[0] == "app"'));
  assert.ok(trusted.includes('!jwt.Claims.ContainsKey("scp")'));
  assert.ok(trusted.includes('roles.Contains("Portal.Invoke")'));
  assert.equal(trusted.includes("context.Request.Headers"), false);
});

test("CORS nested/wildcard/proof exposure, business append and MI caller-token replacement fail", () => {
  const source = '<policies><inbound><choose><when condition="@(true)"><cors allow-credentials="true"><allowed-origins><origin>*</origin></allowed-origins><allowed-headers><header>X-Contoso-Gateway-Authorization</header></allowed-headers></cors></when></choose></inbound></policies>';
  const codes = inspectPolicyXml(source).map(result => result.code);
  assert.ok(codes.includes("CORS_ORDER"));
  assert.ok(codes.includes("CORS_WILDCARD"));
  assert.ok(codes.includes("CORS_HEADER_UNSAFE"));
  assert.ok(inspectPolicyXml('<fragment><set-header name="x-business-invocation-id" exists-action="append"><value>fixture</value></set-header></fragment>').some(result => result.code === "BUSINESS_HEADER_APPEND"));
  assert.ok(inspectPolicyXml('<fragment><set-header name="Authorization"><value>@("Bearer " + (string)context.Variables["contoso.gatewayMiToken"])</value></set-header></fragment>').some(result => result.code === "CALLER_AUTH_REPLACED"));
});

test("real service CORS permits SDK metadata without capture or credential exposure", async () => {
  const root = parsePolicyXml(await readFile(policy("service-policy.xml"), "utf8"));
  const cors = root.children.find(node => node.name === "inbound").children[0];
  const allowed = cors.children.find(node => node.name === "allowed-headers").children.map(node => node.text.trim());
  assert.ok(allowed.includes("Request-Context"));
  assert.equal(allowed.includes("X-Contoso-Gateway-Authorization"), false);
  const exposed = cors.children.find(node => node.name === "expose-headers");
  assert.equal(exposed.children.some(node => /Request-Context|Authorization/i.test(node.text)), false);
  const observability = await readFile(new URL("../../infra/modules/apim-observability.bicep", import.meta.url), "utf8");
  assert.equal(observability.includes("'Request-Context'"), false);
  assert.equal(observability.includes("'request-context'"), false);
});

test("malformed XML, DTD and nested fragment controls fail without fetching external entities", () => {
  assert.throws(() => parsePolicyXml("<fragment><choose></fragment>"));
  assert.throws(() => parsePolicyXml('<!DOCTYPE fragment SYSTEM "https://untrusted.example/fixture"><fragment/>'));
  assert.throws(() => parsePolicyXml("<fragment>&unknown;</fragment>"));
  assert.ok(inspectPolicyXml('<fragment><include-fragment fragment-id="other"/></fragment>').some(result => result.code === "FRAGMENT_STRUCTURE_INVALID"));
});

test("negative fixture manifest excludes every test artifact from deployment", async () => {
  const manifest = JSON.parse(await readFile(fixture("manifest.json"), "utf8"));
  assert.equal(manifest.deployable, false);
  assert.equal(manifest.files.length, 3);
  const module = await readFile(new URL("../../infra/modules/apim-api-policies.bicep", import.meta.url), "utf8");
  assert.equal(/tests[\\/]apim|fixtures/i.test(module), false);
});

test("OpenAPI is versioned, finite, preserves the prefix mapping and never exposes proof credentials", async () => {
  const spec = JSON.parse(await readFile(new URL("../../apim/openapi/contoso-orders.v1.json", import.meta.url), "utf8"));
  assert.equal(spec.openapi, "3.0.3");
  assert.equal(spec.servers[0].url, "/contoso/v1");
  assert.equal(spec["x-contoso-backend-base-path"], "/api");
  assert.equal(spec["x-contoso-required-delegated-scope"], "Orders.Invoke");
  assert.deepEqual(Object.keys(spec.paths), ["/orders", "/orders/{id}", "/me", "/demo-runs", "/demo-runs/{id}", "/demo-runs/{id}/controls"]);
  assert.equal(Object.keys(spec.paths).some(route => route.startsWith("/api") || route.includes("?")), false);
  assert.equal(Object.values(spec.components.parameters).some(parameter => parameter.name === "X-Contoso-Gateway-Authorization"), false);
  assert.equal(spec.components.schemas.DemoRunRequest.properties.demoId.maximum, 15);
  assert.deepEqual(spec.components.schemas.ActorView.properties.actorType.enum, ["user", "workload"]);
  assert.equal(spec.components.schemas.ActorView.properties.pseudonym.pattern, "^h1:[0-9a-f]{32}:[A-Za-z0-9_-]{43}$");
  assert.deepEqual(spec.components.schemas.ActorView.oneOf[1].not.required, ["pseudonym"]);
  assert.equal(spec.components.schemas.ControlRequest.properties.action.enum.includes("REPLAY"), true);
  assert.equal(spec.components.responses.stagedWorkflow.description.includes("not proof of broker acceptance"), true);
});
