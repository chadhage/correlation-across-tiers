import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCatalog, sourceSnapshot } from './demo.mjs';
import { createBoundDirectory, jsonBytes, projectRoot, sha256, verifyManifest, writeManifest } from './files.mjs';
import { UUID } from '../observability/telemetry-contract.mjs';
import { parseBoundedObservationJson } from '../security/native-payload.mjs';
import { createAzureExampleClient, createExampleCredentials, validateAzureExampleConfig, captureAzureExample, decodeObservedLogsResult, exampleFailure } from './adapters/azure-operator.mjs';
import { executeAzureScenario, assertAzureScenario } from './azure-scenarios.mjs';

const fail = code => { throw exampleFailure(code); };
const safeFailure = error => /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code ?? '') ? error.code : 'AZURE_EXAMPLE_FAILED';

export async function runAzureExample({ id, client, approvalReference, outputRoot = path.join(projectRoot, 'evidence'), signal }) {
  const before = await sourceSnapshot();
  const metadata = await client.post('/describe', {}, { signal });
  if (metadata.approvalReference !== approvalReference || metadata.certificationStatus !== 'NOT CERTIFIED' ||
      Date.parse(metadata.startsAtUtc) > Date.now() || Date.parse(metadata.expiresAtUtc) <= Date.now()) {
    fail('AZURE_EXAMPLE_APPROVED_SERVER_WINDOW_REQUIRED');
  }
  const relative = path.relative(projectRoot, outputRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('AZURE_EXAMPLE_OUTPUT_SCOPE');
  const result = { schema: 'contoso.azure-example-result.v1', demoId: id, result: 'FAIL',
    certificationStatus: 'NOT CERTIFIED', sourceAcceptanceIsCertification: false,
    independentlyEnrolledObserver: false, startedAtUtc: new Date().toISOString(),
    reset: { result: 'NOT RUN' } };
  let browser, run, execution, capture;
  const cleanup = async () => {
    let browserError;
    if (browser) {
      try { await browser.close(); } catch { browserError = 'AZURE_EXAMPLE_BROWSER_CLEANUP_FAILED'; }
    }
    if (run) {
      try {
        await client.post(`/runs/${run.runId}/stop`, {});
        result.reset = await client.post(`/runs/${run.runId}/reset`, {});
      } catch (error) { result.reset = { result: 'FAIL', code: safeFailure(error), runId: run.runId }; }
    }
    if (browserError) result.reset = { ...result.reset, result: 'FAIL', browserFailure: browserError };
  };
  try {
    if (['01', '02'].includes(id)) browser = await client.browser();
    try { run = await client.post('/runs', { demoId: Number(id) }, { signal }); }
    catch (error) {
      if (error.recoveryRunId) run = { runId: error.recoveryRunId };
      throw error;
    }
    if (!UUID.test(run?.runId ?? '')) fail('AZURE_EXAMPLE_RUN_ID_INVALID');
    result.runId = run.runId;
    result.baselineSha256 = run.baselineSha256;
    result.executionTarget = { operatorOrigin: client.config.operatorOrigin, gatewayUrl: metadata.gatewayUrl,
      workspaceId: metadata.workspaceId, resourceId: metadata.resourceId, remoteBuildLineageVerified: false };
    await client.post(`/runs/${run.runId}/sampling-on`, {}, { signal });
    execution = await executeAzureScenario({ id, client, run, metadata, browser, signal });
    capture = await captureAzureExample(client, run, { workspaceId: metadata.workspaceId, resourceId: metadata.resourceId }, {
      fromUtc: execution.fromUtc, toUtc: execution.toUtc, signal, browserEvidence: execution.browser
    });
    result.scenario = assertAzureScenario(execution, capture);
    result.captureScope = { tables: capture.metadata, sealedSliceOnly: true, lateOrDroppedSpanAccountingVerified: false };
    if (id === '04') {
      const trusted = execution.inputs.find(input => input.caseId === 'trusted-valid').observedId;
      const wanted = new Set([
        ...execution.observations.publications.map(row => row.envelope_json.traceparent?.split('-')[1]),
        ...execution.observations.attempts.map(row => row.process_traceparent?.split('-')[1])
      ].filter(Boolean));
      const actual = new Set();
      for (const table of ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppEvents', 'AppPageViews']) {
        const rows = decodeObservedLogsResult(await client.post(`/runs/${run.runId}/query`, { table, phase: 'business',
          fromUtc: execution.fromUtc, toUtc: execution.toUtc, watermarkUtc: capture.metadata[0].watermarkUtc,
          invocationId: trusted }, { signal })).rows;
        rows.forEach(row => actual.add(row.OperationId));
      }
      if (!wanted.size || actual.size !== wanted.size || [...wanted].some(trace => !actual.has(trace))) fail('AZURE_EXAMPLE_BUSINESS_LOOKUP_MISMATCH');
      result.lookup = { persistedCohorts: wanted.size, observedCohorts: actual.size, scope: 'declared durable workflow cohorts only' };
    }
    if (id === '14') {
      const candidates = decodeObservedLogsResult(await client.post(`/runs/${run.runId}/query`, {
        table: 'AppRequests', phase: 'orphans', fromUtc: execution.fromUtc, toUtc: execution.toUtc,
        watermarkUtc: capture.metadata[0].watermarkUtc
      }, { signal })).rows;
      if (candidates.length > 2048) fail('AZURE_EXAMPLE_ORPHAN_LIMIT');
      const spans = capture.rows.filter(row => row.recordKind === 'span');
      result.orphans = candidates.map(candidate => {
        const span = spans.find(row => row.nativeOperationId === candidate.OperationId && row.nativeId === candidate.Id);
        if (!span) fail('AZURE_EXAMPLE_ORPHAN_CAPTURE_MISMATCH');
        const parent = spans.find(row => row.traceId === span.traceId && row.spanId === span.parentSpanId);
        return { traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
          classification: parent ? 'canonical-parent-present-serialization-candidate' : 'defect',
          justification: parent ? 'The original query candidate joins the actual captured canonical parent.' : 'No observed parent or independent remote-root justification.' };
      });
      if (result.orphans.some(row => row.classification === 'defect')) fail('AZURE_EXAMPLE_UNEXPLAINED_ORPHAN');
    }
    if (id === '15') {
      const metrics = await client.post(`/runs/${run.runId}/metrics`, {
        fromUtc: execution.fromUtc, toUtc: execution.toUtc
      }, { signal });
      const values = metrics.value;
      if (!Array.isArray(values)) fail('AZURE_EXAMPLE_AZURE_METRICS_INVALID');
      result.load = { ...execution.load, receipts: undefined, metricScope: 'shared App Service plan, not per-JVM',
        resourceMetrics: values.map(metric => ({
          name: metric.name?.value,
          samples: (metric.timeseries ?? []).flatMap(series => series.data ?? [])
            .flatMap(row => Number.isFinite(row.average) || Number.isFinite(row.maximum)
              ? [{ timeStamp: row.timeStamp, average: row.average ?? null, maximum: row.maximum ?? null }] : [])
        })) };
      if (result.load.resourceMetrics.length !== 2 || result.load.resourceMetrics.some(metric => !metric.samples.length)) {
        fail('AZURE_EXAMPLE_AZURE_METRICS_MISSING');
      }
      if (new Set(result.load.resourceMetrics.map(metric => metric.name)).size !== 2 ||
          result.load.resourceMetrics.some(metric => !['CpuPercentage', 'MemoryPercentage'].includes(metric.name) ||
            metric.samples.some(row => !Number.isFinite(row.average) || !Number.isFinite(row.maximum)))) {
        fail('AZURE_EXAMPLE_AZURE_METRICS_MISSING');
      }
      let billedBytes = 0;
      for (const table of ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppEvents', 'AppPageViews']) {
        const rows = decodeObservedLogsResult(await client.post(`/runs/${run.runId}/query`, {
          table, phase: 'billing', fromUtc: execution.fromUtc, toUtc: execution.toUtc,
          watermarkUtc: capture.metadata[0].watermarkUtc
        }, { signal })).rows;
        if (rows.length !== 1 || !Number.isFinite(rows[0].BillableBytes) || rows[0].BillableBytes < 0) fail('AZURE_EXAMPLE_BILLING_MEASUREMENT_MISSING');
        billedBytes += rows[0].BillableBytes;
      }
      result.load.observedBillableBytes = billedBytes;
      result.load.costStatus = 'observed _BilledSize only; retail conversion is an estimate, not an invoice or total platform cost';
      const profile = parseBoundedObservationJson(await readFile(path.join(projectRoot, 'config', 'observability-load.v1.json')));
      result.load.observedLogsCostEstimateUsd = billedBytes / 1e9 * profile.costInputs.analyticsLogsUsdPerBillableGb;
      const breaches = [];
      for (const [field, threshold] of [['p95Ms', profile.thresholds.p95Ms], ['p99Ms', profile.thresholds.p99Ms],
        ['unexpectedErrorPercent', profile.thresholds.unexpectedErrorPercent]]) {
        if (result.load[field] > threshold) breaches.push(field);
      }
      for (const metric of result.load.resourceMetrics) {
        if (metric.name === 'CpuPercentage' && metric.samples.reduce((sum, row) => sum + row.average, 0) /
            metric.samples.length > profile.thresholds.cpuAveragePercent) breaches.push('sharedPlanCpuAverage');
        if (metric.name === 'CpuPercentage' && metric.samples.some(row => row.maximum > profile.thresholds.cpuPeakPercent)) breaches.push('sharedPlanCpuPeak');
        if (metric.name === 'MemoryPercentage' && metric.samples.some(row => row.maximum > profile.thresholds.memoryLimitPercent)) breaches.push('sharedPlanMemoryPeak');
      }
      result.load.thresholdBreaches = breaches;
      result.load.result = breaches.length ? 'FAIL' : 'INCONCLUSIVE';
      if (breaches.length) fail('AZURE_EXAMPLE_LOAD_THRESHOLD_BREACHED');
    }
    if (JSON.stringify(before) !== JSON.stringify(await sourceSnapshot())) fail('AZURE_EXAMPLE_SOURCE_DRIFT');
    result.result = 'OBSERVED';
    result.observedNativeRecords = capture.rows.filter(row => row.recordKind !== 'link').length;
    result.privacy = { result: capture.privacy.result, scope: 'six-table graph intake only', globalPrivacyVerified: false };
  } catch (error) {
    result.failure = { code: safeFailure(error) };
    if (error.safeFindings) result.privacy = { result: 'FAIL', safeFindings: error.safeFindings };
  } finally {
    if (run?.runId) result.runId = run.runId;
    await cleanup(); result.finishedAtUtc = new Date().toISOString();
  }
  if (!['RESTORED', 'ALREADY_RESTORED'].includes(result.reset.result)) result.result = 'FAIL';
  const directory = path.join(outputRoot, `demo-${id}`, `azure-example-${result.startedAtUtc.replaceAll(/[-:.]/g, '')}-${run?.runId ?? 'not-prepared'}`);
  await createBoundDirectory(directory);
  await writeFile(path.join(directory, 'result.json'), jsonBytes(result), { flag: 'wx' });
  await writeFile(path.join(directory, 'source-snapshot.json'), jsonBytes(before), { flag: 'wx' });
  if (capture) {
    const safeRows = capture.rows.map(row => {
      const { recordLocator, workspaceId, subscriptionId, resourceId, nativeProperties, ...rest } = row;
      return { ...rest, nativeProperties, recordLocator: { captureId: recordLocator.captureId,
        nativeTable: recordLocator.nativeTable, rowOrdinal: recordLocator.rowOrdinal } };
    });
    await writeFile(path.join(directory, 'observed-safe-rows.json'), jsonBytes(safeRows), { flag: 'wx' });
  }
  await writeManifest(directory, { sourceKind: 'azure-operator-observation-not-enrolled',
    sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED', demoId: id });
  await verifyManifest(directory);
  return { ...result, evidencePath: path.relative(projectRoot, directory) };
}

export async function azureExamplesMain(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    list: { type: 'boolean' }, check: { type: 'boolean' }, execute: { type: 'boolean' },
    all: { type: 'boolean' }, demo: { type: 'string' }, config: { type: 'string' },
    'config-sha256': { type: 'string' }, 'approval-ref': { type: 'string' }, reset: { type: 'boolean' },
    'run-id': { type: 'string' }, pack: { type: 'string' }, mode: { type: 'string' }
  } });
  if (values.all && values.demo) fail('AZURE_EXAMPLE_AMBIGUOUS_DEMO_SELECTION');
  const { catalog } = await loadCatalog();
  if (values.list) {
    console.log(JSON.stringify({ examples: catalog.demos.map(demo => ({ id: demo.id, title: demo.title })),
      certificationStatus: 'NOT CERTIFIED', azureCallsExecuted: false }));
    return;
  }
  if (!values.config) fail('AZURE_EXAMPLE_CONFIG_REQUIRED');
  const bytes = await readFile(values.config);
  const config = validateAzureExampleConfig(parseBoundedObservationJson(bytes));
  if (values.check) {
    console.log(JSON.stringify({ result: 'CONFIGURATION_VALID', demos: 15, azureCallsExecuted: false, certificationStatus: 'NOT CERTIFIED' }));
    return;
  }
  if (values.mode && values.mode !== 'BootstrapValidate') fail('AZURE_EXAMPLE_CANNOT_CERTIFY');
  if (!values.execute || !/^[a-f0-9]{64}$/.test(values['config-sha256'] ?? '') ||
      sha256(bytes) !== values['config-sha256'] || !values['approval-ref']) fail('AZURE_EXAMPLE_EXPLICIT_EXECUTION_APPROVAL_REQUIRED');
  const client = createAzureExampleClient(config, createExampleCredentials(config));
  if (values.reset) {
    if (!UUID.test(values['run-id'] ?? '')) fail('AZURE_EXAMPLE_RESET_RUN_ID_REQUIRED');
    const metadata = await client.post('/describe', {});
    if (metadata.approvalReference !== values['approval-ref']) fail('AZURE_EXAMPLE_APPROVED_SERVER_WINDOW_REQUIRED');
    const result = await client.post(`/runs/${values['run-id']}/reset`, {});
    console.log(JSON.stringify({ ...result, certificationStatus: 'NOT CERTIFIED' }));
    return;
  }
  const ids = values.all ? catalog.demos.map(demo => demo.id) : [values.demo];
  if (ids.some(id => !catalog.demos.some(demo => demo.id === id))) fail('AZURE_EXAMPLE_DEMO_REQUIRED');
  for (const id of ids) {
    const result = await runAzureExample({ id, client, approvalReference: values['approval-ref'] });
    console.log(JSON.stringify({ demoId: id, result: result.result, failure: result.failure?.code,
      evidencePath: result.evidencePath, certificationStatus: 'NOT CERTIFIED' }));
    if (result.result !== 'OBSERVED') { process.exitCode = 1; break; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await azureExamplesMain(); }
  catch (error) { console.error(safeFailure(error)); process.exitCode = 1; }
}
