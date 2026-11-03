import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APIM_API_VERSION = "2024-05-01";
export const SDK_VERSION = "3.4.5";
export const SDK_W3C_MODE = 18;
export const BUSINESS_HEADER = "x-business-invocation-id";
export const GATEWAY_PROOF_HEADER = "x-contoso-gateway-authorization";
export const PUBLIC_PATH = "/contoso/v1";
export const BACKEND_PATH = "/api";
export const CORS_HEADERS = Object.freeze(["authorization", "content-type", "request-context", "traceparent", "tracestate", BUSINESS_HEADER]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const SHA256 = /^(?!0{64}$)[0-9a-f]{64}$/;
const STATE_KEY = /^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/;
const SOURCE_DIGEST = "2ddecab74cebebbb36be69e03f9b4ad92f7b97a21011a7671d048148b5e842d9";

function values(input) {
  if (input === undefined || input === null) return [];
  return Array.isArray(input) ? input : [input];
}

export function parseTraceparent(input) {
  const entries = values(input);
  if (entries.length === 0) return { valid: false, disposition: "absent" };
  if (entries.length !== 1) return { valid: false, disposition: "duplicate" };
  const raw = entries[0];
  if (typeof raw !== "string" || raw.length < 55 || raw.length > 256 || /[^!-~]|,/.test(raw)) {
    return { valid: false, disposition: "invalid" };
  }
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/.exec(raw);
  if (!match || match[1] === "ff" || /^0{32}$/.test(match[2]) || /^0{16}$/.test(match[3])) {
    return { valid: false, disposition: "invalid" };
  }
  if ((match[1] === "00" && raw.length !== 55) || (raw.length > 55 && raw[55] !== "-")) {
    return { valid: false, disposition: "invalid" };
  }
  return {
    valid: true, disposition: "valid", raw, version: match[1],
    traceId: match[2], parentId: match[3], flags: match[4],
    sampled: (Number.parseInt(match[4], 16) & 1) === 1
  };
}

export function parseTracestate(input, parentValid = true) {
  if (!parentValid) return { valid: false, disposition: "orphan" };
  const entries = values(input);
  if (entries.length === 0) return { valid: true, disposition: "absent", members: [] };
  if (entries.some(entry => typeof entry !== "string")) return { valid: false, disposition: "invalid" };
  const raw = entries.join(",");
  if (raw.length > 512) return { valid: false, disposition: "oversized" };
  const pieces = raw.split(",");
  if (pieces.length > 32) return { valid: false, disposition: "too-many-members" };
  const keys = new Set();
  const members = [];
  for (const piece of pieces) {
    const member = piece.replace(/^[ \t]+|[ \t]+$/g, "");
    if (member === "") continue;
    const separator = member.indexOf("=");
    if (separator <= 0 || separator !== member.lastIndexOf("=")) return { valid: false, disposition: "invalid" };
    const key = member.slice(0, separator);
    const value = member.slice(separator + 1);
    if (!STATE_KEY.test(key) || keys.has(key) || value.length === 0 || value.length > 256
      || /[^\x20-\x7e]|[,=]/.test(value) || value.endsWith(" ")) {
      return { valid: false, disposition: "invalid" };
    }
    keys.add(key);
    members.push({ key, value });
  }
  return { valid: true, disposition: "valid", raw, members };
}

export function contextDecision(parentInput, stateInput) {
  const parent = parseTraceparent(parentInput);
  const state = parseTracestate(stateInput, parent.valid);
  return {
    parent, state,
    deleteHeaders: !parent.valid ? ["traceparent", "tracestate"] : !state.valid ? ["tracestate"] : [],
    tracerRootRequired: !parent.valid
  };
}

export function isCanonicalInvocationId(value) {
  return typeof value === "string" && UUID_V4.test(value);
}

export function resolveBusinessInvocationId(input, { trustedInvocationIssuer = false, generate = randomUUID } = {}) {
  const entries = values(input);
  let disposition;
  if (entries.length === 0) disposition = "generated-absent";
  else if (entries.length !== 1) disposition = "generated-duplicate";
  else if (!trustedInvocationIssuer) disposition = "generated-untrusted";
  else if (!isCanonicalInvocationId(entries[0])) disposition = "generated-invalid";
  else return { id: entries[0], disposition: "accepted-trusted" };
  const id = generate();
  if (!isCanonicalInvocationId(id)) throw new TypeError("Business UUID generator did not return canonical UUIDv4.");
  return { id, disposition };
}

function header(input, name) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.keys(input).filter(key => key.toLowerCase() === name.toLowerCase()).flatMap(key => values(input[key]));
}

function bearer(entries) {
  return entries.length === 1 && typeof entries[0] === "string" && entries[0].length <= 8192
    && /^Bearer [^\s,]+$/i.test(entries[0]);
}

// This checks transport observations, not JWT validity or caller authorization (owned by R8).
export function verifyBackendHeaderContract(before, after) {
  const original = header(before, "authorization");
  const forwarded = header(after, "authorization");
  const proof = header(after, GATEWAY_PROOF_HEADER);
  const business = header(after, BUSINESS_HEADER);
  const errors = [];
  if (!bearer(original) || !bearer(forwarded) || forwarded[0] !== original[0]) errors.push("Original caller Authorization was not preserved.");
  if (!bearer(proof)) errors.push("Independent gateway proof is missing, malformed or duplicated.");
  if (proof[0] === original[0]) errors.push("Gateway proof is not independent of caller Authorization.");
  if (proof[0] === header(before, GATEWAY_PROOF_HEADER)[0]) errors.push("Caller-supplied gateway proof was not replaced.");
  if (business.length !== 1 || !isCanonicalInvocationId(business[0])) errors.push("Backend business header is not one canonical UUIDv4.");
  return { passed: errors.length === 0, errors, jwtValidation: "To Do" };
}

