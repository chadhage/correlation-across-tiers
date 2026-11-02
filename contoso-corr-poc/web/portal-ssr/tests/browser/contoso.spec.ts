import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { driveContosoBrowser, authorizeContosoPortalController } from "../../dist/browser-adapter.js";
import { isRecord, parsePublicConfig } from "../../dist/shared/contracts.js";

interface FixtureObservation {
  path: string;
  method: string;
  actor: string;
  traceparent?: string;
  tracestate?: string;
  businessInvocationId?: string;
  legacyRequestId?: boolean;
  legacyCorrelationContext?: boolean;
  authorizationPresent?: boolean;
}
interface FixtureSpan { type: string; id: string; operationId: string; parentId: string; role: string; unsafeUrl: boolean;
  unsafeMetadata: boolean; businessInvocationId?: string }
interface FixtureSummary { observations: FixtureObservation[]; spans: FixtureSpan[]; excludedOrigin: string }
async function summary(page: import("@playwright/test").Page): Promise<FixtureSummary> {
  const response = await page.request.get("/fixtures/observations");
  const raw: unknown = await response.json();
  if (!isRecord(raw) || raw.fixture !== true || !Array.isArray(raw.observations) || !Array.isArray(raw.spans) || typeof raw.excludedOrigin !== "string")
    throw new Error("FIXTURE_SUMMARY_INVALID");
  const observations: FixtureObservation[] = [];
  const entries: readonly unknown[] = raw.observations;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.method !== "string" || typeof entry.actor !== "string") continue;
    const result: FixtureObservation = { path: entry.path, method: entry.method, actor: entry.actor };
    if (typeof entry.traceparent === "string") result.traceparent = entry.traceparent;
    if (typeof entry.tracestate === "string") result.tracestate = entry.tracestate;
    if (typeof entry.businessInvocationId === "string") result.businessInvocationId = entry.businessInvocationId;
    if (typeof entry.legacyRequestId === "boolean") result.legacyRequestId = entry.legacyRequestId;
    if (typeof entry.legacyCorrelationContext === "boolean") result.legacyCorrelationContext = entry.legacyCorrelationContext;
    if (typeof entry.authorizationPresent === "boolean") result.authorizationPresent = entry.authorizationPresent;
    observations.push(result);
  }
  const spans: FixtureSpan[] = [];
  const spanEntries: readonly unknown[] = raw.spans;
  for (const entry of spanEntries) {
    if (isRecord(entry) && typeof entry.type === "string" && typeof entry.id === "string" && typeof entry.operationId === "string"
      && typeof entry.parentId === "string" && typeof entry.role === "string")
      spans.push({ type: entry.type, id: entry.id, operationId: entry.operationId, parentId: entry.parentId, role: entry.role,
        unsafeUrl: entry.unsafeUrl === true, unsafeMetadata: entry.unsafeMetadata === true,
        ...(typeof entry.businessInvocationId === "string" ? { businessInvocationId: entry.businessInvocationId } : {}) });
  }
  return { observations, spans, excludedOrigin: raw.excludedOrigin };
}
test("FIXTURE real click emits JS3.4.5 W3C_TRACE Fetch dependency and safe header-only evidence", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const evidence = await driveContosoBrowser(page, {
    schemaVersion: 1, runId: randomUUID(), demoId: 1, kind: "order", sku: "CONTOSO-001", quantity: 1
  });
  expect(evidence.evidenceKind).toBe("fixture");
  expect(evidence.backendState).toBe("DURABLE_STAGED");
  expect(evidence.outcome).toBe("staged");
  const action = evidence.observations.find(item => item.path === "/contoso/v1/orders" && item.method === "POST");
  expect(action?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  expect(action?.tracestate).toBe("contoso=cert");
  expect(action?.businessInvocationId).toBe(evidence.businessInvocationId);
  expect(evidence.dependencies.some(item => action?.traceparent?.includes(item.traceId) && action.traceparent.includes(item.spanId))).toBe(true);
  const request = (await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders").at(-1);
  expect(request?.legacyRequestId).toBe(false);
  expect(request?.legacyCorrelationContext).toBe(false);
  const serialized = JSON.stringify(evidence);
  expect(serialized).not.toContain("InstrumentationKey=");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("fixture-user-");
  await expect(page.getByTestId("contoso-run-result")).toContainText("DURABLE_STAGED");
  await expect(page.locator("#execution-mode")).toContainText("FIXTURE");
  await page.screenshot({ path: ".cache/contoso-fixture-storefront.png", fullPage: true });
});
test("FIXTURE SDK route tracking sends page-view telemetry without unsafe URL query/fragment", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  await page.locator('[data-route="/storefront/demos"]').click();
  await page.waitForTimeout(650);
  await page.evaluate(async () => { await window.contosoDemos?.flushTelemetry(); });
  await expect.poll(async () => (await summary(page)).spans.some(item => item.type === "PageviewData" && item.role === "contoso-storefront-spa")).toBe(true);
});
test("FIXTURE excluded successful Fetch and XHR get no technical/business headers", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  await page.evaluate(async () => { await window.contosoDemos?.ready; await window.contosoFixture?.fetchExcluded(); await window.contosoFixture?.xhrExcluded(); });
  const data = await summary(page);
  const excluded = data.observations.filter(item => item.path === "/fixture-excluded").slice(-2);
  expect(excluded).toHaveLength(2);
  for (const item of excluded) {
    expect(item.traceparent).toBeUndefined();
    expect(item.tracestate).toBeUndefined();
    expect(item.businessInvocationId).toBeUndefined();
    expect(item.authorizationPresent).toBe(false);
    expect(item.legacyRequestId).toBe(false);
    expect(item.legacyCorrelationContext).toBe(false);
  }
});
test("FIXTURE approved XHR destination recorded before send receives valid W3C state", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  await page.evaluate(async () => { await window.contosoDemos?.ready; await window.contosoFixture?.xhrApproved(); });
  const request = (await summary(page)).observations.filter(item => item.path === "/contoso/v1/me").at(-1);
  expect(request?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  expect(request?.tracestate).toBe("contoso=cert");
});
test("FIXTURE throwing reporter cannot bypass explicit SDK correlation veto", async ({ page }) => {
  await page.goto("/fixtures/veto-throw");
  await page.evaluate(async () => { await window.contosoFixture?.fetchExcluded(); });
  const request = (await summary(page)).observations.filter(item => item.path === "/fixture-excluded").at(-1);
  expect(request?.traceparent).toBeUndefined();
  expect(request?.tracestate).toBeUndefined();
});
test("FIXTURE unapproved browser origin sees empty preflight without permission and no actual mutation", async ({ page, context }) => {
  await page.goto("/fixtures/storefront");
  const before = await summary(page);
  const count = before.observations.filter(item => item.path === "/contoso/v1/orders").length;
  const rogue = await context.newPage();
  await rogue.goto(`${before.excludedOrigin}/fixtures/rogue`);
  const result = await rogue.evaluate(async () => {
    const view = window as Window & { contosoRogue?: () => Promise<string> };
    return view.contosoRogue ? view.contosoRogue() : "missing";
  });
  expect(result).toBe("browser-blocked");
  expect((await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders")).toHaveLength(count);
  await rogue.close();
});
test("FIXTURE workload SSR requires authenticated controller and renders genuine backend result without human pseudonym", async ({ page, context }) => {
  await page.goto("/portal/");
  await expect(page.getByTestId("contoso-submit-ssr-order")).toBeDisabled();
  const config = parsePublicConfig(await page.evaluate(() => {
    const node = document.getElementById("contoso-runtime-config");
    return node?.textContent ? JSON.parse(node.textContent) as unknown : null;
  }));
  await authorizeContosoPortalController(context, config, `fixture-control-${randomUUID()}`);
  await page.goto("/portal/");
  const evidence = await driveContosoBrowser(page, { schemaVersion: 1, runId: randomUUID(), demoId: 2, kind: "portal" }).catch(async error => {
    const diagnostic = await page.evaluate(() => {
      let code = "";
      try {
        const data: unknown = JSON.parse(document.body.innerText);
        if (typeof data === "object" && data !== null && "errorCode" in data && typeof data.errorCode === "string"
          && /^[A-Z_]{1,80}$/.test(data.errorCode)) code = data.errorCode;
      } catch { /* Only bounded fixture status is reported. */ }
      return { controllerPresent: Boolean(window.contosoDemos), errorCode: code };
    });
    console.log("FIXTURE_SAFE_STATUS", diagnostic);
    throw error;
  });
  expect(evidence.evidenceKind).toBe("fixture");
  expect(evidence.driverKind).toBe("browser-ssr");
  expect(evidence.backendState).toBe("DURABLE_STAGED");
  await expect(page.getByTestId("contoso-run-result")).toContainText("no human");
  const data = await summary(page);
  const call = data.observations.filter(item => item.path === "/contoso/v1/orders" && item.actor === "fixture-workload").at(-1);
  expect(call?.businessInvocationId).toBe(evidence.businessInvocationId);
  expect(call?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const traceId = call?.traceparent?.split("-")[1];
  const clientId = call?.traceparent?.split("-")[2];
  expect(traceId).toBeDefined();
  expect(clientId).toBeDefined();
  await expect.poll(async () => {
    const items = (await summary(page)).spans.filter(item => item.role === "contoso-portal-ssr" && item.operationId === traceId);
    const client = items.find(item => item.type === "RemoteDependencyData" && item.id === clientId);
    return Boolean(client && items.some(item => item.type === "RequestData" && item.id === client.parentId));
  }, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await summary(page)).spans.some(item => item.type === "PageviewData"
    && item.role === "contoso-portal-ssr" && item.operationId !== traceId)).toBe(true);
  const emitted = (await summary(page)).spans.filter(item => item.role === "contoso-portal-ssr" && item.operationId === traceId);
  expect(emitted.filter(item => item.type === "RemoteDependencyData" && item.id === clientId)).toHaveLength(1);
  expect(emitted.every(item => !item.unsafeUrl)).toBe(true);
  expect(emitted.some(item => item.businessInvocationId === evidence.businessInvocationId)).toBe(true);
  expect(JSON.stringify(evidence)).not.toContain("Bearer ");
  expect(JSON.stringify(evidence)).not.toContain("contoso-portal-session");
});
test("FIXTURE HTTP-vector lane proves Node parent advancement preserves incoming sampled=00", async ({ page, context }) => {
  await page.goto("/portal/");
  const config = parsePublicConfig(await page.evaluate(() => {
    const node = document.getElementById("contoso-runtime-config");
    return node?.textContent ? JSON.parse(node.textContent) as unknown : null;
  }));
  await authorizeContosoPortalController(context, config, `fixture-control-${randomUUID()}`);
  const response = await context.request.get("/portal/");
  const html = await response.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  expect(Boolean(csrf)).toBe(true);
  const traceId = randomBytes(16).toString("hex");
  const parentId = randomBytes(8).toString("hex");
  const result = await context.request.post("/portal/orders", {
    headers: { Origin: config.portal.origin, traceparent: `00-${traceId}-${parentId}-00` },
    form: { schemaVersion: "1", csrf: csrf ?? "", runId: randomUUID(), sku: "CONTOSO-001", quantity: "1" }
  });
  expect(result.status()).toBe(200);
  const call = (await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders" && item.actor === "fixture-workload").at(-1);
  expect(call?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  expect(call?.traceparent?.split("-")[1]).toBe(traceId);
  expect(call?.traceparent?.split("-")[2]).not.toBe(parentId);
});
test("FIXTURE Portal controller rejects unauthenticated callers instead of treating a window as authorization", async ({ page }) => {
  await page.goto("/portal/");
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/portal/session", { headers: { Origin: origin }, data: { schemaVersion: 1 } });
  expect(response.status()).toBe(403);
  await expect(page.getByTestId("contoso-submit-ssr-order")).toBeDisabled();
});

test("FIXTURE sequential runs on one page export only current invocation identities and reject reused IDs", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const firstSpec = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 1, kind: "order" as const, sku: "CONTOSO-001", quantity: 1 };
  const first = await driveContosoBrowser(page, firstSpec);
  const secondSpec = { ...firstSpec, runId: randomUUID(), quantity: 2 };
  const second = await driveContosoBrowser(page, secondSpec);
  expect(second.invocationVersion).toBeGreaterThan(first.invocationVersion);
  expect(second.backendId).toBe(secondSpec.runId);
  expect(second.dependencies.length).toBeGreaterThan(0);
  expect(second.dependencies.every(identity => identity.runId === secondSpec.runId && identity.invocationVersion === second.invocationVersion)).toBe(true);
  expect(second.dependencies.some(identity => first.dependencies.some(old => old.dependencyId === identity.dependencyId))).toBe(false);
  expect(await page.evaluate(id => window.contosoDemos?.result(id), firstSpec.runId)).toBeUndefined();
  let staleRequests = 0;
  const requestListener = (request: import("@playwright/test").Request): void => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/contoso/v1/orders") staleRequests++;
  };
  page.on("request", requestListener);
  try { await expect(driveContosoBrowser(page, firstSpec)).rejects.toMatchObject({ code: "RUN_ID_REUSED" }); }
  finally { page.off("request", requestListener); }
  expect(staleRequests).toBe(0);
  const reused = await page.evaluate(input => {
    try { window.contosoDemos?.prepare(input); return "unexpected"; }
    catch (error: unknown) {
      return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
    }
  }, firstSpec);
  expect(reused).toBe("RUN_ID_REUSED");
  await expect(page.locator("#error-banner")).toContainText("RUN_ID_REUSED");
  expect(await page.locator("#error-banner").innerText()).not.toContain(firstSpec.runId);
});

test("FIXTURE in-progress run cannot be replaced and stale completion cannot satisfy a newer invocation", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const pending = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 1, kind: "order" as const, sku: "CONTOSO-001", quantity: 2 };
  await page.evaluate(async input => { await window.contosoDemos?.ready; window.contosoDemos?.prepare(input); }, pending);
  await page.getByTestId("contoso-create-order").click();
  const attempted = { ...pending, runId: randomUUID() };
  const rejected = await page.evaluate(input => {
    try { window.contosoDemos?.prepare(input); return "unexpected"; }
    catch (error: unknown) {
      return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
    }
  }, attempted);
  expect(rejected).toBe("RUN_IN_PROGRESS");
  expect(await page.evaluate(id => window.contosoDemos?.result(id), pending.runId)).toBeUndefined();
  expect(await page.evaluate(id => window.contosoDemos?.result(id), attempted.runId)).toBeUndefined();
  await page.waitForFunction(id => Boolean(window.contosoDemos?.result(id)), pending.runId);
  expect((await page.evaluate(id => window.contosoDemos?.result(id), pending.runId))?.outcome).toBe("staged");
});

