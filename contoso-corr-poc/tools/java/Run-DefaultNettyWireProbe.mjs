import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { canonicalSpanId, TRACE, SPAN } from '../observability/telemetry-contract.mjs';

function isSampledTraceparent(value) {
  const parsed = typeof value === 'string' && /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value);
  return Boolean(parsed && TRACE.test(parsed[1]) && SPAN.test(parsed[2]) && (Number.parseInt(parsed[3], 16) & 1) === 1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const options = parseArgs({ options: {
  java: { type: 'string' }, 'classpath-file': { type: 'string' }, 'source-build': { type: 'string' },
  'verify-sampling-bit': { type: 'boolean' }
} }).values;
if (options['verify-sampling-bit']) {
  for (const [flags, sampled] of [['00', false], ['01', true], ['02', false], ['03', true], ['80', false], ['81', true]]) {
    assert.equal(isSampledTraceparent(`00-${'1'.repeat(32)}-${'2'.repeat(16)}-${flags}`), sampled);
  }
  assert.equal(isSampledTraceparent(`00-${'0'.repeat(32)}-${'2'.repeat(16)}-03`), false);
  assert.equal(isSampledTraceparent(null), false);
  console.log('Sampling-bit validation PASS: 8 exact controls; flags are never rewritten.');
  process.exit(0);
}
assert(options.java && options['classpath-file'] && options['source-build'], 'Explicit tool, classpath and genuine build required');
const java = resolve(options.java);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = async file => digest(await readFile(file));
const executionId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID()}`;
const work = join(root, '.java-work', 'default-netty', executionId);
const output = join(root, 'evidence', 'java-local', 'default-netty', executionId);
await mkdir(dirname(work), { recursive: true });
await mkdir(work);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const sockets = new Set();
const lock = JSON.parse(await readFile(join(root, 'config', 'versions.lock.json'), 'utf8'));
const buildPath = resolve(options['source-build']);
const build = JSON.parse(await readFile(buildPath, 'utf8'));
assert.equal(build.result, 'PASS');
assert.equal(build.scope, 'actual-eleven-module-clean-reactor-build');
assert.equal(build.sourcesStable, true);
const classpath = JSON.parse(await readFile(resolve(options['classpath-file']), 'utf8'));
assert(Array.isArray(classpath) && classpath.length > 10 && classpath.every(path => typeof path === 'string' && path.endsWith('.jar')));
assert(!classpath.some(path => /opentelemetry-(?:sdk|exporter)|applicationinsights-agent/i.test(path)));
const classpathInputs = await Promise.all(classpath.map(async path => ({ path, sha256: await hash(path) })));
const jarOf = module => build.producedArtifacts.find(item => item.path.replaceAll('\\', '/').startsWith(`${module}/target/`));
for (const module of ['services/correlation-core', 'services/security-core', 'services/inventory-data', 'workers/messaging-core']) {
  const artifact = jarOf(module);
  assert(artifact && classpath.includes(join(root, artifact.path)), 'Classpath must use the actual fresh owned archive');
  assert.equal(await hash(join(root, artifact.path)), artifact.sha256);
}
const source = join(root, 'tools', 'java', 'DefaultNettyWireProbe.java');
const scanner = join(root, 'tools', 'security', 'Scan-NativePayloads.mjs');
const sourceInputs = [source, fileURLToPath(import.meta.url), scanner,
  join(root, 'tools', 'security', 'native-payload.mjs'), join(root, 'tools', 'security', 'values.mjs'),
  join(root, 'tools', 'observability', 'telemetry-contract.mjs')];
const snapshot = async () => Promise.all(sourceInputs.map(async path => ({ path, sha256: await hash(path) })));
const beforeSources = await snapshot();
const commands = [];
async function command(executable, args, { env = process.env, input, timeout = 90000 } = {}) {
  const started = Date.now();
  const executableSha256 = await hash(executable);
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', bounded = true;
  const append = target => chunk => {
    if (target === 'out') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    if (stdout.length + stderr.length > 4_194_304) { bounded = false; child.kill(); }
  };
  child.stdout.on('data', append('out'));
  child.stderr.on('data', append('err'));
  const timer = setTimeout(() => { bounded = false; child.kill(); }, timeout);
  try {
    const finished = new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', code => accept(code));
    });
    child.stdin.end(input);
    const code = await finished;
    const finishedAt = Date.now();
    assert.equal(await hash(executable), executableSha256, 'Executed tool bytes changed during the command');
    commands.push({ actualPid: child.pid, executable, executableSha256,
      startedAtUtc: new Date(started).toISOString(), finishedAtUtc: new Date(finishedAt).toISOString(),
      elapsedMs: finishedAt - started, exitCode: code, bounded });
    assert(bounded && code === 0, 'Bounded tool execution failed; raw diagnostics remain in memory only');
    return { stdout, stderr, pid: child.pid };
  } finally { clearTimeout(timer); }
}
const keyPassword = randomUUID();
const token = randomUUID();
const publisher = randomUUID();
const pfx = join(work, 'loopback-only.p12');
const gridHost = 'contoso-default-netty.eventgrid.azure.net';
const queueHost = 'contosodefaultnetty.queue.core.windows.net';
const mismatchGrid = 'contoso-mismatch-netty.eventgrid.azure.net';
const mismatchQueue = 'contosomismatchnetty.queue.core.windows.net';
const allowed = new Set([gridHost, queueHost, mismatchGrid, mismatchQueue].map(host => `${host}:443`));
let tlsServer, proxy, ingestion;
let phase = 'setup';
const wire = [];
const tunnels = [];
const blockedProxyTargets = [];
const payloads = [];
const nativeInFlight = new Set();
const receiverFailures = [];
const reports = [];
let verificationStep = 'SETUP';
let safeCapture = null;
try {
  await command(join(dirname(java), 'keytool.exe'), ['-genkeypair', '-alias', 'contoso-local-only',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1', '-storetype', 'PKCS12',
    '-keystore', pfx, '-storepass', keyPassword, '-keypass', keyPassword,
    '-dname', 'CN=contoso-default-netty.eventgrid.azure.net',
    '-ext', `SAN=dns:${gridHost},dns:${queueHost}`]);
  const classes = join(work, 'classes');
  await mkdir(classes);
  await command(join(dirname(java), 'javac.exe'), ['-cp', classpath.join(delimiter), '-d', classes, source]);
  const probeClass = join(classes, 'com', 'contoso', 'tools', 'DefaultNettyWireProbe.class');
  const probeClassSha256 = await hash(probeClass);
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  tlsServer = httpsServer({ pfx: await readFile(pfx), passphrase: keyPassword, minVersion: 'TLSv1.2' },
    async (request, response) => {
      let stage = 'ROUTE';
      try {
        assert.equal(phase, 'trusted-default');
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          assert(length <= 131072, 'SDK fixture request bound');
          chunks.push(chunk);
        }
        assert.equal(request.method, 'POST');
        stage = 'AUTHORIZATION';
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        const bytes = Buffer.concat(chunks).toString('utf8');
        const host = (request.headers.host ?? '').replace(/:443$/, '');
        let envelope, route;
        if (host === gridHost && request.url.startsWith('/api/events?')) {
          stage = 'CLOUD_EVENT';
          const events = JSON.parse(bytes);
          assert.equal(events.length, 1);
          envelope = events[0].data;
          assert.equal(events[0].traceparent, envelope.traceparent);
          assert.equal(events[0].businessinvocationid, envelope['business.invocation_id']);
          assert.equal(events[0].messageid, envelope.messageId);
          route = 'EVENT_GRID';
          response.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
        } else {
          stage = 'QUEUE_ENVELOPE';
          assert.equal(host, queueHost);
          const matches = [...bytes.matchAll(/<MessageText>([A-Za-z0-9+/=]+)<\/MessageText>/g)];
          assert.equal(matches.length, 1, 'Actual Queue SDK base64 XML required');
          assert(bytes.includes('<QueueMessage') && bytes.includes('</QueueMessage>'));
          envelope = JSON.parse(Buffer.from(matches[0][1], 'base64').toString('utf8'));
          route = 'STORAGE_QUEUE';
          const date = new Date().toUTCString();
          response.writeHead(201, { 'Content-Type': 'application/xml' }).end(
            `<QueueMessagesList><QueueMessage><MessageId>${randomUUID()}</MessageId><InsertionTime>${date}</InsertionTime>` +
            `<ExpirationTime>${date}</ExpirationTime><PopReceipt>local-fixture-receipt</PopReceipt>` +
            `<TimeNextVisible>${date}</TimeNextVisible></QueueMessage></QueueMessagesList>`);
        }
        wire.push({ route, path: request.url.split('?')[0], traceparent: request.headers.traceparent ?? null,
          payloadTraceparent: envelope.traceparent, businessInvocationId: envelope['business.invocation_id'],
          messageId: envelope.messageId, authorizationMatchedInMemory: true, tlsProtocol: request.socket.getProtocol() });
      } catch {
        receiverFailures.push(`SDK_TLS_FIXTURE_REJECTED_${stage}`);
        if (!response.headersSent) response.writeHead(400);
        response.end();
      }
    });
  tlsServer.on('connection', track);
  tlsServer.on('tlsClientError', () => {
    if (phase === 'trusted-default') receiverFailures.push('TRUSTED_TLS_HANDSHAKE_FAILED');
  });
  await new Promise(ready => tlsServer.listen(0, '127.0.0.1', ready));
  proxy = httpServer((_, response) => response.writeHead(405).end());
  proxy.on('connection', track);
  proxy.on('connect', (request, socket, head) => {
    const nativeAuthority = ingestion ? `127.0.0.1:${ingestion.address().port}` : null;
    const nativeLoopback = request.url === nativeAuthority;
    if (!allowed.has(request.url) && !nativeLoopback) {
      blockedProxyTargets.push({ phase, authoritySha256: digest(request.url), outcome: 'DENIED_WITHOUT_OUTBOUND_CONNECTION' });
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    tunnels.push({ phase, authority: request.url, route: nativeLoopback ? 'LOCAL_NATIVE_RECEIVER' : 'LOCAL_TLS_FIXTURE' });
    const upstream = connect(nativeLoopback ? ingestion.address().port : tlsServer.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    track(upstream);
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise(ready => proxy.listen(0, '127.0.0.1', ready));
  async function ingest(request, response) {
    if (request.method !== 'POST' || !['/v2/track', '/v2.1/track'].includes(request.url)) {
      response.writeHead(404).end(); return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) { size += chunk.length; assert(size <= 1_048_576); chunks.push(chunk); }
      assert(payloads.length < 16);
      const payload = { rawBase64: Buffer.concat(chunks).toString('base64'), encoding: request.headers['content-encoding'] ?? 'identity' };
      const scan = await command(process.execPath, [scanner], { input: JSON.stringify({
        publisherKeys: [publisher], forbiddenValues: [token], payloads: [payload]
      }) });
      const capture = JSON.parse(scan.stdout);
      assert.equal(capture.validatorPid, scan.pid);
      const count = capture.payloadReceipts[0].originalEnvelopeCount;
      assert(Number.isInteger(count) && count > 0);
      payloads.push(payload);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ itemsReceived: count, itemsAccepted: count, errors: [] }));
    } catch { receiverFailures.push('NATIVE_INGESTION_BOUND'); response.writeHead(400).end(); }
  }
  ingestion = httpServer((request, response) => {
    const operation = ingest(request, response);
    nativeInFlight.add(operation);
    operation.finally(() => nativeInFlight.delete(operation));
  });
  ingestion.on('connection', track);
  await new Promise(ready => ingestion.listen(0, '127.0.0.1', ready));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:AZURE_|OTEL_|APPLICATIONINSIGHTS_|JAVA_TOOL_OPTIONS$|JAVA_OPTS$|JDK_JAVA_OPTIONS$|_JAVA_OPTIONS$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$|MSI_|IDENTITY_)/.test(key))
      delete env[key];
  }
  Object.assign(env, {
    CONTOSO_NETTY_GRID_HOST: gridHost, CONTOSO_NETTY_QUEUE_HOST: queueHost,
    CONTOSO_NETTY_PROXY_PORT: String(proxy.address().port), CONTOSO_NETTY_FIXTURE_TOKEN: token,
    CONTOSO_NETTY_EXPECTED_GUARD_SHA: lock.extensions[0].sha256,
    HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
    OTEL_SERVICE_NAME: 'contoso-default-netty-wire', APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-default-netty-wire'
  });
  const proxyArgs = ['-Djava.net.useSystemProxies=true', '-Dhttps.proxyHost=127.0.0.1',
    `-Dhttps.proxyPort=${proxy.address().port}`, '-Dhttp.nonProxyHosts=', '-Dhttps.nonProxyHosts=',
    `-Djava.io.tmpdir=${work}`];
  const cp = [classes, ...classpath].join(delimiter);
  async function runCase(name, trusted, native, mismatch = false) {
    phase = name;
    const args = [...proxyArgs];
    if (trusted) args.push(`-Djavax.net.ssl.trustStore=${pfx}`, `-Djavax.net.ssl.trustStorePassword=${keyPassword}`);
    const childEnv = { ...env, CONTOSO_NETTY_GRID_HOST: mismatch ? mismatchGrid : gridHost,
      CONTOSO_NETTY_QUEUE_HOST: mismatch ? mismatchQueue : queueHost };
    if (native) {
      const explicitAgent = process.env.CONTOSO_AGENT_JAR;
      assert(explicitAgent, 'Explicit pinned native agent required');
      assert.equal(await hash(explicitAgent), lock.agent.sha256);
      const extension = join(root, lock.extensions[0].module, lock.extensions[0].file);
      assert.equal(await hash(extension), lock.extensions[0].sha256);
      const config = join(work, 'agent.json');
      await writeFile(config, JSON.stringify({ sampling: { percentage: 100 },
        instrumentation: { azureSdk: { enabled: false }, jdbc: { enabled: false }, redis: { enabled: false } },
        liveMetrics: { enabled: false } }), { flag: 'wx' });
      Object.assign(childEnv, { APPLICATIONINSIGHTS_CONNECTION_STRING:
        `InstrumentationKey=${publisher};IngestionEndpoint=http://127.0.0.1:${ingestion.address().port}`,
        APPLICATIONINSIGHTS_CONFIGURATION_FILE: config });
      args.push(`-javaagent:${explicitAgent}`, `-Dotel.javaagent.extensions=${extension}`,
        '-Dotel.instrumentation.azure-core.enabled=false');
    }
    args.push('-cp', cp, 'com.contoso.tools.DefaultNettyWireProbe');
    if (!native) args.push('reject-tls');
    const result = await command(java, args, { env: childEnv });
    const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('CONTOSO_DEFAULT_NETTY_RESULT '));
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0].slice('CONTOSO_DEFAULT_NETTY_RESULT '.length));
    assert.equal(record.actualPid, result.pid);
    assert.equal(record.executedProbeClassSha256, probeClassSha256);
    assert.equal(record.proxyVerifiedBeforeSend, true);
    reports.push({ phase: name, ...record });
  }
  await runCase('untrusted-ca', false, false);
  assert.equal(wire.length, 0, 'Untrusted certificate must prevent SDK HTTP requests');
  await runCase('hostname-mismatch', true, false, true);
  assert.equal(wire.length, 0, 'Trusted certificate must still enforce hostname validation');
  await runCase('trusted-default', true, true);
  await Promise.all([...nativeInFlight]);
  verificationStep = 'ACTUAL_SDK_REQUEST_COUNTS';
  assert.equal(wire.length, 2);
  assert.equal(receiverFailures.length, 0, 'Actual receiver rejected a request or native payload');
  const positive = reports.at(-1);
  verificationStep = 'ORIGINAL_NATIVE_SCAN';
  const scan = await command(process.execPath, [scanner], { input: JSON.stringify({
    publisherKeys: [publisher], forbiddenValues: [token], payloads
  }) });
  const capture = JSON.parse(scan.stdout);
  assert.equal(capture.validatorPid, scan.pid);
  safeCapture = capture;
  for (const send of positive.sends) {
    verificationStep = 'SDK_MESSAGE_CARRIER_IDENTITY';
    const observed = wire.find(row => row.route === send.destination);
    assert(observed && observed.messageId === send.messageId && observed.businessInvocationId === positive.businessInvocationId);
    assert.equal(observed.payloadTraceparent, send.payloadTraceparent);
    assert.equal(observed.path, send.destination === 'EVENT_GRID' ? '/api/events' : `/${send.entity}/messages`);
    verificationStep = 'NATIVE_HTTP_TRACEPARENT_ON_WIRE';
    assert(isSampledTraceparent(observed.traceparent), 'Actual outgoing sampled bit must be set; other W3C flag bits are preserved');
    assert.equal(observed.traceparent.slice(3, 35), positive.traceId);
    assert.equal(observed.payloadTraceparent.slice(36, 52), send.producerSpanId);
  }
  assert.equal(positive.usedQueuePipelineClientIsDefaultNetty, true);
  assert.equal(positive.transportOrigin.archiveSha256, jarOf('workers/messaging-core').sha256);
  verificationStep = 'ACTUAL_NATIVE_HTTP_EXPORT';
  const nativeHttp = capture.nativeEnvelopes.filter(envelope => envelope.data?.baseType === 'RemoteDependencyData' &&
    ['Http', 'HTTP'].includes(envelope.data?.baseData?.type) &&
    envelope.tags?.['ai.cloud.role'] === 'contoso-default-netty-wire');
  for (const observed of wire) {
    const send = positive.sends.find(item => item.destination === observed.route);
    const matching = nativeHttp.filter(envelope => {
      let url;
      try { url = new URL(envelope.data.baseData.data); } catch { return false; }
      return url.hostname === (observed.route === 'EVENT_GRID' ? gridHost : queueHost) &&
        url.pathname === observed.path && envelope.tags['ai.operation.id'] === positive.traceId;
    });
    assert.equal(matching.length, 1, 'Actual native HTTP client export required for each successful SDK send');
    const envelope = matching[0];
    assert.equal(canonicalSpanId(envelope.data.baseData.id, positive.traceId), observed.traceparent.slice(36, 52));
    assert.equal(canonicalSpanId(envelope.tags['ai.operation.parentId'], positive.traceId), send.producerSpanId);
  }
  const afterSources = await snapshot();
  assert.deepEqual(afterSources, beforeSources);
  const afterClasspath = await Promise.all(classpath.map(async path => ({ path, sha256: await hash(path) })));
  assert.deepEqual(afterClasspath, classpathInputs, 'Actual classpath archive bytes changed during the controlled run');
  const report = { schema: 'contoso.default-netty-isolated-qualification.v1', result: 'PASS', executionId,
    certified: false, credentialMode: 'EXPLICIT_FIXTURE_NOT_PRODUCTION_MI',
    routingBoundary: 'USER_APPROVED_PROCESS_ONLY_LOOPBACK_CONNECT_PROXY_AND_TEMPORARY_JVM_TRUSTSTORE',
    azureSdkSendsRoutedOnlyToLoopback: true, globalTrustStoreChanged: false,
    buildWitnessSha256: await hash(buildPath), probeClassSha256, beforeSources, afterSources,
    classpathInputs, classpathStable: true,
    commands, reports, tunnels, blockedProxyTargets, wire, originalPrivacyCapture: capture,
    limitations: ['Local explicit credential/default business HTTP factory only', 'Not production managed identity or Azure service acceptance'] };
  await writeFile(join(output, 'qualification.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ result: 'PASS', actualDefaultNettySends: wire.length, tlsNegativeCases: 2,
    report: join(output, 'qualification.json'), certified: false }));
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ result: 'FAIL_OR_UNVERIFIED', commands,
    code: error instanceof assert.AssertionError ? 'ASSERTION_FAILED' : 'LOCAL_TRANSPORT_PROBE_FAILED',
    verificationStep, wire,
    actualChildObservations: reports.map(record => ({ phase: record.phase, actualPid: record.actualPid,
      traceId: record.traceId, rootSpanId: record.rootSpanId, businessInvocationId: record.businessInvocationId,
      samplerObservation: record.samplerObservation, sends: record.sends,
      transportOrigin: record.transportOrigin, usedBusinessClientOrigin: record.usedBusinessClientOrigin,
      usedSdkOrigins: record.usedSdkOrigins, usedQueuePipelineClientIsDefaultNetty: record.usedQueuePipelineClientIsDefaultNetty })),
    originalPrivacyCapture: safeCapture,
    receiverFailures, blockedProxyTargets, nativePayloadsReceived: payloads.length, sdkRequestsReceived: wire.length,
    certified: false }), { flag: 'wx' });
  console.error(`Default Netty failure receipt: ${join(output, 'failure.json')}`);
  throw new Error('Isolated default Netty verification failed; only redacted failure metadata persisted');
} finally {
  for (const socket of sockets) socket.destroy();
  await Promise.all([tlsServer, proxy, ingestion].filter(Boolean).map(server =>
    new Promise(accept => server.close(() => accept()))));
  await rm(work, { recursive: true, force: true });
}
