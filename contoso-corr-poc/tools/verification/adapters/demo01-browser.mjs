import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HASH, UUID, SPAN, TRACE, requireUtc } from '../../observability/telemetry-contract.mjs';
import { parseTraceparent } from '../../protocol.mjs';
import { projectRoot, readBoundFile, relativeFile, sha256 } from '../files.mjs';
import { VerificationFailure } from '../invariants.mjs';

export const BROWSER_SOURCE_PATHS = Object.freeze([
  'web\\portal-ssr\\src\\browser-adapter.ts',
  'web\\portal-ssr\\src\\shared\\contracts.ts',
  'web\\portal-ssr\\dist\\browser-adapter.js',
  'web\\portal-ssr\\dist\\shared\\contracts.js'
]);
const driverPath = BROWSER_SOURCE_PATHS[2];
const authorFrozenDriver = new Map([
  [BROWSER_SOURCE_PATHS[0], 'ed6616eed2ef9ab8e428837f4d978d8985e70239f5968f7b3651b4271d76fc62'],
  [driverPath, '4c756dc29696018e00d30df22129f3db1daef6cce982d48f4b755e41b949e944']
].map(([file, hash]) => [relativeFile(file), hash]));
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key))) fail(code, 'Closed Demo 01 operation input required');
}

function canonicalApiOrigin(apiOrigin) {
  let origin;
  try { origin = new URL(apiOrigin); }
  catch { fail('D_DEMO01_BROWSER_TARGET', 'An approved canonical HTTPS API origin is required'); }
  if (origin.protocol !== 'https:' || origin.origin !== apiOrigin || origin.username || origin.password) {
    fail('D_DEMO01_BROWSER_TARGET', 'An approved canonical HTTPS API origin is required');
  }
  return apiOrigin;
}

export function demo01BrowserSpec(context, sku) {
  if (context?.schema !== 'contoso.demo-context.v1' || context.demoId !== '01' ||
      !UUID.test(context.runId ?? '') || context.spec?.scenario !== 'SYNC' ||
      context.spec?.assertion !== 'sync' || !/^CONTOSO-[A-Z0-9-]{1,40}$/.test(sku ?? '')) {
    fail('D_DEMO01_INPUT', 'Demo 01 requires its fresh run ID and the prepared single-SKU lease');
  }
  if (context.signal?.aborted) fail('D_DEMO01_ABORTED', 'Demo 01 operation was cancelled');
  return { schemaVersion: 1, runId: context.runId, demoId: 1, kind: 'demo', sku, quantity: 1 };
}

export async function verifyBrowserSources(sources) {
  if (!Array.isArray(sources) || sources.length !== BROWSER_SOURCE_PATHS.length) {
    fail('D_DEMO01_BROWSER_SOURCE', 'The reviewed browser source and built runtime closure are required');
  }
  const expected = new Set(BROWSER_SOURCE_PATHS.map(relativeFile));
  const seen = new Set();
  for (const source of sources) {
    exact(source, ['path', 'sha256'], 'D_DEMO01_BROWSER_SOURCE');
    let file;
    try { file = relativeFile(source.path); }
    catch { fail('D_DEMO01_BROWSER_SOURCE', 'Browser sources must be project-relative reviewed files'); }
    if (!expected.has(file) || seen.has(file) || !HASH.test(source.sha256 ?? '') ||
        authorFrozenDriver.has(file) && authorFrozenDriver.get(file) !== source.sha256) {
      fail('D_DEMO01_BROWSER_SOURCE', 'Exact unique browser source closure required');
    }
    seen.add(file);
    if (sha256(await readBoundFile(file)) !== source.sha256) {
      fail('D_DEMO01_BROWSER_SOURCE', 'Reviewed browser source or build output changed');
    }
  }
}