test("FIXTURE page invocation capacity rejects overflow visibly instead of evicting reuse protection", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const status = await page.evaluate(async () => {
    const controller = window.contosoDemos;
    await controller?.ready;
    if (!controller) return "missing";
    for (let index = 0; index < 100; index++)
      controller.prepare({ schemaVersion: 1, runId: crypto.randomUUID(), demoId: 1, kind: "order" });
    try {
      controller.prepare({ schemaVersion: 1, runId: crypto.randomUUID(), demoId: 1, kind: "order" });
      return "unexpected";
    } catch (error: unknown) {
      return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
    }
  });
  expect(status).toBe("RUN_CAPACITY_EXCEEDED");
  await expect(page.locator("#error-banner")).toContainText("RUN_CAPACITY_EXCEEDED");
});

test("FIXTURE interaction-required authentication produces no Gateway business call", async ({ page }) => {
  await page.goto("/fixtures/auth-interaction");
  const before = (await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders").length;
  const evidence = await driveContosoBrowser(page, { schemaVersion: 1, runId: randomUUID(), demoId: 1, kind: "order" });
  expect(evidence.outcome).toBe("rejected");
  expect(evidence.backendId).toBeUndefined();
  expect(evidence.dependencies).toHaveLength(0);
  expect((await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders")).toHaveLength(before);
  await expect(page.locator("#error-banner")).toContainText("AUTH_INTERACTION_REQUIRED");
  await expect(page.locator("#error-banner")).toContainText("Sign in with Microsoft Entra");
});

test("FIXTURE real not-ready and conflicting response identity never become success-shaped results", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  for (const [sku, code] of [["CONTOSO-NOTREADY", "API_REQUEST_FAILED"], ["CONTOSO-HEADER-MISMATCH", "API_RESPONSE_INVALID"]]) {
    const evidence = await driveContosoBrowser(page, { schemaVersion: 1, runId: randomUUID(), demoId: 1,
      kind: "order", sku: sku ?? "CONTOSO-NOTREADY", quantity: 1 });
    expect(evidence.outcome).toBe("rejected");
    expect(evidence.backendId).toBeUndefined();
    expect(evidence.backendState).toBeUndefined();
    await expect(page.locator("#error-banner")).toContainText(code ?? "API_REQUEST_FAILED");
    await expect(page.locator("#result-note")).not.toContainText("actual backend state");
  }
});

test("FIXTURE actual Gateway redirect is refused before credentials or correlation can leave its origin", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const before = (await summary(page)).observations.filter(item => item.path === "/fixture-excluded").length;
  const evidence = await driveContosoBrowser(page, { schemaVersion: 1, runId: randomUUID(), demoId: 1,
    kind: "order", sku: "CONTOSO-REDIRECT", quantity: 1 });
  expect(evidence.outcome).toBe("rejected");
  expect((await summary(page)).observations.filter(item => item.path === "/fixture-excluded")).toHaveLength(before);
});

test("FIXTURE actual JS instance observation and quiesce drain one admitted action without accepting another", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const spec = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 1, kind: "order" as const,
    sku: "CONTOSO-001", quantity: 2 };
  await page.evaluate(async input => { await window.contosoDemos?.ready; window.contosoDemos?.prepare(input); }, spec);
  await page.getByTestId("contoso-create-order").click();
  await expect.poll(async () => (await page.evaluate(() => window.contosoDemos?.runtimeState()))?.inFlight).toBe(1);
  const observed = await page.evaluate(() => {
    const controller = window.contosoDemos;
    const windowId = controller?.runtimeState().windowId;
    if (!controller || !windowId) throw new Error("FIXTURE_WINDOW_UNAVAILABLE");
    return controller.observeSampling({ runId: windowId, revision: `cert-${windowId}` });
  });
  expect(observed.providerCount).toBe(1);
  expect(observed.exporterCount).toBe(1);
  expect(observed.effectiveSamplingPercentage).toBe(100);
  expect(observed.ownedConfiguration["telemetry.tracingMode"]).toBe("W3C_TRACE");
  expect(observed.activeLeaseId).toBe(observed.runId);
  expect(observed.certification).toBe("NOT_CERTIFIED");
  expect(JSON.stringify(observed)).not.toContain("InstrumentationKey=");
  await page.evaluate(async () => { window.contosoDemos?.stopTraffic(); await window.contosoDemos?.drain(); });
  const state = await page.evaluate(() => window.contosoDemos?.runtimeState());
  expect(state?.trafficState).toBe("quiesced");
  expect(state?.inFlight).toBe(0);
  expect((await page.evaluate(id => window.contosoDemos?.result(id), spec.runId))?.outcome).toBe("staged");
  await expect(page.getByTestId("contoso-create-order")).toBeDisabled();
  const rejected = await page.evaluate(async () => {
    const controller = window.contosoDemos;
    controller?.prepare({ schemaVersion: 1, runId: crypto.randomUUID(), demoId: 1, kind: "order" });
    return controller?.run();
  });
  expect(rejected?.outcome).toBe("rejected");
  expect(rejected?.errorCode).toBe("CERT_WINDOW_INACTIVE");
});

