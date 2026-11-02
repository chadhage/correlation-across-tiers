import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectPolicyXml } from "../../tools/protocol.mjs";

test("pinned Bicep compiles all APIM modules and preserves real deployment/security contracts", async t => {
  const executable = process.env.CONTOSO_BICEP_PATH ?? "bicep";
  const version = spawnSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (version.error?.code === "ENOENT" && !process.env.CONTOSO_BICEP_PATH) {
    t.skip("Set CONTOSO_BICEP_PATH to the existing frozen compiler; compilation is not verified by this run.");
    return;
  }
  assert.equal(version.status, 0, version.error?.message || version.stderr);
  const lock = JSON.parse(await readFile(new URL("../../config/versions.lock.json", import.meta.url), "utf8"));
  assert.ok(version.stdout.includes(`Bicep CLI version ${lock.portableTools.bicep.version} `));
  if (process.env.CONTOSO_BICEP_PATH) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(executable)) hash.update(chunk);
    assert.equal(hash.digest("hex"), lock.portableTools.bicep.sha256, "Compiler binary must match the frozen source hash.");
  }
  const templates = {};
  for (const module of ["apim-service", "apim-observability", "apim-api-policies"]) {
    const result = spawnSync(executable, ["build", fileURLToPath(new URL(`../../infra/modules/${module}.bicep`, import.meta.url)), "--stdout"], {
      encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || module);
    const template = JSON.parse(result.stdout);
    templates[module] = template;
    for (const resource of Object.values(template.resources)) assert.equal(resource.apiVersion, "2024-05-01", `${module}: ${resource.type}`);
    assert.equal(/tests[\\/]apim|fixtures[\\/]/i.test(JSON.stringify(template)), false);
  }
  const resources = module => Object.values(templates[module].resources);
  const gateway = resources("apim-service").find(resource => resource.type === "Microsoft.ApiManagement/service");
  assert.deepEqual(gateway.sku, { name: "Developer", capacity: 1 });
  assert.equal(gateway.identity.type, "SystemAssigned");
  if (typeof gateway.properties === "string") {
    assert.match(gateway.properties, /^\[shallowMerge\(createArray\(createObject\(/);
    assert.ok(gateway.properties.includes("'virtualNetworkType', 'External'"));
    assert.equal([...gateway.properties.matchAll(/'virtualNetworkType'/g)].length, 1);
  } else assert.equal(gateway.properties.virtualNetworkType, "External");
  const observability = templates["apim-observability"];
  assert.equal(observability.parameters.connectionSecretIdentifier.type.toLowerCase(), "securestring");
  assert.equal(observability.parameters.samplingPercentage.defaultValue, 10);
  assert.equal(observability.parameters.captureCanonicalBackendBusinessHeader.defaultValue, false);
  const named = resources("apim-observability").find(resource => resource.type.endsWith("/namedValues"));
  assert.equal(named.properties.secret, true);
  assert.equal(named.properties.keyVault.secretIdentifier, "[parameters('connectionSecretIdentifier')]");
  assert.equal(Object.hasOwn(named.properties, "value"), false);
  const logger = resources("apim-observability").find(resource => resource.type.endsWith("/loggers"));
  assert.equal(logger.properties.loggerType, "applicationInsights");
  assert.deepEqual(logger.properties.credentials, { connectionString: "{{contoso-appinsights-connection-string}}", identityClientId: "SystemAssigned" });
  assert.ok(logger.dependsOn.length > 0);
  const diagnostic = resources("apim-observability").find(resource => resource.type.endsWith("/diagnostics"));
  assert.equal(diagnostic.properties.httpCorrelationProtocol, "W3C");
  assert.equal(diagnostic.properties.sampling.samplingType, "fixed");
  assert.equal(diagnostic.properties.logClientIp, false);
  assert.equal(diagnostic.properties.metrics, false);
  assert.equal(diagnostic.properties.operationNameFormat, "Name");
  for (const side of ["frontend", "backend"]) for (const direction of ["request", "response"]) {
    assert.equal(diagnostic.properties[side][direction].body.bytes, 0);
    if (side === "backend" && direction === "request") {
      assert.ok(diagnostic.properties[side][direction].headers.includes("variables('captureApplied')"));
      assert.ok(diagnostic.properties[side][direction].headers.includes("x-business-invocation-id"));
    } else assert.deepEqual(diagnostic.properties[side][direction].headers, []);
  }
  const policies = templates["apim-api-policies"];
  const fragments = resources("apim-api-policies").find(resource => resource.type.endsWith("/policyFragments"));
  assert.ok(fragments.dependsOn.includes("policyConfiguration"), "Named values must exist before fragments are validated.");
  assert.equal(policies.variables.fragments.length, 9);
  assert.ok(policies.variables.callerIdsXml.includes("toLower"));
  for (const name of ["contoso-tenant-id", "contoso-public-audience", "contoso-portal-client-ids"]) {
    assert.ok(policies.variables.configuration.find(item => item.name === name).value.includes("toLower"), name);
  }
  assert.equal(policies.variables.configuration.find(item => item.name === "contoso-orders-token-resource").value, "[parameters('ordersTokenResource')]");
  const api = resources("apim-api-policies").find(resource => resource.type === "Microsoft.ApiManagement/service/apis");
  assert.equal(api.properties.path, "contoso/v1");
  assert.equal(api.properties.serviceUrl, "[parameters('ordersBackendBaseUrl')]");
  assert.equal(api.properties.subscriptionRequired, false);
  const apiPolicy = resources("apim-api-policies").find(resource => resource.type.endsWith("/apis/policies"));
  for (const dependency of ["policyConfiguration", "policyFragments", "servicePolicy", "backend"]) assert.ok(apiPolicy.dependsOn.includes(dependency), dependency);
  const literal = /^\[variables\('([^']+)'\)\]$/.exec(apiPolicy.properties.value);
  const policyXml = literal ? policies.variables[literal[1]] : apiPolicy.properties.value;
  assert.deepEqual(inspectPolicyXml(policyXml), []);
  assert.equal(resources("apim-api-policies").some(resource => resource.type.endsWith("/apis/diagnostics")), false);
  assert.equal(policies.outputs.callerAuthorizationHeader.value, "Authorization");
  assert.equal(policies.outputs.gatewayProofHeader.value, "X-Contoso-Gateway-Authorization");
});
