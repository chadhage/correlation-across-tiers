import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { verifyGraphIntake, assertVerifiedScenario, requireVerifiedTrustRootBindings } from '../../tools/verification/pipeline.mjs';
import { projectRoot, nativeEvidenceHash, sha256 } from '../../tools/verification/files.mjs';
import { TRACE_TABLES } from '../../tools/verification/evidence.mjs';
import { assertAsyncEvidence } from '../../tools/messaging/async-honesty.mjs';

const map = JSON.parse(await readFile(path.join(projectRoot, 'contracts', 'expected-boundary-map.v1.json')));
const bid = '12345678-1234-4234-8234-123456789012';
const message = index => `12345678-1234-4234-8234-${String(index).padStart(12, '0')}`;
const scope = { workspaceId: '12345678-1234-4234-8234-123456789012',
  resourceId: '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-fixture/providers/Microsoft.Insights/components/contoso-fixture' };
const span = index => index.toString(16).padStart(16, '0');

function fixture() {
  const rawRows = [];
  const bindings = [];
  const proofArtifacts = [];
  function proof(value, kind = 'native-runtime') {
    const digest = nativeEvidenceHash(value);
    proofArtifacts.push({ kind, sourceKind: 'fixture-check', value, sha256: digest });
    return digest;
  }
  const time = index => ['2026-10-31T12:00:01.000Z', '2026-10-31T12:00:50.000Z', '2026-10-31T12:01:30.000Z'][index];
  const cohorts = ['a', 'b', 'c'].map((letter, index) => {
    const traceId = letter.repeat(32);
    const producerId = rawRows.length + 1;
    const producer = {
      TimeGenerated: time(index), OperationId: traceId, Id: span(producerId), ParentId: null,
      AppRoleName: 'contoso-orders-api', Properties: {
        'business.invocation_id': bid, 'contoso.span.kind': 'PRODUCER', 'contoso.message.id': message(index + 1)
      }, DurationMs: 1, ItemCount: 1, _ResourceId: scope.resourceId
    };
    function add(row, table, boundaryId) {
      const native = { ...row, nativeTable: table, ingestedAtUtc: '2026-10-31T12:03:00.000Z' };
      const rowOrdinal = rawRows.length;
      rawRows.push(native);
      bindings.push({ traceId, spanId: row.Id, boundaryId, observed: true,
        evidenceSha256: proof(native, 'native-row'),
        sourceLocator: { captureId: 'fixture-pipeline', nativeTable: table, rowOrdinal } });
    }
    add(producer, 'AppDependencies', 'orders.servicebus.send');
    for (let attempt = 1; attempt <= (index === 1 ? 2 : 1); attempt++) add({
      ...producer, Id: span(rawRows.length + 1), ParentId: producer.Id,
      AppRoleName: 'contoso-fulfillment-worker', Properties: {
        ...producer.Properties, 'contoso.span.kind': 'CONSUMER', 'contoso.process.attempt': String(attempt),
        'contoso.outcome': index === 1 && attempt === 1 ? 'TRANSIENT_FAILURE' : 'SUCCESS'
      }
    }, 'AppRequests', 'fulfillment.process');
    return { traceId, producerId: producer.Id };
  });
  const columns = ['TimeGenerated', 'OperationId', 'Id', 'ParentId', 'AppRoleName', 'Properties', 'DurationMs', 'ItemCount', '_ResourceId']
    .map(name => ({ name, type: name === 'Properties' ? 'dynamic' : name === 'DurationMs' ? 'real' : name === 'ItemCount' ? 'int' : name === 'TimeGenerated' ? 'datetime' : 'string' }));
  const rawTables = TRACE_TABLES.map(name => {
    const tableColumns = ['AppRequests', 'AppDependencies', 'AppPageViews'].includes(name)
      ? columns : columns.filter(column => !['Id', 'DurationMs'].includes(column.name));
    return { name, columns: tableColumns,
      rows: rawRows.filter(row => row.nativeTable === name).map(row => tableColumns.map(column => row[column.name])) };
  });
  const tables = rawTables.map(table => ({ name: table.name, count: table.rows.length, complete: true, warnings: [],
    pages: [{ ordinal: 0, rowCount: table.rows.length,
      sha256: nativeEvidenceHash(rawRows.filter(row => row.nativeTable === table.name)) }] }));
  const queryText = '// Fixture tests checker machinery only; never requested from Azure.';
  const receipt = {
    schema: 'contoso.raw-query-capture.v1', sourceKind: 'fixture-check', captureId: 'fixture-pipeline', scope,
    fromUtc: '2026-10-31T12:00:00.000Z', toUtc: '2026-10-31T12:02:00.000Z',
    capturedAtUtc: '2026-10-31T12:06:00.000Z', ingestionWatermarkUtc: '2026-10-31T12:04:00.000Z',
    querySha256: sha256(queryText), rowCount: rawRows.length, complete: true, paginationComplete: true,
    tableInventoryComplete: false, warnings: [], tables,
    settledRead: { firstAtUtc: '2026-10-31T12:04:30.000Z', lastAtUtc: '2026-10-31T12:05:00.000Z',
      firstRowsSha256: nativeEvidenceHash(rawRows), lastRowsSha256: nativeEvidenceHash(rawRows) }
  };
  const expected = { traceId: cohorts[1].traceId, parentSpanId: cohorts[1].producerId,
    expectedAttempts: 2, terminalOutcome: 'SUCCESS', businessInvocationId: bid, messageId: message(2) };
  const factValue = { type: 'retry-plan', injectedFailures: 1, successAfterFailures: true, expected };
  const fact = { ...factValue, evidenceSha256: proof(factValue), observed: true };
  const ledgerSpans = bindings.map(binding => ({
    traceId: binding.traceId, spanId: binding.spanId, boundaryId: binding.boundaryId,
    observed: true, evidenceSha256: binding.evidenceSha256
  }));
  const canaries = ['before', 'after'].map((position, index) => {
    const traceId = cohorts[index === 0 ? 0 : 2].traceId;
    const value = { position, traceId, timeUtc: index === 0 ? '2026-10-31T12:00:01.000Z' : '2026-10-31T12:01:30.000Z',
      spans: ledgerSpans.filter(item => item.traceId === traceId) };
    return { ...value, observed: true, evidenceSha256: proof(value) };
  });
  return {
    mode: 'LocalValidate', map,
    spec: { id: '06', assertion: 'retry', brief: ['8', '17'], criteria: ['Async honesty'],
      paths: ['servicebus'], requiredBoundaries: ['orders.servicebus.send', 'fulfillment.process'] },
    capture: { rawRows, rawTables, scanReceipt: receipt, receipt, queryText, assignments: bindings, proofArtifacts,
      rawPages: TRACE_TABLES.map(table => ({ table, ordinal: 0, rows: rawRows.filter(row => row.nativeTable === table) })) },
    execution: { businessInvocationId: bid, fromUtc: receipt.fromUtc, toUtc: receipt.toUtc, nativeFacts: [fact],
      expectation: { businessInvocationId: bid, traceIds: cohorts.map(item => item.traceId),
        independentCohorts: cohorts.map(item => ({ traceId: item.traceId, reason: 'Explicit fixture cohort, not an observed Azure root',
          evidenceSha256: proof(item), observed: true })) },
      trafficLedger: { schema: 'contoso.native-traffic-ledger.v1', observationOrigin: 'native-runtime',
        complete: true, dropped: 0, evidenceSha256: proof({ fixtureLedger: true }), spans: ledgerSpans, canaries,
        workStartedAtUtc: '2026-10-31T12:00:30.000Z', workCompletedAtUtc: '2026-10-31T12:01:00.000Z' } }
  };
}