function httpsOrigin(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && url.pathname === "/" && url.search === "" && url.hash === "" && url.origin === input;
  } catch { return false; }
}

export function corsPreflight({ origin, method, requestedHeaders = [] }, { frontendOrigins }) {
  const validOrigins = Array.isArray(frontendOrigins) && frontendOrigins.length > 0 && frontendOrigins.every(httpsOrigin);
  const granted = validOrigins && frontendOrigins.includes(origin) && ["GET", "POST"].includes(method)
    && Array.isArray(requestedHeaders) && requestedHeaders.every(name => typeof name === "string" && CORS_HEADERS.includes(name.toLowerCase()));
  return { granted, status: 200, allowOrigin: granted ? origin : null };
}

export function validatePublicUrl(input) {
  try {
    const url = new URL(input);
    if (url.username || url.password || url.search || url.hash) return { valid: false, code: "QUERY_OR_CREDENTIALS_NOT_ALLOWED" };
    if (url.protocol !== "https:" || !url.pathname.startsWith(`${PUBLIC_PATH}/`)) return { valid: false, code: "PUBLIC_ROUTE_INVALID" };
    const route = url.pathname.slice(PUBLIC_PATH.length);
    const valid = route === "/orders" || route === "/me" || route === "/demo-runs"
      || /^\/orders\/[0-9a-f-]{36}$/.test(route)
      || /^\/demo-runs\/[0-9a-f-]{36}(?:\/controls)?$/.test(route);
    const id = /\/([0-9a-f-]{36})(?:\/controls)?$/.exec(route)?.[1];
    const accepted = valid && (!id || isCanonicalInvocationId(id));
    return { valid: accepted, code: accepted ? "VALID" : "PUBLIC_ROUTE_INVALID", nativeUrlPrivacy: "To Do" };
  } catch { return { valid: false, code: "PUBLIC_ROUTE_INVALID" }; }
}

export function verifySdkSourcePin(pin) {
  return pin?.sdkVersion === SDK_VERSION && pin.enumName === "eDistributedTracingModes.W3C_TRACE"
    && pin.enumValue === SDK_W3C_MODE && pin.sourceSha256 === SOURCE_DIGEST
    && pin.sourceCommit === "9f3440d9ac3dd8941f7d004dbae43108b08baf7e";
}

export function assertW3cOnlyMode(mode, version = SDK_VERSION, pin) {
  if (version !== SDK_VERSION || (mode !== SDK_W3C_MODE && mode !== "W3C_TRACE") || (pin && !verifySdkSourcePin(pin))) {
    throw new TypeError("SDK3.4.5 requires source-pinned W3C_TRACE=18; older/mixed/unknown modes are not accepted.");
  }
}

export function validateModuleParameters(input) {
  const errors = [];
  if (typeof input.serviceName !== "string" || !/^(?=.{1,50}$)[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(input.serviceName)) errors.push("A root-frozen legal physical APIM name is required.");
  if (typeof input.tenantId !== "string" || !GUID.test(input.tenantId) || NIL_GUID.test(input.tenantId)) errors.push("Explicit tenant GUID required.");
  if (typeof input.publicAudience !== "string" || !GUID.test(input.publicAudience) || NIL_GUID.test(input.publicAudience)) errors.push("v2 public audience must be the bare nonzero Orders application GUID.");
  if (typeof input.ordersTokenResource !== "string" || !input.ordersTokenResource.trim() || /[\r\n\0]/.test(input.ordersTokenResource)) errors.push("R8-frozen Orders MI token resource required separately from the caller audience.");
  if (input.delegatedScope !== "Orders.Invoke") errors.push("Delegated short scope must match Orders.Invoke.");
  const clients = input.allowedCallerClientIds;
  const portals = input.portalClientIds;
  const validIds = ids => Array.isArray(ids) && ids.length > 0 && ids.length <= 64
    && ids.every(id => typeof id === "string" && GUID.test(id) && !NIL_GUID.test(id))
    && new Set(ids.map(id => id.toLowerCase())).size === ids.length;
  if (!validIds(clients)) errors.push("Unique nonzero approved caller client IDs required.");
  if (!validIds(portals) || portals.some(id => !Array.isArray(clients) || !clients.some(client => typeof client === "string" && client.toLowerCase() === id.toLowerCase()))) errors.push("Portal client IDs must be approved caller IDs.");
  if (!Array.isArray(input.frontendOrigins) || input.frontendOrigins.length === 0 || input.frontendOrigins.length > 32
    || input.frontendOrigins.some(origin => !httpsOrigin(origin)) || new Set(input.frontendOrigins).size !== input.frontendOrigins.length) errors.push("Unique exact HTTPS frontend origins required.");
  try {
    const url = new URL(input.ordersBackendBaseUrl);
    if (url.protocol !== "https:" || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,2}azurewebsites\.net$/.test(url.hostname)
      || url.pathname !== BACKEND_PATH || url.search || url.hash || url.username || url.password
      || url.href !== input.ordersBackendBaseUrl) errors.push("Fixed private App HTTPS backend ending /api required.");
  } catch { errors.push("Fixed private App HTTPS backend ending /api required."); }
  return { passed: errors.length === 0, errors };
}

