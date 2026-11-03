import type { BrowserContext, Page, Request, Response } from "@playwright/test";
import {
  ContosoError, isUuid4, parsePublicConfig, safeRoute,
  type ContosoBrowserContextReceiptV1, type ContosoBrowserRunResultV1, type ContosoBrowserRunSpecV1, type ContosoErrorCode,
  type ContosoSdkDependencyIdentity, type ContosoPublicRuntimeConfigV1, type ExecutionMode
} from "./shared/contracts.js";

export interface SanitizedBrowserObservation {
  method: string;
  origin: string;
  path: string;
  resourceType: string;
  status?: number;
  traceparent?: string;
  tracestate?: string;
  businessInvocationId?: string;
  contextRedacted?: boolean;
}
export interface ContosoBrowserEvidenceV1 {
  schemaVersion: 1;
  executionMode: ExecutionMode;
  evidenceKind: "fixture" | "local-observation" | "live-observation-not-certified";
  runId: string;
  invocationVersion: number;
  demoId: number;
  sdkVersion: "3.4.5";
  browserVersion: string;
  driverKind: "browser-spa" | "browser-ssr";
  observations: readonly SanitizedBrowserObservation[];
  dependencies: readonly ContosoSdkDependencyIdentity[];
  browserContexts: readonly ContosoBrowserContextReceiptV1[];
  outcome: "staged" | "rejected";
  backendId?: string;
  businessInvocationId?: string;
  backendState?: string;
}
const PARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
export async function authorizeContosoPortalController(context: BrowserContext, config: ContosoPublicRuntimeConfigV1, bearer: string): Promise<void> {
  const origin = parsePublicConfig(config).portal.origin;
  try {
    // This authenticates a real control session; it is not the browser-driving order action or its trace evidence.
    const response = await context.request.post(`${origin}/portal/session`, {
      headers: { Authorization: `Bearer ${bearer}`, Origin: origin, "Content-Type": "application/json" },
      data: { schemaVersion: 1 }
    });
    if (response.status() !== 200) throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
  } catch { throw new ContosoError("PORTAL_CONTROL_REJECTED", 403); }
}
export function safeTraceparent(value: string | null): string | undefined {
  if (!value || !PARENT.test(value) || /^00-0{32}-/.test(value) || /^00-[0-9a-f]{32}-0{16}-/.test(value)) return undefined;
  return value;
}
export async function driveContosoBrowser(
  page: Page,
  spec: ContosoBrowserRunSpecV1
): Promise<ContosoBrowserEvidenceV1> {
  if (spec.schemaVersion !== 1 || !isUuid4(spec.runId)) throw new ContosoError("REQUEST_INVALID");
  const config = parsePublicConfig(await page.evaluate(() => {
    const element = document.getElementById("contoso-runtime-config");
    if (!element?.textContent) return null;
    const value: unknown = JSON.parse(element.textContent);
    return value;
  }));
  const expectedOrigin = spec.kind === "portal" ? config.portal.origin : config.api.origin;
  const orderSubmission = spec.kind === "order" || (spec.kind === "demo" && spec.demoId === 1);
  const expectedPath = spec.kind === "portal" ? "/portal/orders"
    : `${config.api.basePath}/${orderSubmission ? "orders" : "demo-runs"}`;
  const observations: SanitizedBrowserObservation[] = [];
  const byRequest = new WeakMap<Request, SanitizedBrowserObservation>();
  const pending: Promise<void>[] = [];
  function requestEvent(request: Request): void {
    let url: URL;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== expectedOrigin || url.pathname !== expectedPath || request.method() !== "POST") return;
    const observation: SanitizedBrowserObservation = {
      method: request.method(), origin: url.origin, path: safeRoute(url), resourceType: request.resourceType()
    };
    observations.push(observation);
    byRequest.set(request, observation);
    pending.push((async () => {
      const parent = await request.headerValue("traceparent");
      const cleanParent = safeTraceparent(parent);
      if (cleanParent) observation.traceparent = cleanParent;
      else if (parent) observation.contextRedacted = true;
      const state = await request.headerValue("tracestate");
      if (state === "contoso=cert") observation.tracestate = state;
      else if (state) observation.contextRedacted = true;
      const business = await request.headerValue("x-business-invocation-id");
      if (isUuid4(business)) observation.businessInvocationId = business;
    })().catch(() => { observation.contextRedacted = true; }));
  }
  function responseEvent(response: Response): void {
    const observation = byRequest.get(response.request());
    if (!observation) return;
    observation.status = response.status();
    pending.push((async () => {
      const business = await response.headerValue("x-business-invocation-id");
      if (isUuid4(business)) observation.businessInvocationId = business;
    })().catch(() => { observation.contextRedacted = true; }));
  }
  let result: ContosoBrowserRunResultV1 | undefined;
  let dependencies: readonly ContosoSdkDependencyIdentity[] = [];
  let invocationVersion = 0;
  const browserContexts: ContosoBrowserContextReceiptV1[] = [];
  try {
    const preparation = await page.evaluate(async (input): Promise<number | ContosoErrorCode> => {
      const controller = window.contosoDemos;
      if (!controller) throw new Error("CONTOSO_CONTROLLER_NOT_READY");
      await controller.ready;
      try { return controller.prepare(input); }
      catch (error: unknown) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        return code === "RUN_ID_REUSED" || code === "RUN_IN_PROGRESS" || code === "RUN_CAPACITY_EXCEEDED"
          ? code : "REQUEST_INVALID";
      }
    }, spec);
    if (typeof preparation === "string") throw new ContosoError(preparation, 409);
    if (!Number.isSafeInteger(preparation) || preparation < 1) throw new ContosoError("REQUEST_INVALID");
    invocationVersion = preparation;
    const initialContext = await page.evaluate(() => window.contosoDemos?.browserContextIdentity());
    if (initialContext) browserContexts.push(initialContext);
    page.on("request", requestEvent);
    page.on("response", responseEvent);
    if (spec.kind === "portal") {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.getByTestId("contoso-submit-ssr-order").click()
      ]);
    } else {
      await page.getByTestId(spec.kind === "order" ? "contoso-create-order" : "contoso-run-demo").click();
    }
    await page.waitForFunction(input => {
      const value = window.contosoDemos?.result(input.runId);
      return Boolean(value && value.invocationVersion === input.invocationVersion);
    }, { runId: spec.runId, invocationVersion }, { timeout: 20000 });
    result = await page.evaluate(id => window.contosoDemos?.result(id), spec.runId);
    await page.evaluate(async () => { await window.contosoDemos?.flushTelemetry(); });
    dependencies = await page.evaluate(() => window.contosoDemos?.dependencyIdentities() ?? []);
    const completedContext = await page.evaluate(() => window.contosoDemos?.browserContextIdentity());
    if (completedContext) browserContexts.push(completedContext);
    await Promise.all(pending);
    if (result?.outcome !== "rejected" && !observations.some(item => item.status !== undefined && item.status >= 200 && item.status < 300))
      throw new ContosoError("API_RESPONSE_INVALID");
  } catch (error: unknown) {
    if (error instanceof ContosoError) throw error;
    throw new ContosoError("API_REQUEST_FAILED", 502);
  } finally {
    page.off("request", requestEvent);
    page.off("response", responseEvent);
  }
  if (!result || result.executionMode !== config.executionMode || result.invocationVersion !== invocationVersion)
    throw new ContosoError("API_RESPONSE_INVALID");
  dependencies = dependencies.filter(identity => identity.runId === spec.runId && identity.invocationVersion === invocationVersion
    && observations.some(item => item.traceparent?.split("-")[1] === identity.traceId && item.traceparent.split("-")[2] === identity.spanId));
  const evidence: ContosoBrowserEvidenceV1 = {
    schemaVersion: 1, executionMode: config.executionMode,
    evidenceKind: config.executionMode === "fixture" ? "fixture" : config.executionMode === "local" ? "local-observation" : "live-observation-not-certified",
    runId: spec.runId, invocationVersion, demoId: spec.demoId, sdkVersion: "3.4.5",
    browserVersion: page.context().browser()?.version() ?? "unavailable",
    driverKind: spec.kind === "portal" ? "browser-ssr" : "browser-spa",
    observations, dependencies, browserContexts, outcome: result.outcome === "rejected" ? "rejected" : "staged"
  };
  if (result.backend) {
    evidence.backendId = result.backend.id;
    evidence.businessInvocationId = result.backend.businessInvocationId;
    evidence.backendState = result.backend.state;
  }
  return evidence;
}