test("FIXTURE independent JS deadline fences programmatic sends even without operator restore", async ({ page }) => {
  await page.goto("/fixtures/expiring");
  await page.waitForFunction(() => window.contosoDemos?.runtimeState().providerActive === false, undefined, { timeout: 5000 });
  await expect(page.getByTestId("contoso-create-order")).toBeDisabled();
  const before = (await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders").length;
  const rejected = await page.evaluate(async () => {
    const controller = window.contosoDemos;
    controller?.prepare({ schemaVersion: 1, runId: crypto.randomUUID(), demoId: 1, kind: "order" });
    return controller?.run();
  });
  expect(rejected?.outcome).toBe("rejected");
  expect(rejected?.errorCode).toBe("CERT_WINDOW_INACTIVE");
  expect((await summary(page)).observations.filter(item => item.path === "/contoso/v1/orders")).toHaveLength(before);
});

test("FIXTURE Node existing-provider context is injected only into the exact Gateway origin", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const response = await page.request.get("/portal/", { headers: { "x-contoso-fixture-probe": "outbound" } });
  expect(response.status()).toBe(200);
  const data = await summary(page);
  const gateway = data.observations.filter(item => /^\/contoso\/v1\/orders\/[0-9a-f-]{36}$/.test(item.path)).at(-1);
  expect(gateway?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const excluded = data.observations.filter(item => item.path === "/fixture-excluded").at(-1);
  expect(excluded?.traceparent).toBeUndefined();
  expect(excluded?.tracestate).toBeUndefined();
  expect(excluded?.businessInvocationId).toBeUndefined();
  expect(excluded?.authorizationPresent).toBe(false);
});

test("FIXTURE SPA back navigation restores panels and page views retain no query or fragment", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  await page.locator('[data-route="/storefront/demos"]').click();
  await expect(page.locator("#orders-panel")).toBeHidden();
  await page.locator('[data-route="/storefront/orders"]').click();
  await expect(page.locator("#demos-panel")).toBeHidden();
  await page.goBack();
  await expect(page.locator("#orders-panel")).toBeHidden();
  await expect(page.locator("#demos-panel")).toBeVisible();
  await page.evaluate(() => { history.replaceState({}, "", "/storefront/demos?not_retained=private#not-retained"); });
  await page.waitForTimeout(650);
  await page.evaluate(async () => window.contosoDemos?.flushTelemetry());
  const views = (await summary(page)).spans.filter(item => item.type === "PageviewData" && item.role === "contoso-storefront-spa");
  expect(views.length).toBeGreaterThan(0);
  expect(views.every(item => !item.unsafeUrl)).toBe(true);
});

