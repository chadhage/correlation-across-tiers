import type { IncomingMessage, RequestOptions } from "node:http";
import type { HttpInstrumentationConfig } from "@opentelemetry/instrumentation-http";
import type { MicrosoftOpenTelemetryOptions } from "@microsoft/opentelemetry";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { runtimeWindow, type ContosoEnvironment } from "./config.js";
import { ContosoError, certificationActive, isRecord, isUuid4, parsePublicConfig, safeRoute, type ContosoPublicRuntimeConfigV1 } from "./shared/contracts.js";

export interface ContosoTelemetry {
  status(): ContosoServerTelemetryStatus;
  shutdown(): Promise<void>;
}
export interface ContosoServerTelemetryStatus {
  active: boolean;
  samplingPercentage: number;
  sdkVersion: "1.5.0";
  runtimeInstanceId: string;
  initializedAtUtc: string;
  observedAtUtc: string;
  activeLeaseId: string | null;
  revision: string;
  ownedConfiguration: Readonly<Record<string, string | { $contosoAbsent: true }>>;
  providerCount: null;
  exporterCount: null;
  ownedProviderInitializations: 1;
  executionMode: ContosoPublicRuntimeConfigV1["executionMode"];
  certification: "NOT_CERTIFIED";
}
let initialized = false;
export function approvedGatewayRequest(config: ContosoPublicRuntimeConfigV1, request: RequestOptions): boolean {
  try {
    const host = request.hostname ?? request.host;
    if (typeof host !== "string" || request.auth || !["GET", "POST"].includes((request.method ?? "GET").toUpperCase())) return false;
    const protocol = request.protocol;
    if (protocol !== "http:" && protocol !== "https:") return false;
    const authority = host.split(":").length > 2 && !host.startsWith("[") ? `[${host}]` : host;
    const target = new URL(`${protocol}//${authority}`);
    if (request.port !== undefined) target.port = String(request.port);
    if (target.origin !== config.api.origin || target.username || target.password) return false;
    const path = request.path ?? "/";
    return /^\/contoso\/v1\/orders(?:\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/.test(path);
  } catch { return false; }
}
type AzureExporterOptions = NonNullable<NonNullable<MicrosoftOpenTelemetryOptions["azureMonitor"]>["azureMonitorExporterOptions"]>;
export type FixtureExporterHttpClient = NonNullable<AzureExporterOptions["httpClient"]>;
export async function initializeTelemetry(
  config: ContosoPublicRuntimeConfigV1,
  env: ContosoEnvironment,
  fixtureHttpClient?: FixtureExporterHttpClient
): Promise<ContosoTelemetry> {
  if (initialized) throw new ContosoError("CONFIG_INVALID", 503);
  config = parsePublicConfig(config);
  if (fixtureHttpClient && config.executionMode !== "fixture") throw new ContosoError("CONFIG_INVALID", 503);
  if (Object.entries(env).some(([key, value]) => key.startsWith("OTEL_EXPORTER_OTLP_") && Boolean(value))
    || env.ENABLE_A365_OBSERVABILITY_EXPORTER === "true")
    throw new ContosoError("CONFIG_INVALID", 503);
  if (env.WEBSITE_SITE_NAME && process.versions.node.split(".")[0] !== "24")
    throw new ContosoError("CONFIG_INVALID", 503);
  const configuredPercentage = Number(env.CONTOSO_SERVER_SAMPLING_PERCENTAGE ?? "10");
  if (!Number.isFinite(configuredPercentage) || configuredPercentage <= 0 || configuredPercentage >= 100)
    throw new ContosoError("CONFIG_INVALID", 503);
  const samplingPercentage = certificationActive(config) ? 100 : configuredPercentage;
  runtimeWindow(env);
  initialized = true;
  const runtimeInstanceId = `${process.pid}:${randomUUID()}`;
  const absent = { $contosoAbsent: true } as const;
  const ownedConfiguration = Object.freeze({
    CONTOSO_CERT_START: env.CONTOSO_CERT_START ?? absent,
    CONTOSO_CERT_END: env.CONTOSO_CERT_END ?? absent,
    CONTOSO_CERT_WINDOW_ID: env.CONTOSO_CERT_WINDOW_ID ?? absent
  });
  process.env.OTEL_SERVICE_NAME = "contoso-portal-ssr";
  process.env.OTEL_PROPAGATORS = "tracecontext";
  process.env.OTEL_RESOURCE_ATTRIBUTES = "";
  process.env.OTEL_NODE_RESOURCE_DETECTORS = "none";
  process.env.OTEL_TRACES_SAMPLER = "parentbased_trace_id_ratio";
  process.env.OTEL_TRACES_SAMPLER_ARG = String(samplingPercentage / 100);
  process.env.APPLICATIONINSIGHTS_SDKSTATS_DISABLED = "true";
  process.env.APPLICATIONINSIGHTS_STATSBEAT_DISABLED = "true";
  process.env.APPLICATION_INSIGHTS_NO_STATSBEAT = "true";
  const azureLogger = await import("@azure/logger");
  azureLogger.setLogLevel(undefined);
  azureLogger.AzureLogger.log = () => undefined;
  await import("@microsoft/opentelemetry/loader");
  const distro = await import("@microsoft/opentelemetry");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  if (distro.MICROSOFT_OPENTELEMETRY_VERSION !== "1.5.0") throw new ContosoError("CONFIG_INVALID", 503);
  const http: HttpInstrumentationConfig = {
    enabled: true,
    ignoreIncomingRequestHook: (request: IncomingMessage): boolean => {
      try {
        const url = new URL(request.url ?? "/", config.portal.origin);
        return url.origin !== config.portal.origin || Boolean(url.search || url.hash)
          || !(request.url?.startsWith("/") && !request.url.startsWith("//"))
          || !((url.pathname === "/portal/" && request.method === "GET")
            || (url.pathname === "/portal/orders" && request.method === "POST"));
      } catch { return true; }
    },
    ignoreOutgoingRequestHook: (request: RequestOptions): boolean => {
      return !approvedGatewayRequest(config, request);
    },
    headersToSpanAttributes: { client: { requestHeaders: [], responseHeaders: [] }, server: { requestHeaders: [], responseHeaders: [] } },
    startIncomingSpanHook(request) {
      const url = new URL(request.url ?? "/", config.portal.origin);
      return { "url.full": `${config.portal.origin}${safeRoute(url)}`, "server.address": new URL(config.portal.origin).hostname,
        "user_agent.original": "Contoso", "client.address": "redacted", "network.peer.address": "redacted" };
    },
    startOutgoingSpanHook(request) {
      const url = new URL(request.path ?? "/", config.api.origin);
      const headers = request.headers;
      const businessId = isRecord(headers) ? headers["x-business-invocation-id"] : undefined;
      return { "url.full": `${config.api.origin}${safeRoute(url)}`, "user_agent.original": "Contoso",
        ...(isUuid4(businessId) ? { "business.invocation_id": businessId } : {}) };
    },
    applyCustomAttributesOnSpan(span, request) {
      span.setAttribute("user_agent.original", "Contoso");
      if ("url" in request) {
        span.setAttribute("client.address", "redacted");
        span.setAttribute("network.peer.address", "redacted");
        span.setAttribute("server.address", new URL(config.portal.origin).hostname);
        span.setAttribute("url.full", `${config.portal.origin}${safeRoute(new URL(request.url ?? "/", config.portal.origin))}`);
      }
    },
    responseHook(span, response) {
      const businessId = "getHeader" in response
        ? response.getHeader("x-business-invocation-id") : response.headers["x-business-invocation-id"];
      if (isUuid4(businessId)) span.setAttribute("business.invocation_id", businessId);
    }
  };
  const ingestionValue = config.telemetry.connectionString.split(";")
    .find(entry => entry.startsWith("IngestionEndpoint="))?.slice("IngestionEndpoint=".length);
  if (!ingestionValue) throw new ContosoError("CONFIG_INVALID", 503);
  const ingestionOrigin = new URL(ingestionValue).origin;
  if (samplingPercentage === 100 && !certificationActive(config)) throw new ContosoError("CERT_WINDOW_INACTIVE", 503);
  distro.useMicrosoftOpenTelemetry({
    resource: resourceFromAttributes({ "service.name": "contoso-portal-ssr", "service.instance.id": runtimeInstanceId }),
    samplingRatio: samplingPercentage / 100,
    tracesPerSecond: 0,
    enableConsoleExporters: false,
    enableSensitiveData: false,
    a365: { enabled: false },
    azureMonitor: {
      enabled: true,
      azureMonitorExporterOptions: {
        connectionString: config.telemetry.connectionString,
        disableOfflineStorage: true,
        ...(config.executionMode === "fixture" ? { endpoint: `${ingestionOrigin}/v2.1` } : {}),
        ...(fixtureHttpClient ? { httpClient: fixtureHttpClient } : {}),
        additionalPolicies: config.executionMode === "fixture" ? [{
          position: "perCall",
          policy: {
            name: "contoso-loopback-fixture-transport",
            async sendRequest(request, next) {
              const target = new URL(request.url);
              if (target.origin === ingestionOrigin && target.protocol === "http:"
                && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
                request.allowInsecureConnection = true;
              return next(request);
            }
          }
        }] : []
      },
      enableLiveMetrics: false,
      enablePerformanceCounters: false,
      enableStandardMetrics: false,
      browserSdkLoaderOptions: { enabled: false }
    },
    instrumentationOptions: {
      http, azureSdk: { enabled: false }, mongoDb: { enabled: false }, mySql: { enabled: false },
      postgreSql: { enabled: false }, redis: { enabled: false }, redis4: { enabled: false },
      bunyan: { enabled: false }, winston: { enabled: false }, console: { enabled: false },
      openaiAgents: { enabled: false }, langchain: { enabled: false }
    }
  });
  azureLogger.setLogLevel(undefined);
  azureLogger.AzureLogger.log = () => undefined;
  syncBuiltinESMExports();
  const initializedAtUtc = new Date().toISOString();
  let active = true;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (!stopping) {
      active = false;
      stopping = distro.shutdownMicrosoftOpenTelemetry();
    }
    return stopping;
  };
  const expiry = config.certification.enabled && config.certification.endsAtUtc
    ? setTimeout(() => { void stop(); }, Math.max(0, Date.parse(config.certification.endsAtUtc) - Date.now()))
    : undefined;
  expiry?.unref();
  return {
    status() {
      const admitted = active && (!config.certification.enabled || certificationActive(config));
      const activeLeaseId = admitted && isUuid4(config.certification.windowId) ? config.certification.windowId : null;
      return { active: admitted, samplingPercentage: admitted ? samplingPercentage : 0,
        sdkVersion: "1.5.0", runtimeInstanceId, initializedAtUtc, observedAtUtc: new Date().toISOString(),
        activeLeaseId, revision: activeLeaseId ? `cert-${activeLeaseId}` : "production-or-inactive",
        ownedConfiguration, providerCount: null, exporterCount: null, ownedProviderInitializations: 1,
        executionMode: config.executionMode,
        certification: "NOT_CERTIFIED" };
    },
    async shutdown() { if (expiry) clearTimeout(expiry); await stop(); }
  };
}
