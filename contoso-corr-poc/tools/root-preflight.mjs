import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { frozenNames, validateFrozenNames } from "./names.mjs";
import { validateCertificationManifest } from "./certification-path.mjs";

export const ROOT_SUBSCRIPTION_ID = "474c40eb-d385-40d8-baa2-06883dbdca2d";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guid = value => typeof value === "string" && /^(?!0{8}-0{4}-0{4}-0{4}-0{12}$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const roleName = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(value);

function exactOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

function exactInventoryBaseUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.azurewebsites\.net$/.test(url.hostname)
      && value === `${url.origin}/api`;
  } catch { return false; }
}

function plainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function sealedRecord(value, keys, required = keys) {
  return plainRecord(value) && Object.keys(value).every(key => keys.includes(key))
    && required.every(key => Object.hasOwn(value, key));
}

export function canonicalScmCidr(value) {
  if (typeof value !== "string" || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/(?:[1-9]|[12][0-9]|3[0-2])$/.test(value)) return null;
  const [address, prefixText] = value.split("/");
  const parts = address.split(".");
  const octets = parts.map(Number);
  if (octets.some((number, index) => number > 255 || String(number) !== parts[index])) return null;
  const prefix = Number(prefixText);
  const number = (((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (number & mask) >>> 0;
  return `${network >>> 24}.${(network >>> 16) & 255}.${(network >>> 8) & 255}.${network & 255}/${prefix}`;
}

function secretValuePresent(value) {
  if (typeof value === "string") return /InstrumentationKey=|Bearer\s+\S+|-----BEGIN .*PRIVATE KEY|(?:AccountKey|SharedAccessSignature|ClientSecret)=/i.test(value);
  if (Array.isArray(value)) return value.some(secretValuePresent);
  return value && typeof value === "object" && Object.entries(value).some(([key, item]) =>
    /(?:password|clientsecret|secretvalue|privatekey|accesstoken|connectionstring|accountkey|sharedaccesssignature)$/.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase())
    || secretValuePresent(item));
}

export function validateRootInputs(input) {
  const errors = [];
  const error = code => errors.push(code);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { syntaxPassed: false, errors: ["ROOT_INPUT_OBJECT_REQUIRED"], deploymentReady: false, certification: "NOT_CERTIFIED" };
  }
  const permitted = ["schema", "subscriptionId", "resourceGroup", "location", "deploymentPhase", "names", "publisherName", "publisherEmail",
    "applicationConfiguration", "postgresAdministrator", "scmRunnerCidrs", "notificationActionGroupIds", "deploymentApprovalReference"];
  if (Object.keys(input).some(key => !permitted.includes(key)) || input.schema !== "contoso.root-inputs.v1") error("ROOT_INPUT_SCHEMA_INVALID");
  if (input.subscriptionId !== ROOT_SUBSCRIPTION_ID || input.location !== "centralus") error("ROOT_TARGET_NOT_APPROVED");
  if (!["foundation", "application"].includes(input.deploymentPhase)) error("ROOT_PHASE_INVALID");
  try {
    validateFrozenNames(input.names);
    if (!isDeepStrictEqual(input.names, frozenNames(ROOT_SUBSCRIPTION_ID, "centralus"))
      || input.resourceGroup !== input.names.resourceGroup) error("ROOT_PHYSICAL_MAP_MISMATCH");
  } catch { error("ROOT_PHYSICAL_MAP_INVALID"); }
  if (input.publisherName !== "Contoso" || typeof input.publisherEmail !== "string"
    || !/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(input.publisherEmail)) error("APPROVED_PUBLISHER_CONTACT_REQUIRED");
  if (secretValuePresent(input)) error("ROOT_SECRET_VALUE_FORBIDDEN");
  if (!Array.isArray(input.scmRunnerCidrs) || input.scmRunnerCidrs.some(value => canonicalScmCidr(value) === null))
    error("SCM_RUNNER_CIDR_INVALID");
  if (!Array.isArray(input.notificationActionGroupIds) || input.notificationActionGroupIds.some(value => typeof value !== "string"
    || !/^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Insights\/actionGroups\/[^/]+$/i.test(value)))
    error("NOTIFICATION_ROUTE_INPUT_REQUIRED");
  const config = input.applicationConfiguration ?? {};
  if (input.deploymentPhase === "foundation" && !sealedRecord(config, [])) error("FOUNDATION_MUST_NOT_PRETEND_APPLICATION_BINDINGS");
  if (input.deploymentPhase === "foundation" && !sealedRecord(input.postgresAdministrator ?? {}, [])) error("FOUNDATION_ADMINISTRATOR_MUST_BE_EMPTY");
  if (input.deploymentPhase === "application") {
    if (!sealedRecord(config, ["tenantId", "ordersApiClientId", "inventoryApiClientId", "storefrontClientId", "portalOrigin", "inventoryBaseUrl",
      "hmacSecretVersion", "principals", "controller", "databaseRoles", "approvedTestCallerClientIds"]))
      error("APPLICATION_CONFIGURATION_SCHEMA_INVALID");
    for (const key of ["tenantId", "ordersApiClientId", "inventoryApiClientId", "storefrontClientId"]) if (!guid(config[key])) error(`ACTUAL_${key.toUpperCase()}_GUID_REQUIRED`);
    if (!exactOrigin(config.portalOrigin)) error("ACTUAL_PORTAL_ORIGIN_REQUIRED");
    if (!exactInventoryBaseUrl(config.inventoryBaseUrl)) error("ACTUAL_FOUNDATION_INVENTORY_BASE_URL_REQUIRED");
    if (typeof config.hmacSecretVersion !== "string" || !/^(?!0{32}$)[0-9a-f]{32}$/.test(config.hmacSecretVersion)) error("APPROVED_EXISTING_HMAC_VERSION_REQUIRED");
    for (const service of ["gateway", "portal", "orders", "inventory", "fulfillment", "notify", "aggregator"]) {
      const binding = config.principals?.[service];
      if (!sealedRecord(binding, ["clientId", "objectId"]) || !guid(binding?.clientId) || !guid(binding?.objectId))
        error(`ACTUAL_${service.toUpperCase()}_CLIENT_OBJECT_PAIR_REQUIRED`);
    }
    if (!sealedRecord(config.principals, ["gateway", "portal", "orders", "inventory", "fulfillment", "notify", "aggregator"]))
      error("PRINCIPAL_BINDING_SCHEMA_INVALID");
    if (!sealedRecord(config.controller, ["clientId", "objectId"]) || !guid(config.controller?.clientId) || !guid(config.controller?.objectId))
      error("FIXED_CONTROLLER_CLIENT_OBJECT_PAIR_REQUIRED");
    if (!sealedRecord(config.databaseRoles, ["inventory", "orders", "fulfillment", "notify", "aggregator"]))
      error("DATABASE_ROLE_SCHEMA_INVALID");
    for (const service of ["inventory", "orders", "fulfillment", "notify", "aggregator"]) {
      if (!roleName(config.databaseRoles?.[service])) error(`BOOTSTRAPPED_${service.toUpperCase()}_DATABASE_ROLE_REQUIRED`);
    }
    const admin = input.postgresAdministrator;
    if (!sealedRecord(admin, ["objectId", "principalType", "principalName"])
      || !guid(admin?.objectId) || !["Group", "ServicePrincipal", "User"].includes(admin?.principalType)
      || typeof admin.principalName !== "string" || !admin.principalName.trim()) error("ACTUAL_POSTGRES_ADMINISTRATOR_REQUIRED");
    if (!Array.isArray(config.approvedTestCallerClientIds) || config.approvedTestCallerClientIds.some(value => !guid(value))) error("EXPLICIT_TEST_CALLER_ALLOWLIST_REQUIRED");
  }
  return {
    schema: "contoso.root-preflight.v1", syntaxPassed: errors.length === 0, errors,
    deploymentReady: false, authorizationVerified: false, certification: "NOT_CERTIFIED",
    requiredIndependentEvidence: [
      "current-cost-quota-policy-and-provisioning-approval",
      "physical-name-availability",
      "SCM-approved-runner-route-and-Entra-authentication",
      "actual-Entra-registrations-client-object-role-bindings",
      "KeyVault-secret-generation-set-version-and-reference-resolution",
      "SQL-schema-marker-principal-grants-and-data-permissions",
      "Node-beta-exporter-support-adjudication",
      "current-source-build-loaded-native-proof-and-live-certification"
    ]
  };
}

export async function rootPreflight(input) {
  const result = validateRootInputs(input);
  const dependencies = JSON.parse(await readFile(path.join(root, "config", "certification-dependencies.json"), "utf8"));
  try { validateCertificationManifest(dependencies); result.certificationDependenciesVerified = true; }
  catch { result.certificationDependenciesVerified = false; result.requiredIndependentEvidence.push("certification-dependency-manifest-unverified"); }
  return result;
}

export function rootArmParameters(input) {
  const result = validateRootInputs(input);
  if (!result.syntaxPassed) throw new Error("ROOT_INPUT_PREFLIGHT_REQUIRED");
  const keys = ["names", "location", "deploymentPhase", "publisherName", "publisherEmail", "applicationConfiguration",
    "postgresAdministrator", "scmRunnerCidrs", "notificationActionGroupIds", "deploymentApprovalReference"];
  return {
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: Object.fromEntries(keys.map(key => [key, {
      value: key === "scmRunnerCidrs" ? input.scmRunnerCidrs.map(canonicalScmCidr)
        : input[key] ?? (key === "deploymentApprovalReference" ? "" : {})
    }]))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--input");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node tools\\root-preflight.mjs --input approved-root-inputs.json");
  const result = await rootPreflight(JSON.parse(await readFile(path.resolve(process.argv[index + 1]), "utf8")));
  if (process.argv.includes("--parameters")) {
    if (!result.syntaxPassed) throw new Error("ROOT_INPUT_PREFLIGHT_REQUIRED");
    console.log(JSON.stringify(rootArmParameters(JSON.parse(await readFile(path.resolve(process.argv[index + 1]), "utf8"))), null, 2));
  } else console.log(JSON.stringify(result, null, 2));
  if (!result.syntaxPassed) process.exitCode = 1;
}
