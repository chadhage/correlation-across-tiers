import {
  certificationActive, ContosoError, isUuid4, originalWorkflowInvocationId, SCENARIOS, safeErrorCode, validateDemoRequest, validateOrderRequest,
  type ApiCollection, type ContosoBrowserControllerV1, type ContosoBrowserRunResultV1,
  type ContosoBrowserRunSpecV1, type ContosoErrorCode, type ContosoPublicRuntimeConfigV1,
  type ContosoScenario, type ContosoSdkDependencyIdentity, type WorkflowViewV1
} from "../../portal-ssr/src/shared/contracts.js";
import { createBrowserApi, type BrowserTokenProvider } from "../../portal-ssr/src/shared/browser-api.js";
import { createBrowserTelemetry } from "../../portal-ssr/src/shared/browser-telemetry.js";

export interface StorefrontAuth {
  initialize(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  signedIn(): boolean;
  token: BrowserTokenProvider;
}
const DEMOS = [
  "Synchronous golden path", "Workload Portal SSR", "Gateway context", "Trusted business ID",
  "Failure and timeout", "Service Bus retry", "DLQ and replay", "Fan-out and fan-in",
  "Event Hubs batch", "Event Grid and Storage Queue", "Untrusted message context", "Data safety",
  "Identity and privacy", "Orphan triage", "Sampling and overhead"
];
const MAX_PAGE_INVOCATIONS = 100;
const MAX_INVOCATION_DEPENDENCIES = 100;
function element<T extends HTMLElement>(id: string, ctor: new (...args: never[]) => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof ctor)) throw new ContosoError("CONFIG_UNAVAILABLE");
  return value;
}
function button(testId: string): HTMLButtonElement {
  const value = document.querySelector(`[data-testid="${testId}"]`);
  if (!(value instanceof HTMLButtonElement)) throw new ContosoError("CONFIG_UNAVAILABLE");
  return value;
}

