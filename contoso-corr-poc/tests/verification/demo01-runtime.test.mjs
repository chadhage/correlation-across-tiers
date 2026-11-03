import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  BROWSER_SOURCE_PATHS, demo01BrowserSpec, validateDemo01BrowserObservation,
  verifyBrowserSources, driveDemo01Page, stopDemo01Page, drainDemo01Page
} from '../../tools/verification/adapters/demo01-browser.mjs';
import { projectRoot, readBoundFile, sha256 } from '../../tools/verification/files.mjs';
import * as runtime from '../../tools/verification/adapters/demo01-runtime.mjs';
import { runDemo } from '../../tools/verification/demo.mjs';
import { rawFixture, fakeJwt } from '../security/fixtures.mjs';

const apiOrigin = 'https://api.contoso.invalid';
const context = () => ({
  schema: 'contoso.demo-context.v1', demoId: '01', runId: randomUUID(), mode: 'BootstrapValidate',
  requestedBusinessInvocationId: randomUUID(), spec: { scenario: 'SYNC', assertion: 'sync' },
  signal: new AbortController().signal
});
const sourcePins = () => Promise.all(BROWSER_SOURCE_PATHS.map(async path => ({
  path, sha256: sha256(await readBoundFile(path))
})));
const code = expected => error => error?.code === expected;

