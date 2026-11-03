import { HASH, TRACE, SPAN, requireUtc } from '../observability/telemetry-contract.mjs';
import { nativeEvidenceHash, sha256 } from './files.mjs';
import { VerificationFailure } from './invariants.mjs';

export const TRACE_TABLES = ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppPageViews', 'AppEvents'];
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const key = item => `${item.traceId}:${item.spanId}`;
const tableOf = row => row.nativeTable ?? row.SourceTable ?? row.Type;
const utc = (value, name) => Date.parse(requireUtc(value, name));

export function assertEvidenceCoverage({ receipt, rawPages, rawRows, queryText, privacy, rows, trafficLedger, requiredBoundaries, mode }) {
  if (receipt?.schema !== 'contoso.raw-query-capture.v1' || !Array.isArray(rawRows) || !rawRows.length ||
      !Array.isArray(rawPages) || !rawPages.length || !Array.isArray(rows) || !rows.length) fail('E_ABSENCE', 'No complete raw native capture');
  if (mode !== 'LocalValidate' && receipt.sourceKind !== 'azure-monitor-logs') fail('E_FIXTURE', 'Mocks/local output cannot qualify as Azure evidence');
  if (!['azure-monitor-logs', 'real-local-agent-loopback', 'fixture-check'].includes(receipt.sourceKind)) fail('E_PROVENANCE', 'Unknown raw capture provenance');
  if (receipt.complete !== true || receipt.paginationComplete !== true || receipt.rowCount !== rawRows.length ||
      !Array.isArray(receipt.warnings) || receipt.warnings.length) fail('E_INCOMPLETE', 'Incomplete, warned, truncated or mismatched capture');
  if (!receipt.scope?.workspaceId || !receipt.scope?.resourceId || !HASH.test(receipt.querySha256 ?? '') ||
      typeof queryText !== 'string') fail('E_QUERY', 'Bound query and resource scope required');
  if (receipt.executedQueries) {
    if (!Array.isArray(receipt.executedQueries) || !receipt.executedQueries.length ||
        nativeEvidenceHash(receipt.executedQueries) !== receipt.queryManifestSha256 ||
        receipt.executedQueries.some(query => typeof query.text !== 'string' || sha256(query.text) !== query.querySha256) ||
        receipt.executedQueries.map(query => query.text).join('\n\n') !== queryText) fail('E_QUERY', 'Native executed query text/manifest mismatch');
  } else if (sha256(queryText) !== receipt.querySha256) fail('E_QUERY', 'Bound query text mismatch');
  const from = utc(receipt.fromUtc, 'capture start');
  const to = utc(receipt.toUtc, 'capture end');
  const captured = utc(receipt.capturedAtUtc, 'capture time');
  const watermark = utc(receipt.ingestionWatermarkUtc, 'ingestion watermark');
  if (!(to > from) || to - from > 7_200_000 || captured < watermark || watermark < to) fail('E_WATERMARK', 'Invalid bounded immutable ingestion watermark');
  const tables = receipt.tables;
  if (!Array.isArray(tables) || tables.length !== TRACE_TABLES.length ||
      new Set(tables.map(item => item.name)).size !== TRACE_TABLES.length ||
      TRACE_TABLES.some(name => !tables.some(item => item.name === name))) fail('E_TABLE_SCOPE', 'All six native trace tables must be explicitly queried, including empty tables');
  if (privacy?.result !== 'PASS' || !HASH.test(privacy.policySha256 ?? '') ||
      privacy.scannedRawRecords !== rawRows.length || !Array.isArray(privacy.tablesScanned) ||
      TRACE_TABLES.some(name => !privacy.tablesScanned.includes(name)) ||
      privacy.scannedAllColumns !== true) fail('E_PRIVACY', 'All raw columns must be reviewed in memory before filtering, hashing or persistence');
  const pageKeys = new Set();
  for (const table of tables) {
    const pages = rawPages.filter(page => page.table === table.name).sort((a, b) => a.ordinal - b.ordinal);
    const records = rawRows.filter(row => tableOf(row) === table.name);
    if (!table.complete || !Number.isInteger(table.count) || table.count < 0 || table.count !== records.length ||
        !Array.isArray(table.warnings) || table.warnings.length || !Array.isArray(table.pages) ||
        !pages.length || table.pages.length !== pages.length) fail('E_TABLE_COVERAGE', `Incomplete native table ${table.name}`);
    let count = 0;
    pages.forEach((page, ordinal) => {
      const declared = table.pages.find(item => item.ordinal === ordinal);
      const pageKey = `${table.name}:${page.ordinal}`;
      if (page.ordinal !== ordinal || pageKeys.has(pageKey) || !Array.isArray(page.rows) || !declared ||
          declared.rowCount !== page.rows.length || nativeEvidenceHash(page.rows) !== declared.sha256 ||
          page.rows.some(row => tableOf(row) !== table.name)) fail('E_PAGE_INTEGRITY', 'Missing/repeated/tampered/mixed native page');
      pageKeys.add(pageKey);
      count += page.rows.length;
    });
    if (count !== table.count || nativeEvidenceHash(pages.flatMap(page => page.rows)) !== nativeEvidenceHash(records)) fail('E_PAGE_INTEGRITY', 'Raw page records differ from the assertion input');
  }
  if (pageKeys.size !== rawPages.length) fail('E_TABLE_SCOPE', 'Unexpected table/page in assertion input');
  for (const row of rows) {
    if (row.sourceKind !== receipt.sourceKind || row.recordLocator?.captureId !== receipt.captureId ||
        row.workspaceId !== receipt.scope.workspaceId || row.resourceId !== receipt.scope.resourceId ||
        utc(row.timeGeneratedUtc, 'native event time') < from || utc(row.timeGeneratedUtc, 'native event time') >= to ||
        utc(row.ingestedAtUtc, 'native ingestion time') > watermark) fail('E_SCOPE', 'Native row escapes capture/time/resource provenance');
    if (row.recordKind !== 'link' && (Number(row.nativeItemCount ?? 1) !== 1)) fail('E_SAMPLED_COUNT', 'Weighted/sampled native rows are not 100%-fidelity evidence');
  }
  const settle = receipt.settledRead;
  if (!settle || utc(settle.lastAtUtc, 'settle end') - utc(settle.firstAtUtc, 'settle start') < 30_000 ||
      utc(settle.firstAtUtc, 'settle start') < watermark || utc(settle.lastAtUtc, 'settle end') > captured ||
      !HASH.test(settle.firstRowsSha256 ?? '') || settle.firstRowsSha256 !== settle.lastRowsSha256 ||
      settle.lastRowsSha256 !== nativeEvidenceHash(rawRows)) fail('E_DELAY', 'Bounded drain and stable repeated native capture required');
  if (trafficLedger?.schema !== 'contoso.native-traffic-ledger.v1' || trafficLedger.complete !== true ||
      trafficLedger.dropped !== 0 || !HASH.test(trafficLedger.evidenceSha256 ?? '') ||
      !Array.isArray(trafficLedger.spans) || !trafficLedger.spans.length ||
      trafficLedger.observationOrigin !== 'native-runtime' || !Array.isArray(trafficLedger.canaries)) {
    fail('E_EXPECTED_LEDGER', 'A full independent native emission ledger is required; settings or the expected map are not emission evidence');
  }
  const observed = rows.filter(row => row.recordKind === 'span');
  const nativeKeys = new Set(observed.map(key));
  const expectedKeys = new Set();
  for (const span of trafficLedger.spans) {
    if (!TRACE.test(span.traceId ?? '') || !SPAN.test(span.spanId ?? '') || expectedKeys.has(key(span)) ||
        !HASH.test(span.evidenceSha256 ?? '') || span.observed !== true) fail('E_EXPECTED_LEDGER', 'Invalid/duplicate/unobserved source span in native ledger');
    expectedKeys.add(key(span));
    if (!nativeKeys.has(key(span))) fail('E_LOSS', `Source-emitted native span missing at ${span.boundaryId ?? 'unknown boundary'}`);
  }
  if (nativeKeys.size !== observed.length || observed.some(row => !expectedKeys.has(key(row)))) fail('E_UNACCOUNTED_SPAN', 'Duplicate or unaccounted native span; do not silently deduplicate');
  if (!Array.isArray(requiredBoundaries) || !requiredBoundaries.length) fail('E_CANARY', 'Nonempty full-path canary coverage required');
  const workStarted = utc(trafficLedger.workStartedAtUtc, 'work start');
  const workCompleted = utc(trafficLedger.workCompletedAtUtc, 'work end');
  if (workStarted < from || workCompleted < workStarted || workCompleted >= to) fail('E_WINDOW', 'Traffic lifetime must be inside the capture window');
  const canaryKeys = new Set();
  const canaryTraces = new Set();
  for (const position of ['before', 'after']) {
    const canary = trafficLedger.canaries.find(item => item.position === position);
    if (!canary || !HASH.test(canary.evidenceSha256 ?? '') || canary.observed !== true ||
        !Array.isArray(canary.spans) || !canary.spans.length || !TRACE.test(canary.traceId ?? '') ||
        canaryTraces.has(canary.traceId)) fail('E_CANARY', 'Distinct actual full-path before/after canary evidence required');
    canaryTraces.add(canary.traceId);
    const canaryTime = utc(canary.timeUtc, 'canary time');
    if (canaryTime < from || canaryTime >= to || position === 'before' && canaryTime > workStarted ||
        position === 'after' && canaryTime < workCompleted) fail('E_CANARY', 'Canaries must actually bracket the workload');
    for (const span of canary.spans) {
      if (span.traceId !== canary.traceId || canaryKeys.has(key(span))) fail('E_CANARY', 'Canary contexts reused or inconsistent');
      canaryKeys.add(key(span));
    }
    for (const boundary of requiredBoundaries) {
      const matches = canary.spans.filter(item => item.boundaryId === boundary && expectedKeys.has(key(item)) && nativeKeys.has(key(item)));
      if (!matches.length) fail('E_CANARY', `Canary does not cover actual boundary ${boundary}`);
    }
  }
  return {
    schema: 'contoso.coverage-result.v1', result: 'PASS', complete: true,
    sourceKind: receipt.sourceKind, sourceAcceptanceIsCertification: false,
    expectedSpanRecords: expectedKeys.size, observedSpanRecords: observed.length,
    boundedFullPathEvidence: receipt.sourceKind === 'azure-monitor-logs' && mode !== 'LocalValidate',
    missingSpanRecords: 0, duplicateSpanRecords: 0, rawRecords: rawRows.length,
    tables: tables.map(item => ({ name: item.name, count: item.count }))
  };
}

export function bindObservedProofs(proofs, artifacts) {
  if (!Array.isArray(proofs) || !Array.isArray(artifacts)) fail('E_BINDING', 'Native proof inventory required');
  const hashes = new Set();
  for (const artifact of artifacts) {
    if (!['native-row', 'native-runtime', 'native-wire', 'native-contributor-ledger'].includes(artifact.kind) ||
        !HASH.test(artifact.sha256 ?? '') || nativeEvidenceHash(artifact.value) !== artifact.sha256 ||
        artifact.sourceKind !== 'azure-monitor-logs' && artifact.sourceKind !== 'real-local-agent-loopback' &&
        artifact.sourceKind !== 'fixture-check') fail('E_BINDING', 'Native proof content/provenance mismatch');
    hashes.add(artifact.sha256);
  }
  for (const proof of proofs) {
    if (proof.observed !== true || !hashes.has(proof.evidenceSha256)) fail('E_BINDING', 'Classification/root/contributor proof is not bound to captured native content');
  }
  return true;
}
