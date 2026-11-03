import {
  canonicalOrigin, ContosoError, isUuid4, MAX_CERT_WINDOW_SECONDS, parsePublicConfig,
  type ContosoPublicRuntimeConfigV1, type ContosoSurface, type ExecutionMode
} from "./shared/contracts.js";

export type ContosoEnvironment = Readonly<Record<string, string | undefined>>;
function required(env: ContosoEnvironment, key: string): string {
  const value = env[key];
  if (!value) throw new ContosoError("CONFIG_UNAVAILABLE", 503);
  return value;
}
function percent(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) throw new ContosoError("CONFIG_INVALID", 503);
  return parsed;
}
export function runtimeWindow(env: ContosoEnvironment): { startsAtUtc: string | null; endsAtUtc: string | null; windowId: string | null } {
  const startsAtUtc = env.CONTOSO_CERT_START ?? null;
  const endsAtUtc = env.CONTOSO_CERT_END ?? null;
  const windowId = env.CONTOSO_CERT_WINDOW_ID ?? null;
  if ([startsAtUtc, endsAtUtc, windowId].some(value => value !== null)) {
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
    if (!startsAtUtc || !endsAtUtc || !utc.test(startsAtUtc) || !utc.test(endsAtUtc)
      || !Number.isFinite(Date.parse(startsAtUtc)) || !Number.isFinite(Date.parse(endsAtUtc))
      || Date.parse(startsAtUtc) >= Date.parse(endsAtUtc)
      || Date.parse(endsAtUtc) - Date.parse(startsAtUtc) > MAX_CERT_WINDOW_SECONDS * 1000 || !isUuid4(windowId))
      throw new ContosoError("CONFIG_INVALID", 503);
  }
  return { startsAtUtc, endsAtUtc, windowId };
}
export function runtimeConfig(
  env: ContosoEnvironment,
  surface: ContosoSurface,
  now = Date.now()
): ContosoPublicRuntimeConfigV1 {
  const executionMode = env.CONTOSO_EXECUTION_MODE ?? "live";
  if (!["live", "local", "fixture"].includes(executionMode)) throw new ContosoError("CONFIG_INVALID", 503);
  const mode = executionMode as ExecutionMode;
  const publicOrigin = canonicalOrigin(required(env, "CONTOSO_PUBLIC_ORIGIN"), mode);
  const gatewayOrigin = canonicalOrigin(required(env, "CONTOSO_GATEWAY_ORIGIN"), mode);
  const apiClientId = required(env, "CONTOSO_ORDERS_API_CLIENT_ID");
  const { startsAtUtc: starts, endsAtUtc: ends, windowId } = runtimeWindow(env);
  const active = starts !== null && ends !== null && windowId !== null && Date.parse(starts) <= now && now < Date.parse(ends);
  const roleName = surface === "storefront-spa" ? "contoso-storefront-spa" : "contoso-portal-ssr";
  return parsePublicConfig({
    schemaVersion: 1, executionMode: mode, environment: "poc", surface,
    deploymentStamp: env.CONTOSO_DEPLOYMENT_STAMP ?? "contoso-local",
    api: { origin: gatewayOrigin, basePath: "/contoso/v1" },
    identity: {
      tenantId: required(env, "CONTOSO_TENANT_ID"),
      spaClientId: required(env, "CONTOSO_SPA_CLIENT_ID"),
      apiClientId, apiAudience: apiClientId,
      scopes: [required(env, "CONTOSO_DELEGATED_SCOPE")],
      spaRedirectUri: `${publicOrigin}/storefront/auth/redirect.html`,
      postLogoutRedirectUri: `${publicOrigin}/storefront/`
    },
    portal: { origin: publicOrigin, entryPath: "/portal/", authProfile: "workload-only", enabled: env.CONTOSO_PORTAL_DEMO_ENABLED === "true" },
    telemetry: {
      connectionString: required(env, "APPLICATIONINSIGHTS_CONNECTION_STRING"),
      roleName, tracingMode: "W3C_TRACE",
      samplingPercentage: active ? 100 : percent(env.CONTOSO_BROWSER_SAMPLING_PERCENTAGE, 10),
      approvedCorrelationOrigins: [gatewayOrigin],
      excludedCorrelationHosts: ["login.microsoftonline.com", "js.monitor.azure.com", "js-cdn.monitor.azure.com"]
    },
    certification: { enabled: active, startsAtUtc: active ? starts : null, endsAtUtc: active ? ends : null, windowId: active ? windowId : null },
    demos: { controllerVersion: 1, enabled: active && env.CONTOSO_DEMOS_ENABLED === "true", allowedDemoIds: Array.from({ length: 15 }, (_, i) => i + 1) }
  });
}
export function inlineConfig(config: ContosoPublicRuntimeConfigV1): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script id="contoso-runtime-config" type="application/json">${json}</script>`;
}
export function portFromEnvironment(env: ContosoEnvironment): number {
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ContosoError("CONFIG_INVALID", 503);
  return port;
}
