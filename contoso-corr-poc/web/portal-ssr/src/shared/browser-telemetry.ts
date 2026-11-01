import { ApplicationInsights, DistributedTracingModes } from "@microsoft/applicationinsights-web";
import {
  ContosoError, isRecord, isUuid4, safeRoute,
  type ContosoErrorCode, type ContosoPublicRuntimeConfigV1
} from "./contracts.js";

export interface BrowserDependencyIdentity {
  traceId: string;
  spanId: string;
  dependencyId: string;
  businessInvocationId?: string;
  runId?: string;
  invocationVersion?: number;
}
export interface BrowserTelemetry {
  readonly sdkVersion: "3.4.5";
  flush(): Promise<void>;
  event(name: string, properties?: Readonly<Record<string, string>>): void;
  observeDependencies(callback: (identity: BrowserDependencyIdentity) => void): () => void;
  scopeInvocation(runId: string, invocationVersion: number, path: "/orders" | "/demo-runs"): void;
  clearInvocation(): void;
  stop(): void;
}
const xhrOrigins = new WeakMap<XMLHttpRequest, string>();
let xhrTrackingInstalled = false;
function trackXhrOrigins(): void {
  if (xhrTrackingInstalled) return;
  xhrTrackingInstalled = true;
  const original = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(
    this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true,
    username?: string | null, password?: string | null
  ): void {
    try {
      const target = new URL(url, location.origin);
      if (!target.username && !target.password) xhrOrigins.set(this, target.origin);
      else xhrOrigins.delete(this);
    } catch { xhrOrigins.delete(this); }
    original.call(this, method, url, async, username ?? null, password ?? null);
  };
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function redactUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, location.origin);
    return `${url.origin}${safeRoute(url)}`;
  } catch { return undefined; }
}
function safeProperties(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (key === "business.invocation_id" && isUuid4(item)) result[key] = item;
    if (key === "user.pseudonym" && typeof item === "string" && /^h1\.[A-Za-z0-9_-]{1,40}\.[A-Za-z0-9_-]{40,64}$/.test(item))
      result[key] = item;
    if (["error.category", "auth.outcome", "demo.id", "telemetry.origin", "execution.mode"].includes(key)
      && typeof item === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(item)) result[key] = item;
  }
  return result;
}

