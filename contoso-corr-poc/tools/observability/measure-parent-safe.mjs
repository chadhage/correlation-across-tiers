import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { sha256 } from './telemetry-contract.mjs';
import { runLoad, evaluateMeasurements, percentile } from './load.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const java = process.env.CONTOSO_JAVA_EXE;
const agent = process.env.CONTOSO_AGENT_JAR;
assert(java && agent, 'Exact portable JDK25/agent paths required');
const lock = JSON.parse(await readFile(join(root, 'config', 'versions.lock.json'), 'utf8'));
const approved = JSON.parse(await readFile(join(root, 'config', 'observability-load.v1.json'), 'utf8'));
assert.equal(sha256(await readFile(agent)), lock.agent.sha256);
const extension = lock.extensions[0];
const jar = join(root, 'extensions', 'parent-safe-sampler', 'target', 'contoso-parent-safe-sampler-1.0.0.jar');
assert.equal(sha256(await readFile(jar)), extension.sha256);
const m2 = join(root, '.cache', 'r7', 'm2');
const classpath = [join(root, 'extensions', 'parent-safe-sampler', 'target', 'test-classes'),
  ...['opentelemetry-api', 'opentelemetry-context', 'opentelemetry-common'].map(name =>
    join(m2, 'io', 'opentelemetry', name, '1.65.0', `${name}-1.65.0.jar`))];
assert(classpath.every(path => !/opentelemetry-sdk/.test(path)));
const folder = join(root, 'extensions', 'parent-safe-sampler', 'target', 'approved-load');
await mkdir(folder, { recursive: true });
const received = [];
const sleep = delay => new Promise(done => setTimeout(done, delay));
const server = createServer(async (request, response) => {
  if (request.url === '/echo') {
    await sleep(25);
    response.writeHead(200, { 'x-contoso-observed-traceparent': request.headers.traceparent ?? '' }).end('actual controlled 25ms work');
    return;
  }
  try {
    let bytes = Buffer.concat(await Array.fromAsync(request));
    if (request.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
    let data;
    try { const value = JSON.parse(bytes.toString()); data = Array.isArray(value) ? value : [value]; }
    catch { data = bytes.toString().trim().split(/\r?\n/).map(line => JSON.parse(line)); }
    const observedAtUtc = new Date().toISOString();
    received.push(...data.map(envelope => ({ envelope, observedAtUtc, encodedBytes: Buffer.byteLength(JSON.stringify(envelope)) })));
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      itemsReceived: data.length, itemsAccepted: data.length, errors: []
    }));
  } catch { response.writeHead(400).end('invalid native envelope'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const endpoint = `http://127.0.0.1:${server.address().port}/echo`;

async function measure(name, instrumented) {
  const runtime = join(folder, name);
  await mkdir(runtime, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env).filter(key => key.startsWith('APPLICATIONINSIGHTS_') || key.startsWith('OTEL_'))) delete env[key];
  Object.assign(env, {
    TEMP: runtime, TMP: runtime, JAVA_TOOL_OPTIONS: `-Djava.io.tmpdir=${runtime}`,
    APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${randomUUID()};IngestionEndpoint=http://127.0.0.1:${server.address().port};LiveEndpoint=http://127.0.0.1:${server.address().port}`,
    APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true', APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-parent-safe-load',
    APPLICATIONINSIGHTS_CONFIGURATION_CONTENT: JSON.stringify({ sampling: { percentage: 100 },
      selfDiagnostics: { level: 'WARN', destination: 'console' },
      instrumentation: { azureSdk: { enabled: false }, jdbc: { enabled: false }, redis: { enabled: false } } })
  });
  const arguments_ = ['-Xmx384m', ...(instrumented ? [`-javaagent:${agent}`, `-Dotel.javaagent.extensions=${jar}`] : []),
    '-cp', classpath.join(delimiter), 'com.contoso.correlation.sampling.ParentSafeProbeApplication', endpoint,
    ...(!instrumented ? ['baseline'] : [])];
  const child = spawn(java, arguments_, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { if (stdout.length < 65536) stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { if (stdout.length < 65536) stdout += chunk.toString(); });
  const exited = new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code)); });
  try {
    const deadline = Date.now() + 45000;
    let ready;
    while (!(ready = /PARENT_SAFE_PROBE_READY (\d+)/.exec(stdout))) {
      assert(Date.now() < deadline && child.exitCode === null, 'Actual Java service did not become ready');
      await sleep(100);
    }
    const measurements = await runLoad({
      target: `http://127.0.0.1:${ready[1]}/probe`,
      requestsPerSecond: approved.requestsPerSecond, durationSeconds: approved.durationSeconds,
      requestTimeoutMs: approved.requestTimeoutMs, processId: child.pid,
      cpuNormalizationCores: 2, memoryLimitBytes: 8 * 1024 ** 3
    });
    await sleep(6000);
    child.stdin.end('stop\n');
    assert.equal(await Promise.race([exited, sleep(30000).then(() => { throw new Error('Actual Java shutdown deadline'); })]), 0);
    measurements.processId = child.pid;
    measurements.agentEnabled = instrumented;
    measurements.controlledWorkDelayMs = 25;
    measurements.scopeLimit = 'Actual local process; 2-core/8GiB normalization is not observed Azure shared-plan capacity';
    await writeFile(join(runtime, 'measurements.json'), JSON.stringify(measurements, null, 2));
    return measurements;
  } finally { if (child.exitCode === null) child.kill(); }
}

