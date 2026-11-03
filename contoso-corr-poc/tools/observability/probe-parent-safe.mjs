import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GUARD_POLICY, GUARD_ARTIFACT_VERSION, ownedConfigurationHash, SPAN, TRACE } from './telemetry-contract.mjs';
import { createSamplerEvidenceDirectory, openSamplerNativeReceiver,
  projectSamplerFailureObservation, projectSamplerNativeSpans, samplerFailureDiagnostic,
  selectSamplerNativeSpans, writeSamplerEvidence } from './sampler-native-intake.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const options = parseArgs({ options: {
  java: { type: 'string' }, agent: { type: 'string' }, jar: { type: 'string' },
  m2: { type: 'string' }, output: { type: 'string' }
} }).values;
const java = options.java ?? process.env.CONTOSO_JAVA_EXE;
const agent = options.agent ?? process.env.CONTOSO_AGENT_JAR;
const modulePath = join(project, 'extensions', 'parent-safe-sampler');
const lock = JSON.parse(await readFile(join(project, 'config', 'versions.lock.json'), 'utf8'));
const extension = lock.extensions?.[0];
assert.equal(lock.extensions?.length, 1);
assert.equal(extension?.version, GUARD_ARTIFACT_VERSION);
const jar = resolve(options.jar ?? join(modulePath, 'target', extension.file.split(/[\\/]/).at(-1)));
const m2 = resolve(options.m2 ?? join(project, '.cache', 'r7', 'm2'));
const executionId = `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`;
const output = resolve(options.output ?? join(modulePath, 'target', 'agent-probe',
  `${extension.version}-${extension.sha256.slice(0, 12)}`, executionId));
assert(java && agent, 'Exact portable java and pinned agent paths are required');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const agentHash = digest(await readFile(agent));
assert.equal(lock.agent.version, '3.7.10');
assert.equal(agentHash, lock.agent.sha256, 'Agent checksum mismatch');
const jarHash = digest(await readFile(jar));
assert.equal(jarHash, lock.extensions?.[0]?.sha256, 'Extension checksum mismatch against the sole approved lock');
const api = join(m2, 'io', 'opentelemetry', 'opentelemetry-api', '1.65.0', 'opentelemetry-api-1.65.0.jar');
const context = join(m2, 'io', 'opentelemetry', 'opentelemetry-context', '1.65.0', 'opentelemetry-context-1.65.0.jar');
const common = join(m2, 'io', 'opentelemetry', 'opentelemetry-common', '1.65.0', 'opentelemetry-common-1.65.0.jar');
await Promise.all([java, api, context, common, jar].map(path => access(path)));
await createSamplerEvidenceDirectory(output);
const jarTool = process.env.CONTOSO_JAR_EXE ?? join(dirname(java), 'jar.exe');
const entries = execFileSync(jarTool, ['--list', '--file', jar], { encoding: 'utf8' }).trim().split(/\r?\n/);
const service = 'META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider';
assert.equal(entries.filter(entry => entry === service).length, 1);
assert.equal(entries.filter(entry => entry.endsWith('.jar') || entry.startsWith('io/opentelemetry/')).length, 0,
  'Extension must not contain runtime SDK/API classes or nested JARs');
const classes = entries.filter(entry => entry.endsWith('.class'));
assert(classes.every(entry => entry.startsWith('com/contoso/correlation/sampling/')));
assert(classes.includes('com/contoso/correlation/sampling/ParentSafeSampler.class'));
assert(classes.includes('com/contoso/correlation/sampling/ParentSafeSamplerCustomizer.class'));
const classpathEntries = [join(modulePath, 'target', 'test-classes'), api, context, common];
assert(classpathEntries.every(path => !/opentelemetry-sdk/i.test(path)), 'No SDK implementation in app runtime classpath');
const sleep = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const phases = [];