export function validateSecretReference(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.port
      && /^(?=.{3,24}\.vault\.azure\.net$)[a-z][a-z0-9-]*[a-z0-9]\.vault\.azure\.net$/.test(url.hostname)
      && !url.hostname.split(".")[0].includes("--")
      && /^\/secrets\/[A-Za-z0-9-]{1,127}$/.test(url.pathname)
      && !url.search && !url.hash && !url.username && !url.password && url.href === input;
  } catch { return false; }
}

export function validateDiagnosticSettings(settings, { captureEvidence, certificationWindow } = {}) {
  const errors = [];
  if (settings.httpCorrelationProtocol !== "W3C") errors.push("Diagnostic protocol must be W3C.");
  if (settings.sampling?.samplingType !== "fixed" || !Number.isInteger(settings.sampling?.percentage)
    || settings.sampling.percentage < 0 || settings.sampling.percentage > 100) errors.push("Fixed integer percentage 0..100 required.");
  if (settings.alwaysLog !== "allErrors") errors.push("allErrors required.");
  if (settings.logClientIp !== false || settings.metrics !== false || settings.operationNameFormat !== "Name") errors.push("Safe IP/metrics/operation-name defaults required.");
  for (const side of ["frontend", "backend"]) {
    for (const direction of ["request", "response"]) {
      const message = settings[side]?.[direction];
      if (message?.body?.bytes !== 0) errors.push(`${side}.${direction} body must be zero.`);
      if (!Array.isArray(message?.headers)) { errors.push(`${side}.${direction} header list required.`); continue; }
      if (side === "backend" && direction === "request" && message.headers.length !== 0) {
        if (message.headers.length !== 1 || message.headers[0] !== BUSINESS_HEADER || captureEvidence?.verified !== true
          || !SHA256.test(captureEvidence?.sha256 ?? "")) errors.push("Canonical backend header requires approved timing evidence.");
      } else if (message.headers.length !== 0) errors.push(`${side}.${direction} headers must be empty.`);
    }
  }
  if (settings.sampling?.percentage === 100) {
    const start = utcTime(certificationWindow?.startsAtUtc);
    const end = utcTime(certificationWindow?.expiresAtUtc);
    if (!isCanonicalInvocationId(certificationWindow?.windowId) || !Number.isFinite(start) || !Number.isFinite(end)
      || end <= start || end - start > 7200000) errors.push("100% requires a declared UUID/UTC certification window bounded to two hours.");
  }
  return { passed: errors.length === 0, errors, captureTiming: "To Do", nativeUrlPrivacy: "To Do" };
}

export const APIM_SAMPLING_OWNED_FIELDS = Object.freeze([
  "properties.sampling.samplingType", "properties.sampling.percentage",
  "properties.httpCorrelationProtocol", "properties.alwaysLog",
  "properties.frontend.request.body.bytes", "properties.frontend.response.body.bytes",
  "properties.backend.request.body.bytes", "properties.backend.response.body.bytes",
  "properties.frontend.request.headers", "properties.frontend.response.headers",
  "properties.backend.request.headers", "properties.backend.response.headers"
]);

const configHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const utcTime = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
const validEtag = value => typeof value === "string" && /^(?:W\/)?"[\x21\x23-\x7e]{1,240}"$/.test(value);

