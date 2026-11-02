import { opaqueInvocation, nonzeroHex } from './values.mjs';

const foreign = /^(?:business\.invocation_id|businessInvocationId|messageId|originalMessageId|causationId|messaging\.message\.id|contoso\.(?:original\.message|message|causation)\.id|cloudEventId|cloudEvent\.id|apim\.request_id|context\.RequestId|security\.entra\.(?:request_id|correlation_id))$/i;
const technical = /^(?:OperationId|traceId|Id|spanId|ParentId|parentSpanId)$/;
const normalize = value => typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';

export function scanIdentifiers(records) {
  const findings = [];
  const foreignIds = new Set();
  const rows = [];
  function flatten(value, result = []) {
    if (!value || typeof value !== 'object') return result;
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') flatten(child, result);
      else result.push([key, child]);
    }
    return result;
  }
  if (!Array.isArray(records) || !records.length)
    return { result: 'FAIL', scannedRecords: 0, findings: [{ recordOrdinal: -1, code: 'IDENTIFIER_CAPTURE_MISSING' }] };
  records.forEach(record => {
    const row = flatten(record);
    rows.push(row);
    for (const [key, value] of row) if (foreign.test(key) && value) foreignIds.add(normalize(value));
  });
  rows.forEach((row, recordOrdinal) => {
    for (const [key, value] of row) {
      if (foreign.test(key) && value && /business/i.test(key) && !opaqueInvocation(value))
        findings.push({ recordOrdinal, code: 'BUSINESS_ID_NOT_OPAQUE' });
      if (technical.test(key) && value) {
        const normalized = normalize(value);
        if (foreignIds.has(normalized)) findings.push({ recordOrdinal, code: 'TRACE_AUTH_BUSINESS_CONFLATION' });
        const size = /OperationId|traceId/.test(key) ? 32 : 16;
        if (!(key === 'Id' && recordTable(records[recordOrdinal]) === 'AppPageViews') && !nonzeroHex(value, size))
          findings.push({ recordOrdinal, code: 'NON_W3C_ID' });
      }
      if (/entra.*(?:request|correlation).*id/i.test(key) &&
          !/^security\.entra\.(?:request_id|correlation_id)$/.test(key))
        findings.push({ recordOrdinal, code: 'ENTRA_ID_OUTSIDE_APPROVED_ATTRIBUTE' });
      if ((recordTable(records[recordOrdinal]) === 'AppMetrics' || records[recordOrdinal]?.kind === 'metric') &&
          /business|pseudonym|invocation|(?:^|[._])(?:run|workflow|message)\.id/i.test(key) && value)
        findings.push({ recordOrdinal, code: 'HIGH_CARDINALITY_METRIC_ID' });
    }
  });
  return { result: findings.length ? 'FAIL' : 'PASS', scannedRecords: records.length, findings };
}

function recordTable(record) { return record?.table ?? record?.tableName ?? record?.Type; }

export function scanAuthorizationIdentifierUse(source) {
  const findings = [];
  const methods = source.matchAll(/\b(?:authenticate|authorize|validateToken|verifyToken|canAccess)\s*\([^)]*\)\s*(?:throws[^{]+)?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g);
  for (const match of methods) if (/business\.invocation_id|x-business-invocation-id|InvocationIds\s*\.|businessInvocationId/.test(match[0]))
    findings.push({ code: 'BUSINESS_ID_USED_BY_AUTHORIZATION' });
  if (/\b(?:metric|meter|counter|histogram)\s*\.\s*(?:add|record|set|tag|withAttribute|attributes|createCounter|createHistogram)\s*\([^;]{0,256}(?:business\.invocation_id|businessInvocationId)/i.test(source))
    findings.push({ code: 'BUSINESS_ID_METRIC_DIMENSION' });
  return { result: findings.length ? 'FAIL' : 'PASS', findings };
}