test("FIXTURE production startup with no runtime configuration leaves actions explicitly unavailable", async ({ page }) => {
  await page.goto("/fixtures/no-config");
  await expect(page.locator("#error-banner")).toContainText("CONFIG_UNAVAILABLE");
  await expect(page.getByTestId("contoso-create-order")).toBeDisabled();
  expect(await page.evaluate(() => window.contosoDemos)).toBeUndefined();
  expect(await page.locator("html").getAttribute("data-theme")).toMatch(/^(light|dark)$/);
});

test("FIXTURE actual SDK page-view Id is preserved separately from existing browser trace context", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const context = await page.evaluate(() => window.contosoDemos?.browserContextIdentity());
  expect(context?.identityKind).toBe("sdk-browser-context-not-span");
  expect(context?.traceId).toMatch(/^[0-9a-f]{32}$/);
  await page.evaluate(async () => window.contosoDemos?.flushTelemetry());
  await expect.poll(async () => (await summary(page)).spans.some(item => item.type === "PageviewData"
    && item.operationId === context?.traceId && item.role === "contoso-storefront-spa")).toBe(true);
  const native = (await summary(page)).spans.find(item => item.type === "PageviewData" && item.operationId === context?.traceId);
  expect(native?.id).toBeTruthy();
  console.log("FIXTURE_NATIVE_PAGEVIEW_CONTEXT", JSON.stringify({
    sdkVersion: "3.4.5", nativePageView: native ? {
      id: native.id, operationId: native.operationId, parentId: native.parentId, role: native.role
    } : undefined, existingBrowserContext: context
  }));
});