export function createBrowserTelemetry(
  config: ContosoPublicRuntimeConfigV1,
  onError: (code: ContosoErrorCode) => void,
  syntheticState = false
): BrowserTelemetry {
  const allowedOrigins = new Set(config.telemetry.approvedCorrelationOrigins);
  const listeners = new Set<(identity: BrowserDependencyIdentity) => void>();
  let invocation: { runId: string; invocationVersion: number; path: string } | undefined;
  trackXhrOrigins();
  function veto(): false {
    // A throwing UI callback must not turn the SDK's swallowed listener exception into fail-open injection.
    try { onError("CORRELATION_VETO"); } catch { /* Injection remains vetoed. */ }
    return false;
  }
  const endpoint = config.telemetry.connectionString.split(";")
    .find(part => part.startsWith("IngestionEndpoint="))?.slice("IngestionEndpoint=".length);
  const app = new ApplicationInsights({
    config: {
      connectionString: config.telemetry.connectionString,
      distributedTracingMode: DistributedTracingModes.W3C_TRACE,
      enableCorsCorrelation: true,
      disableAjaxTracking: false,
      disableFetchTracking: false,
      enableAutoRouteTracking: true,
      enableRequestHeaderTracking: false,
      enableResponseHeaderTracking: false,
      enableAjaxErrorStatusText: false,
      disableExceptionTracking: true,
      enableUnhandledPromiseRejectionTracking: false,
      loggingLevelConsole: 0,
      loggingLevelTelemetry: 0,
      isStorageUseDisabled: true,
      cookieCfg: { enabled: false },
      samplingPercentage: config.telemetry.samplingPercentage,
      correlationHeaderDomains: [...allowedOrigins].map(origin => new URL(origin).host),
      correlationHeaderExcludedDomains: [...config.telemetry.excludedCorrelationHosts],
      excludeRequestFromAutoTrackingPatterns: [
        "^https://login\\.microsoftonline\\.com/",
        "^https://(?:js|js-cdn)\\.monitor\\.azure\\.com/",
        "/(?:auth/redirect\\.html|runtime-config\\.v1\\.json)(?:[?#]|$)",
        "/portal/session(?:[?#]|$)",
        ...(endpoint ? [`^${escapeRegex(new URL("v2/track", endpoint.endsWith("/") ? endpoint : `${endpoint}/`).href)}(?:[?#]|$)`] : [])
      ],
      addRequestContext: context => {
        let businessId: string | null = null;
        if (context?.response instanceof Response) businessId = context.response.headers.get("x-business-invocation-id");
        if (context?.xhr) businessId = context.xhr.getResponseHeader("x-business-invocation-id");
        return isUuid4(businessId) ? { "business.invocation_id": businessId } : {};
      }
    }
  });
  app.addTelemetryInitializer(item => {
    if (item.baseType === "ExceptionData") return false;
    const originalTags = { ...item.tags };
    const tags: Record<string, string> = { "ai.cloud.role": config.telemetry.roleName };
    for (const key of ["ai.operation.id", "ai.operation.parentId"]) {
      const value: unknown = originalTags[key];
      if (typeof value === "string" && /^(?:[0-9a-f]{16}|[0-9a-f]{32}|\|[0-9a-f]{32}\.[0-9a-f]{16}\.?)$/.test(value))
        tags[key] = value;
    }
    const sdkVersion: unknown = originalTags["ai.internal.sdkVersion"];
    if (typeof sdkVersion === "string" && /^[A-Za-z0-9:._-]{1,80}$/.test(sdkVersion))
      tags["ai.internal.sdkVersion"] = sdkVersion;
    tags["ai.operation.name"] = location.pathname.endsWith("/demos") ? "Contoso Demos" : "Contoso Orders";
    item.tags = tags;
    if (isRecord(item.baseData)) {
      const data = item.baseData;
      for (const key of ["url", "uri", "refUri", "data"]) {
        if (key in data) {
          const clean = redactUrl(data[key]);
          if (clean) data[key] = clean;
          else delete data[key];
        }
      }
      if (typeof data.name === "string")
        data.name = item.baseType === "RemoteDependencyData" ? "Contoso HTTP"
          : location.pathname.endsWith("/demos") ? "Contoso Demos" : "Contoso Orders";
      if (typeof data.target === "string") {
        try { data.target = new URL(data.target, config.api.origin).host; }
        catch { data.target = new URL(config.api.origin).host; }
      }
      data.properties = {
        ...safeProperties(data.properties),
        "telemetry.origin": "browser",
        "execution.mode": config.executionMode
      };
    }
    item.data = safeProperties(item.data);
    if (isRecord(item.ext)) {
      delete item.ext.user;
      delete item.ext.app;
      delete item.ext.web;
      delete item.ext.loc;
      delete item.ext.os;
      delete item.ext.device;
      delete item.ext.net;
      delete item.ext.http;
    }
    return true;
  });
  app.addDependencyListener(details => {
    const input: unknown = details.input;
    let target: URL;
    try {
      const requestUrl = typeof input === "string" ? input
        : input instanceof Request ? input.url : input instanceof URL ? input.href
          : details.xhr ? xhrOrigins.get(details.xhr) : undefined;
      if (!requestUrl) return veto();
      target = new URL(requestUrl, location.origin);
    } catch {
      return veto();
    }
    if (!allowedOrigins.has(target.origin) || target.username || target.password) {
      return veto();
    }
    if (syntheticState && config.executionMode === "fixture") details.traceState?.set("contoso", "cert");
    const method = details.init?.method ?? (input instanceof Request ? input.method : "GET");
    const current = invocation && method.toUpperCase() === "POST" && target.pathname === invocation.path ? invocation : undefined;
    details.context = { traceId: details.traceId, spanId: details.spanId,
      ...(current ? { runId: current.runId, invocationVersion: current.invocationVersion } : {}) };
    return true;
  });
  app.addDependencyInitializer(details => {
    const context: unknown = details.context;
    if (!isRecord(context) || typeof context.traceId !== "string" || typeof context.spanId !== "string") return;
    const identity: BrowserDependencyIdentity = {
      traceId: context.traceId,
      spanId: context.spanId,
      dependencyId: String(details.item.id)
    };
    const properties: unknown = details.properties;
    if (isRecord(properties) && isUuid4(properties["business.invocation_id"]))
      identity.businessInvocationId = properties["business.invocation_id"];
    if (isUuid4(context.runId) && typeof context.invocationVersion === "number" && Number.isSafeInteger(context.invocationVersion))
      Object.assign(identity, { runId: context.runId, invocationVersion: context.invocationVersion });
    for (const callback of listeners) callback(identity);
  });
  try {
    app.loadAppInsights();
    app.trackPageView({ name: "Contoso Storefront", uri: `${location.origin}${safeRoute(new URL(location.href))}` });
  } catch { throw new ContosoError("SDK_INITIALIZATION_FAILED"); }
  const expiration = config.certification.endsAtUtc ? Date.parse(config.certification.endsAtUtc) : null;
  let stopped = false;
  const timer = expiration && config.certification.enabled
    ? window.setTimeout(() => { stopped = true; void app.unload(true); onError("CERT_WINDOW_INACTIVE"); }, Math.max(0, expiration - Date.now()))
    : undefined;
  return {
    sdkVersion: "3.4.5",
    async flush() {
      if (stopped) return;
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 5000);
        app.flush(true, () => { clearTimeout(timeout); resolve(); });
      });
    },
    event(name, properties = {}) {
      if (!/^Contoso\.[A-Za-z.]{1,60}$/.test(name)) return;
      app.trackEvent({ name }, safeProperties(properties));
    },
    observeDependencies(callback) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
    scopeInvocation(runId, invocationVersion, path) {
      if (!isUuid4(runId) || !Number.isSafeInteger(invocationVersion) || invocationVersion < 1)
        throw new ContosoError("REQUEST_INVALID");
      invocation = { runId, invocationVersion, path: `${config.api.basePath}${path}` };
    },
    clearInvocation() { invocation = undefined; },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      stopped = true;
      void app.unload(true);
    }
  };
}