try {
  const baseline = await measure('baseline-api-only', false);
  const instrumented = await measure('pinned-agent-parent-safe', true);
  const ids = new Set(instrumented.receipts.map(value => value.traceId));
  const spans = received.filter(value => ids.has(value.envelope.tags?.['ai.operation.id']) &&
    ['RequestData', 'RemoteDependencyData'].includes(value.envelope.data?.baseType));
  const expected = instrumented.offeredRequests * 2;
  for (const receipt of instrumented.receipts.filter(value => !value.unexpectedError)) {
    const records = spans.filter(value => value.envelope.tags['ai.operation.id'] === receipt.traceId);
    assert.equal(records.length, 2, 'Every declared local request needs its actual server/client records');
    const request = records.find(value => value.envelope.data.baseType === 'RequestData')?.envelope;
    const dependency = records.find(value => value.envelope.data.baseType === 'RemoteDependencyData')?.envelope;
    assert(request && dependency);
    assert.equal(request.tags['ai.operation.parentId'], receipt.parentId);
    assert.equal(dependency.tags['ai.operation.parentId'], request.data.baseData.id);
  }
  const result = evaluateMeasurements({ baseline, instrumented, nativeSpanCount: spans.length,
    expectedSpanCount: expected, encodedEnvelopeBytes: spans.reduce((sum, value) => sum + value.encodedBytes, 0) }, approved);
  const delays = spans.map(value => {
    const duration = /^(\d+)\.(\d\d):(\d\d):(\d\d)\.(\d+)$/.exec(value.envelope.data.baseData.duration ?? '') ??
      /^(\d\d):(\d\d):(\d\d)\.(\d+)$/.exec(value.envelope.data.baseData.duration ?? '');
    if (!duration) return null;
    const fraction = duration.at(-1);
    const parts = duration.slice(1, -1).map(Number);
    const milliseconds = (parts.length === 4
      ? ((parts[0] * 24 + parts[1]) * 3600 + parts[2] * 60 + parts[3]) * 1000
      : (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000)
      + Number(fraction) / 10 ** fraction.length * 1000;
    return Date.parse(value.observedAtUtc) - Date.parse(value.envelope.time) - milliseconds;
  }).filter(Number.isFinite);
  const report = { schema: 'contoso.parent-safe-load-evidence.v1', result, approvedProfile: approved,
    baseline, instrumented, nativeSpanCount: spans.length, expectedNativeSpanCount: expected,
    nativeSpanKeys: spans.map(value => `${value.envelope.tags['ai.operation.id']}:${value.envelope.data.baseData.id}`),
    nativeIngestionDelayP95Ms: percentile(delays, 95), nativeIngestionDelayP99Ms: percentile(delays, 99),
    sourceKind: 'real-local-agent-http-and-process', agentSha256: lock.agent.sha256,
    extensionSha256: extension.sha256, certificationEligible: false,
    azureBillingAndSharedPlanMetrics: 'To Do' };
  assert.equal(new Set(report.nativeSpanKeys).size, spans.length, 'Duplicate native span emissions');
  await writeFile(join(folder, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: result.result, requests: instrumented.completedRequests,
    p95Ms: instrumented.p95Ms, p99Ms: instrumented.p99Ms,
    cpuAveragePercent: instrumented.serviceCpuAveragePercent, cpuPeakPercent: instrumented.serviceCpuPeakPercent,
    memoryPercent: instrumented.serviceMemoryLimitPercent, instrumentationOverheadPercent: result.instrumentationP95OverheadPercent,
    nativeSpans: spans.length, expectedNativeSpans: expected, missingMetrics: result.missingMetrics,
    thresholdBreaches: result.thresholdBreaches, report: join(folder, 'result.json'), certificationEligible: false }));
  if (result.result !== 'PASS') process.exitCode = 2;
} finally { await new Promise(done => server.close(done)); }
