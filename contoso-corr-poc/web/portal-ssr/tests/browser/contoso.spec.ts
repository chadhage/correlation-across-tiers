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
}
interface FixtureSpan { type: string; id: string; operationId: string; parentId: string; role: string }
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
    observations.push(result);
  }
  const spans: FixtureSpan[] = [];
  const spanEntries: readonly unknown[] = raw.spans;
  for (const entry of spanEntries) {
    if (isRecord(entry) && typeof entry.type === "string" && typeof entry.id === "string" && typeof entry.operationId === "string"
      && typeof entry.parentId === "string" && typeof entry.role === "string")
      spans.push({ type: entry.type, id: entry.id, operationId: entry.operationId, parentId: entry.parentId, role: entry.role });
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
