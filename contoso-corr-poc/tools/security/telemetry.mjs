import { readFileSync } from 'node:fs';
import { digest, forbiddenString, forbiddenField, opaqueInvocation, PSEUDONYM, nonzeroHex } from './values.mjs';

const policyBytes = readFileSync(new URL('./telemetry-policy.v1.json', import.meta.url));
export const telemetryPolicy = JSON.parse(policyBytes);
export const policySha256 = digest(policyBytes);

function canaryPassed(value) {
  return value === 'PASS' || (value?.result === 'PASS' && value.windowBound === true &&
    value.preObserved === true && value.postObserved === true && value.dropped === 0);
}

function scanTables({ tables, receipt, canaryDisposition = 'UNPROVED' } = {}, policy, graphIntake) {
  const findings = [];
  let scannedRawRecords = 0;
  let scannedAllColumns = true;
  const tablesScanned = [];
  const add = (table, ordinal, classification, code) => {
    findings.push({ table, recordOrdinal: ordinal,
      classification: typeof classification === 'string' && /^[a-z-]{1,64}$/.test(classification) ? classification : 'unclassified',
      code });
  };
  if (!Array.isArray(tables) || !tables.length) {
    add('capture', -1, 'coverage', 'RAW_TABLES_MISSING');
    tables = [];
    scannedAllColumns = false;
  }
  const names = tables.map(table => table?.name);
  if (new Set(names).size !== names.length) add('capture', -1, 'coverage', 'DUPLICATE_TABLE');
  if (Array.isArray(receipt?.tables) && new Set(receipt.tables.map(table => table?.name)).size !== receipt.tables.length)
    add('capture', -1, 'coverage', 'DUPLICATE_RECEIPT_TABLE');
  const requiredTables = graphIntake
    ? ['AppRequests', 'AppDependencies', 'AppPageViews', 'AppTraces', 'AppExceptions', 'AppEvents'] : policy.requiredTables;
  if (graphIntake && (names.length !== requiredTables.length || names.some(name => !requiredTables.includes(name))))
    add('capture', -1, 'coverage', 'GRAPH_SCOPE_NOT_SEALED');
  for (const name of requiredTables) if (!names.includes(name)) add(name, -1, 'coverage', 'TABLE_NOT_SCANNED');
  if (!receipt || (!graphIntake && receipt.tableInventoryComplete !== true) || receipt.complete !== true ||
      receipt.paginationComplete !== true || !Array.isArray(receipt.warnings) || receipt.warnings.length ||
      !Array.isArray(receipt.tables)) add('capture', -1, 'coverage', 'CAPTURE_INCOMPLETE');
  if (!graphIntake && !canaryPassed(canaryDisposition)) add('capture', -1, 'canary', 'CANARY_UNPROVED');

  function walk(value, classification, table, ordinal, metric, depth = 0) {
    if (!classification) {
      scannedAllColumns = false;
      add(table, ordinal, 'unclassified', 'UNCLASSIFIED_FIELD');
    }
    if (depth > policy.limits.maxDepth) {
      scannedAllColumns = false;
      add(table, ordinal, classification ?? 'unclassified', 'DEPTH_LIMIT');
      return;
    }
    if (typeof value === 'string') {
      const forbidden = forbiddenString(value);
      if (forbidden) add(table, ordinal, classification ?? 'unclassified', forbidden);
    }
    if (value === null || value === undefined || value === '') return;
    if (classification === 'attributes' || classification === 'measurements') {
      if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { add(table, ordinal, classification, 'INVALID_DYNAMIC_JSON'); return; }
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        add(table, ordinal, classification, 'INVALID_DYNAMIC_SHAPE'); return;
      }
      if (Object.keys(value).length > policy.limits.maxFieldsPerObject) {
        scannedAllColumns = false;
        add(table, ordinal, classification, 'FIELD_LIMIT');
      }
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenField(key)) add(table, ordinal, 'prohibited', 'PROHIBITED_FIELD');
        const assigned = classification === 'measurements'
          ? (policy.measurementNames.includes(key) ? 'number' : undefined) :
            Object.hasOwn(policy.attributes, key) ? policy.attributes[key] : undefined;
        if (metric && !policy.metricAttributes.includes(key)) add(table, ordinal, 'cardinality', 'UNAPPROVED_METRIC_DIMENSION');
        walk(child, assigned, table, ordinal, metric, depth + 1);
      }
      return;
    }
    if (classification === 'span-links') {
      if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { add(table, ordinal, classification, 'INVALID_LINKS'); return; }
      }
      if (!Array.isArray(value) || value.length > policy.limits.maxLinks) {
        add(table, ordinal, classification, 'LINK_BOUND'); return;
      }
      for (const link of value) {
        if (!link || typeof link !== 'object' || Array.isArray(link) ||
            Object.keys(link).some(key => !['traceId', 'spanId', 'operation_Id', 'id'].includes(key)) ||
            !nonzeroHex(link.traceId ?? link.operation_Id, 32) || !nonzeroHex(link.spanId ?? link.id, 16))
          add(table, ordinal, classification, 'INVALID_LINK');
        if (link && typeof link === 'object') for (const [key, child] of Object.entries(link))
          walk(child, ['traceId', 'operation_Id'].includes(key) ? 'trace-id' :
            ['spanId', 'id'].includes(key) ? 'span-id' : undefined, table, ordinal, metric, depth + 1);
      }
      return;
    }
    if (typeof value === 'object') {
      add(table, ordinal, classification ?? 'unclassified', 'UNEXPECTED_OBJECT');
      if (Object.keys(value).length > policy.limits.maxFieldsPerObject) {
        scannedAllColumns = false;
        add(table, ordinal, classification ?? 'unclassified', 'FIELD_LIMIT');
      }
      for (const child of Object.values(value)) walk(child, undefined, table, ordinal, metric, depth + 1);
      return;
    }
    const text = String(value);
    const max = policy.limits.maxTextLength;
    let valid = true;
    if (typeof value !== 'string' && !['number', 'boolean', 'link-count'].includes(classification)) {
      add(table, ordinal, classification ?? 'unclassified', 'CLASSIFICATION_TYPE_VIOLATION');
      return;
    }
    switch (classification) {
      case 'empty': valid = false; break;
      case 'trace-id': valid = nonzeroHex(value, 32); break;
      case 'span-id': valid = nonzeroHex(value, 16); break;
      case 'invocation-id': valid = opaqueInvocation(value); break;
      case 'pseudonym': valid = PSEUDONYM.test(text) && !metric; break;
      case 'security-event-id': valid = /^[0-9a-f-]{36}$/i.test(text) && !metric; break;
      case 'masked-ip': valid = ['0.0.0.0', '::', '0:0:0:0:0:0:0:0'].includes(text); break;
      case 'number': valid = (typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(text)) && Number.isFinite(Number(value)); break;
      case 'boolean': valid = [true, false, 'true', 'false'].includes(value); break;
      case 'timestamp': valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); break;
      case 'service-name': valid = policy.serviceNames.includes(text); break;
      case 'auth-outcome': valid = ['authenticated', 'rejected'].includes(text); break;
      case 'actor-type': valid = ['user', 'workload', 'unknown'].includes(text); break;
      case 'role-category': valid = ['invoker', 'run_controller', 'none'].includes(text); break;
      case 'span-kind': valid = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'].includes(text); break;
      case 'context-code': valid = /^[A-Z][A-Z0-9_]{0,63}$/.test(text); break;
      case 'link-count': valid = /^(?:0|[1-9][0-9]*)$/.test(text) && Number(text) <= policy.limits.maxLinks; break;
      case 'partition-id': valid = /^(?:0|[1-9][0-9]{0,8})$/.test(text); break;
      case 'offset': valid = /^(?:0|[1-9][0-9]{0,18})$/.test(text) && BigInt(text) <= 9223372036854775807n; break;
      case 'anonymous-analytics-id': valid = !metric && /^[A-Za-z0-9+/=_-]{16,128}$/.test(text) &&
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text); break;
      case 'configuration-metadata': valid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text) ||
        /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[A-Za-z0-9._()-]+\/providers\/[A-Za-z0-9./_-]+$/i.test(text); break;
      case 'safe-url':
        try {
          const url = new URL(text);
          valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
            !/%(?:2[0-9a-f]|3[0-9a-f]|40)/i.test(url.pathname);
        } catch { valid = false; }
        break;
      case 'safe-target': valid = text.length <= 256 && /^[A-Za-z0-9.:/_-]+$/.test(text) && !text.includes('@') && !text.includes('?'); break;
      case 'route-name': valid = text.length <= 256 && /^[A-Za-z0-9 .:/{}_*-]+$/.test(text) && !/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(text); break;
      case 'safe-dependency-data': valid = text.length <= 128 && /^[A-Za-z0-9._/-]+$/.test(text); break;
      case 'safe-text': valid = text.length <= max && !/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(text) && !/[{}\r\n]/.test(text); break;
      case 'metric-name': valid = text.length <= 128 && /^[A-Za-z0-9._ /%-]+$/.test(text); break;
      case 'sdk-version': valid = text.length <= 256 && /^[A-Za-z0-9 .:/_+()-]+$/.test(text); break;
      case 'instance-id': case 'opaque-monitor-id': valid = text.length <= 128 && /^[A-Za-z0-9._:/-]+$/.test(text); break;
      case 'bounded-label': valid = text.length <= 128 && /^[A-Za-z0-9 .:/_()+%-]+$/.test(text); break;
      default: valid = false;
    }
    if (['bounded-label', 'route-name', 'safe-text', 'sdk-version', 'safe-target', 'safe-dependency-data', 'metric-name'].includes(classification) &&
        (/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(text) || /(?:^|[^0-9a-f])[0-9a-f]{32,64}(?:$|[^0-9a-f])/i.test(text))) valid = false;
    if (!valid) add(table, ordinal, classification ?? 'unclassified', 'CLASSIFICATION_VIOLATION');
  }

  for (const table of tables) {
    const name = table?.name;
    if (typeof name !== 'string' || !Object.hasOwn(policy.tableColumns, name)) {
      scannedAllColumns = false;
      add('capture', -1, 'coverage', 'UNCLASSIFIED_TABLE');
    }
    const safeName = Object.hasOwn(policy.tableColumns, name ?? '') ? name : 'unclassified-table';
    tablesScanned.push(safeName);
    if (!Array.isArray(table?.columns) || !table.columns.length || !Array.isArray(table?.rows)) {
      scannedAllColumns = false;
      add(safeName, -1, 'coverage', 'RAW_SCHEMA_MISSING');
      continue;
    }
    const columns = table.columns.map(column => typeof column === 'string' ? column : column?.name);
    if (new Set(columns).size !== columns.length) add(safeName, -1, 'coverage', 'DUPLICATE_COLUMN');
    const metadata = receipt?.tables?.find(entry => entry.name === name);
    if (!metadata || metadata.complete !== true || (metadata.count ?? metadata.rowCount) !== table.rows.length)
      add(safeName, -1, 'coverage', 'RAW_COUNT_MISMATCH');
    const assignedColumn = column => (Object.hasOwn(policy.tableColumns, name ?? '') &&
      Object.hasOwn(policy.tableColumns[name], column)) ? policy.tableColumns[name][column] :
      Object.hasOwn(policy.commonColumns, column) ? policy.commonColumns[column] : undefined;
    for (const column of columns) if (!assignedColumn(column)) {
      scannedAllColumns = false;
      add(safeName, -1, 'unclassified', 'UNCLASSIFIED_COLUMN');
    }
    table.rows.forEach((row, ordinal) => {
      scannedRawRecords++;
      const values = Array.isArray(row) ? row : columns.map(column => row?.[column]);
      if ((!Array.isArray(row) && (!row || typeof row !== 'object' ||
          Object.keys(row).some(column => !columns.includes(column)))) || values.length !== columns.length) {
        scannedAllColumns = false;
        add(safeName, ordinal, 'coverage', 'RAW_ROW_SHAPE_MISMATCH');
      }
      columns.forEach((column, index) => {
        if (forbiddenField(column)) add(safeName, ordinal, 'prohibited', 'PROHIBITED_FIELD');
        walk(values[index], assignedColumn(column),
          safeName, ordinal, name === 'AppMetrics');
      });
      if (Array.isArray(row)) row.slice(columns.length).forEach(value => walk(value, undefined, safeName, ordinal, name === 'AppMetrics'));
      else if (row && typeof row === 'object') for (const [column, value] of Object.entries(row))
        if (!columns.includes(column)) walk(value, undefined, safeName, ordinal, name === 'AppMetrics');
    });
  }
  if (!scannedRawRecords) add('capture', -1, 'coverage', 'EMPTY_CAPTURE');
  if (receipt?.rowCount !== scannedRawRecords) add('capture', -1, 'coverage', 'TOTAL_COUNT_MISMATCH');
  if (receipt?.tables?.some(entry => !names.includes(entry.name))) add('capture', -1, 'coverage', 'UNSCANNED_RECEIPT_TABLE');
  return {
    result: findings.length ? 'FAIL' : 'PASS',
    policySha256: policy === telemetryPolicy ? policySha256 : digest(JSON.stringify(policy)),
    scannedRawRecords, tablesScanned: [...new Set(tablesScanned)], scannedAllColumns: scannedAllColumns && findings.length === 0,
    scope: graphIntake ? 'graph-intake' : 'all-table-gate',
    assessmentScope: graphIntake ? 'graph-intake' : 'all-telemetry',
    fullScopeScanned: !graphIntake && findings.length === 0,
    sourceAcceptanceIsCertification: false,
    globalTelemetrySafetyVerified: false,
    gateEligible: false,
    canaryDisposition: canaryPassed(canaryDisposition) ? 'PASS' : 'UNPROVED',
    findings
  };
}