export function validateDemo01BrowserObservation(evidence, spec, apiOrigin) {
  canonicalApiOrigin(apiOrigin);
  exact(evidence, ['schemaVersion', 'executionMode', 'evidenceKind', 'runId', 'invocationVersion', 'demoId',
    'sdkVersion', 'browserVersion', 'driverKind', 'observations', 'dependencies', 'browserContexts',
    'outcome', 'backendId', 'businessInvocationId', 'backendState'], 'D_DEMO01_BROWSER_OBSERVATION');
  if (evidence?.schemaVersion !== 1 || evidence.executionMode !== 'live' ||
      evidence.evidenceKind !== 'live-observation-not-certified' || evidence.runId !== spec.runId ||
      evidence.demoId !== 1 || evidence.driverKind !== 'browser-spa' || evidence.sdkVersion !== '3.4.5' ||
      !Number.isSafeInteger(evidence.invocationVersion) || evidence.invocationVersion < 1 ||
      evidence.outcome !== 'staged' || !UUID.test(evidence.backendId ?? '') ||
      evidence.backendId !== spec.runId ||
      !UUID.test(evidence.businessInvocationId ?? '') || !Array.isArray(evidence.observations) ||
      !Array.isArray(evidence.dependencies) || !evidence.dependencies.length ||
      !Array.isArray(evidence.browserContexts) || !evidence.browserContexts.length) {
    fail('D_DEMO01_BROWSER_OBSERVATION', 'Actual successful live browser action and SDK identities are required; staged is not downstream proof');
  }
  const requests = evidence.observations;
  for (const request of requests) exact(request, ['method', 'origin', 'path', 'resourceType', 'status',
    'traceparent', 'tracestate', 'businessInvocationId', 'contextRedacted'], 'D_DEMO01_BROWSER_WIRE');
  if (requests.length !== 1 || requests.some(item => item.method !== 'POST' || item.origin !== apiOrigin ||
      item.path !== '/contoso/v1/orders' || item.contextRedacted === true ||
      !['fetch', 'xhr'].includes(item.resourceType) ||
      item.businessInvocationId !== evidence.businessInvocationId ||
      !Number.isInteger(item.status) || item.status < 200 || item.status >= 300 ||
      !parseTraceparent(item.traceparent).valid ||
      item.tracestate !== undefined && item.tracestate !== 'contoso=cert')) {
    fail('D_DEMO01_BROWSER_WIRE', 'Exactly the observed Demo 01 order POST and canonical response invocation are required');
  }
  const wire = parseTraceparent(requests[0].traceparent);
  if (!wire.sampled) fail('D_DEMO01_BROWSER_SAMPLING', 'The actual Demo 01 browser dependency must be sampled without rewriting its carrier');
  const keys = new Set();
  for (const dependency of evidence.dependencies) {
    exact(dependency, ['traceId', 'spanId', 'dependencyId', 'businessInvocationId', 'runId',
      'invocationVersion'], 'D_DEMO01_BROWSER_IDENTITY');
    const key = `${dependency.traceId}:${dependency.spanId}`;
    if (!TRACE.test(dependency.traceId ?? '') || !SPAN.test(dependency.spanId ?? '') ||
        dependency.runId !== spec.runId || dependency.invocationVersion !== evidence.invocationVersion ||
        dependency.traceId !== wire.traceId || dependency.spanId !== wire.parentId ||
        typeof dependency.dependencyId !== 'string' || !dependency.dependencyId || keys.has(key) ||
        dependency.businessInvocationId !== undefined && dependency.businessInvocationId !== evidence.businessInvocationId) {
      fail('D_DEMO01_BROWSER_IDENTITY', 'SDK dependencies must join this original action by run, version, trace and span');
    }
    keys.add(key);
  }
  for (const browserContext of evidence.browserContexts) {
    exact(browserContext, ['schemaVersion', 'sdkVersion', 'identityKind', 'pageInstanceId', 'traceId',
      'contextSpanId', 'observedAtUtc'], 'D_DEMO01_BROWSER_CONTEXT');
    let observed;
    try { observed = requireUtc(browserContext.observedAtUtc, 'browser context observation'); }
    catch { fail('D_DEMO01_BROWSER_CONTEXT', 'Original browser context observation time is required'); }
    if (browserContext.schemaVersion !== 1 || browserContext.sdkVersion !== '3.4.5' ||
        browserContext.identityKind !== 'sdk-browser-context-not-span' ||
        !UUID.test(browserContext.pageInstanceId ?? '') || !TRACE.test(browserContext.traceId ?? '') ||
        browserContext.contextSpanId !== undefined && !SPAN.test(browserContext.contextSpanId) ||
        Date.parse(observed) > Date.now()) {
      fail('D_DEMO01_BROWSER_CONTEXT', 'Browser context identity must remain a context, not a fabricated span');
    }
  }
  return evidence;
}