test("FIXTURE native HTTP metadata replaces spoofed Host, client IP and raw User-Agent before SDK export", async ({ page, context }) => {
  await page.goto("/portal/");
  const config = parsePublicConfig(await page.evaluate(() => {
    const node = document.getElementById("contoso-runtime-config");
    return node?.textContent ? JSON.parse(node.textContent) as unknown : null;
  }));
  await authorizeContosoPortalController(context, config, `fixture-control-${randomUUID()}`);
  const html = await (await context.request.get("/portal/")).text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  expect(csrf).toBeTruthy();
  const traceId = randomBytes(16).toString("hex");
  const result = await context.request.post("/portal/orders", {
    headers: { Origin: config.portal.origin, Host: "fixture-sensitive-host.example",
      "User-Agent": "fixture-sensitive-agent-credential", "X-Forwarded-For": "fixture-sensitive-client",
      traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01` },
    form: { schemaVersion: "1", csrf: csrf ?? "", runId: randomUUID(), sku: "CONTOSO-001", quantity: "1" }
  });

  expect(result.status()).toBe(200);
  await expect.poll(async () => (await summary(page)).spans.some(item => item.operationId === traceId && item.type === "RequestData"),
    { timeout: 15000 }).toBe(true);
  expect((await summary(page)).spans.filter(item => item.operationId === traceId).every(item => !item.unsafeMetadata && !item.unsafeUrl)).toBe(true);
});

test("FIXTURE delayed Storefront refresh cannot replace a newer completed browser invocation", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const first = await driveContosoBrowser(page, { schemaVersion: 1, runId: randomUUID(), demoId: 1, kind: "order",
    sku: "CONTOSO-REFRESH-RACE", quantity: 1 });
  const pending = page.waitForResponse(response => response.request().method() === "GET"
    && new URL(response.url()).pathname === `/contoso/v1/orders/${first.backendId}`);
  const started = page.waitForRequest(request => request.method() === "GET"
    && new URL(request.url()).pathname === `/contoso/v1/orders/${first.backendId}`);
  await page.locator("#refresh-result").click();
  await started;
  const secondSpec = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 1, kind: "order" as const,
    sku: "CONTOSO-001", quantity: 1 };
  const second = await driveContosoBrowser(page, secondSpec);
  await pending;
  await expect(page.locator("#result-id")).toHaveText(secondSpec.runId);
  expect(second.backendId).toBe(secondSpec.runId);
  expect((await page.evaluate(id => window.contosoDemos?.result(id), secondSpec.runId))?.backend?.id).toBe(secondSpec.runId);
});

test("FIXTURE failed native CLIENT keeps only its actual validated outbound business header before any response exists", async ({ page, context }) => {
  await page.goto("/portal/");
  const config = parsePublicConfig(await page.evaluate(() => {
    const node = document.getElementById("contoso-runtime-config");
    return node?.textContent ? JSON.parse(node.textContent) as unknown : null;
  }));
  await authorizeContosoPortalController(context, config, `fixture-control-${randomUUID()}`);
  const html = await (await context.request.get("/portal/")).text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  expect(csrf).toBeTruthy();
  const traceId = randomBytes(16).toString("hex");
  const failed = await context.request.post("/portal/orders", {
    headers: { Origin: config.portal.origin, traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01` },
    form: { schemaVersion: "1", csrf: csrf ?? "", runId: randomUUID(), sku: "CONTOSO-CONNECTION-FAIL", quantity: "1" }
  });
  expect(failed.status()).toBe(502);
  const outgoing = (await summary(page)).observations.filter(item => item.actor === "fixture-workload"
    && item.traceparent?.split("-")[1] === traceId).at(-1);
  const clientId = outgoing?.traceparent?.split("-")[2];
  expect(clientId).toMatch(/^[0-9a-f]{16}$/);
  expect(failed.headers()["x-business-invocation-id"]).toBe(outgoing?.businessInvocationId);
  await expect.poll(async () => (await summary(page)).spans.some(item => item.operationId === traceId
    && item.type === "RemoteDependencyData" && item.id === clientId && item.businessInvocationId === outgoing?.businessInvocationId),
    { timeout: 15000 }).toBe(true);
});