// An ARM readback proves configuration only. It never acknowledges effective gateway sampling.
export function createApimSamplingAdapter({
  diagnosticResourceId, request, allowAzureWrites = false, azureWriteApprovalRef = "", now = Date.now
} = {}) {
  const match = typeof diagnosticResourceId === "string" && /^\/subscriptions\/([0-9a-f-]{36})\/resourceGroups\/[A-Za-z0-9._()-]{1,90}\/providers\/Microsoft\.ApiManagement\/service\/[A-Za-z](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?\/diagnostics\/applicationinsights$/i.exec(diagnosticResourceId);
  if (!match || !GUID.test(match[1]) || NIL_GUID.test(match[1]) || typeof request !== "function" || typeof now !== "function") {
    throw new TypeError("APIM_ADAPTER_TARGET_INVALID");
  }
  const serviceId = diagnosticResourceId.slice(0, -"/diagnostics/applicationinsights".length);
  const loggerId = `${serviceId}/loggers/contoso-appinsights`;
  const endpoint = id => `https://management.azure.com${id}?api-version=${APIM_API_VERSION}`;
  const sameId = (left, right) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();
  const exactFields = value => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === APIM_SAMPLING_OWNED_FIELDS.length
    && APIM_SAMPLING_OWNED_FIELDS.every(key => Object.hasOwn(value, key));
  const owned = (document, keys = APIM_SAMPLING_OWNED_FIELDS) => Object.fromEntries(keys.map(key => [
    key, key.split(".").reduce((value, part) => value?.[part], document)
  ]));
  const leaseFields = ["runId", "startsAtUtc", "expiresAtUtc", "drainAtUtc", "restoreDeadlineUtc"];
  const bindLease = lease => Object.fromEntries(leaseFields.map(key => [key, lease[key]]));

  function leaseTimes(lease, active = false) {
    const start = utcTime(lease?.startsAtUtc), end = utcTime(lease?.expiresAtUtc);
    const drain = utcTime(lease?.drainAtUtc), restore = utcTime(lease?.restoreDeadlineUtc);
    if (!isCanonicalInvocationId(lease?.runId) || ![start, end, drain, restore].every(Number.isFinite)
      || end <= start || end - start > 7200000 || drain <= start || drain >= end
      || restore < end || restore - end > 120000 || (active && (now() < start || now() >= drain))) {
      throw new TypeError("APIM_ADAPTER_LEASE_INVALID");
    }
    return { start, end, drain, restore };
  }

  function requireWrites() {
    if (allowAzureWrites !== true || typeof azureWriteApprovalRef !== "string"
      || !azureWriteApprovalRef.trim() || azureWriteApprovalRef.length > 256 || /[\r\n\0]/.test(azureWriteApprovalRef)) {
      throw new TypeError("APIM_ADAPTER_WRITES_NOT_AUTHORIZED");
    }
  }

  async function call(method, url, { headers = {}, body } = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new TypeError("APIM_ADAPTER_URL_INVALID"); }
    if (parsed.origin !== "https://management.azure.com" || parsed.username || parsed.password || parsed.hash
      || !parsed.pathname.toLowerCase().startsWith(`${serviceId.toLowerCase()}/`)
      || parsed.searchParams.get("api-version") !== APIM_API_VERSION) throw new TypeError("APIM_ADAPTER_URL_INVALID");
    let response;
    try { response = await request({ method, url, headers, body, redirect: "error" }); }
    catch { throw new TypeError("APIM_MANAGEMENT_REQUEST_FAILED"); }
    if (!response || (method === "GET" ? response.status !== 200 : ![200, 204].includes(response.status))) {
      throw new TypeError("APIM_MANAGEMENT_RESPONSE_FAILED");
    }
    return response;
  }

  async function collection(id) {
    const first = new URL(endpoint(id));
    let url = first.href;
    const seen = new Set(), items = [];
    while (url) {
      const parsed = new URL(url);
      if (!sameId(parsed.pathname, first.pathname) || seen.has(url) || seen.size >= 100) throw new TypeError("APIM_SCOPE_PAGINATION_INVALID");
      seen.add(url);
      const response = await call("GET", url);
      if (!Array.isArray(response.body?.value) || items.length + response.body.value.length > 1000) throw new TypeError("APIM_SCOPE_LIST_INVALID");
      items.push(...response.body.value);
      const next = response.body.nextLink;
      if (next !== undefined && next !== null && next !== "" && typeof next !== "string") throw new TypeError("APIM_SCOPE_PAGINATION_INVALID");
      try { url = next ? new URL(next, first).href : null; } catch { throw new TypeError("APIM_SCOPE_PAGINATION_INVALID"); }
    }
    return items;
  }

  async function preflight() {
    const diagnostics = await collection(`${serviceId}/diagnostics`);
    if (diagnostics.length !== 1 || !sameId(diagnostics[0]?.id, diagnosticResourceId)) throw new TypeError("APIM_ALL_APIS_DIAGNOSTIC_CONFLICT");
    const apis = await collection(`${serviceId}/apis`);
    for (const api of apis) {
      if (typeof api?.id !== "string" || !api.id.toLowerCase().startsWith(`${serviceId.toLowerCase()}/apis/`)
        || !/^[A-Za-z0-9._;=-]{1,160}$/.test(api.id.slice(serviceId.length + "/apis/".length))) throw new TypeError("APIM_API_SCOPE_INVALID");
      if ((await collection(`${api.id}/diagnostics`)).length !== 0) throw new TypeError("APIM_API_DIAGNOSTIC_OVERRIDE");
    }
    return apis.length;
  }

  function validProperties(properties, lease) {
    if (!properties || !sameId(properties.loggerId, loggerId)
      || Object.keys(properties.sampling ?? {}).some(key => !["samplingType", "percentage"].includes(key))
      || !validateDiagnosticSettings(properties, { certificationWindow: {
        windowId: lease.runId, startsAtUtc: lease.startsAtUtc, expiresAtUtc: lease.expiresAtUtc
      } }).passed) throw new TypeError("APIM_DIAGNOSTIC_CONFIGURATION_UNSAFE");
  }

  async function readDiagnostic(lease) {
    const response = await call("GET", endpoint(diagnosticResourceId));
    if (!sameId(response.body?.id, diagnosticResourceId)) throw new TypeError("APIM_DIAGNOSTIC_ID_MISMATCH");
    validProperties(response.body.properties, lease);
    const etags = header(response.headers, "etag");
    if (etags.length !== 1 || !validEtag(etags[0])) throw new TypeError("APIM_DIAGNOSTIC_ETAG_REQUIRED");
    return { document: response.body, etag: etags[0] };
  }

  function validatePatch(patch, production = false) {
    if (!exactFields(patch)) throw new TypeError("APIM_OWNED_PATCH_INVALID");
    const percentage = patch["properties.sampling.percentage"];
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > (production ? 99 : 100)
      || patch["properties.sampling.samplingType"] !== "fixed"
      || patch["properties.httpCorrelationProtocol"] !== "W3C" || patch["properties.alwaysLog"] !== "allErrors"
      || APIM_SAMPLING_OWNED_FIELDS.filter(key => key.endsWith(".bytes")).some(key => patch[key] !== 0)
      || APIM_SAMPLING_OWNED_FIELDS.filter(key => key.endsWith(".headers")).some(key => !Array.isArray(patch[key]) || patch[key].length !== 0)) {
      throw new TypeError("APIM_OWNED_PATCH_UNSAFE");
    }
  }

  function validateSnapshot(snapshot, lease) {
    if (snapshot?.schema !== "contoso.apim-management-snapshot.v1" || !sameId(snapshot.diagnosticResourceId, diagnosticResourceId)
      || snapshot.runId !== lease.runId || snapshot.sourceKind !== "management-plane-observation"
      || !exactFields(snapshot.baselineOwnedConfiguration)
      || snapshot.baselineOwnedConfigSha256 !== configHash(snapshot.baselineOwnedConfiguration)
      || !validEtag(snapshot.etag)) throw new TypeError("APIM_BASELINE_SNAPSHOT_INVALID");
    if (!snapshot.leaseBinding || typeof snapshot.leaseBinding !== "object" || Array.isArray(snapshot.leaseBinding)
      || Object.keys(snapshot.leaseBinding).length !== leaseFields.length
      || leaseFields.some(key => snapshot.leaseBinding[key] !== lease[key])) throw new TypeError("APIM_LEASE_BINDING_MISMATCH");
    validatePatch(snapshot.baselineOwnedConfiguration, true);
  }

  function patchBody(current, patch) {
    const body = { properties: {
      loggerId: current.properties.loggerId,
      frontend: structuredClone(current.properties.frontend),
      backend: structuredClone(current.properties.backend)
    } };
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split(".");
      let target = body;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = structuredClone(value);
    }
    return body;
  }

  function observation(current, lease, patch) {
    const times = leaseTimes(lease);
    const configuration = owned(current.document, Object.keys(patch));
    const matches = configHash(configuration) === configHash(patch);
    return {
      schema: "contoso.apim-management-observation.v1", sourceKind: "management-plane-observation",
      diagnosticResourceId, runId: lease.runId, apiVersion: APIM_API_VERSION, diagnosticScope: "allApis",
      configSha256: configHash(configuration), ownedConfiguration: configuration,
      percentage: configuration["properties.sampling.percentage"], etag: current.etag, matches,
      observedAtUtc: new Date(now()).toISOString(), activeTrafficWindow: now() >= times.start && now() < times.drain,
      restoreWithinDeadline: now() <= times.restore, runtimeAcknowledgement: false,
      nativeSamplingEffective: "To Do", gatewayWireParentage: "To Do", secretsIncluded: false
    };
  }

  return Object.freeze({
    async prepare({ lease } = {}) {
      leaseTimes(lease, true);
      const apiCount = await preflight();
      const current = await readDiagnostic(lease);
      const baseline = owned(current.document);
      validatePatch(baseline, true);
      return {
        schema: "contoso.apim-management-snapshot.v1", sourceKind: "management-plane-observation",
        diagnosticResourceId, runId: lease.runId, etag: current.etag, apiCount,
        leaseBinding: bindLease(lease),
        baselineOwnedConfiguration: baseline, baselineOwnedConfigSha256: configHash(baseline),
        runtimeAcknowledgement: false
      };
    },
    async apply({ lease, snapshot, ownedPatch } = {}) {
      requireWrites();
      leaseTimes(lease, true);
      validateSnapshot(snapshot, lease);
      validatePatch(ownedPatch);
      await preflight();
      const current = await readDiagnostic(lease);
      if (current.etag !== snapshot.etag
        || configHash(owned(current.document)) !== snapshot.baselineOwnedConfigSha256) throw new TypeError("APIM_BASELINE_CONCURRENT_CHANGE");
      leaseTimes(lease, true);
      await call("PATCH", endpoint(diagnosticResourceId), {
        headers: { "If-Match": current.etag }, body: patchBody(current.document, ownedPatch)
      });
      const result = observation(await readDiagnostic(lease), lease, ownedPatch);
      if (!result.matches) throw new TypeError("APIM_APPLY_READBACK_MISMATCH");
      leaseTimes(lease, true);
      return result;
    },
    async observe({ lease, ownedPatch } = {}) {
      leaseTimes(lease);
      validatePatch(ownedPatch);
      return observation(await readDiagnostic(lease), lease, ownedPatch);
    },
    async restore({ lease, snapshot, appliedOwnedPatch } = {}) {
      requireWrites();
      leaseTimes(lease);
      validateSnapshot(snapshot, lease);
      validatePatch(appliedOwnedPatch);
      const current = await readDiagnostic(lease);
      const baseline = snapshot.baselineOwnedConfiguration;
      const actual = owned(current.document, Object.keys(appliedOwnedPatch));
      const orderedBaseline = Object.fromEntries(Object.keys(appliedOwnedPatch).map(key => [key, baseline[key]]));
      if (configHash(actual) === configHash(orderedBaseline)) {
        return observation(current, lease, baseline);
      }
      if (configHash(actual) !== configHash(appliedOwnedPatch)) throw new TypeError("APIM_RESTORE_CONCURRENT_CHANGE");
      await call("PATCH", endpoint(diagnosticResourceId), {
        headers: { "If-Match": current.etag }, body: patchBody(current.document, baseline)
      });
      const result = observation(await readDiagnostic(lease), lease, baseline);
      if (!result.matches) throw new TypeError("APIM_RESTORE_READBACK_MISMATCH");
      return result;
    }
  });
}

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { quot: '"', apos: "'", amp: "&", lt: "<", gt: ">" }[entity.toLowerCase()];
  });
}

