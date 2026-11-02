import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_POLICY, GUARD_ARTIFACT_VERSION, sha256 } from './telemetry-contract.mjs';
import { runLoad, evaluateMeasurements, percentile } from './load.mjs';
import { createSamplerEvidenceDirectory, openSamplerNativeReceiver,
  samplerFailureDiagnostic, writeSamplerEvidence } from './sampler-native-intake.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const java = process.env.CONTOSO_JAVA_EXE;
const agent = process.env.CONTOSO_AGENT_JAR;
assert(java && agent, 'Exact portable JDK25/agent paths required');
const lock = JSON.parse(await readFile(join(root, 'config', 'versions.lock.json'), 'utf8'));
const approved = JSON.parse(await readFile(join(root, 'config', 'observability-load.v1.json'), 'utf8'));
assert.equal(sha256(await readFile(agent)), lock.agent.sha256);
const extension = lock.extensions[0];
assert.equal(extension.version, GUARD_ARTIFACT_VERSION);
const jar = join(root, 'extensions', 'parent-safe-sampler', 'target', extension.file.split(/[\\/]/).at(-1));
assert.equal(sha256(await readFile(jar)), extension.sha256);
const m2 = resolve(process.env.CONTOSO_OBSERVABILITY_M2 ?? join(root, '.cache', 'r7', 'm2'));
const classpath = [join(root, 'extensions', 'parent-safe-sampler', 'target', 'test-classes'),
  ...['opentelemetry-api', 'opentelemetry-context', 'opentelemetry-common'].map(name =>
    join(m2, 'io', 'opentelemetry', name, '1.65.0', `${name}-1.65.0.jar`))];
assert(classpath.every(path => !/opentelemetry-sdk/.test(path)));
const executionId = `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`;
const folder = await createSamplerEvidenceDirectory(process.env.CONTOSO_OBSERVABILITY_OUTPUT ??
  join(root, 'extensions', 'parent-safe-sampler', 'target', 'approved-load',
    `${extension.version}-${extension.sha256.slice(0, 12)}`, executionId));
const sleep = delay => new Promise(done => setTimeout(done, delay));

async function measure(name, instrumented) {
  const runtime = join(folder, name);
  await mkdir(runtime);
  const env = { ...process.env };
  for (const key of Object.keys(env).filter(key => key.startsWith('APPLICATIONINSIGHTS_') || key.startsWith('OTEL_'))) delete env[key];
  for (const key of ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'NODE_OPTIONS']) delete env[key];
  const fixtureKey = randomUUID();
  const receiver = await openSamplerNativeReceiver({
    publisherKeys: [fixtureKey],
    forbiddenValues: [`InstrumentationKey=${fixtureKey}`],
    onEcho: async () => { await sleep(25); }
  });
  const endpoint = `${receiver.endpoint}/echo`;
  Object.assign(env, {
    TEMP: runtime, TMP: runtime,
    APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${fixtureKey};IngestionEndpoint=${receiver.endpoint};LiveEndpoint=${receiver.endpoint}`,
    APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true', APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-parent-safe-load',
    OTEL_INSTRUMENTATION_JDK_HTTP_SERVER_ENABLED: 'false',
    APPLICATIONINSIGHTS_CONFIGURATION_CONTENT: JSON.stringify({ sampling: { percentage: 100, overrides: [] },
      selfDiagnostics: { level: 'WARN', destination: 'console' },
      instrumentation: { azureSdk: { enabled: false }, jdbc: { enabled: false }, redis: { enabled: false } } })
  });
  const arguments_ = ['-Xmx384m', `-Djava.io.tmpdir=${runtime}`, '-Dotel.instrumentation.jdk-http-server.enabled=false',
    ...(instrumented ? [`-javaagent:${agent}`, `-Dotel.javaagent.extensions=${jar}`] : []),
    '-cp', classpath.join(delimiter), 'com.contoso.correlation.sampling.ParentSafeProbeApplication', endpoint,
    ...(!instrumented ? ['baseline'] : [])];
  let child, stage = 'readiness';
  async function recordFailure(failure) {
    const diagnostic = samplerFailureDiagnostic(failure, stage);
    await writeSamplerEvidence(runtime, 'failed-observation.json', {
      schema: 'contoso.sampler-safe-failure.v1', result: 'FAIL_OR_UNVERIFIED', phase: name,
      ...diagnostic, javaPid: Number.isSafeInteger(child?.pid) ? child.pid : null,
      sourceKind: 'real-local-agent-http-and-process', certificationEligible: false,
      receiverDiagnostics: receiver.diagnostics(),
      allTablePrivacyGateVerified: false
    });
    return diagnostic;
  }
  try { child = spawn(java, arguments_, { env, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (failure) {
    const diagnostic = await recordFailure(failure);
    await receiver.stop();
    throw new Error(`SAMPLER_LOAD_FAILED:${diagnostic.failureStage}:${diagnostic.failureCode}`);
  }
  let stdout = '';
  child.stdout.on('data', chunk => { if (stdout.length < 65536) stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { if (stdout.length < 65536) stdout += chunk.toString(); });
  let startupError;
  const exited = new Promise(done => {
    child.once('error', error => { startupError = error; done(null); });
    child.once('exit', code => done(code));
  });
  try {
    const deadline = Date.now() + 45000;
    let ready;
    while (!(ready = /PARENT_SAFE_PROBE_READY (\d+)/.exec(stdout))) {
      if (startupError) throw startupError;
      assert(Date.now() < deadline && !startupError && child.exitCode === null && child.signalCode === null,
        'Actual Java service did not become ready');
      await sleep(100);
    }
    stage = 'load';
    const measurements = await runLoad({
      target: `http://127.0.0.1:${ready[1]}/probe`,
      requestsPerSecond: approved.requestsPerSecond, durationSeconds: approved.durationSeconds,
      requestTimeoutMs: approved.requestTimeoutMs, processId: child.pid,
      cpuNormalizationCores: 2, memoryLimitBytes: 8 * 1024 ** 3
    });
    await sleep(6000);
    stage = 'shutdown';
    child.stdin.end('stop\n');
    let shutdownTimer;
    const code = await Promise.race([exited, new Promise((_, reject) => {
      shutdownTimer = setTimeout(() => reject(new Error('Actual Java shutdown deadline')), 30000);
    })]).finally(() => clearTimeout(shutdownTimer));
    assert.equal(code, 0);
    stage = 'native-intake';
    const captured = await receiver.finish();
    measurements.processId = child.pid;
    measurements.agentEnabled = instrumented;
    measurements.controlledWorkDelayMs = 25;
    measurements.scopeLimit = 'Actual local process; 2-core/8GiB normalization is not observed Azure shared-plan capacity';
    stage = 'evidence-write';
    await writeSamplerEvidence(runtime, 'measurements.json', measurements);
    await writeSamplerEvidence(runtime, 'native-intake-receipts.json', captured.originalPrivacyCapture);
    await writeSamplerEvidence(runtime, 'receiver-diagnostics.json', captured.receiverDiagnostics);
    return { measurements, captured };
  } catch (failure) {
    const diagnostic = await recordFailure(failure);
    throw new Error(`SAMPLER_LOAD_FAILED:${diagnostic.failureStage}:${diagnostic.failureCode}`);
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    await receiver.stop();
  }
}

