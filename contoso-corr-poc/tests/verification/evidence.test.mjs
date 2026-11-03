import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEvidenceCoverage, bindObservedProofs, TRACE_TABLES } from '../../tools/verification/evidence.mjs';
import { nativeEvidenceHash, sha256 } from '../../tools/verification/files.mjs';

const digest = 'e'.repeat(64);
const scope = { workspaceId: 'test-only-workspace', resourceId: 'test-only-resource' };
function fixture() {
  const rawRows = ['a', 'b', 'c'].map((letter, index) => ({
    nativeTable: index === 1 ? 'AppDependencies' : 'AppRequests',
    OperationId: letter.repeat(32), Id: String(index + 1).padStart(16, '0')
  }));
  const rawPages = TRACE_TABLES.map(table => ({ table, ordinal: 0, rows: rawRows.filter(row => row.nativeTable === table) }));
  const queryText = '// Fixture only; never submitted to Azure';
  const receipt = {
    schema: 'contoso.raw-query-capture.v1', sourceKind: 'fixture-check', scope, captureId: 'fixture',
    fromUtc: '2026-10-31T12:00:00.000Z', toUtc: '2026-10-31T12:02:00.000Z',
    ingestionWatermarkUtc: '2026-10-31T12:04:00.000Z', capturedAtUtc: '2026-10-31T12:06:00.000Z',
    querySha256: sha256(queryText), rowCount: rawRows.length, complete: true, paginationComplete: true, warnings: [],
    settledRead: { firstAtUtc: '2026-10-31T12:04:30.000Z', lastAtUtc: '2026-10-31T12:05:00.000Z',
      firstRowsSha256: nativeEvidenceHash(rawRows), lastRowsSha256: nativeEvidenceHash(rawRows) },
    tables: rawPages.map(page => ({ name: page.table, count: page.rows.length, complete: true, warnings: [],
      pages: [{ ordinal: 0, rowCount: page.rows.length, sha256: nativeEvidenceHash(page.rows) }] }))
  };
  const rows = rawRows.map((raw, index) => ({
    recordKind: 'span', sourceKind: 'fixture-check', recordLocator: { captureId: 'fixture' },
    workspaceId: scope.workspaceId, resourceId: scope.resourceId, traceId: raw.OperationId, spanId: raw.Id,
    timeGeneratedUtc: `2026-10-31T12:0${index % 2}:00.000Z`, ingestedAtUtc: '2026-10-31T12:03:00.000Z',
    nativeItemCount: 1
  }));
  const spans = rows.map(row => ({ traceId: row.traceId, spanId: row.spanId,
    boundaryId: 'orders.request', evidenceSha256: digest, observed: true }));
  const trafficLedger = {
    schema: 'contoso.native-traffic-ledger.v1', complete: true, dropped: 0,
    observationOrigin: 'native-runtime', evidenceSha256: digest, spans,
    workStartedAtUtc: '2026-10-31T12:00:30.000Z', workCompletedAtUtc: '2026-10-31T12:01:00.000Z',
    canaries: [
      { position: 'before', traceId: spans[0].traceId, timeUtc: '2026-10-31T12:00:00.000Z',
        observed: true, evidenceSha256: digest, spans: [spans[0]] },
      { position: 'after', traceId: spans[2].traceId, timeUtc: '2026-10-31T12:01:30.000Z',
        observed: true, evidenceSha256: digest, spans: [spans[2]] }
    ]
  };
  return { receipt, rawPages, rawRows, queryText, rows, trafficLedger, requiredBoundaries: ['orders.request'],
    privacy: { result: 'PASS', policySha256: digest, scannedRawRecords: 3, scannedAllColumns: true, tablesScanned: TRACE_TABLES },
    mode: 'LocalValidate' };
}
const fails = (value, code) => assert.throws(() => assertEvidenceCoverage(value), error => error.code === code);

