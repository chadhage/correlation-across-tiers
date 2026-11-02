import test from 'node:test';
import assert from 'node:assert/strict';
import { RAW_TABLES, collectRawTelemetry, decodeLogsQueryResult, renderRawQuery,
  requireNativeCaptureIdentity, requireNativeQueryResponseIdentity } from '../../tools/observability/raw-query.mjs';
import { scanPrivacy as actualPrivacyScan } from '../../tools/security/telemetry.mjs';

const hash = 'a'.repeat(64);
const trace = '1'.repeat(32);
const resourceId = '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-local-check/providers/Microsoft.Insights/components/contoso-local-check';
const input = { workspaceId: '12345678-1234-4234-8234-123456789abc', resourceId,
  fromUtc: '2026-10-31T21:00:00Z', toUtc: '2026-10-31T21:30:00Z', ingestionWatermarkUtc: '2026-10-31T21:31:00Z',
  pageSize: 1, canary: { trafficLedgerSha256: hash, contexts: [
    { position: 'pre', table: 'AppRequests', traceId: trace, spanId: 'a'.repeat(16) },
    { position: 'post', table: 'AppRequests', traceId: trace, spanId: 'b'.repeat(16) }
  ] } };
const result = (columns, rows) => ({ tables: [{ name: 'PrimaryResult',
  columns: columns.map(([name, type]) => ({ name, type })), rows }] });
function fixture() {
  const source = Object.fromEntries(RAW_TABLES.map(table => [table, []]));
  const row = Id => ({ TimeGenerated: '2026-10-31T21:01:00Z', OperationId: trace, ParentId: '',
    AppRoleName: 'contoso-orders-api', Properties: { 'business.invocation_id': 'd7e820dc-44b0-4730-b70e-bbedfd97eb5b' },
    _ResourceId: resourceId, Id, IKey: '12345678-1234-4234-8234-123456789abc' });
  source.AppRequests = [row('a'.repeat(16)), row('b'.repeat(16))];
  source.AppDependencies = [row('c'.repeat(16)), row('c'.repeat(16))];
  for (const table of RAW_TABLES) source[table].forEach((raw, index) => { raw._ItemId = `fixture-physical-${table}-${index}`; });
  const schemas = Object.fromEntries(RAW_TABLES.map(table => [table, [
    ['TimeGenerated', 'datetime'], ['OperationId', 'string'], ['ParentId', 'string'], ['AppRoleName', 'string'],
    ['Properties', 'dynamic'], ['_ResourceId', 'string'], ['IKey', 'string'], ['_ItemId', 'string'],
    ...(['AppRequests', 'AppDependencies', 'AppPageViews'].includes(table) ? [['Id', 'string']] : [])
  ]]));
  const executeQuery = async ({ table, phase, pageOrdinal, query }) => {
    assert(!query.includes('where OperationId'));
    assert(!query.includes('business.invocation_id'));
    if (phase === 'schema') return result([['ColumnName', 'string'], ['ColumnType', 'string']], schemas[table]);
    if (phase === 'count') return result([['SnapshotRows', 'long'], ['UnwatermarkedRows', 'long'],
      ['RowsBeyondWatermark', 'long'], ['TotalEventWindowRows', 'long'], ['MaxIngestedAtUtc', 'datetime']],
    [[source[table].length, 0, 0, source[table].length, source[table].length ? '2026-10-31T21:02:00Z' : null]]);
    if (phase === 'key-count') return result([['PhysicalKeys', 'long'], ['DuplicateRows', 'long'], ['EmptyKeys', 'long']],
      [[new Set(source[table].map(raw => raw._ItemId)).size, 0, 0]]);
    const columns = [...schemas[table], ['ContosoCollectorIngestedAt', 'datetime'], ['ContosoCollectorRowOrdinal', 'long']];
    const page = source[table].slice(pageOrdinal, pageOrdinal + 1);
    return result(columns, page.map(raw => columns.map(([name, type]) => {
      if (name === 'ContosoCollectorIngestedAt') return '2026-10-31T21:02:00Z';
      if (name === 'ContosoCollectorRowOrdinal') return pageOrdinal + 1;
      return type === 'dynamic' ? JSON.stringify(raw[name]) : raw[name];
    })));
  };
  const scanPrivacy = async (rows, context) => {
    assert.equal(context.assessmentScope, 'graph-intake');
    assert.equal(context.receipt.tableInventoryComplete, false);
    assert(context.tables.every(table => table.columns.some(column => column.name === 'IKey')));
    assert(rows.every(row => Array.isArray(row.values)));
    return { result: 'PASS', policySha256: hash, scannedRawRecords: rows.length,
      tablesScanned: context.tables.map(table => table.name), scannedAllColumns: true,
      assessmentScope: 'graph-intake', globalTelemetrySafetyVerified: false };
  };
  return { source, schemas, executeQuery, scanPrivacy };
}