test("FIXTURE real browser repeated order and demo mutations preserve workflow A and new action B", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  await page.evaluate(async () => window.contosoDemos?.ready);
  for (const kind of ["order", "demo"] as const) {
    const values = await page.evaluate(async input => {
      if (!window.contosoFixture) throw new Error("FIXTURE_REQUIRED");
      return window.contosoFixture.repeatWorkflow(input.kind, input.id);
    }, { kind, id: randomUUID() });
    const [first, repeated, get] = values;
    expect(first?.workflowBusinessInvocationId).toBe(first?.businessInvocationId);
    expect(repeated?.businessInvocationId).not.toBe(first?.businessInvocationId);
    expect(repeated?.workflowBusinessInvocationId).toBe(first?.workflowBusinessInvocationId);
    expect(get?.businessInvocationId).toBe(first?.workflowBusinessInvocationId);
    expect(get?.workflowBusinessInvocationId).toBeUndefined();
  }
});

test("FIXTURE actual Storefront UI distinguishes action B from workflow A and accepts durable GET refresh", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const spec = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 1, kind: "order" as const,
    sku: "CONTOSO-ORIGINAL-WORKFLOW", quantity: 1 };
  const evidence = await driveContosoBrowser(page, spec);
  const backend = await page.evaluate(id => window.contosoDemos?.result(id)?.backend, spec.runId);
  expect(backend?.workflowBusinessInvocationId).toBeTruthy();
  expect(backend?.workflowBusinessInvocationId).not.toBe(backend?.businessInvocationId);
  expect(evidence.businessInvocationId).toBe(backend?.businessInvocationId);
  await expect(page.locator("#result-business-id-label")).toHaveText("Current action invocation ID");
  await expect(page.locator("#result-workflow-business-id")).toHaveText(backend?.workflowBusinessInvocationId ?? "");
  const getResponse = page.waitForResponse(response => response.request().method() === "GET"
    && new URL(response.url()).pathname === `/contoso/v1/orders/${spec.runId}`);
  await page.locator("#refresh-result").click();
  const response = await getResponse;
  const body: unknown = await response.json();
  expect(isRecord(body) && body.businessInvocationId).toBe(backend?.workflowBusinessInvocationId);
  expect(isRecord(body) && "workflowBusinessInvocationId" in body).toBe(false);
  expect(response.headers()["x-business-invocation-id"]).not.toBe(backend?.workflowBusinessInvocationId);
  await expect(page.locator("#result-business-id")).toHaveText(backend?.workflowBusinessInvocationId ?? "");
  await expect(page.locator("#result-business-id-label")).toHaveText("Workflow invocation ID");
  await expect(page.locator("#error-banner")).toBeHidden();
});

