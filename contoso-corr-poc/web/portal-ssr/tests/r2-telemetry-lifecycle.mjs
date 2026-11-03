import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixtureConfig } from "./fixture-config.ts";
import { initializeTelemetry } from "../dist/telemetry.js";
import { ContosoError } from "../dist/shared/contracts.js";
import { AzureLogger, setLogLevel } from "@azure/logger";

setLogLevel(undefined);
AzureLogger.log = () => undefined;
await import("@microsoft/opentelemetry/loader");
await import("@microsoft/opentelemetry");
await import("@azure/identity");
await import("jose");
const config = fixtureConfig();
const { createServer } = await import("node:http");
const collector = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ itemsReceived: 1, itemsAccepted: 1, errors: [] }));
  });
});
await new Promise(resolve => collector.listen(0, "127.0.0.1", resolve));
const collectorAddress = collector.address();
assert.ok(collectorAddress && typeof collectorAddress !== "string");
config.api.origin = `http://127.0.0.1:${collectorAddress.port}`;
config.telemetry.approvedCorrelationOrigins = [config.api.origin];
config.telemetry.connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=${config.api.origin}/`;
config.certification.windowId = randomUUID();
config.certification.endsAtUtc = new Date(Date.now() + 3000).toISOString();
const env = { CONTOSO_SERVER_SAMPLING_PERCENTAGE: "10", CONTOSO_CERT_START: config.certification.startsAtUtc,
  CONTOSO_CERT_END: config.certification.endsAtUtc, CONTOSO_CERT_WINDOW_ID: config.certification.windowId };
const telemetry = await initializeTelemetry(config, env);
assert.equal(telemetry.status().active, true);
assert.equal(telemetry.status().samplingPercentage, 100);
await assert.rejects(initializeTelemetry(config, env), { code: "CONFIG_INVALID" });
const { createContosoServer } = await import("../dist/server.js");
const server = createContosoServer({ env, config, telemetryStatus: () => telemetry.status(),
  shutdownTelemetry: () => telemetry.shutdown(),
  authorizeControl: async bearer => {
    if (bearer !== "fixture-controller-r2") throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const request = { schemaVersion: 1, runId: config.certification.windowId, revision: `cert-${config.certification.windowId}` };
async function control(path, value = request, authorized = true) {
  return fetch(`${origin}/portal/${path}`, { method: "POST",
    headers: { Origin: config.portal.origin, "Content-Type": "application/json",
      ...(authorized ? { Authorization: "Bearer fixture-controller-r2" } : {}) },
    body: JSON.stringify(value)
  });
}
try {
  assert.equal((await control("runtime-state", request, false)).status, 403);
  const observedResponse = await control("runtime-state");
  assert.equal(observedResponse.status, 200);
  const observed = await observedResponse.json();
  assert.ok(observed.runtimeInstanceId.startsWith(`${process.pid}:`));
  assert.equal(observed.activeLeaseId, config.certification.windowId);
  assert.equal(observed.effectiveSamplingPercentage, 100);
  assert.deepEqual(observed.ownedConfiguration, {
    CONTOSO_CERT_START: env.CONTOSO_CERT_START, CONTOSO_CERT_END: env.CONTOSO_CERT_END,
    CONTOSO_CERT_WINDOW_ID: env.CONTOSO_CERT_WINDOW_ID
  });
  assert.ok(!JSON.stringify(observed).includes("InstrumentationKey="));
  assert.ok(!JSON.stringify(observed).includes("Bearer "));
  assert.equal((await control("runtime-state", { ...request, forbidden: "not retained" })).status, 400);
  assert.equal((await control("runtime-stop-traffic")).status, 200);
  const denied = await fetch(`${origin}/portal/orders`, { method: "POST" });
  assert.equal(denied.status, 409);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(config.certification.endsAtUtc) - Date.now() + 100)));
  const expired = telemetry.status();
  assert.equal(expired.active, false);
  assert.equal(expired.samplingPercentage, 0);
  assert.equal(expired.activeLeaseId, null);
  assert.equal((await control("runtime-drain")).status, 200);
  await telemetry.shutdown();
  process.stdout.write(JSON.stringify({ fixture: true, sdkVersion: expired.sdkVersion, providerActive: expired.active,
    providerEnumeration: expired.providerCount, exporterEnumeration: expired.exporterCount,
    ownedProviderInitializations: expired.ownedProviderInitializations, certification: expired.certification }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await telemetry.shutdown();
  collector.closeAllConnections();
  await new Promise(resolve => collector.close(resolve));
}
