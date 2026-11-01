export type ExecutionMode = "live" | "local" | "fixture";
export type ContosoSurface = "storefront-spa" | "portal-page";
export type ContosoRole = "contoso-storefront-spa" | "contoso-portal-ssr";
export type ApiCollection = "orders" | "demo-runs";
export type ContosoScenario =
  | "SYNC" | "RETRY" | "DLQ" | "FAN_OUT" | "FAN_IN" | "BATCH"
  | "EVENT_GRID" | "STORAGE_QUEUE" | "PRIVACY" | "SAMPLING";
export type ContosoErrorCode =
  | "CONFIG_UNAVAILABLE" | "CONFIG_INVALID" | "FIXTURE_CONFIG_REJECTED"
  | "AUTH_REQUIRED" | "AUTH_FAILED" | "AUTH_INTERACTION_REQUIRED"
  | "API_ROUTE_REJECTED" | "API_REQUEST_FAILED" | "API_RESPONSE_INVALID"
  | "CORRELATION_VETO" | "SDK_INITIALIZATION_FAILED" | "CERT_WINDOW_INACTIVE"
  | "PORTAL_DISABLED" | "PORTAL_CSRF_REJECTED" | "PORTAL_TOKEN_UNAVAILABLE" | "PORTAL_CONTROL_REJECTED"
  | "REQUEST_INVALID" | "REQUEST_TOO_LARGE" | "NOT_FOUND"
  | "RUN_IN_PROGRESS" | "RUN_ID_REUSED" | "RUN_CAPACITY_EXCEEDED";

export class ContosoError extends Error {
  readonly code: ContosoErrorCode;
  readonly status: number;
  constructor(code: ContosoErrorCode, status = 400) {
    super(code);
    this.name = "ContosoError";
    this.code = code;
    this.status = status;
  }
}

export interface ContosoPublicRuntimeConfigV1 {
  schemaVersion: 1;
  executionMode: ExecutionMode;
  environment: "poc";
  surface: ContosoSurface;
  deploymentStamp: string;
  api: { origin: string; basePath: "/contoso/v1" };
  identity: {
    tenantId: string;
    spaClientId: string;
    apiClientId: string;
    apiAudience: string;
    scopes: readonly string[];
    spaRedirectUri: string;
    postLogoutRedirectUri: string;
  };
  portal: {
    origin: string;
    entryPath: "/portal/";
    authProfile: "workload-only";
    enabled: boolean;
  };
  telemetry: {
    connectionString: string;
    roleName: ContosoRole;
    tracingMode: "W3C_TRACE";
    samplingPercentage: number;
    approvedCorrelationOrigins: readonly string[];
    excludedCorrelationHosts: readonly string[];
  };
  certification: {
    enabled: boolean;
    startsAtUtc: string | null;
    endsAtUtc: string | null;
    windowId: string | null;
  };
  demos: { controllerVersion: 1; enabled: boolean; allowedDemoIds: readonly number[] };
}