async function withConstructionFixture(action) {
  const report = await runtime.inspectDemo01Construction();
  const files = new Map();
  async function visit(file) {
    if (files.has(file)) return;
    const bytes = await readBoundFile(file);
    files.set(file, bytes);
    if (!file.endsWith('.mjs')) return;
    for (const match of bytes.toString('utf8').matchAll(/\b(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      await visit(path.relative(projectRoot, path.resolve(projectRoot, path.dirname(file), match[1])));
    }
  }
  for (const source of report.sources) await visit(source.path);
  const directory = path.join(projectRoot, 'tests', 'verification', 'generated-fixtures', `demo01-${randomUUID()}`);
  try {
    for (const [file, bytes] of files) {
      const target = path.join(directory, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    const moduleUrl = pathToFileURL(path.join(directory, 'tools', 'verification', 'adapters', 'demo01-runtime.mjs')).href;
    const copied = await import(moduleUrl);
    await action({ copied, directory, files, moduleUrl });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function fixture() {
  const run = context();
  const spec = demo01BrowserSpec(run, 'CONTOSO-OWNED-RUN');
  const businessInvocationId = randomUUID();
  const traceId = 'a'.repeat(32), spanId = 'b'.repeat(16);
  return {
    run, spec,
    evidence: {
      schemaVersion: 1, executionMode: 'live', evidenceKind: 'live-observation-not-certified',
      runId: spec.runId, invocationVersion: 1, demoId: 1, sdkVersion: '3.4.5',
      browserVersion: 'controlled-dependency-not-a-browser-execution', driverKind: 'browser-spa',
      observations: [{
        method: 'POST', origin: apiOrigin, path: '/contoso/v1/orders', resourceType: 'fetch',
        status: 202, traceparent: `00-${traceId}-${spanId}-01`, businessInvocationId
      }],
      dependencies: [{ traceId, spanId, dependencyId: `|${traceId}.${spanId}.`,
        runId: spec.runId, invocationVersion: 1 }],
      browserContexts: [{ schemaVersion: 1, sdkVersion: '3.4.5',
        identityKind: 'sdk-browser-context-not-span', pageInstanceId: randomUUID(),
        traceId, contextSpanId: 'c'.repeat(16), observedAtUtc: new Date().toISOString() }],
      outcome: 'staged', backendId: spec.runId, businessInvocationId, backendState: 'DURABLE_STAGED'
    }
  };
}

test('positive: construction-only input uses the advertised demo action and owned SKU, never a requested observation ID', () => {
  const run = context();
  const spec = demo01BrowserSpec(run, 'CONTOSO-OWNED-RUN');
  assert.deepEqual(spec, { schemaVersion: 1, runId: run.runId, demoId: 1, kind: 'demo',
    sku: 'CONTOSO-OWNED-RUN', quantity: 1 });
  assert.equal(Object.hasOwn(spec, 'businessInvocationId'), false);
  assert.equal(Object.hasOwn(spec, 'traceparent'), false);
});

test('negative: wrong demo, scenario, run identity, SKU and cancelled runs reject before browser effects', () => {
  for (const mutate of [
    run => { run.demoId = '02'; },
    run => { run.runId = 'caller-chosen-non-uuid'; },
    run => { run.spec.scenario = 'RETRY'; },
    run => { run.spec.assertion = 'ssr'; }
  ]) {
    const run = context(); mutate(run);
    assert.throws(() => demo01BrowserSpec(run, 'CONTOSO-OWNED-RUN'), code('D_DEMO01_INPUT'));
  }
  assert.throws(() => demo01BrowserSpec(context(), 'shared/key'), code('D_DEMO01_INPUT'));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => demo01BrowserSpec({ ...context(), signal: controller.signal }, 'CONTOSO-OWNED-RUN'),
    code('D_DEMO01_ABORTED'));
});

test('positive: supplied browser source/build closure is hash checked locally, not native evidence', async () => {
  const pins = await sourcePins();
  await verifyBrowserSources(pins);
  assert.equal(pins.length, 4);
});

test('negative: changed, omitted, repeated, outside-root or extra browser sources cannot substitute a driver', async () => {
  const pins = await sourcePins();
  for (const candidate of [
    pins.slice(1), [...pins.slice(0, -1), pins[0]],
    pins.map((pin, index) => index ? pin : { ...pin, sha256: 'e'.repeat(64) }),
    pins.map((pin, index) => index ? pin : { ...pin, path: '..\\outside.mjs' }),
    pins.map((pin, index) => index ? pin : { ...pin, path: 'tools\\verification\\demo.mjs' }),
    pins.map((pin, index) => index ? pin : { ...pin, execute: () => undefined })
  ]) await assert.rejects(verifyBrowserSources(candidate), code('D_DEMO01_BROWSER_SOURCE'));
});

test('positive: fixed supplied production driver executes through a controlled Page dependency without browser/network/native execution', async () => {
  const { run, evidence } = fixture();
  const portalOrigin = 'https://portal.contoso.invalid';
  const apiClientId = randomUUID();
  const config = {
    schemaVersion: 1, executionMode: 'live', environment: 'poc', surface: 'storefront-spa',
    deploymentStamp: 'controlled-dependency-not-deployed',
    api: { origin: apiOrigin, basePath: '/contoso/v1' },
    identity: {
      tenantId: randomUUID(), spaClientId: randomUUID(), apiClientId, apiAudience: apiClientId,
      scopes: [`api://${apiClientId}/Orders.Invoke`],
      spaRedirectUri: `${portalOrigin}/storefront/auth/redirect.html`,
      postLogoutRedirectUri: `${portalOrigin}/storefront/`
    },
    portal: { origin: portalOrigin, entryPath: '/portal/', authProfile: 'workload-only', enabled: true },
    telemetry: {
      connectionString: `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://centralus-0.in.applicationinsights.azure.com/`,
      roleName: 'contoso-storefront-spa', tracingMode: 'W3C_TRACE', samplingPercentage: 100,
      approvedCorrelationOrigins: [apiOrigin], excludedCorrelationHosts: ['login.microsoftonline.com']
    },
    certification: { enabled: true, startsAtUtc: new Date(Date.now() - 60000).toISOString(),
      endsAtUtc: new Date(Date.now() + 600000).toISOString(), windowId: run.runId },
    demos: { controllerVersion: 1, enabled: true, allowedDemoIds: [1] }
  };
  const events = new Map(), calls = [];
  let prepared;
  const controller = {
    ready: Promise.resolve(),
    prepare(input) { prepared = input; calls.push('prepare'); return 1; },
    browserContextIdentity: () => evidence.browserContexts[0],
    result: id => id === run.runId ? {
      schemaVersion: 1, executionMode: 'live', runId: run.runId, invocationVersion: 1,
      demoId: 1, driverKind: 'browser-spa', outcome: 'staged',
      backend: { id: run.runId, businessInvocationId: evidence.businessInvocationId, state: 'DURABLE_STAGED' }
    } : undefined,
    async flushTelemetry() { calls.push('flush'); },
    dependencyIdentities: () => evidence.dependencies,
    runtimeState: () => ({
      schemaVersion: 1, executionMode: 'live', service: 'contoso-storefront-spa', sdkVersion: '3.4.5',
      providerActive: true, samplingPercentage: 100, windowId: run.runId,
      expiresAtUtc: config.certification.endsAtUtc, trafficState: 'accepting', inFlight: 0,
      certification: 'NOT_CERTIFIED'
    })
  };
  const request = {
    url: () => `${apiOrigin}/contoso/v1/orders`,
    method: () => 'POST', resourceType: () => 'fetch',
    headerValue: async name => name === 'traceparent' ? evidence.observations[0].traceparent : null
  };
  const page = {
    async evaluate(operation, argument) {
      const previousWindow = globalThis.window, previousDocument = globalThis.document;
      globalThis.window = { contosoDemos: controller };
      globalThis.document = { getElementById: () => ({ textContent: JSON.stringify(config) }) };
      try { return await operation(argument); }
      finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
      }
    },
    on(name, operation) { events.set(name, operation); },
    off(name) { events.delete(name); },
    getByTestId(name) {
      return { async click() {
        calls.push(name);
        events.get('request')(request);
        events.get('response')({
          request: () => request, status: () => 202,
          headerValue: async name => name === 'x-business-invocation-id' ? evidence.businessInvocationId : null
        });
      } };
    },
    async waitForFunction(operation, argument) { assert.equal(await page.evaluate(operation, argument), true); },
    context: () => ({ browser: () => ({ version: () => 'controlled-dependency-not-chromium' }) })
  };
  const result = await driveDemo01Page(page, { context: run, sku: 'CONTOSO-OWNED-RUN',
    apiOrigin, browserSources: await sourcePins() });
  assert.deepEqual(prepared, demo01BrowserSpec(run, 'CONTOSO-OWNED-RUN'));
  assert.deepEqual(calls, ['prepare', 'contoso-run-demo', 'flush']);
  assert.equal(result.backendId, run.runId);
  assert.equal(result.businessInvocationId, evidence.businessInvocationId);
  assert.equal(result.observations[0].path, '/contoso/v1/orders');
  assert.equal(result.dependencies[0].spanId, evidence.dependencies[0].spanId);
  assert.equal(events.size, 0);
  assert.equal(Object.hasOwn(result, 'trafficLedger'), false);
  assert.equal(Object.hasOwn(result, 'observationOrigin'), false);
});

test('negative: unavailable browser target/run lease/admission is refused before the supplied action driver is called', async () => {
  const pins = await sourcePins(), run = context();
  const readiness = {
    executionMode: 'live', environment: 'poc', surface: 'storefront-spa',
    api: { origin: apiOrigin, basePath: '/contoso/v1' }, allowed: true,
    certification: { enabled: true, startsAtUtc: new Date(Date.now() - 60000).toISOString(),
      endsAtUtc: new Date(Date.now() + 600000).toISOString(), windowId: run.runId },
    runtime: { executionMode: 'live', service: 'contoso-storefront-spa', sdkVersion: '3.4.5',
      providerActive: true, samplingPercentage: 100, windowId: run.runId, trafficState: 'accepting', inFlight: 0 }
  };
  readiness.runtime.expiresAtUtc = readiness.certification.endsAtUtc;
  const changes = [
    value => { value.api.origin = 'https://other.contoso.invalid'; },
    value => { value.executionMode = 'fixture'; },
    value => { value.allowed = false; },
    value => { value.certification.windowId = randomUUID(); },
    value => { value.certification.endsAtUtc = new Date(Date.now() - 1).toISOString(); },
    value => { value.certification.startsAtUtc = new Date(Date.now() + 1000).toISOString(); },
    value => { value.certification.startsAtUtc = new Date(Date.now() - 7200000).toISOString(); },
    value => { value.runtime.providerActive = false; },
    value => { value.runtime.samplingPercentage = 10; },
    value => { value.runtime.windowId = randomUUID(); },
    value => { value.runtime.trafficState = 'quiesced'; },
    value => { value.runtime.inFlight = 1; }
  ];
  for (const change of changes) {
    const observed = structuredClone(readiness); change(observed);
    let evaluations = 0;
    const page = { async evaluate() { evaluations++; return observed; } };
    await assert.rejects(driveDemo01Page(page, { context: run, sku: 'CONTOSO-OWNED-RUN',
      apiOrigin, browserSources: pins }), code('D_DEMO01_BROWSER_READY'));
    assert.equal(evaluations, 1);
  }
});

test('positive: controlled browser observation validation preserves original IDs and is not downstream/native acceptance', () => {
  const { evidence, spec } = fixture();
  const result = validateDemo01BrowserObservation(evidence, spec, apiOrigin);
  assert.equal(result, evidence);
  assert.equal(result.outcome, 'staged');
  for (const field of ['expectation', 'trafficLedger', 'nativeFacts', 'observationOrigin']) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});

test('negative: fixture/local/stale/rejected browser output never becomes a native Demo 01 execution', () => {
  for (const change of [
    { executionMode: 'fixture' }, { executionMode: 'local' }, { evidenceKind: 'fixture' },
    { runId: randomUUID() }, { demoId: 2 }, { invocationVersion: 0 }, { sdkVersion: 'other' },
    { outcome: 'rejected' }, { backendId: randomUUID() }, { businessInvocationId: 'not-observed' }, { dependencies: [] },
    { browserContexts: [] }, { driverKind: 'browser-ssr' }, { authenticatedPeerVerified: true }
  ]) {
    const { evidence, spec } = fixture();
    assert.throws(() => validateDemo01BrowserObservation({ ...evidence, ...change }, spec, apiOrigin),
      code('D_DEMO01_BROWSER_OBSERVATION'));
  }
});

test('negative: obsolete demo-runs route, alternate origin, extra request, redaction and missing native response reject', () => {
  for (const change of [
    { path: '/contoso/v1/demo-runs' }, { origin: 'https://other.contoso.invalid' },
    { method: 'GET' }, { contextRedacted: true }, { status: 500 }, { status: undefined },
    { businessInvocationId: randomUUID() }, { traceparent: 'invalid' },
    { tracestate: 'other=value' }, { resourceType: 'document' }, { Authorization: 'must-not-be-copied' }
  ]) {
    const { evidence, spec } = fixture();
    evidence.observations[0] = { ...evidence.observations[0], ...change };
    assert.throws(() => validateDemo01BrowserObservation(evidence, spec, apiOrigin),
      code('D_DEMO01_BROWSER_WIRE'));
  }
  const { evidence, spec } = fixture();
  evidence.observations.push({ ...evidence.observations[0] });
  assert.throws(() => validateDemo01BrowserObservation(evidence, spec, apiOrigin), code('D_DEMO01_BROWSER_WIRE'));
});

test('negative: unsampled wire is rejected without changing its flags', () => {
  const { evidence, spec } = fixture();
  evidence.observations[0].traceparent = evidence.observations[0].traceparent.slice(0, -2) + '00';
  const original = evidence.observations[0].traceparent;
  assert.throws(() => validateDemo01BrowserObservation(evidence, spec, apiOrigin), code('D_DEMO01_BROWSER_SAMPLING'));
  assert.equal(evidence.observations[0].traceparent, original);
});

test('negative: SDK dependencies must join the exact run/version/wire trace and span without duplicates or backfill', () => {
  for (const change of [
    { runId: randomUUID() }, { invocationVersion: 2 }, { traceId: 'c'.repeat(32) },
    { spanId: 'd'.repeat(16) }, { dependencyId: '' }, { businessInvocationId: randomUUID() },
    { observed: true }
  ]) {
    const { evidence, spec } = fixture();
    evidence.dependencies[0] = { ...evidence.dependencies[0], ...change };
    assert.throws(() => validateDemo01BrowserObservation(evidence, spec, apiOrigin),
      code('D_DEMO01_BROWSER_IDENTITY'));
  }
  const { evidence, spec } = fixture();
  evidence.dependencies.push({ ...evidence.dependencies[0] });
  assert.throws(() => validateDemo01BrowserObservation(evidence, spec, apiOrigin), code('D_DEMO01_BROWSER_IDENTITY'));
});

test('negative: browser contexts remain original valid contexts and are never invented parent spans', () => {
  for (const change of [
    { identityKind: 'span' }, { pageInstanceId: 'invalid' }, { traceId: '0'.repeat(32) },
    { contextSpanId: '0'.repeat(16) }, { observedAtUtc: 'invalid' },
    { observedAtUtc: new Date(Date.now() + 60000).toISOString() }, { spanId: 'd'.repeat(16) }
  ]) {
    const { evidence, spec } = fixture();
    evidence.browserContexts[0] = { ...evidence.browserContexts[0], ...change };
    assert.throws(() => validateDemo01BrowserObservation(evidence, spec, apiOrigin),
      code('D_DEMO01_BROWSER_CONTEXT'));
  }
});

test('negative: browser target input rejects noncanonical, credential-bearing and non-HTTPS targets', () => {
  for (const origin of ['http://api.contoso.invalid', `${apiOrigin}/`, `${apiOrigin}?token=value`,
    'https://user:credential@api.contoso.invalid', 'not-an-origin']) {
    const { evidence, spec } = fixture();
    assert.throws(() => validateDemo01BrowserObservation(evidence, spec, origin), code('D_DEMO01_BROWSER_TARGET'));
  }
});

test('positive: supplied browser controller stop/drain/flush operations are invoked, not callback PASS receipts', async () => {
  const calls = [];
  let state = { trafficState: 'accepting', inFlight: 1 };
  const previous = globalThis.window;
  globalThis.window = { contosoDemos: {
    stopTraffic() { calls.push('stop'); state.trafficState = 'quiesced'; },
    async drain() { calls.push('drain'); state.inFlight = 0; },
    async flushTelemetry() { calls.push('flush'); },
    runtimeState() { return { ...state }; }
  } };
  try {
    const page = { evaluate: operation => operation() };
    const stopped = await stopDemo01Page(page);
    assert.equal(stopped.inFlight, 1);
    const drained = await drainDemo01Page(page);
    assert.equal(drained.inFlight, 0);
    assert.deepEqual(calls, ['stop', 'stop', 'drain', 'flush']);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('negative: absent controller, continued admission or remaining in-flight browser work cannot acknowledge cleanup', async () => {
  const previous = globalThis.window;
  const page = { evaluate: operation => operation() };
  try {
    globalThis.window = {};
    await assert.rejects(stopDemo01Page(page), code('D_DEMO01_BROWSER_STOP'));
    globalThis.window.contosoDemos = {
      stopTraffic() {}, async drain() {}, async flushTelemetry() {},
      runtimeState: () => ({ trafficState: 'accepting', inFlight: 0 })
    };
    await assert.rejects(drainDemo01Page(page), code('D_DEMO01_BROWSER_STOP'));
    globalThis.window.contosoDemos.runtimeState = () => ({ trafficState: 'quiesced', inFlight: 1 });
    await assert.rejects(drainDemo01Page(page), code('D_DEMO01_BROWSER_DRAIN'));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

function graphCapture() {
  const fixture = rawFixture();
  const names = ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppEvents', 'AppPageViews'];
  return {
    rawTables: fixture.tables.filter(table => names.includes(table.name)),
    scanReceipt: {
      ...fixture.receipt, tableInventoryComplete: false,
      tables: fixture.receipt.tables.filter(table => names.includes(table.name))
    }
  };
}

test('positive: concrete privacy operation runs the real original-column scanner and cannot certify a fixture', () => {
  const originalCapture = graphCapture();
  const input = { originalCapture, privacyDisposition: { result: 'FAIL' } };
  const before = JSON.stringify(input);
  const privacy = runtime.scanDemo01Capture(input);
  assert.equal(privacy.result, 'PASS');
  assert.equal(privacy.scannedAllColumns, true);
  assert.equal(privacy.scannedRawRecords, 1);
  assert.equal(privacy.tablesScanned.length, 6);
  assert.equal(privacy.assessmentScope, 'graph-intake');
  assert.equal(privacy.sourceAcceptanceIsCertification, false);
  assert.equal(privacy.globalTelemetrySafetyVerified, false);
  assert.equal(privacy.gateEligible, false);
  assert.equal(JSON.stringify(input), before);
});

test('negative: original unsafe or unknown columns reject despite a caller PASS and benign replacement projections', () => {
  const secret = fakeJwt();
  const originalCapture = graphCapture();
  const requests = originalCapture.rawTables.find(table => table.name === 'AppRequests');
  requests.columns.push({ name: 'UnknownRawColumn', type: 'dynamic' });
  requests.rows[0].push({ nested: secret });
  const input = { ...graphCapture(), originalCapture, privacyDisposition: { result: 'PASS', scannedAllColumns: true } };
  assert.throws(() => runtime.scanDemo01Capture(input), error =>
    error.code === 'E_PRIVACY' && !error.message.includes(secret));
});

test('negative: missing original tables, lost pagination and unscanned tables cannot be replaced with receipt flags', () => {
  assert.throws(() => runtime.scanDemo01Capture({ privacyDisposition: { result: 'PASS' } }), code('E_PRIVACY'));
  for (const mutate of [
    capture => { capture.rawTables.pop(); },
    capture => { capture.scanReceipt.paginationComplete = false; },
    capture => { capture.scanReceipt.rowCount = 100; },
    capture => { capture.scanReceipt.warnings.push('incomplete'); }
  ]) {
    const capture = graphCapture(); mutate(capture);
    assert.throws(() => runtime.scanDemo01Capture(capture), code('E_PRIVACY'));
  }
});

test('positive: source construction binds supplied modules and reports every missing production operation explicitly', async () => {
  const report = await runtime.inspectDemo01Construction();
  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.runnableDemoAdapter, false);
  assert.equal(report.nativeExecution, 'NOT RUN');
  assert.equal(report.sourceAcceptanceIsCertification, false);
  assert.equal(report.certificationStatus, 'NOT CERTIFIED');
  assert.equal(report.availableOperations.browser.export, 'driveContosoBrowser');
  assert.equal(report.availableOperations.collector.export, 'createDemo01Collector');
  assert.deepEqual(report.availableOperations.preparation.argv, ['--approved-operator-stdio']);
  assert.match(report.availableOperations.preparation.restoreCapturedRun, /^UNSUPPORTED:/);
  assert.match(report.availableOperations.preparation.invocationStatus, /^NOT RUN:/);
  assert.deepEqual(report.blockingInterfaces.map(item => item.id), [
    'independent-native-execution', 'native-query-enrollment', 'native-sampling-control',
    'reviewed-preparation-process', 'durable-owned-recovery'
  ]);
  assert.equal(report.nativeQueryObserverCount, 0);
  assert.equal(report.sources.find(source => source.path === BROWSER_SOURCE_PATHS[0]).sha256,
    'ed6616eed2ef9ab8e428837f4d978d8985e70239f5968f7b3651b4271d76fc62');
  assert.equal(report.sources.find(source => source.path === BROWSER_SOURCE_PATHS[2]).sha256,
    '4c756dc29696018e00d30df22129f3db1daef6cce982d48f4b755e41b949e944');
  const bindings = new Map(report.authorFrozenSources.map(source => [source.path, source.sha256]));
  const currentBindings = new Map(report.prospectiveSourceBinding.components.map(source => [source.path, source.sha256]));
  for (const [file, hash] of [
    ['services\\inventory-data\\src\\main\\java\\com\\contoso\\inventory\\data\\InventoryFixtureRun.java',
      '829fa86e661ffaca01dafcb13528539566312322a3380f52f3f32ba8244a2041'],
    ['services\\inventory-data\\src\\main\\java\\com\\contoso\\inventory\\data\\InventoryFixtureStdio.java',
      'bf28812f7910c3d3ceae27b6ad554bb9ff2bae209c1b6612e51a3237628f4389'],
    ['services\\inventory-data\\tools\\InventoryFixtureContract.md',
      'd65bec32b8ad03024a05ce87fc8a89d79aaa1f9d343322e65269249bf972d626']
  ]) {
    assert.equal(bindings.get(file), hash);
    assert.equal(report.sources.find(source => source.path === file).sha256, currentBindings.get(file));
  }
  assert.match(report.availableOperations.preparation.scope, /same-handle retry revalidates its private checkpoint/);
  assert.ok(Object.isFrozen(report.blockingInterfaces));
  assert.throws(() => { report.runnableDemoAdapter = true; }, TypeError);
});

test('positive: prospective current-source binding preserves historical pins without inheriting their approval', async () => {
  const report = await runtime.inspectDemo01Construction();
  const binding = report.prospectiveSourceBinding;
  assert.equal(binding.schema, 'contoso.demo01-construction-source-binding.v2');
  assert.equal(binding.scope, 'PROSPECTIVE_CURRENT_SOURCE_CONSTRUCTION_ONLY');
  assert.equal(binding.sha256, 'a064083844ad91ad01a47f9ed3dcd52ad6afcd204aa2fd911fb67a7aa07bb794');
  assert.equal(sha256(await readBoundFile(binding.path)), binding.sha256);
  assert.equal(report.authorFrozenSourcesDisposition, 'HISTORICAL_ONLY_NOT_CURRENT_APPROVAL');
  const historical = new Map(report.authorFrozenSources.map(source => [source.path, source.sha256]));
  const current = new Map(binding.components.map(source => [source.path, source.sha256]));
  assert.equal(historical.get('web\\storefront-spa\\src\\app.ts'), '2f4eee79496b3f0f089f78bb48ef4986e2b33389b13d9c145affec2f604185ac');
  assert.equal(current.get('web\\storefront-spa\\src\\app.ts'), 'e5895fc497ea8157bcdcfd1cedbde1d0c3bb608acc6f54263aadc0e126d62456');
  assert.equal(historical.get('services\\inventory-data\\tools\\InventoryFixtureContract.md'),
    'd65bec32b8ad03024a05ce87fc8a89d79aaa1f9d343322e65269249bf972d626');
  assert.equal(current.get('services\\inventory-data\\tools\\InventoryFixtureContract.md'),
    '8976f2b6e21b800d34b782ec0f599c9c13062b35f122000280560762a7d0c5ca');
  assert.equal(binding.components.length, historical.size);
  for (const source of binding.components) {
    assert.equal(report.sources.find(value => value.path === source.path).sha256, source.sha256);
  }
  assert.equal(binding.sourceAcceptanceIsCertification, false);
  assert.equal(binding.runnableDemoAdapter, false);
  assert.equal(binding.nativeExecution, 'NOT RUN');
  assert.ok(Object.isFrozen(binding.components));
});

test('negative: real isolated component, loaded-module and privacy-policy drift fail closed after import', async () => {
  await withConstructionFixture(async ({ copied, directory, files }) => {
    assert.equal((await copied.inspectDemo01Construction()).result, 'BLOCKED');
    for (const file of [
      'web\\storefront-spa\\src\\app.ts',
      'services\\inventory-data\\tools\\InventoryFixtureContract.md',
      'tools\\observability\\demo01-collector.mjs',
      'tools\\verification\\adapters\\demo01-runtime.mjs',
      'tools\\verification\\adapters\\demo01-browser.mjs',
      'tools\\security\\telemetry.mjs',
      'tools\\security\\telemetry-policy.v1.json',
      'tools\\verification\\adapters\\demo01-source-binding.v2.json'
    ]) {
      const original = files.get(file);
      await writeFile(path.join(directory, file), Buffer.concat([original, Buffer.from('\n ')]));
      try {
        await assert.rejects(copied.inspectDemo01Construction(), code('E_SOURCE_DRIFT'), file);
        await assert.rejects(copied.demo01ConstructionMain(['--check']), code('E_SOURCE_DRIFT'), file);
      } finally { await writeFile(path.join(directory, file), original); }
      assert.equal((await copied.inspectDemo01Construction()).result, 'BLOCKED');
    }
  });
});

test('negative: rewriting a prospective JSON pin cannot approve changed bytes or a fresh module import', async () => {
  await withConstructionFixture(async ({ copied, directory, files, moduleUrl }) => {
    const app = 'web\\storefront-spa\\src\\app.ts';
    const binding = 'tools\\verification\\adapters\\demo01-source-binding.v2.json';
    const changed = Buffer.concat([files.get(app), Buffer.from('\n// checker-only changed source\n')]);
    const forged = JSON.parse(files.get(binding));
    forged.components.find(source => source.path === app).sha256 = sha256(changed);
    await writeFile(path.join(directory, app), changed);
    await writeFile(path.join(directory, binding), JSON.stringify(forged));
    await assert.rejects(copied.inspectDemo01Construction(), code('E_SOURCE_DRIFT'));
    await assert.rejects(import(`${moduleUrl}?unreviewed=${randomUUID()}`), code('E_SOURCE_DRIFT'));
  });
});

test('negative: incomplete construction does not advertise a v1 adapter or a throw-only createAdapter stub', async () => {
  assert.equal(Object.hasOwn(runtime, 'createAdapter'), false);
  assert.equal(Object.hasOwn(runtime, 'adapter'), false);
  const result = await runDemo({ demoId: '01', adapter: runtime, recordEvidence: false });
  assert.equal(result.result, 'FAIL');
  assert.equal(result.failure.code, 'D_MISSING_ADAPTER');
  assert.equal(result.reset.result, 'NOT RUN');
  assert.equal(result.sourceAcceptanceIsCertification, false);
});

test('negative: the construction entrypoint does not permit execute/native/caller-module options', async () => {
  for (const args of [[], ['--execute'], ['--check', '--native'], ['--adapter', 'caller.mjs']]) {
    await assert.rejects(runtime.demo01ConstructionMain(args), code('D_ARGUMENT'));
  }
  let reads = 0;
  const caller = { get components() { reads++; return []; }, approved: true };
  await assert.rejects(runtime.inspectDemo01Construction(caller), code('D_ARGUMENT'));
  assert.equal(reads, 0);
});

test('positive: the construction entrypoint performs only side-effect-free inspection', async () => {
  const result = await runtime.demo01ConstructionMain(['--check']);
  assert.equal(result.result, 'BLOCKED');
  assert.equal(result.nativeExecution, 'NOT RUN');
});
