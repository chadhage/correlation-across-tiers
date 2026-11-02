import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bindDemo01Capture, createDemo01Collector, DEMO01_COLLECTOR_SOURCE_SHA256 } from '../../tools/observability/demo01-collector.mjs';
import { RAW_TABLES, collectRawTelemetry, requireNativeCaptureIdentity } from '../../tools/observability/raw-query.mjs';
import { loadRootMap } from '../../tools/observability/kql.mjs';
import { ownedConfigurationHash, sha256 } from '../../tools/observability/telemetry-contract.mjs';
import { scanPrivacy } from '../../tools/security/telemetry.mjs';
import { verifyGraphIntake, assertVerifiedScenario } from '../../tools/verification/pipeline.mjs';
import { parseTraceparent } from '../../tools/protocol.mjs';

const resourceId = '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-local-check/providers/Microsoft.Insights/components/contoso-local-check';
const parameters = { workspaceId: '12345678-1234-4234-8234-123456789abc', resourceId,
  fromUtc: '2026-10-31T12:00:00.000Z', toUtc: '2026-10-31T12:02:00.000Z',
  ingestionWatermarkUtc: '2026-10-31T12:04:00.000Z', pageSize: 2 };
const result = (columns, rows) => ({ tables: [{ name: 'PrimaryResult',
  columns: columns.map(([name, type]) => ({ name, type })), rows }] });