// Small dependency-free policy XML reader; the focused validation also uses the native .NET XML parser.
export function parsePolicyXml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new TypeError("Policy XML DTD/entities are forbidden.");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]|&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(source)) throw new TypeError("Invalid XML character/entity.");
  const document = { name: "#document", children: [], text: "", parent: null };
  const stack = [document];
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf("<", cursor);
    if (opening < 0) { stack.at(-1).text += decodeXml(source.slice(cursor)); break; }
    stack.at(-1).text += decodeXml(source.slice(cursor, opening));
    if (source.startsWith("<!--", opening)) {
      const end = source.indexOf("-->", opening + 4);
      if (end < 0) throw new TypeError("Unclosed XML comment.");
      cursor = end + 3; continue;
    }
    if (source.startsWith("<?", opening)) {
      const end = source.indexOf("?>", opening + 2);
      if (end < 0) throw new TypeError("Unclosed XML declaration.");
      cursor = end + 2; continue;
    }
    let quote = null;
    let end = opening + 1;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === source.length) throw new TypeError("Unclosed XML tag.");
    const tag = source.slice(opening + 1, end).trim();
    if (tag.startsWith("/")) {
      if (stack.length === 1 || stack.at(-1).name !== tag.slice(1).trim()) throw new TypeError("Mismatched XML closing tag.");
      stack.pop();
    } else {
      const selfClosing = tag.endsWith("/");
      const body = selfClosing ? tag.slice(0, -1).trim() : tag;
      const match = /^([A-Za-z_][\w:.-]*)/.exec(body);
      if (!match) throw new TypeError("Invalid XML tag.");
      const attributes = {};
      let remaining = body.slice(match[0].length);
      while (remaining.trim()) {
        const attribute = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(remaining);
        if (!attribute || Object.hasOwn(attributes, attribute[1])) throw new TypeError("Invalid/duplicate XML attribute.");
        attributes[attribute[1]] = decodeXml(attribute[3]);
        remaining = remaining.slice(attribute[0].length);
      }
      const node = { name: match[1], attributes, children: [], text: "", parent: stack.at(-1), offset: opening };
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    }
    cursor = end + 1;
  }
  if (stack.length !== 1 || document.children.length !== 1 || document.text.trim()) throw new TypeError("Invalid policy XML root.");
  return document.children[0];
}