export interface WorkflowViewV1 {
  schemaVersion: 1;
  id: string;
  businessInvocationId: string;
  state: string;
  details: Readonly<Record<string, string>>;
}
export interface IdentityViewV1 {
  schemaVersion: 1;
  actorType: "HUMAN" | "WORKLOAD";
  businessInvocationId: string;
  pseudonym?: string;
}
export interface OrderRequestV1 {
  schemaVersion: 1;
  orderId?: string;
  sku: string;
  quantity: number;
}
export interface DemoRunRequestV1 {
  schemaVersion: 1;
  runId?: string;
  demoId: number;
  scenario?: ContosoScenario;
  failureBudget?: number;
}
export interface ContosoBrowserRunSpecV1 {
  schemaVersion: 1;
  runId: string;
  demoId: number;
  scenario?: ContosoScenario;
  failureBudget?: number;
  kind: "order" | "demo" | "portal";
  sku?: string;
  quantity?: number;
}
export interface ContosoBrowserRunResultV1 {
  schemaVersion: 1;
  executionMode: ExecutionMode;
  runId: string;
  invocationVersion: number;
  demoId: number;
  driverKind: "browser-spa" | "browser-ssr";
  outcome: "staged" | "observed" | "rejected";
  backend?: WorkflowViewV1;
  errorCode?: ContosoErrorCode;
}
export interface ContosoSdkDependencyIdentity {
  traceId: string;
  spanId: string;
  dependencyId: string;
  businessInvocationId?: string;
  runId?: string;
  invocationVersion?: number;
}
export interface ContosoBrowserControllerV1 {
  readonly version: 1;
  readonly ready: Promise<void>;
  prepare(spec: ContosoBrowserRunSpecV1): number;
  run(): Promise<ContosoBrowserRunResultV1 | undefined>;
  result(runId: string): ContosoBrowserRunResultV1 | undefined;
  dependencyIdentities(): readonly ContosoSdkDependencyIdentity[];
  flushTelemetry(): Promise<void>;
}
declare global {
  interface Window { contosoDemos?: ContosoBrowserControllerV1 }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SCENARIOS: readonly ContosoScenario[] =
  ["SYNC", "RETRY", "DLQ", "FAN_OUT", "FAN_IN", "BATCH", "EVENT_GRID", "STORAGE_QUEUE", "PRIVACY", "SAMPLING"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ContosoError("CONFIG_INVALID");
  return value;
}
export function isUuid4(value: unknown): value is string {
  return typeof value === "string" && UUID4.test(value);
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
}
function string(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n\0]/.test(value))
    throw new ContosoError("CONFIG_INVALID");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ContosoError("CONFIG_INVALID");
  return value;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !(key in value)))
    throw new ContosoError("CONFIG_INVALID");
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string"))
    throw new ContosoError("CONFIG_INVALID");
  const items: readonly unknown[] = value;
  return items.map(item => string(item));
}
export function canonicalOrigin(value: string, mode: ExecutionMode): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ContosoError("CONFIG_INVALID"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(mode !== "live" && loopback && url.protocol === "http:")))
    throw new ContosoError("CONFIG_INVALID");
  return url.origin;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  const text = string(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text)))
    throw new ContosoError("CONFIG_INVALID");
  return text;
}
export function certificationActive(config: ContosoPublicRuntimeConfigV1, now = Date.now()): boolean {
  const { enabled, startsAtUtc, endsAtUtc, windowId } = config.certification;
  return enabled && windowId !== null && startsAtUtc !== null && endsAtUtc !== null
    && Date.parse(startsAtUtc) <= now && now < Date.parse(endsAtUtc);
}
export function validateConnectionString(value: string, mode: ExecutionMode): void {
  const allowed = new Set(["InstrumentationKey", "IngestionEndpoint", "ApplicationId", "EndpointSuffix", "LiveEndpoint"]);
  const pairs = new Map<string, string>();
  for (const entry of value.split(";").filter(Boolean)) {
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator);
    const item = entry.slice(separator + 1);
    if (separator < 1 || !allowed.has(key) || pairs.has(key) || !item || /[\r\n\0]/.test(item))
      throw new ContosoError("CONFIG_INVALID");
    pairs.set(key, item);
  }
  if (!isUuid(pairs.get("InstrumentationKey"))) throw new ContosoError("CONFIG_INVALID");
  const endpoint = pairs.get("IngestionEndpoint");
  if (!endpoint) throw new ContosoError("CONFIG_INVALID");
  let ingestion: URL;
  try { ingestion = new URL(endpoint); } catch { throw new ContosoError("CONFIG_INVALID"); }
  canonicalOrigin(ingestion.origin, mode);
  if (ingestion.username || ingestion.password || ingestion.search || ingestion.hash) throw new ContosoError("CONFIG_INVALID");
  if (mode === "fixture" && !["localhost", "127.0.0.1", "[::1]"].includes(ingestion.hostname))
    throw new ContosoError("CONFIG_INVALID");
  if (mode === "live" && !ingestion.hostname.endsWith(".applicationinsights.azure.com"))
    throw new ContosoError("CONFIG_INVALID");
}

