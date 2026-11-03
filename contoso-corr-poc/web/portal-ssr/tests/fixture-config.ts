import { randomUUID } from "node:crypto";
import type { ContosoPublicRuntimeConfigV1 } from "../dist/shared/contracts.js";

export function fixtureConfig(origin = "http://127.0.0.1:41001", gateway = "http://127.0.0.1:41002"): ContosoPublicRuntimeConfigV1 {
  const apiClientId = randomUUID();
  return {
    schemaVersion: 1, executionMode: "fixture", environment: "poc", surface: "storefront-spa", deploymentStamp: "contoso-fixture",
    api: { origin: gateway, basePath: "/contoso/v1" },
    identity: { tenantId: randomUUID(), spaClientId: randomUUID(), apiClientId, apiAudience: apiClientId,
      scopes: [`api://${apiClientId}/Orders.Invoke`],
      spaRedirectUri: `${origin}/storefront/auth/redirect.html`, postLogoutRedirectUri: `${origin}/storefront/` },
    portal: { origin, entryPath: "/portal/", authProfile: "workload-only", enabled: true },
    telemetry: { connectionString: `InstrumentationKey=${randomUUID()};IngestionEndpoint=${gateway}/`,
      roleName: "contoso-storefront-spa", tracingMode: "W3C_TRACE", samplingPercentage: 100,
      approvedCorrelationOrigins: [gateway], excludedCorrelationHosts: ["login.microsoftonline.com"] },
    certification: { enabled: true, startsAtUtc: new Date(Date.now() - 60000).toISOString(),
      endsAtUtc: new Date(Date.now() + 600000).toISOString(), windowId: randomUUID() },
    demos: { controllerVersion: 1, enabled: true, allowedDemoIds: Array.from({ length: 15 }, (_, index) => index + 1) }
  };
}