async function fixture({ omitBoundary = null, wrongParent = false, unsafeColumn = false } = {}) {
  const { map } = await loadRootMap();
  const businessInvocationId = randomUUID();
  const proofArtifacts = [];
  const proof = (value, kind = 'native-runtime') => {
    const sha256 = ownedConfigurationHash(value);
    proofArtifacts.push({ kind, value, sha256, sourceKind: 'fixture-check' });
    return sha256;
  };
  const source = Object.fromEntries(RAW_TABLES.map(table => [table, []]));
  const ledgerSpans = [];
  const contexts = [];
  const time = ['2026-10-31T12:00:01.000Z', '2026-10-31T12:00:50.000Z', '2026-10-31T12:01:30.000Z'];
  const cohorts = time.map((timeUtc, index) => {
    const traceId = randomBytes(16).toString('hex');
    const ids = Object.fromEntries(map.coreSynchronousBoundaries.map(boundary => [boundary, randomBytes(8).toString('hex')]));
    const browserContext = { schemaVersion: 1, sdkVersion: '3.4.5', identityKind: 'sdk-browser-context-not-span',
      pageInstanceId: randomUUID(), traceId, contextSpanId: randomBytes(8).toString('hex'), observedAtUtc: timeUtc };
    contexts.push({ traceId, contextSpanId: browserContext.contextSpanId, identityKind: browserContext.identityKind,
      roleName: 'contoso-storefront-spa', observed: true, evidenceSha256: proof(browserContext) });
    for (const boundaryId of map.coreSynchronousBoundaries) {
      const boundary = map.spans.find(item => item.id === boundaryId);
      const parentBoundary = map.edges.find(edge => edge.to === boundaryId && edge.type === 'parent' &&
        ['spa', 'sync'].includes(edge.path))?.from;
      const parent = parentBoundary ? ids[parentBoundary] : browserContext.contextSpanId;
      const emitted = { traceId, spanId: ids[boundaryId], boundaryId, runtimeInstanceId: `fixture-owner-${index}` };
      ledgerSpans.push({ traceId, spanId: ids[boundaryId], boundaryId, observed: true, evidenceSha256: proof(emitted) });
      if (index === 1 && boundaryId === omitBoundary) continue;
      const table = boundary.semanticKind === 'SERVER' ? 'AppRequests' : 'AppDependencies';
      source[table].push({ TimeGenerated: timeUtc, OperationId: traceId, Id: ids[boundaryId],
        ParentId: wrongParent && index === 1 && boundaryId === 'inventory.request' ? ids['orders.request'] : parent,
        AppRoleName: boundary.roleName, Properties: { 'contoso.span.kind': boundary.semanticKind,
          'business.invocation_id': businessInvocationId }, _ResourceId: resourceId,
        _ItemId: `fixture-physical-${table}-${index}-${source[table].length}`, ItemCount: 1 });
    }
    source.AppTraces.push({ TimeGenerated: timeUtc, OperationId: traceId, ParentId: ids['orders.request'],
      AppRoleName: 'contoso-orders-api', Properties: { 'business.invocation_id': businessInvocationId },
      _ResourceId: resourceId, _ItemId: `fixture-physical-log-${index}`, ItemCount: 1 });
    return { traceId, ids, browserContext, timeUtc };
  });
  const canaries = ['before', 'after'].map((position, index) => {
    const cohort = cohorts[index === 0 ? 0 : 2];
    const value = { position, traceId: cohort.traceId, timeUtc: cohort.timeUtc,
      spans: ledgerSpans.filter(span => span.traceId === cohort.traceId) };
    return { ...value, observed: true, evidenceSha256: proof(value) };
  });
  const main = cohorts[1];
  const browserEvidence = { schemaVersion: 1, executionMode: 'fixture', evidenceKind: 'fixture', runId: randomUUID(),
    invocationVersion: 1, demoId: 1, sdkVersion: '3.4.5', browserVersion: 'fixture-only',
    driverKind: 'browser-spa', outcome: 'staged', businessInvocationId,
    observations: [{ method: 'POST', origin: 'https://contoso-fixture.invalid', path: '/api/orders',
      resourceType: 'fetch', status: 201, traceparent: `00-${main.traceId}-${main.ids['storefront.http']}-01`,
      businessInvocationId }],
    dependencies: [{ traceId: main.traceId, spanId: main.ids['storefront.http'], dependencyId: main.ids['storefront.http'],
      businessInvocationId }], browserContexts: [main.browserContext] };
  browserEvidence.dependencies[0].runId = browserEvidence.runId;
  browserEvidence.dependencies[0].invocationVersion = browserEvidence.invocationVersion;
  proof(browserEvidence, 'native-wire');
  const wire = { type: 'gateway-wire', inboundTraceparent: browserEvidence.observations[0].traceparent,
    outboundTraceparent: `00-${main.traceId}-${main.ids['gateway.backend']}-01` };
  const trafficLedger = { schema: 'contoso.native-traffic-ledger.v1', observationOrigin: 'native-runtime',
    complete: true, dropped: 0, spans: ledgerSpans, canaries,
    workStartedAtUtc: '2026-10-31T12:00:30.000Z', workCompletedAtUtc: '2026-10-31T12:01:00.000Z' };
  const execution = { businessInvocationId, fromUtc: parameters.fromUtc, toUtc: parameters.toUtc,
    observationOrigin: 'native-runtime', nativeFacts: [{ ...wire, observed: true, evidenceSha256: proof(wire, 'native-wire') }],
    trafficLedger: { ...trafficLedger, evidenceSha256: proof(trafficLedger) },
    expectation: { businessInvocationId, traceIds: cohorts.map(item => item.traceId), browserContexts: contexts,
      independentCohorts: cohorts.map(cohort => {
        const value = { traceId: cohort.traceId, reason: 'Explicit CPU fixture cohort, not native execution' };
        return { ...value, observed: true, evidenceSha256: proof(value) };
      }) } };
  const schemas = Object.fromEntries(RAW_TABLES.map(table => [table, [
    ['TimeGenerated', 'datetime'], ['OperationId', 'string'], ['ParentId', 'string'], ['AppRoleName', 'string'],
    ['Properties', 'dynamic'], ['_ResourceId', 'string'], ['_ItemId', 'string'], ['ItemCount', 'long'],
    ...(['AppRequests', 'AppDependencies', 'AppPageViews'].includes(table) ? [['Id', 'string']] : [])
  ]]));
  if (unsafeColumn) {
    schemas.AppRequests.push(['UnreviewedNativeColumn', 'string']);
    source.AppRequests[0].UnreviewedNativeColumn = 'fixture-original-unsafe-marker';
  }
  const executeQuery = async ({ table, phase, parameters: input, pageOrdinal }) => {
    if (phase === 'schema') return result([['ColumnName', 'string'], ['ColumnType', 'string']], schemas[table]);
    if (phase === 'count') return result([['SnapshotRows', 'long'], ['UnwatermarkedRows', 'long'],
      ['RowsBeyondWatermark', 'long'], ['TotalEventWindowRows', 'long'], ['MaxIngestedAtUtc', 'datetime']],
    [[source[table].length, 0, 0, source[table].length, source[table].length ? '2026-10-31T12:03:00.000Z' : null]]);
    if (phase === 'key-count') return result([['PhysicalKeys', 'long'], ['DuplicateRows', 'long'], ['EmptyKeys', 'long']],
      [[source[table].length, 0, 0]]);
    const columns = [...schemas[table], ['ContosoCollectorIngestedAt', 'datetime'], ['ContosoCollectorRowOrdinal', 'long']];
    const offset = pageOrdinal * input.pageSize;
    return result(columns, source[table].slice(offset, offset + input.pageSize).map((row, index) => columns.map(([name]) =>
      name === 'ContosoCollectorIngestedAt' ? '2026-10-31T12:03:00.000Z' :
        name === 'ContosoCollectorRowOrdinal' ? offset + index + 1 : row[name] ?? null)));
  };
  const rawCanaries = canaries.flatMap(canary => canary.spans.map(span => ({
    position: canary.position === 'before' ? 'pre' : 'post', traceId: span.traceId, spanId: span.spanId,
    table: map.spans.find(boundary => boundary.id === span.boundaryId).semanticKind === 'SERVER' ? 'AppRequests' : 'AppDependencies'
  })));
  const capture = await collectRawTelemetry({ ...parameters,
    canary: { trafficLedgerSha256: execution.trafficLedger.evidenceSha256, contexts: rawCanaries } }, { executeQuery, scanPrivacy });
  const observations = { mode: 'LocalValidate', execution, browserEvidence, proofArtifacts,
    settledRead: { firstAtUtc: '2026-10-31T12:04:30.000Z', lastAtUtc: '2026-10-31T12:05:00.000Z',
      firstRowsSha256: capture.receipt.rawRowsSha256, lastRowsSha256: capture.receipt.rawRowsSha256 } };
  return { capture, observations, map, main };
}