test('raw six-table capture preserves physical duplicates, scans original columns and seals only ingested slice', async () => {
  const value = fixture();
  const captured = await collectRawTelemetry(input, value);
  assert.equal(captured.rows.length, 4);
  assert.equal(captured.rows.filter(row => row.Id === 'c'.repeat(16)).length, 2);
  assert.equal(captured.receipt.complete, true);
  assert.equal(captured.receipt.paginationComplete, true);
  assert.equal(captured.receipt.tables.length, 6);
  assert.equal(captured.receipt.canary.droppedSpans, null);
  assert.equal(captured.receipt.globalTelemetrySafetyVerified, false);
  assert.equal(captured.receipt.certificationEligible, false);
  assert.equal(captured.receipt.sourceKind, 'fixture-check');
  assert(captured.receipt.tables.every(table => table.pages.length >= 1));
  assert(captured.receipt.tables.filter(table => table.count === 0).every(table => table.pages[0].rowCount === 0));
  assert.equal(captured.nativeResponses.length, 0);
  assert(captured.receipt.tables.flatMap(table => table.pages).every(page => /^[a-f0-9]{64}$/.test(page.sha256)));
});

test('200 partial errors, warnings, truncated rows and invented native schemas fail closed', async () => {
  assert.throws(() => decodeLogsQueryResult({ ...result([], []), error: { code: 'PartialError' } }));
  assert.throws(() => decodeLogsQueryResult({ ...result([], []), warnings: ['partial'] }));
  assert.throws(() => decodeLogsQueryResult(result([['Id', 'string']], [[]])));
  const value = fixture();
  value.schemas.AppDependencies = value.schemas.AppDependencies.filter(([name]) => name !== 'Id');
  await assert.rejects(collectRawTelemetry(input, value), /CAPTURE_NATIVE_SCHEMA_DRIFT/);
});

test('short/missing pages and source-label promotion cannot establish complete live capture', async () => {
  const value = fixture();
  const executeQuery = async request => {
    const response = await value.executeQuery(request);
    if (request.phase === 'page') response.tables[0].rows = [];
    return response;
  };
  await assert.rejects(collectRawTelemetry(input, { ...value, executeQuery }), /CAPTURE_INCOMPLETE_PAGE/);
  await assert.rejects(collectRawTelemetry(input, { ...value, sourceKind: 'azure-monitor-logs',
    queryExecutorReceipt: { sourceKind: 'azure-monitor-logs', codeSha256: hash } }), /CAPTURE_UNVERIFIED_EXECUTOR_PROVENANCE/);
});

test('all-original-column privacy failure never releases rows or raw violation details', async () => {
  const value = fixture();
  value.source.AppRequests[0].Properties.Authorization = 'fixture-private-marker';
  let scanned = false;
  const scanPrivacy = async (rows, context) => {
    scanned = rows.some(row => row.values.some(cell => cell?.Authorization === 'fixture-private-marker'));
    assert.equal(context.tables.length, 6);
    return { result: 'FAIL', policySha256: hash, scannedRawRecords: rows.length, tablesScanned: RAW_TABLES,
      findings: [{ table: 'AppRequests', recordOrdinal: 0, classification: 'secret', code: 'denied' }] };
  };
  await assert.rejects(collectRawTelemetry(input, { ...value, scanPrivacy }),
    failure => failure.code === 'CAPTURE_RAW_PRIVACY_DISPOSITION_FAILED' && !failure.message.includes('fixture-private-marker'));
  assert.equal(scanned, true);
});

test('changed count/watermark and missing canary remain nonpassing rather than loss-zero', async () => {
  const value = fixture();
  let calls = 0;
  const executeQuery = async request => {
    const response = await value.executeQuery(request);
    if (request.table === 'AppRequests' && request.phase === 'count' && ++calls === 2) {
      response.tables[0].rows[0][2] = 1;
      response.tables[0].rows[0][3] += 1;
    }
    return response;
  };
  const captured = await collectRawTelemetry(input, { ...value, executeQuery });
  assert.equal(captured.receipt.complete, false);
  assert(captured.receipt.warnings.includes('AppRequests:late-ingestion-observed'));
  const missing = await collectRawTelemetry({ ...input, canary: { ...input.canary,
    contexts: input.canary.contexts.map(context => context.position === 'post' ? { ...context, spanId: 'd'.repeat(16) } : context) } }, value);
  assert.equal(missing.receipt.complete, false);
  assert.equal(missing.receipt.canary.droppedSpans, null);
});