test('usable pipeline invokes async structure only after original privacy/source/native checks; fixture positive is checker-only', async () => {
  const capability = await verifyGraphIntake(fixture());
  const result = assertVerifiedScenario(capability);
  assert.equal(result.assertion.result, 'PASS');
  assert.equal(result.asyncStructure.retries.length, 1);
  assert.equal(result.originScope, 'CHECKER FIXTURE ONLY');
  assert.equal(result.coverage.boundedFullPathEvidence, false);
  assert.equal(result.sourceAcceptanceIsCertification, false);
  assert.equal(result.certificationStatus, 'NOT CERTIFIED');
  const bindings = requireVerifiedTrustRootBindings(capability, { map, rows: result.rows, mode: 'LocalValidate' });
  assert.equal(bindings.checkerOnly, true);
  assert.equal(bindings.actualSourceVerified, false);
  assert.equal(bindings.originScope, 'CHECKER FIXTURE ONLY');
  assert.deepEqual(bindings.roots, []);
  assert.ok(Object.isFrozen(result.rows[0].recordLocator));
  assert.throws(() => { result.rows[0].recordLocator.rowOrdinal = 100; }, TypeError);
});

test('root binding getter requires the original graph capability and exact map/rows/mode', async () => {
  const capability = await verifyGraphIntake(fixture());
  const result = assertVerifiedScenario(capability);
  const options = { map, rows: result.rows, mode: 'LocalValidate' };
  for (const fake of [{}, { verified: true }, JSON.parse(JSON.stringify(capability))]) {
    assert.throws(() => requireVerifiedTrustRootBindings(fake, options), /private verified graph/);
  }
  const changedRows = structuredClone(result.rows);
  changedRows[0].recordLocator.rowOrdinal++;
  assert.throws(() => requireVerifiedTrustRootBindings(capability, { ...options, rows: changedRows }), /drift/);
  assert.throws(() => requireVerifiedTrustRootBindings(capability, { ...options, mode: 'Certify' }), /Private original/);
});