test('fixture construction binds actual carrier and raw row locators through existing six-table graph intake, never native qualification', async () => {
  const value = await fixture();
  const capture = await bindDemo01Capture(value.capture, value.observations);
  const parsed = parseTraceparent(value.observations.browserEvidence.observations[0].traceparent);
  assert.equal(parsed.parentId, value.main.ids['storefront.http']);
  assert.equal(parsed.spanId, undefined);
  assert.equal(capture.assignments.length, 24);
  assert.equal(capture.rawRows.length, 27);
  assert.equal(capture.receipt.executedQueries.length, 39);
  assert.equal(capture.receipt.tables.length, 6);
  assert.equal(capture.originalCapture, value.capture);
  for (const assignment of capture.assignments) {
    const raw = capture.rawRows[assignment.sourceLocator.rowOrdinal];
    assert.equal(raw.Id, assignment.spanId);
    assert.equal(raw.OperationId, assignment.traceId);
    assert.equal(raw.nativeTable, assignment.sourceLocator.nativeTable);
    assert.equal(ownedConfigurationHash(raw), assignment.evidenceSha256);
  }
  const capability = await verifyGraphIntake({ map: value.map,
    spec: { id: '01', assertion: 'sync', paths: ['spa', 'sync'], requiredBoundaries: value.map.coreSynchronousBoundaries },
    capture, execution: value.observations.execution, mode: 'LocalValidate' });
  const verified = assertVerifiedScenario(capability);
  assert.equal(verified.assertion.result, 'PASS');
  assert.equal(verified.originScope, 'CHECKER FIXTURE ONLY');
  assert.equal(verified.coverage.boundedFullPathEvidence, false);
  assert.equal(capture.collectorReceipt.nativeQualification, 'NOT RUN');
  assert.equal(capture.collectorReceipt.authenticatedPeerVerified, false);
  assert.equal(capture.collectorReceipt.independentProducerAuthorityVerified, false);
  assert.equal(capture.collectorReceipt.globalTelemetrySafetyVerified, false);
  assert.equal(capture.collectorReceipt.collectorSourceSha256, DEMO01_COLLECTOR_SOURCE_SHA256);
  assert.equal(capture.collectorReceipt.certificationEligible, false);
  assert.throws(() => requireNativeCaptureIdentity(capture.originalCapture), /CAPTURE_NATIVE_IDENTITY_REQUIRED/);
});

