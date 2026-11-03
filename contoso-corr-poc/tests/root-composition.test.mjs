import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { frozenNames } from "../tools/names.mjs";
import { ROOT_SUBSCRIPTION_ID, canonicalScmCidr, rootArmParameters, validateRootInputs } from "../tools/root-preflight.mjs";
import { assertRootWorkbookComposition, writeRootCandidate } from "../tools/root-candidate.mjs";

function foundation() {
  const names = frozenNames(ROOT_SUBSCRIPTION_ID, "centralus");
  return { schema: "contoso.root-inputs.v1", subscriptionId: ROOT_SUBSCRIPTION_ID, location: "centralus",
    resourceGroup: names.resourceGroup, deploymentPhase: "foundation", names, publisherName: "Contoso",
    publisherEmail: "operator@example.invalid", applicationConfiguration: {}, postgresAdministrator: {},
    scmRunnerCidrs: [], notificationActionGroupIds: [], deploymentApprovalReference: "" };
}

function application() {
  const input = foundation();
  const id = index => `11111111-1111-4111-8111-${index.toString(16).padStart(12, "0")}`;
  const services = ["gateway", "portal", "orders", "inventory", "fulfillment", "notify", "aggregator"];
  return { ...input, deploymentPhase: "application",
    applicationConfiguration: {
      tenantId: id(1), ordersApiClientId: id(2), inventoryApiClientId: id(3), storefrontClientId: id(4),
      portalOrigin: `https://${input.names.portal}-fixture.centralus-01.azurewebsites.net`,
      inventoryBaseUrl: `https://${input.names.inventory}-fixture.centralus-01.azurewebsites.net/api`,
      hmacSecretVersion: "a1".repeat(16),
      principals: Object.fromEntries(services.map((name, index) => [name, { clientId: id(10 + index), objectId: id(20 + index) }])),
      controller: { clientId: id(40), objectId: id(41) },
      databaseRoles: { inventory: "contoso_inventory", orders: "contoso_orders", fulfillment: "contoso_fulfillment",
        notify: "contoso_notify", aggregator: "contoso_aggregator" },
      approvedTestCallerClientIds: []
    },
    postgresAdministrator: { objectId: id(42), principalType: "Group", principalName: "Fixture only; no live authority" } };
}

test("foundation has no invented client IDs, secret versions or deployment authority", () => {
  const result = validateRootInputs(foundation());
  assert.equal(result.syntaxPassed, true);
  assert.equal(result.deploymentReady, false);
  assert.equal(result.authorizationVerified, false);
  assert.equal(result.certification, "NOT_CERTIFIED");
  assert.equal(validateRootInputs({ ...foundation(), publisherEmail: "" }).syntaxPassed, false);
  assert.equal(validateRootInputs({ ...foundation(), applicationConfiguration: { hmacSecretVersion: "0".repeat(32) } }).syntaxPassed, false);
  const parameters = rootArmParameters(foundation());
  assert.equal(parameters.parameters.deploymentPhase.value, "foundation");
  assert.equal(parameters.parameters.publisherEmail.value, "operator@example.invalid");
  assert.equal(parameters.parameters.subscriptionId, undefined);
  assert.throws(() => rootArmParameters({ ...foundation(), publisherEmail: "" }), /PREFLIGHT_REQUIRED/);
});

test("application rejects absent bindings, zero IDs, broad SCM and inline secrets", () => {
  assert.equal(validateRootInputs({ ...foundation(), deploymentPhase: "application" }).syntaxPassed, false);
  assert.equal(validateRootInputs({ ...foundation(), scmRunnerCidrs: ["0.0.0.0/0"] }).syntaxPassed, false);
  assert.equal(validateRootInputs({ ...foundation(), publisherEmail: "InstrumentationKey=not-allowed" }).syntaxPassed, false);
  assert.equal(validateRootInputs({ ...foundation(), location: "eastus2" }).syntaxPassed, false);
});

