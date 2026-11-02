import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPolicyXml, runProtocolGate, scanSource } from "../../tools/protocol.mjs";

test("textual guard mentions do not authorize deletion behind unconditional alternatives", () => {
  for (const condition of [
    '@((string)context.Variables["contoso.traceparentDisposition"] != "valid" || true)',
    '@(true || (string)context.Variables["contoso.traceparentDisposition"] != "valid")',
    '@(!(bool)context.Variables["contoso.tracestateValid"] || true)'
  ]) {
    const escaped = condition.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const source = `<fragment><choose><when condition="${escaped}"><set-header name="tracestate" exists-action="delete" /></when></choose></fragment>`;
    assert.ok(inspectPolicyXml(source).some(finding => finding.code === "CONTEXT_DELETE_UNGUARDED"), condition);
  }
});

test("hidden policy telemetry/raw metadata/third-party credential forwarding fails closed", () => {
  for (const [source, code] of [
    ['<fragment><trace source="contoso-gateway"><message>Contoso invocation edge.</message><metadata name="raw" value="@((string)context.Variables[&quot;rejectedCandidate&quot;])" /></trace></fragment>', "TRACE_METADATA_UNSAFE"],
    ['<fragment><trace><message>@(context.Request.OriginalUrl.ToString())</message></trace></fragment>', "TRACE_SENSITIVE"],
    ['<fragment><set-backend-service base-url="https://third-party.example" /></fragment>', "BACKEND_TARGET_UNSAFE"],
    ['<fragment><set-backend-service backend-id="{{caller-backend}}" /></fragment>', "BACKEND_TARGET_UNSAFE"],
    ['<fragment><choose><when condition="@(false)"><log-to-eventhub logger-id="hidden">fixture</log-to-eventhub></when></choose></fragment>', "UNDECLARED_POLICY_EGRESS"],
    ['<fragment><send-request mode="copy" response-variable-name="ignored"><set-url>https://third-party.example</set-url></send-request></fragment>', "UNDECLARED_POLICY_EGRESS"]
  ]) assert.ok(inspectPolicyXml(source).some(finding => finding.code === code), code);
});

test("named SDK values cannot conceal composed mixed mode and dynamic bodies cannot pass as zero", () => {
  for (const value of [
    "DistributedTracingModes.W3C_TRACE | 17",
    "enabled ? DistributedTracingModes.W3C_TRACE : 17",
    "unverified.W3C_TRACE",
    "DistributedTracingModes.W3C_TRACE + 1"
  ]) assert.ok(scanSource(`distributedTracingMode: ${value},`, "unsafe.ts").some(finding => finding.code === "SDK_TRACING_MODE"), value);
  const diagnostic = "resource diagnostic 'Microsoft.ApiManagement/service/diagnostics@2024-05-01' = { properties: { httpCorrelationProtocol: 'W3C', frontend: {request: {body: {bytes: bytesFromNamedValue}}} } }";
  assert.ok(scanSource(diagnostic, "unsafe.bicep").some(finding => finding.code === "BODY_CAPTURE_UNRESOLVED"));
  assert.deepEqual(scanSource('app.config.distributedTracingMode === DistributedTracingModes.W3C_TRACE ? "W3C_TRACE" : "UNSUPPORTED"', "observation.ts"), []);
  assert.ok(scanSource("app.config.distributedTracingMode = 17;", "unsafe.ts").some(finding => finding.code === "SDK_TRACING_MODE"));
});

test("a W3C constant in another file cannot certify an unbound SDK initialization", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const fixture = path.join(root, ".cache", "r3-apim", `source-fixture-${randomUUID()}`);
  try {
    await mkdir(path.join(fixture, "apim"), { recursive: true });
    await mkdir(path.join(fixture, "web"), { recursive: true });
    await copyFile(path.join(root, "apim", "sdk-source-pin.json"), path.join(fixture, "apim", "sdk-source-pin.json"));
    await writeFile(path.join(fixture, "web", "package.json"), JSON.stringify({ dependencies: { "@microsoft/applicationinsights-web": "3.4.5" } }));
    await writeFile(path.join(fixture, "web", "unrelated.ts"), "const unboundMode = 18;");
    await writeFile(path.join(fixture, "web", "unsafe.ts"), "new ApplicationInsights({ config: { distributedTracingMode: unboundMode } });");
    const result = await runProtocolGate(fixture);
    assert.equal(result.codePassed, false);
    assert.ok(result.findings.some(finding => finding.code === "SDK_TRACING_MODE" && finding.path.endsWith("unsafe.ts")));
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
