import {
  ContosoError, isUuid4, parsePublicConfig, parseWorkflowView, safeErrorCode,
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
    const backend = parseWorkflowView(rawResult);
    results.set(backend.id, {
      schemaVersion: 1, executionMode: config.executionMode, runId: backend.id, invocationVersion: 1, demoId: 2,
      driverKind: "browser-ssr", outcome: "staged", backend
    });
  }
  let spec: ContosoBrowserRunSpecV1 | undefined;
  let submitting = false;
  document.getElementById("portal-order-form")?.addEventListener("submit", () => { submitting = true; });
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
      spec = { ...value };
      const id = document.getElementById("portal-run-id");
      if (id instanceof HTMLInputElement) id.value = value.runId;
      return 1;
    },
    async run() {
      if (!spec) throw new ContosoError("REQUEST_INVALID");
      const submit = document.querySelector('[data-testid="contoso-submit-ssr-order"]');
      if (!(submit instanceof HTMLButtonElement) || submit.disabled) throw new ContosoError("CERT_WINDOW_INACTIVE");
      submit.click();
      return undefined;
    },
    result(id) { return results.get(id); },
    dependencyIdentities() { return []; },
    flushTelemetry() { return telemetry.flush(); }
  };
} catch (error: unknown) {
  const result = document.getElementById("portal-result");
  if (result) {
    const notice = document.createElement("p");
    notice.textContent = `Contoso Portal browser instrumentation unavailable: ${safeErrorCode(error, "CONFIG_INVALID")}`;
    result.append(notice);
  }
}
