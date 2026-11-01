import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const options = parseArgs({ options: {
  java: { type: 'string' }, agent: { type: 'string' }, jar: { type: 'string' },
  m2: { type: 'string' }, output: { type: 'string' }
} }).values;
const java = options.java ?? process.env.CONTOSO_JAVA_EXE;
const agent = options.agent ?? process.env.CONTOSO_AGENT_JAR;
const modulePath = join(project, 'extensions', 'parent-safe-sampler');
const jar = resolve(options.jar ?? join(modulePath, 'target', 'contoso-parent-safe-sampler-1.0.0.jar'));
const m2 = resolve(options.m2 ?? join(project, '.cache', 'r7', 'm2'));
const output = resolve(options.output ?? join(modulePath, 'target', 'agent-probe'));
assert(java && agent, 'Exact portable java and pinned agent paths are required');
const lock = JSON.parse(await readFile(join(project, 'config', 'versions.lock.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const agentHash = digest(await readFile(agent));
assert.equal(lock.agent.version, '3.7.10');
assert.equal(agentHash, lock.agent.sha256, 'Agent checksum mismatch');
const jarHash = digest(await readFile(jar));
const api = join(m2, 'io', 'opentelemetry', 'opentelemetry-api', '1.65.0', 'opentelemetry-api-1.65.0.jar');
const context = join(m2, 'io', 'opentelemetry', 'opentelemetry-context', '1.65.0', 'opentelemetry-context-1.65.0.jar');
const common = join(m2, 'io', 'opentelemetry', 'opentelemetry-common', '1.65.0', 'opentelemetry-common-1.65.0.jar');
await Promise.all([api, context, common, jar].map(path => access(path)));
await mkdir(output, { recursive: true });
const jarTool = process.env.CONTOSO_JAR_EXE ?? join(dirname(java), 'jar.exe');
const entries = execFileSync(jarTool, ['--list', '--file', jar], { encoding: 'utf8' }).trim().split(/\r?\n/);
const service = 'META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider';
assert.equal(entries.filter(entry => entry === service).length, 1);
assert.equal(entries.filter(entry => entry.endsWith('.jar') || entry.startsWith('io/opentelemetry/')).length, 0,
  'Extension must not contain runtime SDK/API classes or nested JARs');
assert.deepEqual(entries.filter(entry => entry.endsWith('.class')).sort(), [
  'com/contoso/correlation/sampling/ParentSafeSampler.class',
  'com/contoso/correlation/sampling/ParentSafeSamplerCustomizer.class'
]);
const classpathEntries = [join(modulePath, 'target', 'test-classes'), api, context, common];
assert(classpathEntries.every(path => !/opentelemetry-sdk/i.test(path)), 'No SDK implementation in app runtime classpath');
const native = [];
const echoes = new Map();
const receiver = createServer(async (request, response) => {
  try {
    if (request.url === '/echo') {
      echoes.set(request.headers['x-contoso-probe-case'], {
        traceparent: request.headers.traceparent ?? null, tracestate: request.headers.tracestate ?? null
      });
      response.writeHead(200, { 'x-contoso-observed-traceparent': request.headers.traceparent ?? '' }).end('ok');
      return;
    }
    let body = Buffer.concat(await Array.fromAsync(request));
    if (request.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
    let payloads;
    try {
      const value = JSON.parse(body.toString('utf8'));
      payloads = Array.isArray(value) ? value : [value];
    } catch {
      payloads = body.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(value => JSON.parse(value));
    }
    native.push(...payloads);
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      itemsReceived: payloads.length, itemsAccepted: payloads.length, errors: []
    }));
  } catch (failure) {
    response.writeHead(400).end('invalid native payload');
  }
});
await new Promise(resolveReady => receiver.listen(0, '127.0.0.1', resolveReady));
const endpoint = `http://127.0.0.1:${receiver.address().port}`;
const sleep = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const phases = [];
async function phase(name, percentage) {
  const start = native.length;
  const runtime = join(output, name);
  await mkdir(runtime, { recursive: true });
  const env = { ...process.env };
  for (const key of ['APPLICATIONINSIGHTS_AUTHENTICATION_STRING', 'AZURE_CLIENT_SECRET',
    'APPLICATIONINSIGHTS_CONFIGURATION_FILE', 'APPLICATIONINSIGHTS_SAMPLING_REQUESTS_PER_SECOND',
    'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_JAVAAGENT_EXTENSIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'APPLICATIONINSIGHTS_PROXY']) {
    delete env[key];
  }
  Object.assign(env, {
    TEMP: runtime, TMP: runtime, JAVA_TOOL_OPTIONS: `-Djava.io.tmpdir=${runtime}`,
    APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${randomUUID()};IngestionEndpoint=${endpoint};LiveEndpoint=${endpoint}`,
    APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-parent-safe-probe', OTEL_SERVICE_NAME: 'contoso-parent-safe-probe',
    APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true', APPLICATIONINSIGHTS_SAMPLING_PERCENTAGE: String(percentage),
    APPLICATIONINSIGHTS_CONFIGURATION_CONTENT: JSON.stringify({
      sampling: { percentage }, selfDiagnostics: { level: 'WARN', destination: 'console' },
      instrumentation: { azureSdk: { enabled: false }, jdbc: { enabled: false }, redis: { enabled: false } }
    }),
    OTEL_INSTRUMENTATION_JDK_HTTP_SERVER_ENABLED: 'false'
  });
  const args = [`-javaagent:${resolve(agent)}`, `-Dotel.javaagent.extensions=${jar}`,
    '-Dotel.instrumentation.jdk-http-server.enabled=false',
    '-cp', classpathEntries.join(delimiter), 'com.contoso.correlation.sampling.ParentSafeProbeApplication', `${endpoint}/echo`];
  const child = spawn(java, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', chunk => { if (text.length < 131072) text += chunk.toString(); });
  child.stderr.on('data', chunk => { if (text.length < 131072) text += chunk.toString(); });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  try {
    const deadline = Date.now() + 45000;
    let ready;
    while (!(ready = text.match(/PARENT_SAFE_PROBE_READY (\d+)/))) {
      assert(Date.now() < deadline, `Agent fixture did not become ready: ${text}`);
      assert(child.exitCode === null, `Agent fixture exited before readiness: ${text}`);
      await sleep(100);
    }
    const observations = [];
    for (const sampled of [true, false]) {
      const caseId = `${name}-${sampled ? 'sampled' : 'unsampled'}`;
      const traceId = randomBytes(16).toString('hex');
      const parentId = randomBytes(8).toString('hex');
      const traceparent = `00-${traceId}-${parentId}-${sampled ? '01' : '00'}`;
      const response = await fetch(`http://127.0.0.1:${ready[1]}/probe`, {
        headers: { traceparent, tracestate: 'contoso=local', 'x-contoso-probe-case': caseId }
      });
      assert.equal(response.status, 200, `Fixture request failed: ${text}`);
      const observed = await response.json();
      assert.equal(observed.traceId, traceId);
      assert.equal(observed.parentId, parentId);
      assert.match(observed.serverSpanId, /^[0-9a-f]{16}$/);
      assert.match(observed.clientSpanId, /^[0-9a-f]{16}$/);
      assert.notEqual(observed.serverSpanId, observed.clientSpanId);
      assert.notEqual(observed.serverSpanId, parentId);
      const wire = echoes.get(caseId);
      assert(wire, 'Actual downstream request was not observed');
      const expectedSampled = sampled && percentage === 100;
      assert.equal(wire.traceparent, `00-${traceId}-${observed.clientSpanId}-${expectedSampled ? '01' : '00'}`);
      assert.equal(observed.serverSampled, expectedSampled);
      assert.equal(observed.clientSampled, expectedSampled);
      assert.equal(observed.serverRecording, expectedSampled);
      assert.equal(observed.clientRecording, null, 'Do not invent an ended native client recording state');
      assert.equal(observed.clientObservation, 'actual-downstream-carrier');
      observations.push({ ...observed, inputTraceparent: traceparent, wire });
    }
    assert.equal(new Set(observations.map(value => value.providerIdentity)).size, 1, 'Multiple observed API provider facades');
    await sleep(6000);
    child.stdin.end('stop\n');
    const result = await Promise.race([exited, sleep(30000).then(() => { throw new Error('Graceful shutdown deadline'); })]);
    assert.equal(result.code, 0, text);
    await sleep(250);
    const loads = [...text.matchAll(/CONTOSO_PARENT_SAFE_SAMPLER_LOADED ([^\r\n]+)/g)].map(match => match[1]);
    assert.equal(loads.length, 1, `Expected one SPI registration: ${text}`);
    assert.match(loads[0], /delegate=com\.microsoft\.applicationinsights\.agent\.internal\.sampling\.DelegatingSampler/);
    assert.match(loads[0], /extensionLoader=.*ExtensionClassLoader/);
    assert.match(loads[0], /delegateLoader=.*AgentClassLoader/);
    const traceIds = new Set(observations.map(value => value.traceId));
    const spans = native.slice(start).filter(row => traceIds.has(row.tags?.['ai.operation.id'])
      && ['RequestData', 'RemoteDependencyData'].includes(row.data?.baseType));
    assert.equal(spans.length, percentage === 100 ? 2 : 0,
      `Unexpected actual native span count: ${JSON.stringify(spans.map(row => ({ name: row.data?.baseData?.name, type: row.data?.baseType })))}`);
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
    const report = { name, percentage, pid: child.pid, spiLoads: loads, observations, nativeSpanCount: spans.length,
      nativeSpanIds: spans.map(row => row.data.baseData.id), runtimeClasspath: classpathEntries,
      loaderArgument: args[1], sourceKind: 'real-local-agent-loopback', certificationEligible: false };
    await writeFile(join(runtime, 'observations.json'), JSON.stringify(report, null, 2));
    await writeFile(join(runtime, 'native-agent-envelopes.json'), JSON.stringify(native.slice(start), null, 2));
    phases.push(report);
  } catch (failure) {
    const safeText = text.replace(/InstrumentationKey=[^;\s]+/gi, 'InstrumentationKey=[fixture-redacted]');
    throw new Error(`Real agent probe ${name} failed: ${safeText}`, { cause: failure });
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
try {
  await phase('eligible-on', 100);
  await phase('delegate-off', 0);
  await phase('restored-on', 100);
  assert.equal(new Set(phases.map(value => value.pid)).size, 3);
  assert.equal(new Set(phases.flatMap(value => value.nativeSpanIds)).size, 4, 'Span identity reused across restart');
  const report = { schema: 'contoso.parent-safe-local-probe.v1', result: 'PASS',
    agentVersion: '3.7.10', agentSha256: agentHash, extensionSha256: jarHash, sdkAbi: '1.65.0',
    providerClass: 'com.contoso.correlation.sampling.ParentSafeSamplerCustomizer', jarEntries: entries,
    phases, certificationEligible: false, azureLiveClauses: 'To Do', vendorSupportGuarantee: false };
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: 'PASS', extensionSha256: jarHash, nativeSpanCounts: phases.map(value => value.nativeSpanCount),
    sourceKind: 'real-local-agent-loopback', certificationEligible: false, report: join(output, 'result.json') }));
} finally {
  await new Promise(resolveClose => receiver.close(resolveClose));
}