test('omitted emitted hop and wrong actual parent fail without repairing source IDs or parents', async () => {
  const missing = await fixture({ omitBoundary: 'orders.inventory' });
  await assert.rejects(bindDemo01Capture(missing.capture, missing.observations), /DEMO01_MISSING_OR_AMBIGUOUS_EMITTED_SPAN/);
  const wrong = await fixture({ wrongParent: true });
  await assert.rejects(bindDemo01Capture(wrong.capture, wrong.observations), /B_WRONG_EDGE/);
});

test('browser route, SDK run/version/context and Gateway carrier cannot be substituted from expectations', async () => {
  for (const mutation of [
    value => { value.observations.browserEvidence.observations[0].path = '/api/demo-runs'; },
    value => { value.observations.browserEvidence.dependencies[0].runId = randomUUID(); },
    value => { value.observations.browserEvidence.dependencies[0].invocationVersion++; },
    value => { value.observations.execution.nativeFacts[0].outboundTraceparent = `00-${value.main.traceId}-${randomBytes(8).toString('hex')}-01`; },
    value => { value.observations.browserEvidence.browserContexts = []; },
    value => { value.observations.execution.expectation.traceIds[0] = randomBytes(16).toString('hex'); }
  ]) {
    const value = await fixture();
    mutation(value);
    await assert.rejects(bindDemo01Capture(value.capture, value.observations));
  }
});

test('row-only ledgers, lost full-path canaries, duplicate physical spans and unstable settlement fail', async () => {
  for (const mutation of [
    value => { value.observations.proofArtifacts.forEach(artifact => {
      if (artifact.kind === 'native-runtime') artifact.kind = 'native-row';
    }); },
    value => { value.observations.execution.trafficLedger.canaries[0].spans.pop(); },
    value => { value.capture.rows.push(value.capture.rows[0]); },
    value => { value.observations.settledRead.lastRowsSha256 = 'a'.repeat(64); }
  ]) {
    const value = await fixture();
    mutation(value);
    await assert.rejects(bindDemo01Capture(value.capture, value.observations));
  }
});

test('actual original-column privacy rejects unsafe inputs and caller PASS cannot hide a projected-row injection', async () => {
  await assert.rejects(fixture({ unsafeColumn: true }), error =>
    error.code === 'CAPTURE_RAW_PRIVACY_DISPOSITION_FAILED' && !error.message.includes('fixture-original-unsafe-marker'));
  const value = await fixture();
  value.capture.rows[0].Properties = { ...value.capture.rows[0].Properties, Authorization: 'fixture-in-memory-private-marker' };
  await assert.rejects(bindDemo01Capture(value.capture, value.observations), error =>
    error.code === 'DEMO01_ORIGINAL_CORRESPONDENCE_FAILED' && !error.message.includes('fixture-in-memory-private-marker'));
});