test("FIXTURE browser mutation rejects missing or invalid original identity without repairing it", async ({ page }) => {
  for (const sku of ["CONTOSO-MISSING-DURABLE", "CONTOSO-INVALID-DURABLE"]) {
    await page.goto("/fixtures/storefront");
    const runId = randomUUID();
    const evidence = await driveContosoBrowser(page, { schemaVersion: 1, runId, demoId: 1,
      kind: "order", sku, quantity: 1 });
    expect(evidence.outcome).toBe("rejected");
    expect(await page.evaluate(id => window.contosoDemos?.result(id)?.errorCode, runId)).toBe("API_RESPONSE_INVALID");
    expect(evidence.backendId).toBeUndefined();
    await expect(page.locator("#error-banner")).toContainText("API_RESPONSE_INVALID");
  }
});

test("FIXTURE actual Portal navigation exposes original workflow A and refresh remains valid", async ({ page, context }) => {
  await page.goto("/portal/");
  const config = parsePublicConfig(await page.evaluate(() => {
    const node = document.getElementById("contoso-runtime-config");
    return node?.textContent ? JSON.parse(node.textContent) as unknown : null;
  }));
  await authorizeContosoPortalController(context, config, `fixture-control-${randomUUID()}`);
  await page.goto("/portal/");
  const spec = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 2, kind: "portal" as const,
    sku: "CONTOSO-ORIGINAL-WORKFLOW", quantity: 1 };
  const evidence = await driveContosoBrowser(page, spec);
  const backend = await page.evaluate(id => window.contosoDemos?.result(id)?.backend, spec.runId);
  expect(backend?.workflowBusinessInvocationId).toBeTruthy();
  expect(backend?.workflowBusinessInvocationId).not.toBe(backend?.businessInvocationId);
  expect(evidence.businessInvocationId).toBe(backend?.businessInvocationId);
  await expect(page.locator("#result-workflow-business-id")).toHaveText(backend?.workflowBusinessInvocationId ?? "");
  await page.goto("/portal/");
  await expect(page.locator("#result-business-id")).toHaveText(backend?.workflowBusinessInvocationId ?? "");
  await expect(page.locator("#result-workflow-business-id")).toHaveText(backend?.workflowBusinessInvocationId ?? "");
  expect(await page.locator("#portal-error").count()).toBe(0);
});