test('complete fixture tests the checker but cannot qualify as bounded Azure full-path evidence', () => {
  const result = assertEvidenceCoverage(fixture());
  assert.equal(result.result, 'PASS');
  assert.equal(result.boundedFullPathEvidence, false);
  const value = fixture();
  value.mode = 'Certify';
  fails(value, 'E_FIXTURE');
});

test('six explicit native tables include zero-count queries and exhaustive pages', () => {
  const missing = fixture();
  missing.receipt.tables.pop();
  fails(missing, 'E_TABLE_SCOPE');
  const partial = fixture();
  partial.receipt.paginationComplete = false;
  fails(partial, 'E_INCOMPLETE');
  const warned = fixture();
  warned.receipt.warnings.push('partial-result');
  fails(warned, 'E_INCOMPLETE');
});

test('query/page tampering and duplicate/mixed rows fail closed', () => {
  const query = fixture();
  query.queryText += ' changed';
  fails(query, 'E_QUERY');
  const page = fixture();
  page.rawPages[0].rows[0].Id = 'changed';
  fails(page, 'E_PAGE_INTEGRITY');
});

test('filtering before scanning all raw columns/tables cannot count as privacy evidence', () => {
  const value = fixture();
  value.privacy.scannedRawRecords = 2;
  fails(value, 'E_PRIVACY');
  value.privacy.scannedRawRecords = 3;
  value.privacy.scannedAllColumns = false;
  fails(value, 'E_PRIVACY');
});

test('no 100% claim from weighted counts, missing source ledger, or sampled00 absence', () => {
  const weighted = fixture();
  weighted.rows[0].nativeItemCount = 2;
  fails(weighted, 'E_SAMPLED_COUNT');
  const absent = fixture();
  absent.trafficLedger = { sampled00Exports: 0, allSamplingSettings: 100 };
  fails(absent, 'E_EXPECTED_LEDGER');
  const loss = fixture();
  loss.trafficLedger.spans.push({ traceId: 'd'.repeat(32), spanId: '1'.repeat(16),
    boundaryId: 'gateway.backend', evidenceSha256: digest, observed: true });
  fails(loss, 'E_LOSS');
});

test('canaries must be distinct, bracket work and cover every actual expected boundary', () => {
  const absent = fixture();
  absent.trafficLedger.canaries.pop();
  fails(absent, 'E_CANARY');
  const same = fixture();
  same.trafficLedger.canaries[1].traceId = same.trafficLedger.canaries[0].traceId;
  fails(same, 'E_CANARY');
  const missingHop = fixture();
  missingHop.requiredBoundaries.push('gateway.backend');
  fails(missingHop, 'E_CANARY');
  const chronology = fixture();
  chronology.trafficLedger.canaries[0].timeUtc = '2026-10-31T12:01:30.000Z';
  fails(chronology, 'E_CANARY');
});

test('delay/watermark and unaccounted emitted-span records are not hidden', () => {
  const delayed = fixture();
  delayed.receipt.settledRead.lastRowsSha256 = 'a'.repeat(64);
  fails(delayed, 'E_DELAY');
  const duplicate = fixture();
  duplicate.rows.push({ ...duplicate.rows[0] });
  fails(duplicate, 'E_UNACCOUNTED_SPAN');
});

test('classification proof hashes must bind actual native content, not be invented', () => {
  const value = { nativeTable: 'AppRequests', OperationId: 'a'.repeat(32), Id: 'b'.repeat(16) };
  const sha = nativeEvidenceHash(value);
  assert.equal(bindObservedProofs([{ observed: true, evidenceSha256: sha }], [
    { kind: 'native-row', sourceKind: 'fixture-check', value, sha256: sha }
  ]), true);
  assert.throws(() => bindObservedProofs([{ observed: true, evidenceSha256: digest }], []), /not bound/);
  assert.throws(() => bindObservedProofs([], [{ kind: 'expected-map', value, sha256: sha }]), /content\/provenance/);
});