export async function driveDemo01Page(page, { context, sku, apiOrigin, browserSources }) {
  const spec = demo01BrowserSpec(context, sku);
  canonicalApiOrigin(apiOrigin);
  await verifyBrowserSources(browserSources);
  let readiness;
  try {
    readiness = await page.evaluate(() => {
      const element = document.getElementById('contoso-runtime-config');
      const controller = window.contosoDemos;
      if (!element?.textContent || !controller) return null;
      const config = JSON.parse(element.textContent);
      return {
        executionMode: config.executionMode, environment: config.environment, surface: config.surface,
        api: config.api, certification: config.certification,
        allowed: config.demos?.enabled === true && config.demos?.allowedDemoIds?.includes(1) === true,
        runtime: controller.runtimeState()
      };
    });
  } catch { fail('D_DEMO01_BROWSER_READY', 'Actual approved browser configuration and controller readiness are required before effects'); }
  let start, end;
  try {
    start = Date.parse(requireUtc(readiness?.certification?.startsAtUtc, 'browser window start'));
    end = Date.parse(requireUtc(readiness?.certification?.endsAtUtc, 'browser window end'));
  } catch { fail('D_DEMO01_BROWSER_READY', 'The actual browser must have a finite active run window before effects'); }
  const runtime = readiness.runtime;
  if (readiness.executionMode !== 'live' || readiness.environment !== 'poc' ||
      readiness.surface !== 'storefront-spa' || readiness.api?.origin !== apiOrigin ||
      readiness.api?.basePath !== '/contoso/v1' || readiness.certification.enabled !== true ||
      readiness.certification.windowId !== context.runId || !readiness.allowed ||
      start > Date.now() || end <= Date.now() || end <= start || end - start > 7200000 ||
      runtime?.executionMode !== 'live' || runtime.service !== 'contoso-storefront-spa' ||
      runtime.sdkVersion !== '3.4.5' || runtime.providerActive !== true || runtime.samplingPercentage !== 100 ||
      runtime.windowId !== context.runId || runtime.expiresAtUtc !== readiness.certification.endsAtUtc ||
      runtime.trafficState !== 'accepting' || runtime.inFlight !== 0) {
    fail('D_DEMO01_BROWSER_READY', 'Actual browser target, run lease and local SDK admission must match before the action; this is not native fidelity proof');
  }
  if (context.signal?.aborted) fail('D_DEMO01_ABORTED', 'Demo 01 operation was cancelled');
  const { driveContosoBrowser } = await import(pathToFileURL(path.join(projectRoot, driverPath)).href);
  if (typeof driveContosoBrowser !== 'function') fail('D_DEMO01_BROWSER_SOURCE', 'The supplied production browser driver is unavailable');
  const evidence = await driveContosoBrowser(page, spec);
  await verifyBrowserSources(browserSources);
  return validateDemo01BrowserObservation(evidence, spec, apiOrigin);
}

export async function stopDemo01Page(page) {
  const result = await page.evaluate(() => {
    const controller = window.contosoDemos;
    if (!controller) return null;
    controller.stopTraffic();
    return controller.runtimeState();
  });
  if (result?.trafficState !== 'quiesced') {
    fail('D_DEMO01_BROWSER_STOP', 'The actual browser controller did not quiesce admission');
  }
  return result;
}

export async function drainDemo01Page(page) {
  await stopDemo01Page(page);
  const result = await page.evaluate(async () => {
    const controller = window.contosoDemos;
    if (!controller) return null;
    await controller.drain();
    await controller.flushTelemetry();
    return controller.runtimeState();
  });
  if (result?.trafficState !== 'quiesced' || result.inFlight !== 0) {
    fail('D_DEMO01_BROWSER_DRAIN', 'The actual browser controller did not finish in-flight work and flushing');
  }
  return result;
}