test('raw capture rejects future/overlong scopes and approved pagination limits', async () => {
  assert.throws(() => renderRawQuery('AppRequests', 'page', { ...input,
    ingestionWatermarkUtc: new Date(Date.now() + 60000).toISOString() }));
  assert.throws(() => renderRawQuery('AppRequests', 'page', { ...input, toUtc: '2026-11-01T21:00:00Z' }));
  assert.throws(() => renderRawQuery('invented', 'count', input));
  await assert.rejects(collectRawTelemetry({ ...input, maxRows: 1 }, fixture()), /CAPTURE_APPROVED_ROW_OR_PAGE_LIMIT/);
});

test('unobserved/nonunique native physical keys cannot mint stable multipage coverage', async () => {
  const value = fixture();
  value.schemas.AppRequests = value.schemas.AppRequests.filter(([name]) => name !== '_ItemId');
  await assert.rejects(collectRawTelemetry(input, value), /CAPTURE_NO_STABLE_PAGINATION_KEY/);
  const single = await collectRawTelemetry({ ...input, pageSize: 5000 }, {
    ...value, executeQuery: async request => {
      if (request.phase !== 'page') return value.executeQuery(request);
      const response = await value.executeQuery(request);
      const first = response.tables[0].rows[0];
      if (request.table === 'AppRequests') {
        const second = [...first];
        second[response.tables[0].columns.findIndex(column => column.name === 'Id')] = 'b'.repeat(16);
        second[response.tables[0].columns.findIndex(column => column.name === 'ContosoCollectorRowOrdinal')] = 2;
        response.tables[0].rows.push(second);
      } else if (request.table === 'AppDependencies') {
        const second = [...first];
        second[response.tables[0].columns.findIndex(column => column.name === '_ItemId')] += '-second';
        second[response.tables[0].columns.findIndex(column => column.name === 'ContosoCollectorRowOrdinal')] = 2;
        response.tables[0].rows.push(second);
      }
      return response;
    }
  });

  assert.equal(single.receipt.complete, true);
  assert.equal(single.receipt.tables.find(table => table.name === 'AppRequests').paginationStrategy, 'bounded-single-page');
  const repeated = fixture();
  repeated.source.AppRequests[1]._ItemId = repeated.source.AppRequests[0]._ItemId;
  await assert.rejects(collectRawTelemetry(input, repeated), /CAPTURE_NONUNIQUE_PHYSICAL_KEY/);
});

test('JSON flags/clones and injected fixtures cannot mint private native capture/response authority', async () => {
  const captured = await collectRawTelemetry(input, fixture());
  assert.throws(() => requireNativeCaptureIdentity(captured), /CAPTURE_NATIVE_IDENTITY_REQUIRED/);
  const claimed = structuredClone(captured);
  claimed.receipt.sourceKind = 'azure-monitor-logs';
  claimed.receipt.certificationEligible = true;
  claimed.native = true;
  assert.throws(() => requireNativeCaptureIdentity(claimed), /CAPTURE_NATIVE_IDENTITY_REQUIRED/);
  assert.throws(() => requireNativeQueryResponseIdentity(result([], [])), /CAPTURE_NATIVE_QUERY_RESPONSE_IDENTITY_REQUIRED/);
});

test('actual R8 scoped scanner sees original native metadata without granting a global privacy gate', async () => {
  const value = fixture();
  const captured = await collectRawTelemetry({ ...input, pageSize: 5000 }, {
    ...value, executeQuery: async request => {
      if (request.phase !== 'page') return value.executeQuery(request);
      const response = await value.executeQuery(request);
      if (response.tables[0].rows.length) {
        const first = response.tables[0].rows[0];
        const second = [...first];
        const idColumn = response.tables[0].columns.findIndex(column => column.name === 'Id');
        if (request.table === 'AppRequests') second[idColumn] = 'b'.repeat(16);
        second[response.tables[0].columns.findIndex(column => column.name === '_ItemId')] += '-second';
        second[response.tables[0].columns.findIndex(column => column.name === 'ContosoCollectorRowOrdinal')] = 2;
        response.tables[0].rows.push(second);
      }
      return response;
    }, scanPrivacy: async (rows, context) => {
      const verdict = await actualPrivacyScan(rows, context);
      assert.equal(verdict.result, 'PASS', JSON.stringify({
        findings: verdict.findings, scannedRawRecords: verdict.scannedRawRecords,
        tablesScanned: verdict.tablesScanned, assessmentScope: verdict.assessmentScope,
        scannedAllColumns: verdict.scannedAllColumns
      }));
      return verdict;
    }
  });
  assert.equal(captured.privacyDisposition.result, 'PASS');
  assert.equal(captured.privacyDisposition.globalTelemetrySafetyVerified, false);
  assert.equal(captured.receipt.tableInventoryComplete, false);
});
