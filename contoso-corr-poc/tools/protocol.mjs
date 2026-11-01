import { randomUUID } from "node:crypto";
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
  const key = Object.keys(input).find(key => key.toLowerCase() === name.toLowerCase());
  return key === undefined ? [] : values(input[key]);
}

// This checks transport observations, not JWT validity or caller authorization (owned by R8).
export function verifyBackendHeaderContract(before, after) {
  const original = header(before, "authorization");
  const forwarded = header(after, "authorization");
  const proof = header(after, GATEWAY_PROOF_HEADER);
  const business = header(after, BUSINESS_HEADER);
  const errors = [];
  if (original.length !== 1 || forwarded.length !== 1 || forwarded[0] !== original[0]) errors.push("Original caller Authorization was not preserved.");
  if (proof.length !== 1 || typeof proof[0] !== "string" || !proof[0].startsWith("Bearer ") || proof[0].length <= 7) errors.push("Independent gateway proof is missing or duplicated.");
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
    && requestedHeaders.every(name => CORS_HEADERS.includes(name.toLowerCase()));
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
  if (!Array.isArray(clients) || clients.length === 0 || clients.some(id => !GUID.test(id))) errors.push("Approved caller client IDs required.");
  if (!Array.isArray(portals) || portals.length === 0 || portals.some(id => !GUID.test(id) || !clients?.includes(id))) errors.push("Portal client IDs must be approved caller IDs.");
  if (!Array.isArray(input.frontendOrigins) || input.frontendOrigins.length === 0 || input.frontendOrigins.some(origin => !httpsOrigin(origin))) errors.push("Exact HTTPS frontend origins required.");
  try {
    const url = new URL(input.ordersBackendBaseUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".azurewebsites.net") || url.pathname !== BACKEND_PATH || url.search || url.hash || url.username || url.password) errors.push("Fixed private App HTTPS backend ending /api required.");
  } catch { errors.push("Fixed private App HTTPS backend ending /api required."); }
  return { passed: errors.length === 0, errors };
}

