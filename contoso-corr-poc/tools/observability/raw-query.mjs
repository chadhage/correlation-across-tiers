import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HASH, TRACE, SPAN, TELEMETRY_CONTRACT_SOURCE_SHA256, canonicalSpanId, ownedConfigurationHash, requireUtc, sha256 } from './telemetry-contract.mjs';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nativeExecutors = new WeakMap();
const nativeCaptures = new WeakMap();
const nativeResponses = new WeakMap();
const loadedCodeFiles = [
  { path: 'tools\\observability\\raw-query.mjs', sha256: sha256(await readFile(fileURLToPath(import.meta.url))) },
  { path: 'tools\\observability\\telemetry-contract.mjs', sha256: TELEMETRY_CONTRACT_SOURCE_SHA256 }
];
const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ARM = /^\/subscriptions\/474c40eb-d385-40d8-baa2-06883dbdca2d\/resourceGroups\/[^"'\\\r\n]+\/providers\/Microsoft\.Insights\/components\/[^"'\\\r\n]+$/i;
export const RAW_TABLES = ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppEvents', 'AppPageViews'];
const common = { TimeGenerated: 'datetime', OperationId: 'string', ParentId: 'string',
  AppRoleName: 'string', Properties: 'dynamic', _ResourceId: 'string' };
const helper = 'ContosoCollector';
const failure = code => Object.assign(new Error(code), { code });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function captureParameters(parameters) {
  const fromUtc = requireUtc(parameters.fromUtc, 'fromUtc');
  const toUtc = requireUtc(parameters.toUtc, 'toUtc');
  const ingestionWatermarkUtc = requireUtc(parameters.ingestionWatermarkUtc, 'ingestionWatermarkUtc');
  if (!GUID.test(parameters.workspaceId ?? '') || !ARM.test(parameters.resourceId ?? '') ||
      Date.parse(toUtc) <= Date.parse(fromUtc) || Date.parse(toUtc) - Date.parse(fromUtc) > 7200000 ||
      Date.parse(ingestionWatermarkUtc) < Date.parse(toUtc) || Date.parse(ingestionWatermarkUtc) > Date.now()) {
    throw failure('CAPTURE_INVALID_SCOPE_OR_WATERMARK');
  }
  const pageSize = parameters.pageSize ?? 500;
  const maxRows = parameters.maxRows ?? 100000;
  const maxPages = parameters.maxPages ?? 200;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5000 ||
      !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 250000 ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw failure('CAPTURE_UNBOUNDED_PAGINATION');
  return { ...parameters, fromUtc, toUtc, ingestionWatermarkUtc, pageSize, maxRows, maxPages };
}

export function renderRawQuery(table, phase, parameters, pageOrdinal = 0) {
  if (!RAW_TABLES.includes(table) || !['schema', 'count', 'key-count', 'page'].includes(phase)) throw failure('CAPTURE_UNKNOWN_TABLE_OR_PHASE');
  const input = captureParameters(parameters);
  if (!Number.isInteger(pageOrdinal) || pageOrdinal < 0 || pageOrdinal >= input.maxPages) throw failure('CAPTURE_INVALID_PAGE');
  if (phase === 'schema') return `${table} | getschema | project ColumnName,ColumnType`;
  const source = `${table}
| where TimeGenerated >= datetime(${input.fromUtc}) and TimeGenerated < datetime(${input.toUtc})
| where _ResourceId =~ ${JSON.stringify(input.resourceId)}
| extend ${helper}IngestedAt=ingestion_time()`;
  if (phase === 'count') return `${source}
| summarize SnapshotRows=countif(isnotnull(${helper}IngestedAt) and ${helper}IngestedAt<=datetime(${input.ingestionWatermarkUtc})),
    UnwatermarkedRows=countif(isnull(${helper}IngestedAt)),
    RowsBeyondWatermark=countif(${helper}IngestedAt>datetime(${input.ingestionWatermarkUtc})),
    TotalEventWindowRows=count(),
    MaxIngestedAtUtc=maxif(${helper}IngestedAt,${helper}IngestedAt<=datetime(${input.ingestionWatermarkUtc}))`;
  if (phase === 'key-count') {
    if (input.stablePhysicalKey !== '_ItemId') throw failure('CAPTURE_UNOBSERVED_PHYSICAL_KEY');
    return `${source}
| where isnotnull(${helper}IngestedAt) and ${helper}IngestedAt<=datetime(${input.ingestionWatermarkUtc})
| summarize Copies=count() by _ItemId
| summarize PhysicalKeys=count(),DuplicateRows=sum(Copies-1),EmptyKeys=countif(isempty(_ItemId))`;
  }
  const offset = pageOrdinal * input.pageSize;
  return `${source}
| where isnotnull(${helper}IngestedAt) and ${helper}IngestedAt<=datetime(${input.ingestionWatermarkUtc})
| order by TimeGenerated asc,${helper}IngestedAt asc${input.stablePhysicalKey === '_ItemId' ? ',_ItemId asc' : ''}
| serialize ${helper}RowOrdinal=row_number()
| where ${helper}RowOrdinal>${offset} and ${helper}RowOrdinal<=${offset + input.pageSize}`;
}

export function decodeLogsQueryResult(response) {
  if (response?.error || (response?.warnings && (!Array.isArray(response.warnings) || response.warnings.length))) {
    throw failure('CAPTURE_PARTIAL_OR_WARNING_RESPONSE');
  }
  if (!Array.isArray(response?.tables) || response.tables.length !== 1 ||
      response.tables[0].name !== 'PrimaryResult') throw failure('CAPTURE_UNREVIEWED_RESPONSE');
  const result = response.tables[0];
  if (!Array.isArray(result.columns) || !Array.isArray(result.rows) ||
      new Set(result.columns.map(column => column.name)).size !== result.columns.length ||
      result.columns.some(column => typeof column.name !== 'string' || !column.name || typeof column.type !== 'string')) {
    throw failure('CAPTURE_INVALID_RESULT_SCHEMA');
  }
  const rows = result.rows.map(row => {
    if (!Array.isArray(row) || row.length !== result.columns.length) throw failure('CAPTURE_TRUNCATED_ROW');
    return Object.fromEntries(result.columns.map((column, index) => {
      let value = row[index];
      if (column.type === 'dynamic' && typeof value === 'string') {
        try { value = JSON.parse(value); } catch { throw failure('CAPTURE_INVALID_DYNAMIC_VALUE'); }
      }
      return [column.name, value];
    }));
  });
  return { rows, columns: result.columns };
}

async function collectorCodeReceipt() {
  for (const file of loadedCodeFiles) {
    if (sha256(await readFile(join(root, file.path))) !== file.sha256) throw failure('CAPTURE_LOADED_SOURCE_DRIFT');
  }
  return loadedCodeFiles.map(file => ({ ...file }));
}

export async function createAzureLogsExecutor({
  workspaceId, resourceId, azureCliExecutable, azureCliExecutableSha256,
  allowAzureReads = false, readApprovalRef = null
}) {
  if (!allowAzureReads || typeof readApprovalRef !== 'string' || !readApprovalRef.trim() ||
      !GUID.test(workspaceId ?? '') || !ARM.test(resourceId ?? '') ||
      !isAbsolute(azureCliExecutable ?? '') || !HASH.test(azureCliExecutableSha256 ?? '') ||
      sha256(await readFile(azureCliExecutable)) !== azureCliExecutableSha256) {
    throw failure('CAPTURE_APPROVED_PINNED_READ_EXECUTOR_REQUIRED');
  }
  const codeFiles = await collectorCodeReceipt();
  const executor = async request => {
    await collectorCodeReceipt();
    if (request.parameters.workspaceId !== workspaceId || request.parameters.resourceId !== resourceId ||
        request.query !== renderRawQuery(request.table, request.phase, request.parameters, request.pageOrdinal) ||
        request.querySha256 !== sha256(request.query) ||
        sha256(await readFile(azureCliExecutable)) !== azureCliExecutableSha256) throw failure('CAPTURE_EXECUTOR_SCOPE_OR_CODE_DRIFT');
    let stdout;
    try {
      ({ stdout } = await execute(azureCliExecutable, ['rest', '--method', 'post',
        '--url', `https://api.loganalytics.azure.com/v1/workspaces/${workspaceId}/query`,
        '--body', JSON.stringify({ query: request.query }), '--only-show-errors', '--output', 'json'],
      { shell: false, windowsHide: true, timeout: request.timeoutMs, maxBuffer: 33554432 }));
    } catch { throw failure('CAPTURE_NATIVE_QUERY_FAILED'); }
    let response;
    try { response = JSON.parse(stdout); } catch { throw failure('CAPTURE_NATIVE_RESPONSE_INVALID'); }
    freeze(response);
    nativeResponses.set(response, {
      sourceKind: 'azure-monitor-logs', transport: 'pinned-azure-cli-native-stdout',
      querySha256: request.querySha256, workspaceId, resourceId,
      observedAtUtc: new Date().toISOString(), nativeHttpStatus: null, nativeRequestId: null,
      authenticatedPeerVerified: false, sourceAcceptanceIsCertification: false, responseSha256: null
    });
    return response;
  };
  nativeExecutors.set(executor, { schema: 'contoso.query-executor-code-receipt.v1',
    sourceKind: 'azure-monitor-logs', transport: 'azure-cli-rest-logs-query',
    workspaceId, resourceId, codeFiles, azureCliExecutableSha256,
    sourceVerification: 'R9-independent-tool-auth-and-native-source-receipt-required', certificationEligible: false });
  return executor;
}

function validateSchema(table, rows) {
  if (rows.some(row => typeof row.ColumnName !== 'string' || typeof row.ColumnType !== 'string') ||
      new Set(rows.map(row => row.ColumnName)).size !== rows.length ||
      rows.some(row => row.ColumnName.startsWith(helper))) throw failure('CAPTURE_NATIVE_SCHEMA_DRIFT');
  const schema = Object.fromEntries(rows.map(row => [row.ColumnName, row.ColumnType]));
  const required = { ...common, ...(['AppRequests', 'AppDependencies', 'AppPageViews'].includes(table) ? { Id: 'string' } : {}) };
  if (Object.entries(required).some(([name, type]) => schema[name] !== type)) throw failure('CAPTURE_NATIVE_SCHEMA_DRIFT');
  return schema;
}

function counts(rows) {
  if (rows.length !== 1) throw failure('CAPTURE_MISSING_COUNTS');
  const value = rows[0];
  for (const name of ['SnapshotRows', 'UnwatermarkedRows', 'RowsBeyondWatermark', 'TotalEventWindowRows']) {
    if (!Number.isSafeInteger(value[name]) || value[name] < 0) throw failure('CAPTURE_INVALID_COUNTS');
  }
  if (value.SnapshotRows + value.UnwatermarkedRows + value.RowsBeyondWatermark !== value.TotalEventWindowRows) {
    throw failure('CAPTURE_INCONSISTENT_COUNTS');
  }
  if (value.MaxIngestedAtUtc !== null) requireUtc(value.MaxIngestedAtUtc, 'MaxIngestedAtUtc');
  return value;
}

function observeCanary(canary, rows, serializationByRole) {
  if (!HASH.test(canary?.trafficLedgerSha256 ?? '') || !Array.isArray(canary.contexts) ||
      canary.contexts.length < 2 || canary.contexts.length > 32 ||
      !['pre', 'post'].every(position => canary.contexts.some(context => context.position === position))) {
    throw failure('CAPTURE_REAL_CANARY_LEDGER_REQUIRED');
  }
  const keys = new Set();
  const observations = canary.contexts.map(context => {
    const key = `${context.table}:${context.traceId}:${context.spanId}`;
    if (!['pre', 'post'].includes(context.position) || !TRACE.test(context.traceId ?? '') ||
        !SPAN.test(context.spanId ?? '') || !['AppRequests', 'AppDependencies'].includes(context.table) || keys.has(key)) {
      throw failure('CAPTURE_INVALID_CANARY_CONTEXT');
    }
    keys.add(key);
    const physicalRows = rows.filter(row => {
      if (row.nativeTable !== context.table || row.OperationId !== context.traceId) return false;
      try { return canonicalSpanId(row.Id, row.OperationId, serializationByRole[row.AppRoleName]) === context.spanId; }
      catch { return false; }
    }).length;
    return { ...context, physicalRows, observed: physicalRows === 1 };
  });
  return { trafficLedgerSha256: canary.trafficLedgerSha256, observations,
    complete: observations.every(value => value.observed), droppedSpans: null,
    producerAuthentication: 'independent-owner-evidence-required' };
}

export function rawRowEvidenceHash(row, { privacyDisposition }) {
  if (!RAW_TABLES.includes(row?.nativeTable) || privacyDisposition?.result !== 'PASS' ||
      privacyDisposition.scannedAllColumns !== true || privacyDisposition.assessmentScope !== 'graph-intake' ||
      !HASH.test(privacyDisposition.policySha256 ?? '')) throw failure('CAPTURE_APPROVED_RAW_ROW_REQUIRED');
  return ownedConfigurationHash(row);
}

export function requireNativeQueryResponseIdentity(response) {
  const identity = nativeResponses.get(response);
  if (!identity || !Object.isFrozen(response) ||
      (identity.responseSha256 && ownedConfigurationHash(response) !== identity.responseSha256)) {
    throw failure('CAPTURE_NATIVE_QUERY_RESPONSE_IDENTITY_REQUIRED');
  }
  return { ...identity, certificationEligible: false };
}

export function requireNativeCaptureIdentity(capture) {
  const identity = nativeCaptures.get(capture);
  if (!identity || ownedConfigurationHash(capture.rows) !== identity.rawRowsSha256 ||
      ownedConfigurationHash(capture.receipt) !== identity.receiptSha256 ||
      ownedConfigurationHash(capture.privacyDisposition) !== identity.privacyDispositionSha256 ||
      ownedConfigurationHash(capture.rawTables) !== identity.rawTablesSha256 ||
      ownedConfigurationHash(capture.scanReceipt) !== identity.scanReceiptSha256) {
    throw failure('CAPTURE_NATIVE_IDENTITY_REQUIRED');
  }
  if (!Array.isArray(capture.nativeResponses) || capture.nativeResponses.length !== identity.nativeResponseCount) {
    throw failure('CAPTURE_NATIVE_IDENTITY_REQUIRED');
  }
  capture.nativeResponses.forEach(response => requireNativeQueryResponseIdentity(response));
  if (capture.verifiedQueryCapabilities !== identity.verifiedQueryCapabilities) throw failure('CAPTURE_NATIVE_IDENTITY_REQUIRED');
  return { ...identity, certificationEligible: false };
}

export async function collectRawTelemetry(parameters, {
  executeQuery, scanPrivacy, sourceKind = 'fixture-check', verifyQueryExecutorReceipt = null
}) {
  const input = captureParameters(parameters);
  const captureId = input.captureId ?? randomUUID();
  if (!GUID.test(captureId)) throw failure('CAPTURE_INVALID_CAPTURE_ID');
  if (typeof executeQuery !== 'function' || typeof scanPrivacy !== 'function') throw failure('CAPTURE_EXECUTOR_AND_RAW_PRIVACY_SCAN_REQUIRED');
  const executorReceipt = nativeExecutors.get(executeQuery);
  if (sourceKind !== 'fixture-check' && (sourceKind !== 'azure-monitor-logs' || !executorReceipt)) {
    throw failure('CAPTURE_UNVERIFIED_EXECUTOR_PROVENANCE');
  }
  if (executorReceipt && sourceKind !== executorReceipt.sourceKind) throw failure('CAPTURE_EXECUTOR_PROVENANCE_MISMATCH');
  if (executorReceipt && typeof verifyQueryExecutorReceipt !== 'function') throw failure('CAPTURE_NATIVE_OBSERVER_VERIFIER_REQUIRED');
  let requireQueryAuthority = null;
  if (executorReceipt) {
    const observerModule = await import('../verification/observers.mjs');
    requireQueryAuthority = observerModule.requireVerifiedQueryReceiptIdentity;
    if (typeof requireQueryAuthority !== 'function') throw failure('CAPTURE_NATIVE_SOURCE_CAPABILITY_UNAVAILABLE');
  }
  await collectorCodeReceipt();
  const rows = [], tableReceipts = [], queryHashes = [], executedQueries = [], scanTables = [], queryResponses = [], responseRequests = [], verifiedQueryCapabilities = [];
  const deadline = Date.now() + 120000;
  const query = async (table, phase, pageOrdinal = 0, tableInput = input) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure('CAPTURE_DEADLINE');
    const text = renderRawQuery(table, phase, tableInput, pageOrdinal);
    const querySha256 = sha256(text);
    queryHashes.push(querySha256);
    const request = { table, phase, pageOrdinal, query: text, querySha256, parameters: tableInput, timeoutMs: Math.min(30000, remaining) };
    if (executorReceipt) {
      const verified = await verifyQueryExecutorReceipt({ ...executorReceipt, querySha256 }, {
        scope: { workspaceId: input.workspaceId, resourceId: input.resourceId }, querySha256,
        mode: input.mode ?? 'LocalValidate', phase: 'pre-query'
      });
      if (verified?.verified !== true) throw failure('CAPTURE_UNTRUSTED_NATIVE_OBSERVER');
      requireQueryAuthority(verified, { querySha256, phase: 'pre-query',
        scope: { workspaceId: input.workspaceId, resourceId: input.resourceId } });
    }
    let timer;
    try {
      const response = await Promise.race([executeQuery(request), new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure('CAPTURE_QUERY_DEADLINE')), request.timeoutMs);
      })]);
      if (executorReceipt) {
        requireNativeQueryResponseIdentity(response);
        responseRequests.push({ response, querySha256 });
      }
      queryResponses.push(response);
      executedQueries.push({ table, phase, pageOrdinal, querySha256, text });
      return { ...decodeLogsQueryResult(response), querySha256 };
    } finally { clearTimeout(timer); }
  };
  for (const table of RAW_TABLES) {
    const schemaResult = await query(table, 'schema');
    const nativeSchema = validateSchema(table, schemaResult.rows);
    const scanTable = { name: table, columns: schemaResult.rows.map(row => ({ name: row.ColumnName, type: row.ColumnType })), rows: [] };
    scanTables.push(scanTable);
    const before = counts((await query(table, 'count')).rows);
    if (rows.length + before.SnapshotRows > input.maxRows ||
        Math.ceil(before.SnapshotRows / input.pageSize) > input.maxPages) throw failure('CAPTURE_APPROVED_ROW_OR_PAGE_LIMIT');
    const stablePhysicalKey = nativeSchema._ItemId === 'string' ? '_ItemId' : null;
    const tableInput = { ...input, stablePhysicalKey };
    if (before.SnapshotRows > input.pageSize && !stablePhysicalKey) throw failure('CAPTURE_NO_STABLE_PAGINATION_KEY');
    let physicalKeyProof = null;
    if (before.SnapshotRows && stablePhysicalKey) {
      const keyResult = await query(table, 'key-count', 0, tableInput);
      const keys = keyResult.rows[0];
      if (keyResult.rows.length !== 1 || keys.PhysicalKeys !== before.SnapshotRows ||
          keys.DuplicateRows !== 0 || keys.EmptyKeys !== 0) throw failure('CAPTURE_NONUNIQUE_PHYSICAL_KEY');
      physicalKeyProof = { key: stablePhysicalKey, physicalKeys: keys.PhysicalKeys, querySha256: keyResult.querySha256 };
    }
    const pages = [], physicalKeys = new Set();
    for (let ordinal = 0; ordinal < Math.max(1, Math.ceil(before.SnapshotRows / input.pageSize)); ordinal++) {
      const page = await query(table, 'page', ordinal, tableInput);
      if (Object.entries(nativeSchema).some(([name, type]) => !page.columns.some(column => column.name === name && column.type === type)) ||
          page.columns.some(column => !Object.hasOwn(nativeSchema, column.name) &&
            ![`${helper}IngestedAt`, `${helper}RowOrdinal`].includes(column.name))) throw failure('CAPTURE_PAGE_SCHEMA_DRIFT');
      const expectedCount = Math.min(input.pageSize, before.SnapshotRows - ordinal * input.pageSize);
      if (page.rows.length !== expectedCount) throw failure('CAPTURE_INCOMPLETE_PAGE');
      const offset = rows.length;
      for (const [index, raw] of page.rows.entries()) {
        const ingestedAt = Date.parse(requireUtc(raw[`${helper}IngestedAt`], 'native ingestion time'));
        const generatedAt = Date.parse(requireUtc(raw.TimeGenerated, 'native event time'));
        if (raw[`${helper}RowOrdinal`] !== ordinal * input.pageSize + index + 1 ||
            ingestedAt > Date.parse(input.ingestionWatermarkUtc) ||
            generatedAt < Date.parse(input.fromUtc) || generatedAt >= Date.parse(input.toUtc) ||
            typeof raw._ResourceId !== 'string' || raw._ResourceId.toLowerCase() !== input.resourceId.toLowerCase()) {
          throw failure('CAPTURE_PAGE_SCOPE_OR_ORDINAL_DRIFT');
        }
        if (raw.Type !== undefined && raw.Type !== table) throw failure('CAPTURE_NATIVE_TABLE_SCOPE_DRIFT');
        if (raw.TenantId && raw.TenantId.toLowerCase() !== input.workspaceId) throw failure('CAPTURE_NATIVE_WORKSPACE_SCOPE_DRIFT');
        if (stablePhysicalKey) {
          if (typeof raw._ItemId !== 'string' || !raw._ItemId || physicalKeys.has(raw._ItemId)) throw failure('CAPTURE_REPEATED_PHYSICAL_ROW');
          physicalKeys.add(raw._ItemId);
        }
        const { [`${helper}RowOrdinal`]: rowOrdinal, [`${helper}IngestedAt`]: ingestionTime, ...native } = raw;
        scanTable.rows.push(scanTable.columns.map(column => native[column.name]));
        rows.push({ ...native, nativeTable: table, ingestedAtUtc: ingestionTime });
      }
      pages.push({ ordinal, rowCount: page.rows.length, offset, querySha256: page.querySha256 });
    }
    const after = counts((await query(table, 'count')).rows);
    const warnings = [];
    if (ownedConfigurationHash(before) !== ownedConfigurationHash(after)) warnings.push('snapshot-counts-changed');
    if (after.UnwatermarkedRows) warnings.push('native-ingestion-watermark-unavailable');
    if (after.RowsBeyondWatermark) warnings.push('late-ingestion-observed');
    tableReceipts.push({ name: table, count: before.SnapshotRows, complete: !warnings.length,
      schemaSha256: ownedConfigurationHash(nativeSchema), pages, warnings, physicalKeyProof,
      paginationStrategy: stablePhysicalKey ? 'observed-unique-native-physical-key' : 'bounded-single-page' });
  }
  const canary = observeCanary(input.canary, rows, input.serializationByRole ?? {});
  const warnings = tableReceipts.flatMap(table => table.warnings.map(code => `${table.name}:${code}`));
  if (!canary.complete) warnings.push('canary-contexts-missing-or-duplicated');
  const scanReceipt = { captureId, sourceKind, workspaceId: input.workspaceId, resourceId: input.resourceId,
    fromUtc: input.fromUtc, toUtc: input.toUtc, ingestionWatermarkUtc: input.ingestionWatermarkUtc,
    rowCount: rows.length, complete: !warnings.length, paginationComplete: true, tableInventoryComplete: false,
    warnings, tables: tableReceipts };
  const privacyDisposition = await scanPrivacy(scanTables.flatMap(table => table.rows.map(values => ({ table: table.name, values }))), {
    tables: scanTables, receipt: scanReceipt, canaryDisposition: canary,
    assessmentScope: 'graph-intake', sourceKind,
    scope: { workspaceId: input.workspaceId, resourceId: input.resourceId }, fromUtc: input.fromUtc, toUtc: input.toUtc });
  if (privacyDisposition?.result !== 'PASS' || !HASH.test(privacyDisposition.policySha256 ?? '') ||
      privacyDisposition.scannedAllColumns !== true || privacyDisposition.assessmentScope !== 'graph-intake' ||
      privacyDisposition.scannedRawRecords !== rows.length || !Array.isArray(privacyDisposition.tablesScanned) ||
      privacyDisposition.tablesScanned.length !== RAW_TABLES.length ||
      RAW_TABLES.some(table => !privacyDisposition.tablesScanned.includes(table))) throw failure('CAPTURE_RAW_PRIVACY_DISPOSITION_FAILED');
  if (executorReceipt) for (const response of queryResponses) {
    const identity = nativeResponses.get(response);
    identity.responseSha256 = ownedConfigurationHash(response);
  }
  if (executorReceipt) for (const { response, querySha256 } of responseRequests) {
    const verified = await verifyQueryExecutorReceipt({ ...executorReceipt, querySha256,
      nativeResponseReceipt: response.nativeResponseReceipt ?? null, originalNativeResponse: response }, {
      scope: { workspaceId: input.workspaceId, resourceId: input.resourceId }, querySha256,
      mode: input.mode ?? 'LocalValidate', phase: 'post-query', nativeResponses: [response]
    });
    if (verified?.verified !== true) throw failure('CAPTURE_UNTRUSTED_NATIVE_RESPONSE');
    requireQueryAuthority(verified, { querySha256, phase: 'post-query',
      scope: { workspaceId: input.workspaceId, resourceId: input.resourceId } });
    verifiedQueryCapabilities.push(verified);
  }
  for (const table of tableReceipts) for (const page of table.pages) {
    page.sha256 = ownedConfigurationHash(rows.slice(page.offset, page.offset + page.rowCount));
    delete page.offset;
  }
  const receipt = {
    schema: 'contoso.raw-query-capture.v1', captureId, sourceKind, workspaceId: input.workspaceId, resourceId: input.resourceId,
    fromUtc: input.fromUtc, toUtc: input.toUtc, capturedAtUtc: new Date().toISOString(),
    ingestionWatermarkUtc: input.ingestionWatermarkUtc, querySha256: ownedConfigurationHash(queryHashes),
    queryManifestSha256: ownedConfigurationHash(executedQueries), executedQueries,
    rowCount: rows.length, tables: tableReceipts, paginationComplete: true,
    complete: !warnings.length, warnings, canary, privacyPolicySha256: privacyDisposition.policySha256,
    rawRowsSha256: ownedConfigurationHash(rows), collectorCodeFiles: await collectorCodeReceipt(),
    queryExecutorReceipt: executorReceipt ?? { sourceKind: 'fixture-check', certificationEligible: false },
    coverage: 'bounded-event-window-ingested-at-or-before-watermark-only',
    tableInventoryComplete: false, assessmentScope: 'graph-intake', globalTelemetrySafetyVerified: false,
    rawRowsInMemoryOnly: true, delayedOrDroppedTelemetryExcluded: false, certificationEligible: false
  };
  const capture = { rows, receipt, privacyDisposition, rawTables: scanTables, scanReceipt,
    nativeResponses: executorReceipt ? queryResponses : [], verifiedQueryCapabilities };
  if (executorReceipt) nativeCaptures.set(capture, {
    sourceKind: 'azure-monitor-logs', captureId, rawRowsSha256: ownedConfigurationHash(rows),
    receiptSha256: ownedConfigurationHash(receipt), queryManifestSha256: receipt.queryManifestSha256,
    privacyDispositionSha256: ownedConfigurationHash(privacyDisposition),
    rawTablesSha256: ownedConfigurationHash(scanTables), scanReceiptSha256: ownedConfigurationHash(scanReceipt),
    nativeResponseCount: queryResponses.length, verifiedQueryCapabilities, verified: true
  });
  if (executorReceipt) freeze(capture);
  return capture;
}