test("SCM scope rejects every host-bits spelling of IPv4 /0 before rendering", () => {
  for (const cidr of ["0.0.0.0/0", "127.0.0.1/0", "203.0.113.17/0", "999.1.1.1/24", "127.000.0.1/32"]) {
    const input = { ...foundation(), scmRunnerCidrs: [cidr] };
    assert.equal(validateRootInputs(input).syntaxPassed, false, cidr);
    assert.throws(() => rootArmParameters(input), /PREFLIGHT_REQUIRED/, cidr);
  }
  assert.equal(canonicalScmCidr("203.0.113.17/24"), "203.0.113.0/24");
  assert.deepEqual(rootArmParameters({ ...foundation(), scmRunnerCidrs: ["203.0.113.17/24"] }).parameters.scmRunnerCidrs.value,
    ["203.0.113.0/24"]);
});

test("prefixed and normalized credential keys or unused foundation admin data cannot enter parameters", () => {
  for (const key of ["AZURE_CLIENT_SECRET", "azure-client-secret", "Client_Secret", "APPLICATIONINSIGHTS_CONNECTION_STRING",
    "private-key", "access_token", "database-password", "AccountKey"]) {
    const input = { ...foundation(), postgresAdministrator: { [key]: "synthetic-review-only" } };
    const result = validateRootInputs(input);
    assert.equal(result.syntaxPassed, false, key);
    assert.ok(result.errors.includes("ROOT_SECRET_VALUE_FORBIDDEN"), key);
    assert.throws(() => rootArmParameters(input), /PREFLIGHT_REQUIRED/, key);
    assert.equal(JSON.stringify(result).includes("synthetic-review-only"), false);
  }
  assert.equal(validateRootInputs({ ...foundation(), postgresAdministrator: { principalName: "unused" } }).syntaxPassed, false);
  assert.equal(validateRootInputs({ ...foundation(), applicationConfiguration: [] }).syntaxPassed, false);
});

test("complete synthetic application references pass syntax without becoming deployment approval", () => {
  const input = application();
  const result = validateRootInputs(input);
  assert.equal(result.syntaxPassed, true);
  assert.equal(result.deploymentReady, false);
  assert.equal(result.authorizationVerified, false);
  const parameters = rootArmParameters(input).parameters;
  assert.deepEqual(parameters.applicationConfiguration.value, input.applicationConfiguration);
  assert.equal(parameters.applicationConfiguration.value.inventoryBaseUrl, input.applicationConfiguration.inventoryBaseUrl);
  assert.equal(parameters.deploymentApprovalReference.value, "");
});

test("Inventory URL is an explicit captured HTTPS app-host API root, never a name-derived fallback", () => {
  for (const inventoryBaseUrl of [undefined, "", "http://inventory.azurewebsites.net/api",
    "https://inventory.azurewebsites.net/api/", "https://inventory.azurewebsites.net/api?token=redacted",
    "https://inventory.azurewebsites.net/api#state", "https://caller@inventory.azurewebsites.net/api",
    "https://inventory.azurewebsites.net:8443/api", "https://inventory.example.invalid/api",
    "https://inventory.azurewebsites.net.other.invalid/api", "https://inventory.azurewebsites.net/"]) {
    const input = application();
    input.applicationConfiguration.inventoryBaseUrl = inventoryBaseUrl;
    const result = validateRootInputs(input);
    assert.equal(result.syntaxPassed, false);
    assert.ok(result.errors.includes("ACTUAL_FOUNDATION_INVENTORY_BASE_URL_REQUIRED"));
    assert.throws(() => rootArmParameters(input), /PREFLIGHT_REQUIRED/);
  }
});