test('fixtures, JSON clones, native labels, observer IDs and saved settlement cannot mint private source authority', async () => {
  const value = await fixture();
  await assert.rejects(bindDemo01Capture(value.capture, { ...value.observations, mode: 'BootstrapValidate' }),
    /DEMO01_FIXTURE_CANNOT_QUALIFY_NATIVE/);
  const claimed = structuredClone(value.capture);
  claimed.receipt.sourceKind = 'azure-monitor-logs';
  claimed.receipt.observerId = 'caller-approved';
  claimed.receipt.authenticatedPeerVerified = true;
  claimed.receipt.certificationEligible = true;
  claimed.verifiedQueryCapabilities = [{ verified: true, nativeResponseVerified: true, sourceOriginVerified: true }];
  await assert.rejects(bindDemo01Capture(claimed, value.observations), /CAPTURE_NATIVE_IDENTITY_REQUIRED/);
});

test('production constructor rejects query/privacy/authentication callback injection and accepts no caller settlement', async () => {
  const configuration = { observerId: 'caller-selector-only' };
  for (const field of ['executeQuery', 'scanPrivacy', 'verifyQueryExecutorReceipt', 'authenticatedPeerVerified', 'nativeAuthority']) {
    assert.throws(() => createDemo01Collector({ ...configuration, [field]: () => true }), /DEMO01_UNSUPPORTED_INPUT/);
  }
  const collector = createDemo01Collector(configuration);
  const value = await fixture();
  await assert.rejects(collector.collect({}, { ...value.observations }), /DEMO01_UNSUPPORTED_INPUT/);
  const { mode: ignoredMode, settledRead: ignoredSettlement, ...observations } = value.observations;
  await assert.rejects(collector.collect({ mode: 'LocalValidate' }, observations), /DEMO01_BROWSER_OBSERVATION_REQUIRED/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collector.collect({}, {}, { signal: controller.signal }), /CAPTURE_ABORTED/);
});

test('actual native verifier rejects an invented observer selector before any CLI query; no transport is injected or invoked', async () => {
  const value = await fixture();
  const path = fileURLToPath(new URL('../../tools/observability/raw-query.mjs', import.meta.url));
  const collector = createDemo01Collector({ workspaceId: parameters.workspaceId, resourceId,
    azureCliExecutable: path, azureCliExecutableSha256: sha256(await readFile(path)),
    allowAzureReads: true, readApprovalRef: 'CPU-only-registry-rejection-not-a-native-window',
    observerId: 'caller-selector-only' });
  const observations = { execution: value.observations.execution,
    browserEvidence: { ...value.observations.browserEvidence, executionMode: 'live', evidenceKind: 'live-observation-not-certified' },
    proofArtifacts: value.observations.proofArtifacts };
  const { workspaceId: ignoredWorkspace, resourceId: ignoredResource, ...scope } = parameters;
  await assert.rejects(collector.collect(scope, observations), /E_UNTRUSTED_OBSERVER/);
});

test('native construction snapshots query-window and observation inputs before asynchronous source checks', async () => {
  const value = await fixture();
  const path = fileURLToPath(new URL('../../tools/observability/raw-query.mjs', import.meta.url));
  const collector = createDemo01Collector({ workspaceId: parameters.workspaceId, resourceId,
    azureCliExecutable: path, azureCliExecutableSha256: sha256(await readFile(path)),
    allowAzureReads: true, readApprovalRef: 'CPU-only-source-rejection-not-a-native-window', observerId: 'caller-selector-only' });
  const { workspaceId: ignoredWorkspace, resourceId: ignoredResource, ...scope } = parameters;
  const observations = { execution: value.observations.execution,
    browserEvidence: { ...value.observations.browserEvidence, executionMode: 'live', evidenceKind: 'live-observation-not-certified' },
    proofArtifacts: value.observations.proofArtifacts };
  const pending = collector.collect(scope, observations);
  scope.fromUtc = scope.toUtc;
  observations.browserEvidence.executionMode = 'fixture';
  await assert.rejects(pending, /E_UNTRUSTED_OBSERVER/);
});
