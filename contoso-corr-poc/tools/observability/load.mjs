import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pause = delay => new Promise(done => setTimeout(done, delay));
export const percentile = (values, p) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(p / 100 * ordered.length) - 1)];
};

export async function sampleProcess(processId) {
  if (!Number.isInteger(processId) || processId < 1) throw new TypeError('Actual service PID required');
  const { stdout } = await execute(process.env.CONTOSO_PWSH_EXE ?? 'pwsh',
    ['-NoProfile', '-File', join(root, 'tools', 'observability', 'process-metrics.ps1'), '-ProcessId', String(processId)],
    { windowsHide: true, timeout: 10000, maxBuffer: 32768 });
  const value = JSON.parse(stdout);
  if (value.processId !== processId || !Number.isFinite(value.cpuSeconds) || value.cpuSeconds < 0 ||
      !Number.isFinite(Date.parse(value.processStartedAtUtc)) ||
      !Number.isFinite(value.workingSetBytes) || value.workingSetBytes <= 0) throw new TypeError('Missing actual service metric');
  return value;
}

export async function runLoad({
  target, requestsPerSecond, durationSeconds, requestTimeoutMs = 5000,
  processId, cpuNormalizationCores, memoryLimitBytes, sampleIntervalMs = 2000,
  approvedRemoteTraffic = false, trafficApprovalRef = null, approvedOrigins = [],
  method = 'GET', body = null, headers = {}, sample = sampleProcess
}) {
  const url = new URL(target);
  if (url.username || url.password || url.hash ||
      (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
       (!approvedRemoteTraffic || !trafficApprovalRef || !approvedOrigins.includes(url.origin) || url.protocol !== 'https:'))) throw new TypeError('Approved target required');
  if (!['GET', 'POST'].includes(method)) throw new TypeError('Unapproved request method');
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0 || requestsPerSecond > 10 ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 120) throw new TypeError('Unapproved load envelope');
  if (!Number.isFinite(cpuNormalizationCores) || cpuNormalizationCores < 1 ||
      !Number.isFinite(memoryLimitBytes) || memoryLimitBytes <= 0) throw new TypeError('Explicit CPU/memory normalization required');
  const samples = [];
  const metricErrors = [];
  let sampling = true;
  const monitor = (async () => {
    while (sampling) {
      try { samples.push(await sample(processId)); } catch (failure) { metricErrors.push(failure.name); }
      await pause(sampleIntervalMs);
    }
  })();
  const receipts = [];
  const durationMs = durationSeconds * 1000;
  const requestCount = Math.round(requestsPerSecond * durationSeconds);
  const began = performance.now();
  const requests = [];
  try {
    for (let index = 0; index < requestCount; index++) {
      const due = began + index * 1000 / requestsPerSecond;
      if (performance.now() < due) await pause(due - performance.now());
      const traceId = randomBytes(16).toString('hex');
      const parentId = randomBytes(8).toString('hex');
      requests.push((async () => {
        const start = performance.now();
        const receipt = { index, traceId, parentId, startedAtUtc: new Date().toISOString() };
        try {
          const response = await fetch(url, { method, redirect: 'error', body: body === null ? undefined : JSON.stringify(body),
            headers: { ...(body === null ? {} : { 'content-type': 'application/json' }), ...headers,
            traceparent: `00-${traceId}-${parentId}-01`, 'x-contoso-probe-case': `load-${index}` },
          signal: AbortSignal.timeout(requestTimeoutMs) });
          await response.arrayBuffer();
          receipt.statusCode = response.status;
          receipt.unexpectedError = !response.ok;
        } catch (failure) {
          receipt.statusCode = null;
          receipt.unexpectedError = true;
          receipt.errorCategory = failure.name;
        }
        receipt.durationMs = performance.now() - start;
        receipts.push(receipt);
      })());
    }
    await Promise.all(requests);
    if (performance.now() - began < durationMs) await pause(durationMs - (performance.now() - began));
    try { samples.push(await sample(processId)); } catch (failure) { metricErrors.push(failure.name); }
  } finally { sampling = false; await monitor; }
  const percentages = [];
  for (let index = 1; index < samples.length; index++) {
    const first = samples[index - 1], second = samples[index];
    const seconds = (Date.parse(second.observedAtUtc) - Date.parse(first.observedAtUtc)) / 1000;
    if (seconds > 0 && second.cpuSeconds >= first.cpuSeconds) {
      percentages.push(100 * (second.cpuSeconds - first.cpuSeconds) / seconds / cpuNormalizationCores);
    }
  }
  const first = samples[0], last = samples.at(-1);
  const elapsed = first && last ? (Date.parse(last.observedAtUtc) - Date.parse(first.observedAtUtc)) / 1000 : null;
  const continuity = samples.every((value, index) => value.processId === processId &&
    Number.isFinite(value.cpuSeconds) && value.cpuSeconds >= 0 &&
    Number.isFinite(value.workingSetBytes) && value.workingSetBytes > 0 &&
    Number.isFinite(Date.parse(value.observedAtUtc)) &&
    (!index || (value.cpuSeconds >= samples[index - 1].cpuSeconds &&
      Date.parse(value.observedAtUtc) >= Date.parse(samples[index - 1].observedAtUtc))) &&
    (sample !== sampleProcess || value.processStartedAtUtc === first?.processStartedAtUtc));
  if (!continuity) metricErrors.push('ProcessMetricContinuity');
  const cpuAverage = continuity && elapsed > 0 ? 100 * (last.cpuSeconds - first.cpuSeconds) / elapsed / cpuNormalizationCores : null;
  const peakMemory = samples.length ? Math.max(...samples.map(value => value.workingSetBytes)) : null;
  return {
    schema: 'contoso.observability-measurements.v1', sourceKind: sample === sampleProcess ? 'actual-http-and-local-process' : 'fixture-metrics-with-real-http',
    targetOrigin: url.origin, requestedRps: requestsPerSecond, requestedSeconds: durationSeconds,
    offeredRequests: requestCount, completedRequests: receipts.length,
    elapsedMs: performance.now() - began,
    p95Ms: percentile(receipts.map(value => value.durationMs), 95),
    p99Ms: percentile(receipts.map(value => value.durationMs), 99),
    unexpectedErrorPercent: receipts.length ? 100 * receipts.filter(value => value.unexpectedError).length / receipts.length : null,
    serviceCpuAveragePercent: Number.isFinite(cpuAverage) ? cpuAverage : null,
    serviceCpuPeakPercent: continuity && percentages.length ? Math.max(...percentages) : null,
    servicePeakWorkingSetBytes: peakMemory,
    serviceMemoryLimitPercent: peakMemory === null ? null : peakMemory / memoryLimitBytes * 100,
    cpuNormalizationCores, memoryLimitBytes, metricErrors, samples, receipts,
    certificationEligible: false, azureResourceMetrics: 'To Do'
  };
}

