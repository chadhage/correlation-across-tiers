import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

test("LOCAL actual Node provider rejects a second initialize and expires independently without a hot restore claim", async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("OTEL_EXPORTER_OTLP_")) delete env[key];
  delete env.AZURE_LOG_LEVEL;
  delete env.DEBUG;
  delete env.NODE_DEBUG;
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--experimental-strip-types", fileURLToPath(new URL("./r2-telemetry-lifecycle.mjs", import.meta.url))],
    { env, timeout: 30000, windowsHide: true, maxBuffer: 16384 });
  const status: unknown = JSON.parse(stdout);
  assert.deepEqual(status, { fixture: true, sdkVersion: "1.5.0", providerActive: false,
    providerEnumeration: null, exporterEnumeration: null, ownedProviderInitializations: 1, certification: "NOT_CERTIFIED" });
});