function allNodes(root) {
  return [root, ...root.children.flatMap(allNodes)];
}

function ancestors(node) {
  const result = [];
  for (let parent = node.parent; parent; parent = parent.parent) result.push(parent);
  return result;
}

function inspectProtocolExpressions(text, add) {
  if (/context\s*\.\s*RequestId/i.test(text)) add("REQUEST_ID_PROVENANCE", "APIM request identity must not supply technical trace context.");
  if (/(?:\.replace|\.Replace)\s*\([^)]{0,160}(?:-00|00\$)[^)]{0,160}(?:-01|01)/s.test(text)
    || /(?:traceFlags|trace_flags|sampled)\s*(?:\|=|=\s*[^;\n]{0,100}\|)\s*(?:0x0?1|1)\b/i.test(text)
    || /\b(?:traceFlags|trace_flags)\s*=\s*(?:0x0?1|1)\b/.test(text)
    || /(?:setTraceFlags|withTraceFlags)\s*\(|TraceFlags\.getSampled\s*\(/.test(text)) add("SAMPLED_FLAG_SURGERY", "Manual sampled-bit surgery is forbidden, including disabled branches.");
}

export function inspectPolicyXml(source, sourcePath = "policy.xml") {
  const errors = [];
  let root;
  try { root = parsePolicyXml(source); } catch { return [{ code: "POLICY_XML_INVALID", path: sourcePath, message: "Policy XML is malformed or contains forbidden declarations." }]; }
  const add = (code, message) => errors.push({ code, path: sourcePath, message });
  const nodes = allNodes(root);
  inspectProtocolExpressions(nodes.flatMap(node => [node.text, ...Object.values(node.attributes)]).join("\n"), add);
  if (!["fragment", "policies"].includes(root.name)) add("POLICY_ROOT_INVALID", "Expected policies or fragment root.");
  if (root.name === "fragment" && nodes.some(node => ["base", "inbound", "outbound", "backend", "on-error", "include-fragment"].includes(node.name))) add("FRAGMENT_STRUCTURE_INVALID", "Fragments may not contain sections/base/nested fragments.");
  for (const node of nodes) {
    if (node.name === "set-header") {
      const name = node.attributes.name?.toLowerCase() ?? "";
      const action = node.attributes["exists-action"] ?? "override";
      if (!name || name.includes("@") || name.includes("{{")) add("HEADER_NAME_DYNAMIC", "Protocol/security header names must be literal.");
      if (["traceparent", "tracestate"].includes(name)) {
        const conditions = ancestors(node).filter(parent => parent.name === "when").map(parent => (parent.attributes.condition ?? "").replace(/\s/g, ""));
        const parentInvalid = conditions.includes('@((string)context.Variables["contoso.traceparentDisposition"]!="valid")');
        const stateInvalid = conditions.includes('@(!(bool)context.Variables["contoso.tracestateValid"])');
        if (action !== "delete") add("VALID_CONTEXT_WRITE", "Policy must not rewrite/append/copy back valid W3C context.");
        else if (!parentInvalid && !(name === "tracestate" && stateInvalid)) add("CONTEXT_DELETE_UNGUARDED", "Only absent/invalid-context guarded deletions are allowed.");
      }
      if (name === BUSINESS_HEADER && action === "append") add("BUSINESS_HEADER_APPEND", "Business identifiers must override duplicates, never append.");
      if (name === "authorization" && action !== "delete" && !node.children.some(child => child.text.includes("contoso.originalAuthorization"))) add("CALLER_AUTH_REPLACED", "Forwarded Authorization must restore the original validated caller token.");
      if (name === GATEWAY_PROOF_HEADER && action !== "delete" && (action !== "override" || !node.children.some(child => child.text.includes("contoso.gatewayMiToken")))) add("GATEWAY_PROOF_INVALID", "Gateway proof must override client input with the MI token.");
    }
    if (node.name === "cors") {
      const scope = node.parent;
      if (scope?.name !== "inbound" || scope.children[0] !== node) add("CORS_ORDER", "CORS must be the direct first inbound policy.");
      if (node.attributes["allow-credentials"] !== "false" || node.attributes["terminate-unmatched-request"] !== "true") add("CORS_SETTINGS", "Explicit no-cookie and unmatched-origin behavior required.");
      const descendants = allNodes(node);
      if (descendants.some(child => child.name === "origin" && child.text.trim() === "*")) add("CORS_WILDCARD", "Wildcard frontend origins are forbidden.");
      for (const section of node.children.filter(child => ["allowed-headers", "expose-headers"].includes(child.name))) {
        for (const child of section.children) {
          const name = child.text.trim().toLowerCase();
          if ((section.name === "allowed-headers" && !CORS_HEADERS.includes(name))
            || (section.name === "expose-headers" && name !== BUSINESS_HEADER)) add("CORS_HEADER_UNSAFE", "CORS must not grant gateway proof, wildcard, cookies or credential response exposure.");
        }
      }
    }
    if (node.name === "authentication-managed-identity" && (node.attributes["ignore-error"] !== "false"
      || node.attributes["output-token-variable-name"] !== "contoso.gatewayMiToken")) add("MI_PROOF_FAIL_OPEN", "MI acquisition must fail closed and use the separate proof variable.");
    if (node.name === "set-backend-service" && (node.attributes["backend-id"] !== "contoso-orders-backend"
      || Object.hasOwn(node.attributes, "base-url"))) add("BACKEND_TARGET_UNSAFE", "Caller and gateway credentials must only reach the fixed approved Orders backend.");
    if (["send-request", "send-one-way-request", "log-to-eventhub"].includes(node.name)) add("UNDECLARED_POLICY_EGRESS", "Undeclared policy egress/telemetry sinks are outside the approved gateway boundary.");
    if (node.name === "forward-request" && node.attributes["follow-redirects"] !== "false") add("BACKEND_REDIRECT", "Gateway must not follow redirects carrying credentials.");
    if (node.name === "trace") {
      const descendants = allNodes(node);
      if (descendants.some(child => /Authorization|Cookie|LastError\.Message|Request\.(?:Body|Headers|OriginalUrl|Url)|validatedCallerJwt|gatewayMiToken/i.test(`${Object.values(child.attributes ?? {}).join(" ")} ${child.text}`))) add("TRACE_SENSITIVE", "Policy trace must not serialize credentials, raw errors, claims, URLs or bodies.");
      const permitted = {
        "business.invocation_id": '@((string)context.Variables["contoso.businessId"])',
        "business.disposition": '@((string)context.Variables["contoso.businessDisposition"])'
      };
      for (const child of descendants.filter(child => child.name === "metadata")) {
        if (permitted[child.attributes.name] !== child.attributes.value) add("TRACE_METADATA_UNSAFE", "Only canonical generated business identity and bounded disposition metadata are permitted.");
      }
      if (descendants.some(child => child.name === "message" && child.text.trim() !== "Contoso invocation edge.")) add("TRACE_MESSAGE_UNSAFE", "Gateway trace message must be fixed, not raw context or caller data.");
      if (descendants.some(child => !["trace", "message", "metadata"].includes(child.name))) add("TRACE_STRUCTURE_UNSAFE", "Trace structure must not add another unreviewed data carrier.");
    }
  }
  return errors;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function bicepObject(source, opening) {
  let depth = 0;
  let quote = false;
  let triple = false;
  for (let index = opening; index < source.length; index++) {
    if (source.startsWith("'''", index)) { triple = !triple; index += 2; continue; }
    if (triple) continue;
    if (source[index] === "'" && source[index - 1] !== "\\") { quote = !quote; continue; }
    if (quote) continue;
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(opening, index + 1);
  }
  return "";
}

export function scanSource(source, sourcePath, { sdkVersion = SDK_VERSION, constants = new Map() } = {}) {
  const findings = [];
  const add = (code, message) => findings.push({ code, path: sourcePath, message });
  const text = stripComments(source);
  inspectProtocolExpressions(text, add);
  if (/\bbytes\s*:\s*[1-9]\d*/.test(text) && /\.bicep$/i.test(sourcePath)) add("BODY_CAPTURE_NONZERO", "APIM body capture must be zero even in inactive alternatives.");
  for (const match of text.matchAll(/['"]Microsoft\.ApiManagement\/[^'"]+@([^'"]+)['"]/g)) {
    if (match[1] !== APIM_API_VERSION) add("APIM_API_PIN", "Every APIM resource must use the frozen GA2024-05-01 contract.");
  }
  for (const match of text.matchAll(/\bresource\s+\w+\s+['"]Microsoft\.ApiManagement\/service\/(?:apis\/)?diagnostics@[^'"]+['"]\s*=/g)) {
    const opening = text.indexOf("{", match.index + match[0].length);
    const block = opening < 0 ? "" : bicepObject(text, opening);
    if (!/\bhttpCorrelationProtocol\s*:\s*'W3C'/.test(block)) add("DIAGNOSTIC_PROTOCOL", "Bicep diagnostic must explicitly bind W3C; omitted/unresolved inheritance is not proof.");
    if ([...block.matchAll(/\bbody\s*:\s*\{\s*bytes\s*:\s*0\s*\}/g)].length !== 4) add("BODY_CAPTURE_UNRESOLVED", "Every diagnostic must explicitly bind all four body positions to zero, not dynamic/default values.");
    if (/\/apis\//.test(match[0])) add("DIAGNOSTIC_SCOPE_OVERRIDE", "API diagnostic overrides are not permitted in the allApis baseline.");
  }
  if (/load(?:Text|Json)Content\s*\([^)]*tests[\\/][^)]*fixtures|load(?:Text|Json)Content\s*\([^)]*tests[\\/]apim/i.test(text)) add("FIXTURE_DEPLOYMENT_REFERENCE", "Negative controls must not enter deployable infrastructure.");
  for (const match of text.matchAll(/\bhttpCorrelationProtocol["']?\s*[:=]\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== "W3C") add("DIAGNOSTIC_PROTOCOL", "APIM diagnostics must remain W3C.");
  }
  for (const match of text.matchAll(/\bdistributedTracingMode["']?\s*(?::|=(?!=|>))\s*([^,\n;}]+)/g)) {
    const expression = match[1].trim();
    let mode = /^\d+$/.test(expression) ? Number(expression) : undefined;
    if (/^(?:DistributedTracingModes|eDistributedTracingModes)\.W3C_TRACE$/.test(expression)) mode = SDK_W3C_MODE;
    if (constants.has(expression)) mode = constants.get(expression);
    if (mode !== SDK_W3C_MODE || sdkVersion !== SDK_VERSION) add("SDK_TRACING_MODE", "SDK initialization requires version-pinned W3C_TRACE18; unresolved/legacy/mixed modes fail closed.");
  }
  if (/\bnew\s+ApplicationInsights\s*\(/.test(text) && !/\bdistributedTracingMode["']?\s*:/.test(text)) add("SDK_TRACING_MODE", "SDK initialization must explicitly bind the approved W3C_TRACE mode, not an SDK default.");
  const inspectPolicy = xml => {
    for (const finding of inspectPolicyXml(xml, sourcePath)) {
      if (!findings.some(existing => existing.code === finding.code && existing.path === finding.path && existing.message === finding.message)) findings.push(finding);
    }
  };
  if (/^\s*<(?:fragment|policies)\b/.test(text)) inspectPolicy(text);
  else {
    for (const match of text.matchAll(/<(?:fragment|policies)\b[\s\S]*?<\/(?:fragment|policies)>/g)) inspectPolicy(match[0].replace(/\\'/g, "'"));
  }
  if (/\.json$/i.test(sourcePath)) {
    try {
      const visit = item => {
        if (Array.isArray(item)) { item.forEach(visit); return; }
        if (!item || typeof item !== "object") return;
        if (/^Microsoft\.ApiManagement\/service\/(?:apis\/)?diagnostics$/i.test(item.type ?? "")) {
          if (item.apiVersion !== APIM_API_VERSION) add("APIM_API_PIN", "Snapshot must use the frozen GA APIM version.");
          if (item.properties?.httpCorrelationProtocol !== "W3C") add("DIAGNOSTIC_PROTOCOL", "Omitted/unresolved/non-W3C diagnostic protocol is forbidden.");
          if (/\/apis\//i.test(item.type)) add("DIAGNOSTIC_SCOPE_OVERRIDE", "This baseline permits one allApis diagnostic, not API-specific overrides.");
          for (const side of ["frontend", "backend"]) for (const direction of ["request", "response"]) {
            if (item.properties?.[side]?.[direction]?.body?.bytes !== 0) add("BODY_CAPTURE_NONZERO", "All four snapshot body settings must be explicitly zero.");
          }
        }
        Object.values(item).forEach(visit);
      };
      visit(JSON.parse(source));
    } catch { add("SOURCE_JSON_INVALID", "JSON source/snapshot cannot be validated."); }
  }
  return findings;
}

async function walk(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (["node_modules", "target", "dist", "bin", "obj", ".cache", ".git"].includes(entry.name)) continue;
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await walk(name));
      else if (/\.(?:bicep|bicepparam|json|xml|mjs|js|ts|tsx|java|cs)$/i.test(entry.name)) result.push(name);
    }
    return result;
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function sdkVersionFor(file, root) {
  let directory = path.dirname(file);
  while (directory.startsWith(root)) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
      const version = dependencies["@microsoft/applicationinsights-web"] ?? dependencies["@microsoft/applicationinsights-core-js"];
      if (version) return version;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return "UNVERIFIED";
}

export async function runProtocolGate(root) {
  root = path.resolve(root);
  const findings = [];
  const pin = JSON.parse(await readFile(path.join(root, "apim", "sdk-source-pin.json"), "utf8"));
  if (!verifySdkSourcePin(pin)) findings.push({ code: "SDK_SOURCE_PIN", path: "apim/sdk-source-pin.json", message: "SDK source/version/enum digest pin mismatch." });
  const files = (await Promise.all(["apim", "infra", "web", "services", "workers"].map(directory => walk(path.join(root, directory))))).flat();
  const sources = await Promise.all(files.map(async file => ({ file, text: await readFile(file, "utf8") })));
  for (const { file, text } of sources) {
    const constants = new Map();
    for (const match of stripComments(text).matchAll(/\bconst\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*(18)\s*(?:;|$)/gm)) constants.set(match[1], Number(match[2]));
    findings.push(...scanSource(text, path.relative(root, file), { constants, sdkVersion: await sdkVersionFor(file, root) }));
  }
  return {
    gateId: "GATE-01", codePassed: findings.length === 0, scannedFiles: files.length, findings,
    sourcePin: { sdkVersion: pin.sdkVersion, enumName: pin.enumName, enumValue: pin.enumValue, sourceSha256: pin.sourceSha256 },
    liveAcceptance: { strictSampled00: "To Do", gatewayWireParentage: "To Do", loggerIngestion: "To Do", captureTiming: "To Do", nativeUrlPrivacy: "To Do" }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = await runProtocolGate(root);
    console.log(JSON.stringify(result, null, 2));
    if (!result.codePassed) process.exitCode = 1;
  } catch {
    console.error("GATE-01 could not verify all source/configuration inputs.");
    process.exitCode = 1;
  }
}