export function createStorefront(
  config: ContosoPublicRuntimeConfigV1,
  auth: StorefrontAuth,
  fixture = false
): ContosoBrowserControllerV1 {
  if (config.executionMode === "fixture" && !fixture) throw new ContosoError("FIXTURE_CONFIG_REJECTED");
  const errorBanner = element("error-banner", HTMLDivElement);
  function report(code: ContosoErrorCode): void {
    errorBanner.textContent = `Contoso operation unavailable: ${code}. ${
      code === "AUTH_INTERACTION_REQUIRED" ? "Use Sign in with Microsoft Entra to authorize this scope again. " : ""
    }No sensitive input has been logged.`;
    errorBanner.hidden = false;
  }
  const telemetry = createBrowserTelemetry(config, report, fixture);
  const dependencies: ContosoSdkDependencyIdentity[] = [];
  let quiesced = false;
  let inFlight = 0;
  const drained = new Set<() => void>();
  function finishTraffic(): void {
    inFlight--;
    if (inFlight === 0) { for (const resolve of drained) resolve(); drained.clear(); }
  }
  function requireTraffic(): void {
    if (quiesced || !telemetry.status().active) throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
  }
  const api = createBrowserApi(config, () => auth.token(), requireTraffic);
  const seenRunIds = new Set<string>();
  let currentSpec: ContosoBrowserRunSpecV1 | undefined;
  let currentResult: ContosoBrowserRunResultV1 | undefined;
  let invocationVersion = 0;
  let refreshVersion = 0;
  let prepared = false;
  let dependencyOverflow = false;
  let currentCollection: ApiCollection = "orders";
  let currentWorkflow: WorkflowViewV1 | undefined;
  let running = false;
  telemetry.observeDependencies(identity => {
    if (identity.runId !== currentSpec?.runId || identity.invocationVersion !== invocationVersion) return;
    if (dependencies.length >= MAX_INVOCATION_DEPENDENCIES) {
      dependencyOverflow = true;
      report("RUN_CAPACITY_EXCEEDED");
      if (currentResult) currentResult = { ...currentResult, outcome: "rejected", errorCode: "RUN_CAPACITY_EXCEEDED" };
      return;
    }
    dependencies.push(identity);
  });
  const orderForm = element("order-form", HTMLFormElement);
  const skuInput = element("order-sku", HTMLInputElement);
  const quantityInput = element("order-quantity", HTMLInputElement);
  const demoSelect = element("demo-id", HTMLSelectElement);
  const scenarioSelect = element("demo-scenario", HTMLSelectElement);
  const budgetInput = element("failure-budget", HTMLInputElement);
  const runDemoButton = button("contoso-run-demo");
  const createOrderButton = button("contoso-create-order");
  const identityButton = element("load-identity", HTMLButtonElement);
  const refreshButton = element("refresh-result", HTMLButtonElement);
  for (let id = 1; id <= 15; id++) {
    const option = document.createElement("option");
    option.value = String(id);
    option.textContent = `Contoso Demo ${String(id).padStart(2, "0")} · ${DEMOS[id - 1] ?? "Scenario"}`;
    if (id === 2) {
      option.disabled = true;
      option.textContent += " · open Workload Portal";
    }
    demoSelect.add(option);
  }
  for (const scenario of SCENARIOS) {
    const option = document.createElement("option");
    option.value = scenario;
    option.textContent = scenario;
    scenarioSelect.add(option);
  }
  element("execution-mode", HTMLSpanElement).textContent =
    fixture ? "FIXTURE · not Azure certification" : `${config.executionMode.toUpperCase()} · Contoso POC`;
  element("sdk-state", HTMLParagraphElement).textContent =
    `JS SDK ${telemetry.sdkVersion} · W3C_TRACE · ${config.telemetry.roleName}`;
  const portalLink = element("portal-link", HTMLAnchorElement);
  portalLink.href = `${config.portal.origin}${config.portal.entryPath}`;
  portalLink.rel = "noopener";
  function updateControls(): void {
    const signedIn = auth.signedIn();
    element("auth-state", HTMLParagraphElement).textContent = fixture
      ? "FIXTURE identity adapter · no Entra authentication proof" : signedIn ? "Signed in · API authorization still enforced" : "Not signed in";
    const active = certificationActive(config);
    element("window-state", HTMLParagraphElement).textContent = active
      ? "Bounded certification window active. Real workspace evidence is still required."
      : "Certification window inactive; demo mutations are disabled.";
    const unavailable = running || quiesced || !telemetry.status().active;
    createOrderButton.disabled = unavailable || !signedIn;
    identityButton.disabled = unavailable || !signedIn;
    runDemoButton.disabled = unavailable || !signedIn || !config.demos.enabled || !active;
    refreshButton.disabled = unavailable || !signedIn || !currentWorkflow;
  }
  function showWorkflow(view: WorkflowViewV1, kind: "browser-spa" | "browser-ssr"): void {
    currentWorkflow = view;
    element("result-state", HTMLHeadingElement).textContent = view.state;
    element("result-id", HTMLElement).textContent = view.id;
    element("result-business-id", HTMLElement).textContent = view.businessInvocationId;
    element("result-business-id-label", HTMLElement).textContent =
      view.workflowBusinessInvocationId ? "Current action invocation ID" : "Workflow invocation ID";
    element("result-workflow-business-id", HTMLElement).textContent = originalWorkflowInvocationId(view);
    element("result-driver", HTMLElement).textContent = kind;
    element("result-note", HTMLParagraphElement).textContent =
      "This is actual backend state. DURABLE_STAGED/202 does not prove broker delivery, worker completion or live correlation certification.";
    const details = element("result-details", HTMLDivElement);
    details.replaceChildren();
    for (const [key, value] of Object.entries(view.details)) {
      const row = document.createElement("p");
      row.textContent = `${key}: ${value}`;
      details.append(row);
    }
  }
  function defaultSpec(kind: "order" | "demo"): ContosoBrowserRunSpecV1 {
    const scenario = scenarioSelect.value;
    if (!SCENARIOS.includes(scenario as ContosoScenario)) throw new ContosoError("REQUEST_INVALID");
    return {
      schemaVersion: 1, runId: crypto.randomUUID(), demoId: kind === "order" ? 1 : Number(demoSelect.value),
      kind, scenario: scenario as ContosoScenario, failureBudget: Number(budgetInput.value),
      sku: skuInput.value, quantity: Number(quantityInput.value)
    };
  }
  function reject(code: ContosoErrorCode): never {
    report(code);
    throw new ContosoError(code, 409);
  }
  function prepareRun(spec: ContosoBrowserRunSpecV1): number {
    if (running) reject("RUN_IN_PROGRESS");
    if (spec.schemaVersion !== 1 || !isUuid4(spec.runId) || !Number.isInteger(spec.demoId)
      || spec.demoId < 1 || spec.demoId > 15 || spec.kind === "portal"
      || (spec.kind === "demo" && spec.demoId === 2)) reject("REQUEST_INVALID");
    if (seenRunIds.has(spec.runId)) reject("RUN_ID_REUSED");
    if (seenRunIds.size >= MAX_PAGE_INVOCATIONS) reject("RUN_CAPACITY_EXCEEDED");
    seenRunIds.add(spec.runId);
    invocationVersion++;
    currentSpec = { ...spec };
    currentResult = undefined;
    currentWorkflow = undefined;
    prepared = true;
    dependencyOverflow = false;
    dependencies.length = 0;
    telemetry.clearInvocation();
    errorBanner.hidden = true;
    skuInput.value = spec.sku ?? "CONTOSO-001";
    quantityInput.value = String(spec.quantity ?? 1);
    demoSelect.value = String(spec.demoId);
    scenarioSelect.value = spec.scenario ?? "SYNC";
    budgetInput.value = String(spec.failureBudget ?? 0);
    element("result-state", HTMLHeadingElement).textContent = "Awaiting requested execution";
    element("result-note", HTMLParagraphElement).textContent = "Prepared only: no current backend request has completed.";
    for (const id of ["result-id", "result-business-id", "result-workflow-business-id", "result-driver"])
      element(id, HTMLElement).textContent = "—";
    element("result-business-id-label", HTMLElement).textContent = "Business invocation ID";
    element("result-details", HTMLDivElement).replaceChildren();
    navigate(spec.kind === "order" ? "/storefront/orders" : "/storefront/demos");
    updateControls();
    return invocationVersion;
  }
  async function execute(spec: ContosoBrowserRunSpecV1): Promise<ContosoBrowserRunResultV1> {
    if (running) reject("RUN_IN_PROGRESS");
    if (!prepared || currentSpec?.runId !== spec.runId) reject("RUN_ID_REUSED");
    const version = invocationVersion;
    const collection: ApiCollection = spec.kind === "order" || (spec.kind === "demo" && spec.demoId === 1)
      ? "orders" : "demo-runs";
    prepared = false;
    running = true;
    inFlight++;
    telemetry.scopeInvocation(spec.runId, version, collection === "orders" ? "/orders" : "/demo-runs");
    errorBanner.hidden = true;
    updateControls();
    try {
      if (spec.kind === "portal") throw new ContosoError("REQUEST_INVALID");
      if (spec.kind === "demo" && spec.demoId === 2) throw new ContosoError("REQUEST_INVALID");
      if (spec.kind === "demo" && (!config.demos.enabled || !certificationActive(config)
        || !config.demos.allowedDemoIds.includes(spec.demoId))) throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
      const view = collection === "orders"
        ? await api.order(validateOrderRequest({
          schemaVersion: 1, orderId: spec.runId, sku: spec.sku ?? "CONTOSO-001", quantity: spec.quantity ?? 1
        }))
        : await api.demo(validateDemoRequest({
          schemaVersion: 1, runId: spec.runId, demoId: spec.demoId,
          ...(spec.scenario ? { scenario: spec.scenario } : {}),
          ...(spec.failureBudget !== undefined ? { failureBudget: spec.failureBudget } : {})
        }));
      currentCollection = collection;
      if (dependencyOverflow) throw new ContosoError("RUN_CAPACITY_EXCEEDED", 409);
      showWorkflow(view, "browser-spa");
      telemetry.event("Contoso.Action", { "business.invocation_id": view.businessInvocationId, "demo.id": String(spec.demoId) });
      const result: ContosoBrowserRunResultV1 = {
        schemaVersion: 1, executionMode: config.executionMode, runId: spec.runId, invocationVersion: version,
        demoId: spec.demoId, driverKind: "browser-spa", outcome: "staged", backend: view
      };
      currentResult = result;
      return result;
    } catch (error: unknown) {
      const code = safeErrorCode(error, "API_REQUEST_FAILED");
      report(code);
      telemetry.event("Contoso.Frontend.Error", { "error.category": code });
      const result: ContosoBrowserRunResultV1 = {
        schemaVersion: 1, executionMode: config.executionMode, runId: spec.runId, invocationVersion: version,
        demoId: spec.demoId, driverKind: "browser-spa", outcome: "rejected", errorCode: code
      };
      currentResult = result;
      return result;
    } finally {
      telemetry.clearInvocation();
      running = false;
      finishTraffic();
      updateControls();
    }
  }
  function executeClick(kind: "order" | "demo"): void {
    try {
      const spec = prepared && currentSpec?.kind === kind ? currentSpec : defaultSpec(kind);
      if (!prepared || spec !== currentSpec) prepareRun(spec);
      void execute(spec).catch((error: unknown) => report(safeErrorCode(error, "REQUEST_INVALID")));
    } catch (error: unknown) { report(safeErrorCode(error, "REQUEST_INVALID")); }
  }
  orderForm.addEventListener("submit", event => {
    event.preventDefault();
    executeClick("order");
  });
  runDemoButton.addEventListener("click", () => {
    executeClick("demo");
  });
  button("contoso-sign-in").addEventListener("click", () => {
    void auth.signIn().catch((error: unknown) => report(safeErrorCode(error, "AUTH_FAILED")));
  });
  element("sign-out", HTMLButtonElement).addEventListener("click", () => {
    void auth.signOut().catch((error: unknown) => report(safeErrorCode(error, "AUTH_FAILED")));
  });
  identityButton.addEventListener("click", () => {
    inFlight++;
    void api.identity().then(view => {
      element("identity-state", HTMLParagraphElement).textContent =
        view.actorType === "user" ? "Verified human API identity; only approved pseudonym displayed." : "Workload identity · no human pseudonym.";
      element("pseudonym", HTMLElement).textContent = view.pseudonym ?? "Approved pseudonym unavailable.";
      telemetry.event("Contoso.Identity", { "auth.outcome": view.actorType, ...(view.pseudonym ? { "user.pseudonym": view.pseudonym } : {}) });
    }).catch((error: unknown) => report(safeErrorCode(error, "API_REQUEST_FAILED"))).finally(finishTraffic);
  });
  refreshButton.addEventListener("click", () => {
    if (currentWorkflow) {
      const version = invocationVersion;
      const refresh = ++refreshVersion;
      const id = currentWorkflow.id;
      const businessId = originalWorkflowInvocationId(currentWorkflow);
      const collection = currentCollection;
      const current = (): boolean => version === invocationVersion && refresh === refreshVersion
        && currentWorkflow?.id === id && currentCollection === collection;
      inFlight++;
      void api.workflow(collection, id)
      .then(view => {
        if (!current()) return;
        if (originalWorkflowInvocationId(view) !== businessId) throw new ContosoError("API_RESPONSE_INVALID", 502);
        showWorkflow(view, "browser-spa");
      })
      .catch((error: unknown) => { if (current()) report(safeErrorCode(error, "API_REQUEST_FAILED")); }).finally(finishTraffic);
    }
  });
  function renderRoute(path: string): void {
    if (!["/storefront/orders", "/storefront/demos"].includes(path)) return;
    orderForm.closest("article")?.toggleAttribute("hidden", path.endsWith("/demos"));
    element("demos-panel", HTMLElement).toggleAttribute("hidden", path.endsWith("/orders"));
  }
  function navigate(path: string): void {
    if (!["/storefront/orders", "/storefront/demos"].includes(path)) return;
    if (location.pathname !== path) history.pushState({}, "", path);
    renderRoute(path);
  }
  for (const value of document.querySelectorAll<HTMLElement>("[data-route]"))
    value.addEventListener("click", () => navigate(value.dataset.route ?? ""));
  addEventListener("popstate", () => renderRoute(location.pathname));
  renderRoute(location.pathname.endsWith("/demos") ? "/storefront/demos" : "/storefront/orders");
  const ready = auth.initialize().then(() => { updateControls(); });
  ready.catch((error: unknown) => { report(safeErrorCode(error, "AUTH_FAILED")); updateControls(); });
  updateControls();
  if (config.certification.enabled && config.certification.endsAtUtc)
    setTimeout(updateControls, Math.max(0, Date.parse(config.certification.endsAtUtc) - Date.now()));
  return {
    version: 1, ready,
    prepare: prepareRun,
    async run() {
      await ready;
      if (!currentSpec) throw new ContosoError("REQUEST_INVALID");
      return execute(currentSpec);
    },
    result(runId) { return currentSpec?.runId === runId ? currentResult : undefined; },
    dependencyIdentities() { return dependencies.map(identity => ({ ...identity })); },
    flushTelemetry() { return telemetry.flush(); },
    browserContextIdentity() { return telemetry.contextIdentity(); },
    runtimeState() {
      const status = telemetry.status();
      return { schemaVersion: 1, executionMode: config.executionMode, service: config.telemetry.roleName,
        sdkVersion: telemetry.sdkVersion, providerActive: status.active, samplingPercentage: status.samplingPercentage,
        windowId: config.certification.windowId, expiresAtUtc: config.certification.endsAtUtc,
        trafficState: quiesced || !status.active ? "quiesced" : "accepting", inFlight, certification: "NOT_CERTIFIED" };
    },
    observeSampling(request) {
      return telemetry.observeSampling(request, { state: quiesced ? "quiesced" : "accepting", inFlight });
    },
    stopTraffic() { quiesced = true; updateControls(); },
    async drain() {
      quiesced = true;
      updateControls();
      if (inFlight > 0) await new Promise<void>(resolve => drained.add(resolve));
      await telemetry.flush();
    }
  };
}