test("FIXTURE next prepared and rejected action never retain prior workflow identity", async ({ page }) => {
  await page.goto("/fixtures/storefront");
  const first = { schemaVersion: 1 as const, runId: randomUUID(), demoId: 1, kind: "order" as const,
    sku: "CONTOSO-ORIGINAL-WORKFLOW", quantity: 1 };
  await driveContosoBrowser(page, first);
  const original = await page.locator("#result-workflow-business-id").textContent();
  expect(original).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const next = { ...first, runId: randomUUID(), sku: "invalid" };
  await page.evaluate(spec => {
    if (!window.contosoDemos) throw new Error("FIXTURE_CONTROLLER_REQUIRED");
    window.contosoDemos.prepare(spec);
  }, next);
  expect(await page.evaluate(id => window.contosoDemos?.result(id), next.runId)).toBeUndefined();
  await expect(page.locator("#result-state")).toHaveText("Awaiting requested execution");
  await expect(page.locator("#result-business-id")).toHaveText("—");
  await expect(page.locator("#result-workflow-business-id")).toHaveText("—");
  await expect(page.locator("#result-business-id-label")).toHaveText("Business invocation ID");
  await expect(page.getByTestId("contoso-run-result")).not.toContainText(original ?? "");
  await page.getByTestId("contoso-create-order").click();
  await expect.poll(() => page.evaluate(id => window.contosoDemos?.result(id)?.outcome, next.runId)).toBe("rejected");
  const rejected = await page.evaluate(id => window.contosoDemos?.result(id), next.runId);
  expect(rejected?.errorCode).toBe("REQUEST_INVALID");
  expect(rejected?.backend).toBeUndefined();
  await expect(page.locator("#result-business-id")).toHaveText("—");
  await expect(page.locator("#result-workflow-business-id")).toHaveText("—");
  await expect(page.locator("#result-business-id-label")).toHaveText("Business invocation ID");
  await expect(page.getByTestId("contoso-run-result")).not.toContainText(original ?? "");
});