export function evaluateMeasurements({ baseline, instrumented, nativeSpanCount, expectedSpanCount,
  billableBytes = null, variableDailyUsd = null, encodedEnvelopeBytes = null }, approved) {
  const missing = [];
  const breaches = [];
  const thresholds = approved.thresholds;
  const pairs = [
    ['p95Ms', thresholds.p95Ms], ['p99Ms', thresholds.p99Ms],
    ['unexpectedErrorPercent', thresholds.unexpectedErrorPercent],
    ['serviceCpuAveragePercent', thresholds.cpuAveragePercent],
    ['serviceCpuPeakPercent', thresholds.cpuPeakPercent],
    ['serviceMemoryLimitPercent', thresholds.memoryLimitPercent]
  ];
  for (const [field, maximum] of pairs) {
    if (!Number.isFinite(instrumented[field]) || instrumented[field] < 0 ||
        (field === 'unexpectedErrorPercent' && instrumented[field] > 100)) missing.push(field);
    else if (instrumented[field] > maximum) breaches.push(field);
  }
  const overhead = Number.isFinite(baseline.p95Ms) && baseline.p95Ms > 0 && Number.isFinite(instrumented.p95Ms) && instrumented.p95Ms >= 0
    ? (instrumented.p95Ms / baseline.p95Ms - 1) * 100 : null;
  if (overhead === null) missing.push('baselineP95Overhead');
  else if (overhead > thresholds.instrumentationP95OverheadPercent) breaches.push('instrumentationP95Overhead');
  const validCoverage = Number.isSafeInteger(nativeSpanCount) && nativeSpanCount >= 0 &&
    Number.isSafeInteger(expectedSpanCount) && expectedSpanCount > 0;
  if (!validCoverage) missing.push('declaredSpanCoverage');
  else if (nativeSpanCount !== expectedSpanCount) breaches.push('declaredSpanCoverage');
  const validBilling = Number.isFinite(billableBytes) && billableBytes >= 0;
  const validVariable = Number.isFinite(variableDailyUsd) && variableDailyUsd >= 0;
  const validDuration = Number.isFinite(instrumented.requestedSeconds) && instrumented.requestedSeconds > 0 && instrumented.requestedSeconds <= 120;
  if (!validBilling) missing.push('actualAzureBillableBytes');
  if (!validVariable) missing.push('actualVariableDailyMeters');
  if (!validDuration) missing.push('costMeasurementDuration');
  if (instrumented.metricErrors?.length || baseline.metricErrors?.length) missing.push('serviceMetricContinuity');
  const billableGb = validBilling ? billableBytes / 1e9 : null;
  const actualLogsCost = billableGb === null ? null : billableGb * approved.costInputs.analyticsLogsUsdPerBillableGb;
  const actualDailyTotal = actualLogsCost !== null && validVariable && validDuration
    ? approved.costInputs.rootFixedDailyUsd + actualLogsCost * 86400 / instrumented.requestedSeconds + variableDailyUsd : null;
  if (actualDailyTotal !== null && actualDailyTotal > approved.budget.dailyTargetUsd) breaches.push('dailyBudgetTarget');
  const encodedEstimate = Number.isFinite(encodedEnvelopeBytes) && encodedEnvelopeBytes >= 0
    ? encodedEnvelopeBytes / 1e9 * approved.costInputs.analyticsLogsUsdPerBillableGb : null;
  return {
    result: breaches.length ? 'FAIL' : missing.length ? 'INCONCLUSIVE' : 'PASS',
    missingMetrics: missing, thresholdBreaches: breaches, instrumentationP95OverheadPercent: overhead,
    expectedSpanCount, nativeSpanCount, missingDeclaredSpans: validCoverage
      ? Math.max(0, expectedSpanCount - nativeSpanCount) : null,
    actualBillableBytes: validBilling ? billableBytes : null, actualLogsCostUsd: actualLogsCost,
    actualVariableDailyUsd: validVariable ? variableDailyUsd : null, actualDailyTotalUsd: actualDailyTotal, encodedEnvelopeBytes,
    encodedSizeCostEstimateUsd: encodedEstimate,
    costEstimateBasis: 'Encoded payload proxy is not _BilledSize/invoice; root fixed/variable meters remain independently owned by R1',
    dailyBudgetTargetUsd: approved.budget.dailyTargetUsd, intendedLifetimeHours: approved.budget.intendedLifetimeHours,
    certificationEligible: false, azureSloCertification: 'To Do'
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = parseArgs({ options: { plan: { type: 'string' }, output: { type: 'string' } } }).values;
  if (!values.plan || !values.output) throw new Error('Usage: load.mjs --plan runtime-load-plan.json --output report.json');
  const plan = JSON.parse(await readFile(values.plan, 'utf8'));
  const measured = await runLoad(plan);
  await writeFile(values.output, JSON.stringify(measured, null, 2));
  const missing = ['p95Ms', 'p99Ms', 'serviceCpuAveragePercent', 'serviceCpuPeakPercent', 'serviceMemoryLimitPercent']
    .filter(field => !Number.isFinite(measured[field]));
  const nonpassing = missing.length > 0 || measured.metricErrors.length > 0 || measured.completedRequests !== measured.offeredRequests;
  console.log(JSON.stringify({ result: nonpassing ? 'INCONCLUSIVE' : 'MEASURED', requests: measured.completedRequests,
    p95Ms: measured.p95Ms, p99Ms: measured.p99Ms, metricErrors: measured.metricErrors, certificationEligible: false }));
  if (nonpassing) process.exitCode = 2;
}
