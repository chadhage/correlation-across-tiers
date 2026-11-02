import { runtimeConfig, portFromEnvironment } from "./config.js";
import { safeErrorCode, type ContosoPublicRuntimeConfigV1 } from "./shared/contracts.js";
import type { ContosoTelemetry } from "./telemetry.js";

let config: ContosoPublicRuntimeConfigV1 | undefined;
let telemetry: ContosoTelemetry | undefined;
try {
  config = runtimeConfig(process.env, "storefront-spa");
  if (config.executionMode === "fixture") throw new Error("FIXTURE_BOOTSTRAP_REJECTED");
  const module = await import("./telemetry.js");
  telemetry = await module.initializeTelemetry(config, process.env);
} catch (error: unknown) {
  config = undefined;
  process.stdout.write(`Contoso web configuration unavailable: ${safeErrorCode(error, "CONFIG_INVALID")}\n`);
}
const { createContosoServer } = await import("./server.js");
const server = createContosoServer({
  env: process.env,
  ...(config ? { config } : {}),
  ...(telemetry ? { telemetryStatus: () => telemetry.status(), shutdownTelemetry: () => telemetry.shutdown() } : {})
});
const port = portFromEnvironment(process.env);
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Contoso public Node host listening on ${port}; live certification remains To Do.\n`);
});
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (telemetry) await telemetry.shutdown();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
