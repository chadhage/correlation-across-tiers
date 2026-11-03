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

test('approved load target never forwards correlation or request data through redirects', async () => {
  let foreignHits = 0;
  let directHits = 0;
  const foreignHeaders = [];
  const destination = createServer((request, response) => {
    foreignHits++;
    foreignHeaders.push(request.headers);
    response.writeHead(200).end('unapproved redirect destination');
  });
  await new Promise(done => destination.listen(0, '127.0.0.1', done));
  const source = createServer((request, response) => {
    if (request.url === '/direct') {
      directHits++;
      response.writeHead(200).end('approved direct response');
    } else if (request.url === '/same-redirect') response.writeHead(307, { location: '/direct' }).end();
    else response.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/foreign` }).end();
  });
  await new Promise(done => source.listen(0, '127.0.0.1', done));
  const measure = path => runLoad({
    target: `http://127.0.0.1:${source.address().port}${path}`,
    requestsPerSecond: 10, durationSeconds: 0.1, processId: process.pid,
    cpuNormalizationCores: 1, memoryLimitBytes: 1024, sampleIntervalMs: 10,
    method: 'POST', body: { fixture: 'synthetic-load-control' },
    headers: { 'x-test-request-context': 'fixture-only' },
    sample: async pid => ({ processId: pid, observedAtUtc: new Date().toISOString(),
      cpuSeconds: 0, workingSetBytes: 512 })
  });
  try {
    const redirected = await measure('/redirect');
    assert.equal(redirected.completedRequests, 1);
    assert.equal(redirected.unexpectedErrorPercent, 100);
    assert.equal(redirected.receipts[0].statusCode, null);
    assert.equal(redirected.receipts[0].unexpectedError, true);
    assert.equal(redirected.receipts[0].errorCategory, 'TypeError');
    assert.equal(foreignHits, 0);
    assert.deepEqual(foreignHeaders, []);
    const sameOriginRedirect = await measure('/same-redirect');
    assert.equal(sameOriginRedirect.receipts[0].statusCode, null);
    assert.equal(sameOriginRedirect.unexpectedErrorPercent, 100);
    assert.equal(directHits, 0);
    const direct = await measure('/direct');
    assert.equal(direct.receipts[0].statusCode, 200);
    assert.equal(direct.unexpectedErrorPercent, 0);
    assert.equal(directHits, 1);
    assert.equal(foreignHits, 0);
  } finally {
    source.closeAllConnections();
    destination.closeAllConnections();
    await Promise.all([new Promise(done => source.close(done)), new Promise(done => destination.close(done))]);
  }
});

test('negative metrics, zero-denominator coverage and missing cost duration never PASS', () => {
  const measured = { baseline: { p95Ms: 10 }, instrumented: {
    p95Ms: 10, p99Ms: 20, unexpectedErrorPercent: 0, serviceCpuAveragePercent: -1,
    serviceCpuPeakPercent: 1, serviceMemoryLimitPercent: 1
  }, nativeSpanCount: 0, expectedSpanCount: 0, billableBytes: -1, variableDailyUsd: -1 };
  const result = evaluateMeasurements(measured, approved);
  assert.equal(result.result, 'INCONCLUSIVE');
  assert(result.missingMetrics.includes('serviceCpuAveragePercent'));
  assert(result.missingMetrics.includes('declaredSpanCoverage'));
  assert(result.missingMetrics.includes('costMeasurementDuration'));
  assert.equal(result.missingDeclaredSpans, null);
  assert.equal(result.actualBillableBytes, null);
  assert.equal(result.actualDailyTotalUsd, null);
});