export function scanRawTelemetry(input = {}, policy = telemetryPolicy) {
  return scanTables(input, policy, input.assessmentScope === 'graph-intake');
}

export function scanGraphIntake(input = {}, policy = telemetryPolicy) {
  return scanTables(input, policy, true);
}

export function scanPrivacy(rows, context = {}) {
  rows = Array.isArray(rows) ? rows : [];
  const { tables = [], receipt, canaryDisposition } = context;
  if (Array.isArray(rows) && rows.every(row => row && Array.isArray(row.columns) && Array.isArray(row.rows)))
    return (context.scope === 'graph-intake' || context.assessmentScope === 'graph-intake') ? scanGraphIntake({ tables: rows, receipt, canaryDisposition }) :
      scanRawTelemetry({ tables: rows, receipt, canaryDisposition });
  const rawTables = tables.map(table => ({
    ...table, rows: Array.isArray(table.rows) ? table.rows :
      rows.filter(row => (row.table ?? row.tableName) === table.name).map(row => row.values ?? row.row ?? row)
  }));
  return (context.scope === 'graph-intake' || context.assessmentScope === 'graph-intake') ? scanGraphIntake({ tables: rawTables, receipt, canaryDisposition }) :
    scanRawTelemetry({ tables: rawTables, receipt, canaryDisposition });
}

export function lintTelemetryCapture({ apimDiagnostics, javaAgent } = {}) {
  const findings = [];
  const diagnostics = Array.isArray(apimDiagnostics) ? apimDiagnostics : [apimDiagnostics];
  if (!diagnostics.length || diagnostics.some(value => !value))
    findings.push({ code: 'APIM_CAPTURE_CONFIGURATION_MISSING' });
  for (const diagnostic of diagnostics.filter(Boolean)) {
    const properties = diagnostic.properties ?? diagnostic;
    for (const side of ['frontend', 'backend']) for (const direction of ['request', 'response']) {
      const value = properties[side]?.[direction];
      if (!value || value.body?.bytes !== 0 || !Array.isArray(value.headers) ||
          value.headers.some(header => header.toLowerCase() !== 'x-business-invocation-id'))
        findings.push({ code: 'APIM_UNSAFE_CAPTURE', side, direction });
    }
  }
  if (javaAgent?.instrumentation?.jdbc?.enabled !== false || javaAgent?.instrumentation?.redis?.enabled !== false)
    findings.push({ code: 'AUTOMATIC_DATA_CAPTURE_NOT_DISABLED' });
  return { result: findings.length ? 'FAIL' : 'PASS', findings };
}