export function parsePublicConfig(value: unknown): ContosoPublicRuntimeConfigV1 {
  const root = record(value);
  keys(root, ["schemaVersion", "executionMode", "environment", "surface", "deploymentStamp", "api", "identity", "portal", "telemetry", "certification", "demos"]);
  if (root.schemaVersion !== 1 || root.environment !== "poc"
    || !["live", "local", "fixture"].includes(string(root.executionMode))
    || !["storefront-spa", "portal-page"].includes(string(root.surface))) throw new ContosoError("CONFIG_INVALID");
  const mode = root.executionMode as ExecutionMode;
  const surface = root.surface as ContosoSurface;
  const api = record(root.api);
  const identity = record(root.identity);
  const portal = record(root.portal);
  const telemetry = record(root.telemetry);
  const certification = record(root.certification);
  const demos = record(root.demos);
  keys(api, ["origin", "basePath"]);
  keys(identity, ["tenantId", "spaClientId", "apiClientId", "apiAudience", "scopes", "spaRedirectUri", "postLogoutRedirectUri"]);
  keys(portal, ["origin", "entryPath", "authProfile", "enabled"]);
  keys(telemetry, ["connectionString", "roleName", "tracingMode", "samplingPercentage", "approvedCorrelationOrigins", "excludedCorrelationHosts"]);
  keys(certification, ["enabled", "startsAtUtc", "endsAtUtc", "windowId"]);
  keys(demos, ["controllerVersion", "enabled", "allowedDemoIds"]);
  if (api.basePath !== "/contoso/v1" || portal.entryPath !== "/portal/" || portal.authProfile !== "workload-only")
    throw new ContosoError("CONFIG_INVALID");
  const apiOrigin = canonicalOrigin(string(api.origin), mode);
  const portalOrigin = canonicalOrigin(string(portal.origin), mode);
  const tenantId = string(identity.tenantId, 36);
  const spaClientId = string(identity.spaClientId, 36);
  const apiClientId = string(identity.apiClientId, 36);
  if (![tenantId, spaClientId, apiClientId].every(isUuid) || identity.apiAudience !== apiClientId)
    throw new ContosoError("CONFIG_INVALID");
  const scopes = strings(identity.scopes);
  if (scopes.length !== 1 || !new RegExp(`^api://${apiClientId}/[A-Za-z][A-Za-z0-9.]{1,80}$`).test(scopes[0] ?? ""))
    throw new ContosoError("CONFIG_INVALID");
  for (const uri of [string(identity.spaRedirectUri), string(identity.postLogoutRedirectUri)]) {
    const target = new URL(uri);
    if (canonicalOrigin(target.origin, mode) !== portalOrigin || target.search || target.hash || target.username || target.password)
      throw new ContosoError("CONFIG_INVALID");
  }
  if (identity.spaRedirectUri !== `${portalOrigin}/storefront/auth/redirect.html`
    || identity.postLogoutRedirectUri !== `${portalOrigin}/storefront/`) throw new ContosoError("CONFIG_INVALID");
  const roleName = surface === "storefront-spa" ? "contoso-storefront-spa" : "contoso-portal-ssr";
  if (telemetry.roleName !== roleName || telemetry.tracingMode !== "W3C_TRACE"
    || typeof telemetry.samplingPercentage !== "number" || telemetry.samplingPercentage <= 0 || telemetry.samplingPercentage > 100
    || !Number.isFinite(telemetry.samplingPercentage)) throw new ContosoError("CONFIG_INVALID");
  const origins = strings(telemetry.approvedCorrelationOrigins).map(item => canonicalOrigin(item, mode));
  if (origins.length !== 1 || origins[0] !== apiOrigin) throw new ContosoError("CONFIG_INVALID");
  const connectionString = string(telemetry.connectionString);
  validateConnectionString(connectionString, mode);
  const startsAtUtc = date(certification.startsAtUtc);
  const endsAtUtc = date(certification.endsAtUtc);
  const enabled = boolean(certification.enabled);
  const windowId = certification.windowId === null ? null : string(certification.windowId, 80);
  if (enabled && (!startsAtUtc || !endsAtUtc || !windowId || Date.parse(startsAtUtc) >= Date.parse(endsAtUtc)))
    throw new ContosoError("CONFIG_INVALID");
  if (demos.controllerVersion !== 1 || !Array.isArray(demos.allowedDemoIds)
    || demos.allowedDemoIds.some(item => !Number.isInteger(item) || typeof item !== "number" || item < 1 || item > 15))
    throw new ContosoError("CONFIG_INVALID");
  const allowedDemoIds = demos.allowedDemoIds.filter((item): item is number => typeof item === "number");
  if (new Set(allowedDemoIds).size !== allowedDemoIds.length) throw new ContosoError("CONFIG_INVALID");
  const config: ContosoPublicRuntimeConfigV1 = {
    schemaVersion: 1, executionMode: mode, environment: "poc", surface,
    deploymentStamp: string(root.deploymentStamp, 80),
    api: { origin: apiOrigin, basePath: "/contoso/v1" },
    identity: { tenantId, spaClientId, apiClientId, apiAudience: apiClientId, scopes,
      spaRedirectUri: string(identity.spaRedirectUri), postLogoutRedirectUri: string(identity.postLogoutRedirectUri) },
    portal: { origin: portalOrigin, entryPath: "/portal/", authProfile: "workload-only", enabled: boolean(portal.enabled) },
    telemetry: { connectionString, roleName, tracingMode: "W3C_TRACE", samplingPercentage: telemetry.samplingPercentage,
      approvedCorrelationOrigins: origins, excludedCorrelationHosts: strings(telemetry.excludedCorrelationHosts) },
    certification: { enabled, startsAtUtc, endsAtUtc, windowId },
    demos: { controllerVersion: 1, enabled: boolean(demos.enabled), allowedDemoIds }
  };
  if (config.telemetry.samplingPercentage === 100 && !certificationActive(config))
    throw new ContosoError("CERT_WINDOW_INACTIVE");
  return config;
}

