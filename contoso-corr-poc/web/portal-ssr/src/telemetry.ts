import type { IncomingMessage, RequestOptions } from "node:http";
import type { HttpInstrumentationConfig } from "@opentelemetry/instrumentation-http";
import type { MicrosoftOpenTelemetryOptions } from "@microsoft/opentelemetry";
import { syncBuiltinESMExports } from "node:module";
import type { ContosoEnvironment } from "./config.js";
import { ContosoError, certificationActive, type ContosoPublicRuntimeConfigV1 } from "./shared/contracts.js";

export interface ContosoTelemetry {
  status(): { active: boolean; samplingPercentage: number };
  shutdown(): Promise<void>;
}
type AzureExporterOptions = NonNullable<NonNullable<MicrosoftOpenTelemetryOptions["azureMonitor"]>["azureMonitorExporterOptions"]>;
export type FixtureExporterHttpClient = NonNullable<AzureExporterOptions["httpClient"]>;
export async function initializeTelemetry(
  config: ContosoPublicRuntimeConfigV1,
  env: ContosoEnvironment,
  fixtureHttpClient?: FixtureExporterHttpClient
): Promise<ContosoTelemetry> {
  if (fixtureHttpClient && config.executionMode !== "fixture") throw new ContosoError("CONFIG_INVALID", 503);
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.ENABLE_A365_OBSERVABILITY_EXPORTER === "true")
    throw new ContosoError("CONFIG_INVALID", 503);
  if (env.WEBSITE_SITE_NAME && process.versions.node.split(".")[0] !== "24")
    throw new ContosoError("CONFIG_INVALID", 503);
  const configuredPercentage = Number(env.CONTOSO_SERVER_SAMPLING_PERCENTAGE ?? "10");
  if (!Number.isFinite(configuredPercentage) || configuredPercentage <= 0 || configuredPercentage >= 100)
    throw new ContosoError("CONFIG_INVALID", 503);
  const samplingPercentage = certificationActive(config) ? 100 : configuredPercentage;
  process.env.OTEL_SERVICE_NAME = "contoso-portal-ssr";
  process.env.OTEL_PROPAGATORS = "tracecontext";
  process.env.OTEL_TRACES_SAMPLER = "parentbased_trace_id_ratio";
  process.env.OTEL_TRACES_SAMPLER_ARG = String(samplingPercentage / 100);
  process.env.APPLICATIONINSIGHTS_SDKSTATS_DISABLED = "true";
  process.env.APPLICATIONINSIGHTS_STATSBEAT_DISABLED = "true";
  process.env.APPLICATION_INSIGHTS_NO_STATSBEAT = "true";
  await import("@microsoft/opentelemetry/loader");
  const distro = await import("@microsoft/opentelemetry");
  if (distro.MICROSOFT_OPENTELEMETRY_VERSION !== "1.5.0") throw new ContosoError("CONFIG_INVALID", 503);
  const identityHosts = new Set(["login.microsoftonline.com", "169.254.169.254"]);
  for (const input of [env.IDENTITY_ENDPOINT, env.MSI_ENDPOINT]) {
    if (input) {
      try { identityHosts.add(new URL(input).hostname); }
      catch { throw new ContosoError("CONFIG_INVALID", 503); }
    }
  }
  const http: HttpInstrumentationConfig = {
    enabled: true,
    ignoreIncomingRequestHook: (request: IncomingMessage): boolean => {
      try {
        const url = new URL(request.url ?? "/", config.portal.origin);
        return url.origin !== config.portal.origin || Boolean(url.search || url.hash)
          || !["/portal/", "/portal/orders"].includes(url.pathname);
      } catch { return true; }
    },
    ignoreOutgoingRequestHook: (request: RequestOptions): boolean => {
      const host = request.hostname ?? request.host;
      if (typeof host !== "string") return true;
      let hostname: string;
      try { hostname = new URL(`http://${host}`).hostname; } catch { return true; }
      const path = request.path ?? "/";
      return identityHosts.has(hostname) || path.startsWith("/MSI/")
        || path.startsWith("/metadata/identity/") || path.includes("?") || path.includes("#");
    }
  };
  const ingestionValue = config.telemetry.connectionString.split(";")
    .find(entry => entry.startsWith("IngestionEndpoint="))?.slice("IngestionEndpoint=".length);
  if (!ingestionValue) throw new ContosoError("CONFIG_INVALID", 503);
  const ingestionOrigin = new URL(ingestionValue).origin;
  distro.useMicrosoftOpenTelemetry({
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
  syncBuiltinESMExports();
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
    status() { return { active, samplingPercentage: active ? samplingPercentage : 0 }; },
    async shutdown() { if (expiry) clearTimeout(expiry); await stop(); }
  };
}