test('caller claimed trusted origin, missing origin and JSON capabilities all fail closed', async () => {
  const claimed = fixture();
  claimed.mode = 'Certify';
  claimed.capture.receipt.sourceKind = 'azure-monitor-logs';
  claimed.capture.sourceVerified = true;
  claimed.capture.observed = true;
  await assert.rejects(verifyGraphIntake(claimed), /registered native capture|Unregistered|native source|NATIVE_CAPTURE/i);
  const missing = fixture();
  delete missing.capture.receipt.sourceKind;
  await assert.rejects(verifyGraphIntake(missing), /registered native capture/);
  assert.throws(() => assertVerifiedScenario({ sourceVerified: true, verified: true }), /caller JSON\/flags\/hashes/);
  assert.throws(() => assertAsyncEvidence({ evidenceKind: 'live-azure', sourceVerified: true }), /disabled/);
});

test('fixture label can never be promoted to BootstrapValidate or Certify', async () => {
  for (const mode of ['BootstrapValidate', 'Certify']) {
    const value = fixture();
    value.mode = mode;
    await assert.rejects(verifyGraphIntake(value), /cannot grant native or certification authority/);
  }
});

test('callback privacy PASS or filtering raw inputs cannot bypass the actual trusted R8 scanner', async () => {
  const unsafe = fixture();
  unsafe.capture.rawTables[0].rows[0][5] = { Authorization: 'forbidden synthetic header control' };
  unsafe.capture.privacyDisposition = { result: 'PASS', policySha256: 'a'.repeat(64), scannedAllColumns: true };
  await assert.rejects(verifyGraphIntake(unsafe), /Trusted original-column classification failed/);
  const injection = fixture();
  injection.capture.rawRows[0].unscanned = 'new unsafe field';
  await assert.rejects(verifyGraphIntake(injection), /unscanned native columns/);
});
