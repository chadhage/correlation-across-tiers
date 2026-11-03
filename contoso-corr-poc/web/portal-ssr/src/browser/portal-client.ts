import {
  ContosoError, isUuid4, parsePublicConfig, parseWorkflowMutationView, parseWorkflowView, safeErrorCode, validateOrderRequest,
  type ContosoBrowserRunResultV1, type ContosoBrowserRunSpecV1
} from "../shared/contracts.js";
import { createBrowserTelemetry } from "../shared/browser-telemetry.js";

try {
  const configNode = document.getElementById("contoso-runtime-config");
  if (!configNode?.textContent) throw new ContosoError("CONFIG_UNAVAILABLE");
  const raw: unknown = JSON.parse(configNode.textContent);
  const config = parsePublicConfig(raw);
  const report = (code: string): void => {
    const state = document.getElementById("portal-result");
    if (state) {
      const alert = document.createElement("p");
      alert.setAttribute("role", "alert"); alert.textContent = `Contoso Portal status: ${code}`;
      state.append(alert);
    }
  };
  const telemetry = createBrowserTelemetry(config, report);
  const results = new Map<string, ContosoBrowserRunResultV1>();
  const resultNode = document.getElementById("contoso-portal-backend-result");
  if (resultNode?.textContent) {
    const rawResult: unknown = JSON.parse(resultNode.textContent);
    const backend = location.pathname === "/portal/orders" ? parseWorkflowMutationView(rawResult) : parseWorkflowView(rawResult);
    results.set(backend.id, {
      schemaVersion: 1, executionMode: config.executionMode, runId: backend.id, invocationVersion: 1, demoId: 2,
      driverKind: "browser-ssr", outcome: "staged", backend
    });
  }
  let spec: ContosoBrowserRunSpecV1 | undefined;
  let submitting = false;
  let quiesced = false;
  function stopTraffic(): void {
    quiesced = true;
    const submit = document.querySelector('[data-testid="contoso-submit-ssr-order"]');
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
  }
  document.getElementById("portal-order-form")?.addEventListener("submit", event => {
    if (quiesced || !telemetry.status().active) { event.preventDefault(); report("CERT_WINDOW_INACTIVE"); return; }
    submitting = true;
  });
  window.contosoDemos = {
    version: 1,
    ready: Promise.resolve(),
    prepare(value) {
      if (submitting) { report("RUN_IN_PROGRESS"); throw new ContosoError("RUN_IN_PROGRESS", 409); }
      if (results.has(value.runId) || spec?.runId === value.runId) {
        report("RUN_ID_REUSED"); throw new ContosoError("RUN_ID_REUSED", 409);
      }
      if (value.schemaVersion !== 1 || value.kind !== "portal" || value.demoId !== 2 || !isUuid4(value.runId))
        throw new ContosoError("REQUEST_INVALID");
      const command = validateOrderRequest({
        schemaVersion: 1, orderId: value.runId, sku: value.sku ?? "CONTOSO-001", quantity: value.quantity ?? 1
      });
      spec = { ...value };
      const id = document.getElementById("portal-run-id");
      if (id instanceof HTMLInputElement) id.value = value.runId;
      const sku = document.querySelector('#portal-order-form input[name="sku"]');
      const quantity = document.querySelector('#portal-order-form input[name="quantity"]');
      if (!(sku instanceof HTMLInputElement) || !(quantity instanceof HTMLInputElement)) throw new ContosoError("CONFIG_UNAVAILABLE");
      sku.value = command.sku;
      quantity.value = String(command.quantity);
      return 1;
    },
    async run() {
      if (!spec) throw new ContosoError("REQUEST_INVALID");
      const submit = document.querySelector('[data-testid="contoso-submit-ssr-order"]');
      if (!(submit instanceof HTMLButtonElement) || submit.disabled || quiesced || !telemetry.status().active)
        throw new ContosoError("CERT_WINDOW_INACTIVE");
      submit.click();
      return undefined;
    },
    result(id) { return results.get(id); },
    dependencyIdentities() { return []; },
    flushTelemetry() { return telemetry.flush(); },
    browserContextIdentity() { return telemetry.contextIdentity(); },
    runtimeState() {
      const status = telemetry.status();
      return { schemaVersion: 1, executionMode: config.executionMode, service: config.telemetry.roleName,
        sdkVersion: telemetry.sdkVersion, providerActive: status.active, samplingPercentage: status.samplingPercentage,
        windowId: config.certification.windowId, expiresAtUtc: config.certification.endsAtUtc,
        trafficState: quiesced || !status.active ? "quiesced" : "accepting", inFlight: submitting ? 1 : 0,
        certification: "NOT_CERTIFIED" };
    },
    observeSampling(request) {
      return telemetry.observeSampling(request, { state: quiesced ? "quiesced" : "accepting", inFlight: submitting ? 1 : 0 });
    },
    stopTraffic,
    async drain() {
      stopTraffic();
      if (submitting) throw new ContosoError("RUN_IN_PROGRESS", 409);
      await telemetry.flush();
    }
  };
} catch (error: unknown) {
  const result = document.getElementById("portal-result");
  if (result) {
    const notice = document.createElement("p");
    notice.textContent = `Contoso Portal browser instrumentation unavailable: ${safeErrorCode(error, "CONFIG_INVALID")}`;
    result.append(notice);
  }
}