const SAFE_DETAIL_KEYS = new Set(["operation", "status", "source", "transport", "target", "attempts", "orderId", "runId", "sku", "quantity", "producer", "delivery", "reason", "result"]);
export function parseWorkflowView(value: unknown): WorkflowViewV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isUuid4(value.id) || !isUuid4(value.businessInvocationId)
    || typeof value.state !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.state) || !isRecord(value.details))
    throw new ContosoError("API_RESPONSE_INVALID", 502);
  const details: Record<string, string> = {};
  for (const [key, item] of Object.entries(value.details)) {
    if (SAFE_DETAIL_KEYS.has(key) && typeof item === "string" && item.length <= 120
      && /^[A-Za-z0-9 _.:/-]*$/.test(item) && !/eyJ|Bearer|https?:|password|token|secret/i.test(item))
      details[key] = item;
  }
  return { schemaVersion: 1, id: value.id, businessInvocationId: value.businessInvocationId, state: value.state, details };
}
export function parseIdentityView(value: unknown): IdentityViewV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.actorType !== "string" || !["HUMAN", "WORKLOAD"].includes(value.actorType)
    || !isUuid4(value.businessInvocationId)) throw new ContosoError("API_RESPONSE_INVALID", 502);
  const actorType = value.actorType as "HUMAN" | "WORKLOAD";
  const result: IdentityViewV1 = { schemaVersion: 1, actorType, businessInvocationId: value.businessInvocationId };
  if (actorType === "HUMAN" && typeof value.pseudonym === "string" && /^h1\.[a-zA-Z0-9_-]{1,40}\.[A-Za-z0-9_-]{40,64}$/.test(value.pseudonym))
    result.pseudonym = value.pseudonym;
  return result;
}
export function validateOrderRequest(value: unknown): OrderRequestV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !["schemaVersion", "orderId", "sku", "quantity"].includes(key))
    || typeof value.sku !== "string" || !/^CONTOSO-[A-Z0-9-]{1,40}$/.test(value.sku)
    || typeof value.quantity !== "number" || !Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 100
    || (value.orderId !== undefined && !isUuid4(value.orderId))) throw new ContosoError("REQUEST_INVALID");
  const result: OrderRequestV1 = { schemaVersion: 1, sku: value.sku, quantity: value.quantity };
  if (isUuid4(value.orderId)) result.orderId = value.orderId;
  return result;
}
export function validateDemoRequest(value: unknown): DemoRunRequestV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !["schemaVersion", "runId", "demoId", "scenario", "failureBudget"].includes(key))
    || typeof value.demoId !== "number" || !Number.isInteger(value.demoId) || value.demoId < 1 || value.demoId > 15
    || (value.runId !== undefined && !isUuid4(value.runId))
    || (value.scenario !== undefined && !SCENARIOS.includes(value.scenario as ContosoScenario))
    || (value.failureBudget !== undefined && (typeof value.failureBudget !== "number" || !Number.isInteger(value.failureBudget) || value.failureBudget < 0 || value.failureBudget > 10)))
    throw new ContosoError("REQUEST_INVALID");
  const result: DemoRunRequestV1 = { schemaVersion: 1, demoId: value.demoId };
  if (isUuid4(value.runId)) result.runId = value.runId;
  if (typeof value.scenario === "string") result.scenario = value.scenario as ContosoScenario;
  if (typeof value.failureBudget === "number") result.failureBudget = value.failureBudget;
  return result;
}
export function safeErrorCode(error: unknown, fallback: ContosoErrorCode): ContosoErrorCode {
  return error instanceof ContosoError ? error.code : fallback;
}
export function safeRoute(url: URL): string {
  if (/^\/contoso\/v1\/(?:orders|demo-runs)(?:\/[0-9a-f-]{36}(?:\/controls)?)?$/.test(url.pathname))
    return url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "{id}");
  if (["/contoso/v1/me", "/portal/orders", "/portal/", "/storefront/", "/storefront/orders", "/storefront/demos", "/fixture-excluded"].includes(url.pathname))
    return url.pathname;
  return "/unclassified";
}