export function validateSecretReference(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.hostname.endsWith(".vault.azure.net")
      && /^\/secrets\/[A-Za-z0-9-]+$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password;
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
    const start = Date.parse(certificationWindow?.startsAtUtc);
    const end = Date.parse(certificationWindow?.expiresAtUtc);
    if (!certificationWindow?.windowId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push("100% requires a declared bounded certification window.");
  }
  return { passed: errors.length === 0, errors, captureTiming: "To Do", nativeUrlPrivacy: "To Do" };
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

export function inspectPolicyXml(source, sourcePath = "policy.xml") {
  const errors = [];
  let root;
  try { root = parsePolicyXml(source); } catch { return [{ code: "POLICY_XML_INVALID", path: sourcePath, message: "Policy XML is malformed or contains forbidden declarations." }]; }
  const add = (code, message) => errors.push({ code, path: sourcePath, message });
  const nodes = allNodes(root);
  if (!["fragment", "policies"].includes(root.name)) add("POLICY_ROOT_INVALID", "Expected policies or fragment root.");
  if (root.name === "fragment" && nodes.some(node => ["base", "inbound", "outbound", "backend", "on-error", "include-fragment"].includes(node.name))) add("FRAGMENT_STRUCTURE_INVALID", "Fragments may not contain sections/base/nested fragments.");
  for (const node of nodes) {
    if (node.name === "set-header") {
      const name = node.attributes.name?.toLowerCase() ?? "";
      const action = node.attributes["exists-action"] ?? "override";
      if (!name || name.includes("@") || name.includes("{{")) add("HEADER_NAME_DYNAMIC", "Protocol/security header names must be literal.");
      if (["traceparent", "tracestate"].includes(name)) {
        const conditions = ancestors(node).filter(parent => parent.name === "when").map(parent => parent.attributes.condition ?? "");
        const parentInvalid = conditions.some(condition => /contoso\.traceparentDisposition[\s\S]*!=[\s\S]*"valid"/.test(condition));
        const stateInvalid = conditions.some(condition => /!\(bool\)[\s\S]*contoso\.tracestateValid/.test(condition));
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
    if (node.name === "forward-request" && node.attributes["follow-redirects"] !== "false") add("BACKEND_REDIRECT", "Gateway must not follow redirects carrying credentials.");
    if (node.name === "trace" && allNodes(node).some(child => /Authorization|Cookie|LastError\.Message|Request\.Body|validatedCallerJwt|gatewayMiToken/i.test(`${child.attributes.value ?? ""} ${child.text}`))) add("TRACE_SENSITIVE", "Policy trace must not serialize credentials, raw errors, claims or bodies.");
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
  if (/context\s*\.\s*RequestId/i.test(text)) add("REQUEST_ID_PROVENANCE", "APIM request identity must not supply technical trace context.");
  if (/(?:\.replace|\.Replace)\s*\([^)]{0,160}(?:-00|00\$)[^)]{0,160}(?:-01|01)/s.test(text)
    || /(?:traceFlags|trace_flags|sampled)\s*(?:\|=|=\s*[^;\n]{0,100}\|)\s*(?:0x0?1|1)\b/i.test(text)
    || /\b(?:traceFlags|trace_flags)\s*=\s*(?:0x0?1|1)\b/.test(text)
    || /(?:setTraceFlags|withTraceFlags)\s*\(|TraceFlags\.getSampled\s*\(/.test(text)) add("SAMPLED_FLAG_SURGERY", "Manual sampled-bit surgery is forbidden, including disabled branches.");
  if (/\bbytes\s*:\s*[1-9]\d*/.test(text) && /\.bicep$/i.test(sourcePath)) add("BODY_CAPTURE_NONZERO", "APIM body capture must be zero even in inactive alternatives.");
  for (const match of text.matchAll(/['"]Microsoft\.ApiManagement\/[^'"]+@([^'"]+)['"]/g)) {
    if (match[1] !== APIM_API_VERSION) add("APIM_API_PIN", "Every APIM resource must use the frozen GA2024-05-01 contract.");
  }
  for (const match of text.matchAll(/\bresource\s+\w+\s+['"]Microsoft\.ApiManagement\/service\/(?:apis\/)?diagnostics@[^'"]+['"]\s*=/g)) {
    const opening = text.indexOf("{", match.index + match[0].length);
    const block = opening < 0 ? "" : bicepObject(text, opening);
    if (!/\bhttpCorrelationProtocol\s*:\s*'W3C'/.test(block)) add("DIAGNOSTIC_PROTOCOL", "Bicep diagnostic must explicitly bind W3C; omitted/unresolved inheritance is not proof.");
    if (/\/apis\//.test(match[0])) add("DIAGNOSTIC_SCOPE_OVERRIDE", "API diagnostic overrides are not permitted in the allApis baseline.");
  }
  if (/load(?:Text|Json)Content\s*\([^)]*tests[\\/][^)]*fixtures|load(?:Text|Json)Content\s*\([^)]*tests[\\/]apim/i.test(text)) add("FIXTURE_DEPLOYMENT_REFERENCE", "Negative controls must not enter deployable infrastructure.");
  for (const match of text.matchAll(/\bhttpCorrelationProtocol["']?\s*[:=]\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== "W3C") add("DIAGNOSTIC_PROTOCOL", "APIM diagnostics must remain W3C.");
  }
  for (const match of text.matchAll(/\bdistributedTracingMode["']?\s*[:=]\s*([^,\n;}]+)/g)) {
    const expression = match[1].trim();
    let mode = /^\d+$/.test(expression) ? Number(expression) : undefined;
    if (/\bW3C_TRACE\b/.test(expression)) mode = SDK_W3C_MODE;
    if (constants.has(expression)) mode = constants.get(expression);
    if (mode !== SDK_W3C_MODE || sdkVersion !== SDK_VERSION) add("SDK_TRACING_MODE", "SDK initialization requires version-pinned W3C_TRACE18; unresolved/legacy/mixed modes fail closed.");
  }
  if (/\bnew\s+ApplicationInsights\s*\(/.test(text) && !/\bdistributedTracingMode["']?\s*:/.test(text)) add("SDK_TRACING_MODE", "SDK initialization must explicitly bind the approved W3C_TRACE mode, not an SDK default.");
  if (/^\s*<(?:fragment|policies)\b/.test(text)) findings.push(...inspectPolicyXml(text, sourcePath));
  else {
    for (const match of text.matchAll(/<(?:fragment|policies)\b[\s\S]*?<\/(?:fragment|policies)>/g)) findings.push(...inspectPolicyXml(match[0].replace(/\\'/g, "'"), sourcePath));
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
  const constants = new Map();
  for (const { text } of sources) {
    for (const match of text.matchAll(/\bconst\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*(18)\b/g)) constants.set(match[1], Number(match[2]));
  }
  for (const { file, text } of sources) {
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