test("sealed application and ARM schemas reject unknown or decorated credential fields before rendering", () => {
  for (const decorate of [
    input => { input.applicationConfiguration.unknownArmParameter = 1; },
    input => { input.applicationConfiguration.principals.portal.extra = 1; },
    input => { input.applicationConfiguration.controller.extra = 1; },
    input => { input.applicationConfiguration.databaseRoles.extra = "unused"; },
    input => { input.postgresAdministrator.AZURE_CLIENT_SECRET_EXTRA = "synthetic-only"; },
    input => { input.applicationConfiguration["azure-client-secret"] = "synthetic-only"; },
    input => { input.applicationConfiguration.principals.inventory["access_token"] = "synthetic-only"; },
    input => { input.extraArmParameter = "unused"; }
  ]) {
    const input = application();
    decorate(input);
    const result = validateRootInputs(input);
    assert.equal(result.syntaxPassed, false);
    assert.throws(() => rootArmParameters(input), /PREFLIGHT_REQUIRED/);
    assert.equal(JSON.stringify(result).includes("synthetic-only"), false);
  }
});

test("creation-time ingress and dynamic host output bindings do not produce compute cycles or partial web updates", async () => {
  const main = await readFile(new URL("../infra/main.bicep", import.meta.url), "utf8");
  const access = await readFile(new URL("../infra/modules/root-access.bicep", import.meta.url), "utf8");
  const settings = main.slice(main.indexOf("var serviceSettings"), main.indexOf("module compute"));
  assert.ok(settings.includes("CONTOSO_INVENTORY_BASE_URL: configuredInventoryBaseUrl"));
  assert.equal(settings.includes("compute.outputs."), false);
  assert.ok(main.includes("apiIpSecurityRestrictions: apiIngressRules"));
  assert.ok(main.includes("workerIpSecurityRestrictions: workerIngressRules"));
  assert.ok(main.includes("scmIpSecurityRestrictions: scmIngressRules"));
  assert.ok(main.includes("output inventoryBaseUrl string = compute.outputs.inventoryBaseUrl"));
  assert.ok(main.includes("output portalOrigin string = compute.outputs.portalOrigin"));
  assert.equal(access.includes("Microsoft.Web/sites/config"), false);
  assert.ok(access.includes("name: 'scm'"));
  assert.ok(access.includes("name: 'ftp'"));
  assert.ok(access.includes("properties: { allow: false }"));
  assert.ok(access.includes("scope: hostBlobs["));
  assert.ok(access.includes("scope: appi"));
});

test("published root candidates cannot be overwritten while source and module revisions advance", async () => {
  const before = await readFile(new URL("../infra/root-preparation-candidate.v2.json", import.meta.url));
  await assert.rejects(() => writeRootCandidate("v2"), /REVISION_ALREADY_EXISTS/);
  assert.deepEqual(await readFile(new URL("../infra/root-preparation-candidate.v2.json", import.meta.url)), before);
});

test("root passes the accepted derived workbook to its sole existing telemetry module", async () => {
  const main = await readFile(new URL("../infra/main.bicep", import.meta.url), "utf8");
  const telemetry = await readFile(new URL("../infra/modules/telemetry.bicep", import.meta.url), "utf8");
  const workbook = JSON.parse(await readFile(new URL("../workbooks/contoso-correlation.workbook.json", import.meta.url), "utf8"));
  const call = main.slice(main.indexOf("module telemetry "), main.indexOf("module messaging "));
  assert.ok(call.includes("names: { law: names.workspace, appi: names.appInsights }"));
  assert.ok(call.includes("workbookSerializedData: loadTextContent('../workbooks/contoso-correlation.workbook.json')"));
  assert.equal((main.match(/module telemetry /g) ?? []).length, 1);
  assert.ok(main.includes("output workbookResourceId string = telemetry.outputs.workbookResourceId"));
  assert.ok(telemetry.includes("sourceId: appi.id"));
  assert.ok(telemetry.includes("serializedData: workbookSerializedData"));
  assert.equal(workbook.version, "Notebook/1.0");
  assert.equal(workbook.metadata.certificationEligible, false);
  const conditional = workbook.items.find(item => item.name === "conditional-root-candidates");
  assert.ok(conditional.content.query.includes('NativeEvidenceStatus="UNVERIFIED"'));
});

