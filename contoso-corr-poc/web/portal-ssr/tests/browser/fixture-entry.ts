import "../../../storefront-spa/src/style.css";
import { createStorefront } from "../../../storefront-spa/src/app.js";
import { ContosoError, parsePublicConfig } from "../../src/shared/contracts.js";
import type { WorkflowViewV1 } from "../../src/shared/contracts.js";
import { createBrowserApi } from "../../src/shared/browser-api.js";
import { createBrowserTelemetry } from "../../src/shared/browser-telemetry.js";

declare global {
  interface Window {
    contosoFixture?: {
      fetchExcluded(): Promise<void>;
      xhrApproved(): Promise<void>;
      xhrExcluded(): Promise<void>;
      repeatWorkflow(kind: "order" | "demo", id: string): Promise<WorkflowViewV1[]>;
    };
  }
}
const node = document.getElementById("contoso-runtime-config");
if (!node?.textContent) throw new Error("FIXTURE_CONFIG_MISSING");
const value: unknown = JSON.parse(node.textContent);
const config = parsePublicConfig(value);
if (config.executionMode !== "fixture") throw new Error("FIXTURE_ONLY");
const endpoints = document.getElementById("contoso-fixture-endpoints");
if (!endpoints?.textContent) throw new Error("FIXTURE_ENDPOINTS_MISSING");
const raw: unknown = JSON.parse(endpoints.textContent);
if (typeof raw !== "object" || raw === null || !("excludedOrigin" in raw) || typeof raw.excludedOrigin !== "string")
  throw new Error("FIXTURE_ENDPOINTS_INVALID");
const excluded = raw.excludedOrigin;
const interactionRequired = location.pathname.includes("auth-interaction");
const fixtureToken = `fixture-user-${crypto.randomUUID()}`;
if (location.pathname.includes("veto-throw")) {
  createBrowserTelemetry(config, () => { throw new Error("FIXTURE_REPORTER_FAILURE"); }, true);
} else {
  window.contosoDemos = createStorefront(config, {
    async initialize() {}, async signIn() {}, async signOut() {},
    signedIn() { return true; }, async token() {
      if (interactionRequired) throw new ContosoError("AUTH_INTERACTION_REQUIRED", 401);
      return fixtureToken;
    }
  }, true);
}
async function xhr(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.onload = () => resolve();
    request.onerror = () => reject(new Error("FIXTURE_XHR_FAILED"));
    request.send();
  });
}
window.contosoFixture = {
  async fetchExcluded() { await fetch(`${excluded}/fixture-excluded`, { mode: "cors", credentials: "omit", redirect: "error" }); },
  async xhrApproved() { await xhr(`${config.api.origin}/contoso/v1/me`); },
  async xhrExcluded() { await xhr(`${excluded}/fixture-excluded`); },
  async repeatWorkflow(kind, id) {
    const api = createBrowserApi(config, async () => fixtureToken);
    const send = () => kind === "order"
      ? api.order({ schemaVersion: 1, orderId: id, sku: "CONTOSO-001", quantity: 1 })
      : api.demo({ schemaVersion: 1, runId: id, demoId: 8, scenario: "FAN_IN", failureBudget: 0 });
    return [await send(), await send(), await api.workflow(kind === "order" ? "orders" : "demo-runs", id)];
  }
};
