import { defineConfig } from "@playwright/test";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const browserWork = fileURLToPath(new URL("./.cache/browser-work", import.meta.url));
mkdirSync(browserWork, { recursive: true });
process.env.TEMP = browserWork;
process.env.TMP = browserWork;
process.env.TMPDIR = browserWork;
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL("./.cache/browsers", import.meta.url));

async function reservePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { reject(new Error("FIXTURE_PORT_UNAVAILABLE")); return; }
      server.close(() => resolve(address.port));
    });
  });
}
const port = process.env.CONTOSO_FIXTURE_WEB_PORT ? Number(process.env.CONTOSO_FIXTURE_WEB_PORT) : await reservePort();
process.env.CONTOSO_FIXTURE_WEB_PORT = String(port);
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: "line",
  outputDir: ".cache/browser-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block"
  },
  webServer: {
    command: "node --experimental-strip-types tests/browser/fixture-boot.ts",
    url: `http://127.0.0.1:${port}/fixtures/observations`,
    timeout: 60000,
    reuseExistingServer: false,
    env: { CONTOSO_FIXTURE_WEB_PORT: String(port) },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 }
  }
});