let summaryStage = 'load-baseline';
try {
  const baselineRun = await measure('baseline-api-only', false);
  summaryStage = 'load-instrumented';
  const instrumentedRun = await measure('pinned-agent-parent-safe', true);
  const baseline = baselineRun.measurements;
  const instrumented = instrumentedRun.measurements;
  const received = instrumentedRun.captured.observations;
  const ids = new Set(instrumented.receipts.map(value => value.traceId));
  const spans = received.filter(value => ids.has(value.envelope.tags?.['ai.operation.id']) &&
    ['RequestData', 'RemoteDependencyData'].includes(value.envelope.data?.baseType));
  const expected = instrumented.offeredRequests * 2;
  summaryStage = 'load-correspondence';
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
  const report = { schema: 'contoso.parent-safe-load-evidence.v1', result, executionId, approvedProfile: approved,
    baseline, instrumented, nativeSpanCount: spans.length, expectedNativeSpanCount: expected,
    nativeSpanKeys: spans.map(value => `${value.envelope.tags['ai.operation.id']}:${value.envelope.data.baseData.id}`),
    nativeIngestionDelayP95Ms: percentile(delays, 95), nativeIngestionDelayP99Ms: percentile(delays, 99),
    sourceKind: 'real-local-agent-http-and-process', agentSha256: lock.agent.sha256,
    extensionSha256: extension.sha256, certificationEligible: false,
    guardPolicy: GUARD_POLICY, artifactVersion: GUARD_ARTIFACT_VERSION,
    originalPrivacyCapture: instrumentedRun.captured.originalPrivacyCapture,
    receiverDiagnostics: instrumentedRun.captured.receiverDiagnostics,
    baselineNativeIntake: baselineRun.captured.originalPrivacyCapture,
    encodedBytesScope: instrumentedRun.captured.encodedBytesScope,
    allTablePrivacyGateVerified: false,
    azureBillingAndSharedPlanMetrics: 'To Do' };
  summaryStage = 'load-summary';
  assert.equal(new Set(report.nativeSpanKeys).size, spans.length, 'Duplicate native span emissions');
  await writeSamplerEvidence(folder, 'result.json', report);
  console.log(JSON.stringify({ result: result.result, requests: instrumented.completedRequests,
    p95Ms: instrumented.p95Ms, p99Ms: instrumented.p99Ms,
    cpuAveragePercent: instrumented.serviceCpuAveragePercent, cpuPeakPercent: instrumented.serviceCpuPeakPercent,
    memoryPercent: instrumented.serviceMemoryLimitPercent, instrumentationOverheadPercent: result.instrumentationP95OverheadPercent,
    nativeSpans: spans.length, expectedNativeSpans: expected, missingMetrics: result.missingMetrics,
    thresholdBreaches: result.thresholdBreaches, report: join(folder, 'result.json'), certificationEligible: false }));
  if (result.result !== 'PASS') process.exitCode = 2;
} catch (failure) {
  const diagnostic = samplerFailureDiagnostic(failure, summaryStage);
  await writeSamplerEvidence(folder, 'failed-observation.json', {
    schema: 'contoso.sampler-safe-failure.v1', result: 'FAIL_OR_UNVERIFIED',
    phase: 'load-summary', ...diagnostic, certificationEligible: false, allTablePrivacyGateVerified: false
  });
  throw new Error(`SAMPLER_LOAD_FAILED:${diagnostic.failureStage}:${diagnostic.failureCode}`);
}