async function phase(name, percentage, requestsPerSecond = null) {
  const runtime = join(output, name);
  await mkdir(runtime);
  const env = { ...process.env };
  for (const key of ['APPLICATIONINSIGHTS_AUTHENTICATION_STRING', 'AZURE_CLIENT_SECRET',
    'APPLICATIONINSIGHTS_CONFIGURATION_FILE', 'APPLICATIONINSIGHTS_SAMPLING_REQUESTS_PER_SECOND',
    'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_JAVAAGENT_EXTENSIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'APPLICATIONINSIGHTS_PROXY',
    'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE']) {
    delete env[key];
  }
  const fixtureKey = randomUUID();
  const echoes = new Map();
  const receiver = await openSamplerNativeReceiver({
    publisherKeys: [fixtureKey],
    forbiddenValues: [`InstrumentationKey=${fixtureKey}`],
    onEcho(request) {
      const caseId = request.headers['x-contoso-probe-case'];
      assert([`${name}-sampled`, `${name}-unsampled`].includes(caseId));
      echoes.set(caseId, {
        traceparent: request.headers.traceparent ?? null, tracestate: request.headers.tracestate ?? null
      });
    }
  });
  const endpoint = receiver.endpoint;
  Object.assign(env, {
    TEMP: runtime, TMP: runtime,
    APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${fixtureKey};IngestionEndpoint=${endpoint};LiveEndpoint=${endpoint}`,
    APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-parent-safe-probe', OTEL_SERVICE_NAME: 'contoso-parent-safe-probe',
    APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true',
    APPLICATIONINSIGHTS_CONFIGURATION_CONTENT: JSON.stringify({
      sampling: requestsPerSecond === null ? { percentage, overrides: [] } : { requestsPerSecond, overrides: [] },
      selfDiagnostics: { level: 'WARN', destination: 'console' },
      instrumentation: { azureSdk: { enabled: false }, jdbc: { enabled: false }, redis: { enabled: false } }
    }),
    OTEL_INSTRUMENTATION_JDK_HTTP_SERVER_ENABLED: 'false'
  });
  if (requestsPerSecond === null) env.APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE = String(percentage);
  const args = [`-javaagent:${resolve(agent)}`, `-Dotel.javaagent.extensions=${jar}`,
    '-Dotel.instrumentation.jdk-http-server.enabled=false',
    `-Djava.io.tmpdir=${runtime}`,
    '-cp', classpathEntries.join(delimiter), 'com.contoso.correlation.sampling.ParentSafeProbeApplication', `${endpoint}/echo`];
  let child, observedSampler = null;
  let stage = 'readiness', lastProbeHttpStatus = null, actualScopedNativeSpanCount = null, lastCaseId = null;
  async function recordFailure(failure) {
    const diagnostic = samplerFailureDiagnostic(failure, stage);
    const echo = lastCaseId ? echoes.get(lastCaseId) : null;
    const parts = typeof echo?.traceparent === 'string' ? echo.traceparent.split('-') : [];
    await writeSamplerEvidence(runtime, 'failed-observation.json', {
      schema: 'contoso.sampler-safe-failure.v1', result: 'FAIL_OR_UNVERIFIED', phase: name,
      ...diagnostic, javaPid: Number.isSafeInteger(child?.pid) ? child.pid : null,
      lastProbeHttpStatus, actualScopedNativeSpanCount,
      lastProbeEchoObserved: lastCaseId ? Boolean(echo) : null,
      lastProbeEchoCarrierPresent: echo ? typeof echo.traceparent === 'string' && echo.traceparent.length > 0 : null,
      lastProbeEchoCarrierValid: echo ? parts.length === 4 && parts[0] === '00' &&
        TRACE.test(parts[1] ?? '') && SPAN.test(parts[2] ?? '') && ['00', '01'].includes(parts[3]) : null,
      expectedScopedNativeSpanCount: percentage === 100 ? 2 : 0,
      sourceKind: 'real-local-agent-loopback',
      receiverDiagnostics: receiver.diagnostics(),
      actualObservation: observedSampler ? projectSamplerFailureObservation(observedSampler) : null,
      expectedExtensionSha256: jarHash, certificationEligible: false, allTablePrivacyGateVerified: false
    });
    return diagnostic;
  }
  try { child = spawn(java, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (failure) {
    const diagnostic = await recordFailure(failure);
    await receiver.stop();
    throw new Error(`SAMPLER_PROBE_FAILED:${diagnostic.failureStage}:${diagnostic.failureCode}`);
  }
  let text = '';
  child.stdout.on('data', chunk => { if (text.length < 131072) text += chunk.toString(); });
  child.stderr.on('data', chunk => { if (text.length < 131072) text += chunk.toString(); });
  let startupError;
  const exited = new Promise(resolveExit => {
    child.once('error', error => { startupError = error; resolveExit({ code: null, signal: null }); });
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  try {
    const deadline = Date.now() + 45000;
    let ready;
    while (!(ready = text.match(/PARENT_SAFE_PROBE_READY (\d+)/))) {
      assert(Date.now() < deadline, 'Agent fixture did not become ready');
      if (startupError) throw startupError;
      assert(!startupError && child.exitCode === null && child.signalCode === null, 'Agent fixture exited before readiness');
      await sleep(100);
    }
    stage = 'sampling-response';
    const observationResponse = await fetch(`http://127.0.0.1:${ready[1]}/sampling-observation`);
    assert.equal(observationResponse.status, 200);
    stage = 'sampling-parse';
    const nativeObservation = await observationResponse.json();
    observedSampler = nativeObservation;
    stage = 'sampling-state';
    assert.equal(nativeObservation.nativeStateAvailable, true);
    assert.equal(nativeObservation.runtimeInstanceId, String(child.pid), 'Native observation is not bound to the actual child PID');
    assert.equal(nativeObservation.guardSha256, jarHash);
    assert.equal(nativeObservation.guardPolicy, GUARD_POLICY);
    assert.equal(nativeObservation.artifactVersion, GUARD_ARTIFACT_VERSION);
    assert.equal(nativeObservation.loadedCount, 1);
    assert.equal(nativeObservation.providerCount, null, 'Never infer global provider count from one SPI');
    assert.equal(nativeObservation.exporterCount, null, 'No unsupported global exporter enumeration');
    assert.equal(nativeObservation.effectiveSamplingPercentage, percentage);
    assert.equal(nativeObservation.requestsPerSecond, requestsPerSecond);
    assert.equal(nativeObservation.ownedConfiguration['sampling.percentage']?.$contosoAbsent === true, requestsPerSecond !== null);
    assert.equal(nativeObservation.ownedConfiguration['sampling.requestsPerSecond']?.$contosoAbsent === true, requestsPerSecond === null);
    assert.deepEqual(nativeObservation.ownedConfiguration['sampling.overrides'], []);
    const nativeObservationHash = ownedConfigurationHash(nativeObservation.ownedConfiguration);
    const observationSamples = [nativeObservation];
    stage = 'rate-observation';
    if (requestsPerSecond !== null) for (let index = 0; index < 9; index++) {
      const sample = await (await fetch(`http://127.0.0.1:${ready[1]}/sampling-observation`)).json();
      assert.equal(sample.nativeStateAvailable, true);
      assert.equal(ownedConfigurationHash(sample.ownedConfiguration), nativeObservationHash);
      assert.equal(sample.delegateDecisionCount, nativeObservation.delegateDecisionCount);
      observationSamples.push(sample);
    }
    const observations = [];
    for (const sampled of requestsPerSecond === null ? [true, false] : []) {
      const prefix = sampled ? 'sampled' : 'unsampled';
      const caseId = `${name}-${sampled ? 'sampled' : 'unsampled'}`;
      lastCaseId = caseId;
      const traceId = randomBytes(16).toString('hex');
      const parentId = randomBytes(8).toString('hex');
      const traceparent = `00-${traceId}-${parentId}-${sampled ? '01' : '00'}`;
      stage = `${prefix}-request`;
      const response = await fetch(`http://127.0.0.1:${ready[1]}/probe`, {
        headers: { traceparent, tracestate: 'contoso=local', 'x-contoso-probe-case': caseId }
      });
      lastProbeHttpStatus = response.status;
      stage = `${prefix}-status`;
      assert.equal(response.status, 200, 'Fixture request failed');
      stage = `${prefix}-parse`;
      const observed = await response.json();
      stage = `${prefix}-identity`;
      assert.equal(observed.traceId, traceId);
      assert.equal(observed.parentId, parentId);
      assert.match(observed.serverSpanId, /^[0-9a-f]{16}$/);
      assert.match(observed.clientSpanId, /^[0-9a-f]{16}$/);
      assert.notEqual(observed.serverSpanId, observed.clientSpanId);
      assert.notEqual(observed.serverSpanId, parentId);
      stage = `${prefix}-echo`;
      const wire = echoes.get(caseId);
      assert(wire, 'Actual downstream request was not observed');
      const expectedSampled = sampled && percentage === 100;
      stage = `${prefix}-wire`;
      assert.equal(wire.traceparent, `00-${traceId}-${observed.clientSpanId}-${expectedSampled ? '01' : '00'}`);
      stage = `${prefix}-decision`;
      assert.equal(observed.serverSampled, expectedSampled);
      assert.equal(observed.clientSampled, expectedSampled);
      assert.equal(observed.serverRecording, expectedSampled);
      assert.equal(observed.clientRecording, null, 'Do not invent an ended native client recording state');
      assert.equal(observed.clientObservation, 'actual-downstream-carrier');
      observations.push({ ...observed, inputTraceparent: traceparent, wire });
    }
    stage = 'provider-identity';
    if (observations.length) assert.equal(new Set(observations.map(value => value.providerIdentity)).size, 1, 'Multiple observed API provider facades');
    await sleep(6000);
    stage = 'shutdown';
    child.stdin.end('stop\n');
    let shutdownTimer;
    const result = await Promise.race([exited, new Promise((_, reject) => {
      shutdownTimer = setTimeout(() => reject(new Error('Graceful shutdown deadline')), 30000);
    })]).finally(() => clearTimeout(shutdownTimer));
    assert.equal(result.code, 0, 'Actual Java probe failed');
    await sleep(250);
    stage = 'native-intake';
    const captured = await receiver.finish();
    const native = captured.observations.map(value => value.envelope);
    stage = 'spi-loaders';
    const loads = [...text.matchAll(/CONTOSO_PARENT_SAFE_SAMPLER_LOADED ([^\r\n]+)/g)].map(match => match[1]);
    assert.equal(loads.length, 1, 'Expected one SPI registration');
    assert.match(loads[0], /delegate=com\.microsoft\.applicationinsights\.agent\.internal\.sampling\.DelegatingSampler/);
    assert.match(loads[0], /extensionLoader=.*ExtensionClassLoader/);
    assert.match(loads[0], /delegateLoader=.*AgentClassLoader/);
    const traceIds = new Set(observations.map(value => value.traceId));
    const spans = selectSamplerNativeSpans(native, traceIds);
    actualScopedNativeSpanCount = spans.length;
    stage = 'native-count';
    assert.equal(spans.length, percentage === 100 ? 2 : 0,
      `Unexpected actual native span count: ${JSON.stringify(spans.map(row => ({ name: row.data?.baseData?.name, type: row.data?.baseType })))}`);
    stage = 'native-correspondence';
    if (percentage === 100) {
      const sampled = observations[0];
      const server = spans.find(row => row.data.baseData.id === sampled.serverSpanId);
      const client = spans.find(row => row.data.baseData.id === sampled.clientSpanId);
      assert(server && client);
      assert.equal(server.data.baseType, 'RequestData');
      assert.equal(client.data.baseType, 'RemoteDependencyData');
      assert.equal(server.data.baseData.id, sampled.serverSpanId);
      assert.equal(client.data.baseData.id, sampled.clientSpanId);
      assert.equal(server.tags['ai.operation.id'], sampled.traceId);
      assert.equal(server.tags['ai.operation.parentId'], sampled.parentId);
      assert.equal(client.tags['ai.operation.id'], sampled.traceId);
      assert.equal(client.tags['ai.operation.parentId'], sampled.serverSpanId);
    }
    const report = { name, percentage, requestsPerSecond, pid: child.pid, spiLoads: loads, observations,
      guardPolicy: GUARD_POLICY, artifactVersion: GUARD_ARTIFACT_VERSION,
      nativeObservation, observationSamples, nativeObservationHash,
      nativeSpanCount: requestsPerSecond === null ? spans.length : null,
      nativeSpanIds: spans.map(row => row.data.baseData.id), runtimeClasspath: classpathEntries,
      loaderArgument: args[1], sourceKind: 'real-local-agent-loopback', certificationEligible: false,
      originalPrivacyCapture: captured.originalPrivacyCapture,
      receiverDiagnostics: captured.receiverDiagnostics };
    stage = 'evidence-write';
    await writeSamplerEvidence(runtime, 'observations.json', report);
    await writeSamplerEvidence(runtime, 'native-agent-envelopes.json', projectSamplerNativeSpans(native));
    await writeSamplerEvidence(runtime, 'projection-disposition.json', {
      schema: 'contoso.local-native-projection.v1', originalEnvelopesInMemoryOnly: true,
      projectedRecords: spans.length, publisherKeysPersisted: false, allTablePrivacyGateVerified: false,
      sourceKind: 'real-local-agent-loopback', certificationEligible: false,
      originalPrivacyCapture: captured.originalPrivacyCapture,
      receiverDiagnostics: captured.receiverDiagnostics
    });
    if (requestsPerSecond === null) phases.push(report);
    return report;
  } catch (failure) {
    const diagnostic = await recordFailure(failure);
    throw new Error(`SAMPLER_PROBE_FAILED:${diagnostic.failureStage}:${diagnostic.failureCode}`);
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    await receiver.stop();
  }
}
{
  await phase('eligible-on', 100);
  await phase('delegate-off', 0);
  await phase('restored-on', 100);
  const rateObservation = await phase('native-rate-five', null, 5);
  assert.equal(new Set(phases.map(value => value.pid)).size, 3);
  assert.equal(new Set(phases.flatMap(value => value.nativeSpanIds)).size, 4, 'Span identity reused across restart');
  const report = { schema: 'contoso.parent-safe-local-probe.v1', result: 'PASS', executionId,
    agentVersion: '3.7.10', agentSha256: agentHash, extensionSha256: jarHash, sdkAbi: '1.65.0',
    providerClass: 'com.contoso.correlation.sampling.ParentSafeSamplerCustomizer', jarEntries: entries,
    guardPolicy: GUARD_POLICY, artifactVersion: GUARD_ARTIFACT_VERSION,
    phases, certificationEligible: false, allTablePrivacyGateVerified: false,
    independentProducerAuthorityVerified: false, azureLiveClauses: 'To Do', vendorSupportGuarantee: false };
  await writeSamplerEvidence(output, 'result.json', report);
  await writeSamplerEvidence(output, 'native-sampling-observation.json', {
    schema: 'contoso.native-sampling-local-observation.v1', extensionSha256: jarHash,
    guardPolicy: GUARD_POLICY, artifactVersion: GUARD_ARTIFACT_VERSION,
    fixedPhases: phases.map(phase => phase.nativeObservation), rateObservation,
    classification: 'Contoso-owned pinned internal ABI read-only observation; not vendor support or Azure certification',
    sourceKind: 'real-local-agent-loopback', certificationEligible: false
  });
  console.log(JSON.stringify({ result: 'PASS', extensionSha256: jarHash, nativeSpanCounts: phases.map(value => value.nativeSpanCount),
    sourceKind: 'real-local-agent-loopback', certificationEligible: false, report: join(output, 'result.json') }));
}
