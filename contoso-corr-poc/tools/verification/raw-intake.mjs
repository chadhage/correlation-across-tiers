import { renderRawQuery } from '../observability/raw-query.mjs';
import { nativeEvidenceHash, sha256 } from './files.mjs';
import { VerificationFailure } from './invariants.mjs';

export function adaptR7Capture(capture, { settledRead } = {}) {
  const receipt = capture?.receipt;
  if (receipt?.schema !== 'contoso.raw-query-capture.v1' || !Array.isArray(capture.rows) ||
      capture.privacyDisposition?.result !== 'PASS' || capture.privacyDisposition.scannedAllColumns !== true ||
      !Array.isArray(receipt.executedQueries) || !Array.isArray(receipt.tables)) throw new VerificationFailure('E_CAPTURE_ADAPTER', 'Actual R7 sealed native capture required');
  const executedQueries = receipt.executedQueries.map(query => {
    const text = query.text ?? renderRawQuery(query.table, query.phase, {
      workspaceId: receipt.workspaceId, resourceId: receipt.resourceId, fromUtc: receipt.fromUtc,
      toUtc: receipt.toUtc, ingestionWatermarkUtc: receipt.ingestionWatermarkUtc,
      pageSize: query.pageSize, pageOrdinal: query.pageOrdinal, stablePhysicalKey: query.stablePhysicalKey
    }, query.pageOrdinal);
    if (typeof text !== 'string' || sha256(text) !== query.querySha256) throw new VerificationFailure('E_QUERY', 'Executed native query text must be supplied or exactly reproducible');
    return { ...query, text };
  });
  const rawPages = [];
  for (const table of receipt.tables) {
    const native = capture.rows.filter(row => row.nativeTable === table.name);
    let offset = 0;
    for (const page of table.pages) {
      const rows = native.slice(offset, offset + page.rowCount);
      offset += page.rowCount;
      if (nativeEvidenceHash(rows) !== page.sha256) throw new VerificationFailure('E_PAGE_INTEGRITY', 'Actual R7 native page content/digest mismatch');
      rawPages.push({ table: table.name, ordinal: page.ordinal, rows });
    }
    if (offset !== native.length) throw new VerificationFailure('E_PAGE_INTEGRITY', 'Native R7 page rows do not exhaust table capture');
  }
  return {
    rawRows: capture.rows, rawPages, queryText: executedQueries.map(query => query.text).join('\n\n'),
    originalCapture: capture,
    receipt: { ...receipt, scope: { workspaceId: receipt.workspaceId, resourceId: receipt.resourceId },
      originalQueryManifestSha256: receipt.queryManifestSha256,
      queryManifestSha256: nativeEvidenceHash(executedQueries), executedQueries,
      settledRead: settledRead ?? null },
    privacyDisposition: capture.privacyDisposition
  };
}

export function selectNativeCohort(rows, { traceIds, businessInvocationId }) {
  const wanted = new Set(traceIds);
  return rows.filter(row => wanted.has(row.traceId) ||
    row.businessInvocationId === businessInvocationId ||
    row.nativeProperties?.['business.invocation_id'] === businessInvocationId);
}