test("compiled workbook guards reject omitted/stale bytes, duplicate telemetry or foreign resource bindings", async () => {
  const text = await readFile(new URL("../workbooks/contoso-correlation.workbook.json", import.meta.url), "utf8");
  const mapSha256 = JSON.parse(text).metadata.sourceBoundaryMapSha256;
  const fixture = {
    resources: { telemetry: { properties: {
      parameters: { workbookSerializedData: { value: text } },
      template: {
        resources: [
          { type: "Microsoft.OperationalInsights/workspaces" },
          { type: "Microsoft.Insights/components", properties: { WorkspaceResourceId: "fixture-law-reference" } },
          { type: "Microsoft.Insights/workbooks", properties: {
            sourceId: "fixture-appi-reference", serializedData: "[parameters('workbookSerializedData')]"
          } }
        ],
        outputs: { applicationInsightsResourceId: { value: "fixture-appi-reference" },
          logAnalyticsWorkspaceResourceId: { value: "fixture-law-reference" } }
      }
    } } },
    outputs: { workbookResourceId: { value: "[reference('telemetry').outputs.workbookResourceId.value]" } }
  };
  assert.equal(assertRootWorkbookComposition(fixture, text, mapSha256).certification, "NOT_CERTIFIED");
  const lifted = structuredClone(fixture);
  lifted.variables = { "$fxv#0": text };
  lifted.resources.telemetry.properties.parameters.workbookSerializedData.value = "[variables('$fxv#0')]";
  assert.equal(assertRootWorkbookComposition(lifted, text, mapSha256).compiledTextBinding, "fixed-string-compiler-variable");
  const unresolved = structuredClone(lifted);
  delete unresolved.variables["$fxv#0"];
  assert.throws(() => assertRootWorkbookComposition(unresolved, text, mapSha256), /COMPOSITION_INVALID/);
  for (const change of [
    value => { delete value.resources.telemetry.properties.parameters.workbookSerializedData; },
    value => { value.resources.telemetry.properties.parameters.workbookSerializedData.value += " "; },
    value => { value.resources.telemetry.properties.template.resources.push({ type: "Microsoft.OperationalInsights/workspaces" }); },
    value => { value.resources.telemetry.properties.template.resources[1].properties.WorkspaceResourceId = "foreign-law"; },
    value => { value.resources.telemetry.properties.template.resources[2].properties.sourceId = "foreign-appi"; },
    value => { delete value.outputs.workbookResourceId; },
    value => { value.resources.telemetry.properties.parameters.workbookSerializedData.value = "[parameters('unapproved-workbook')]"; }
  ]) {
    const invalid = structuredClone(fixture);
    change(invalid);
    assert.throws(() => assertRootWorkbookComposition(invalid, text, mapSha256), /COMPOSITION_INVALID/);
  }
  assert.throws(() => assertRootWorkbookComposition(fixture, text, "0".repeat(64)), /COMPOSITION_INVALID/);
});

test("root composes real modules with scoped secret/logger ordering and correct audience/resource separation", async () => {
  const main = await readFile(new URL("../infra/main.bicep", import.meta.url), "utf8");
  for (const module of ["network", "telemetry", "messaging", "compute", "security-keyvault", "security-secret-readers",
    "data-postgres", "data-managed-redis", "apim-service", "apim-api-policies", "apim-observability", "messaging-roles", "root-access"]) {
    assert.ok(main.includes(`./modules/${module}.bicep`), module);
  }
  assert.ok(main.includes("publicAudience: ordersClientId"));
  assert.ok(main.includes("ordersTokenResource: 'api://${ordersClientId}'"));
  assert.ok(main.includes("CONTOSO_INVENTORY_AUDIENCE: inventoryClientId"));
  assert.ok(main.includes("CONTOSO_INVENTORY_TOKEN_RESOURCE: 'api://${inventoryClientId}'"));
  assert.ok(main.includes("dependsOn: [secretReaders, rootAccess]"));
  assert.equal(/InstrumentationKey=|administratorLoginPassword|module\s+\w+.*(?:eval|evaluation)/i.test(main), false);
});
