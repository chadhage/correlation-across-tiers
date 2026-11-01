import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { percentile, runLoad, evaluateMeasurements } from '../../tools/observability/load.mjs';
const approved = JSON.parse(await readFile(new URL('../../config/observability-load.v1.json', import.meta.url), 'utf8'));
test('user-approved profile is exact and missing measured fields never become zero', () => {
  assert.equal(approved.requestsPerSecond, 10);
  assert.equal(approved.durationSeconds, 120);
  const result = evaluateMeasurements({ baseline: {}, instrumented: {}, nativeSpanCount: null, expectedSpanCount: null }, approved);
  assert.equal(result.result, 'INCONCLUSIVE');
  assert(result.missingMetrics.includes('serviceCpuAveragePercent'));
  assert(result.missingMetrics.includes('actualAzureBillableBytes'));
  assert.equal(result.actualLogsCostUsd, null);
  assert.equal(result.instrumentationP95OverheadPercent, null);
});
test('latency/CPU/memory/errors/overhead/span breaches are nonpassing', () => {
  const result = evaluateMeasurements({ baseline: { p95Ms: 100 }, instrumented: {
    p95Ms: 1100, p99Ms: 2600, unexpectedErrorPercent: 2,
    serviceCpuAveragePercent: 71, serviceCpuPeakPercent: 91, serviceMemoryLimitPercent: 81
  }, nativeSpanCount: 7, expectedSpanCount: 8, billableBytes: 10, variableDailyUsd: 1 }, approved);
  assert.equal(result.result, 'FAIL');
  assert.equal(result.missingDeclaredSpans, 1);
  assert.equal(result.thresholdBreaches.length, 8);
});
test('bounded real HTTP measurement keeps actual metrics and source separate from certification', async () => {
  const server = createServer((request, response) => response.writeHead(200).end('real loopback response'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let cpu = 0;
  try {
    const result = await runLoad({ target: `http://127.0.0.1:${server.address().port}`,
      requestsPerSecond: 10, durationSeconds: 0.3, processId: process.pid, cpuNormalizationCores: 1,
      memoryLimitBytes: 1024, sampleIntervalMs: 50,
      sample: async pid => ({ processId: pid, observedAtUtc: new Date().toISOString(), cpuSeconds: cpu += 0.001, workingSetBytes: 512 }) });
    assert.equal(result.offeredRequests, 3);
    assert.equal(result.completedRequests, 3);
    assert.equal(result.unexpectedErrorPercent, 0);
    assert.equal(result.certificationEligible, false);
    assert.equal(percentile([1, 2, 3, 4], 95), 4);
  } finally { await new Promise(done => server.close(done)); }
});
test('remote traffic and excessive duration/RPS require bounded explicit approval', async () => {
  await assert.rejects(runLoad({ target: 'https://unapproved.example', requestsPerSecond: 10, durationSeconds: 1 }));
  await assert.rejects(runLoad({ target: 'http://127.0.0.1', requestsPerSecond: 11, durationSeconds: 1 }));
});
