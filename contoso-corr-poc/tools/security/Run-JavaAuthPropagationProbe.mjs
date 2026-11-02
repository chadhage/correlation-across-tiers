import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from './values.mjs';
import { jarMemberSha256, checkUsedIdentityScope, checkHeaderIsolation } from './av23-check.mjs';
import { createIdentityClientCollector, NATIVE_PAYLOAD_LIMIT } from './native-identity-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.argv.includes('--okhttp-exclusion')) throw new Error('INEFFECTIVE_OKHTTP_DISABLE_REMOVED');
const tools = process.env.CONTOSO_PORTABLE_TOOLS_ROOT ??
  'C:\\Users\\chhage\\.copilot\\session-state\\a2820816-7000-4e63-9cf2-cd2c8da2162f\\files\\tools\\r4';
const agent = process.env.CONTOSO_AGENT_JAR ?? path.join(tools, 'agent', 'applicationinsights-agent-3.7.10.jar');
const lock = JSON.parse(await readFile(path.join(root, 'config', 'versions.lock.json'), 'utf8'));
const lockedExtension = lock.extensions?.find(entry => entry.artifactId === 'contoso-parent-safe-sampler');
if (!lockedExtension) throw new Error('EXTENSION_LOCK_MISSING');
const extension = process.env.CONTOSO_PARENT_SAFE_JAR ??
  path.join(root, lockedExtension.module.replaceAll('/', path.sep), lockedExtension.file.replaceAll('/', path.sep));
if (digest(await readFile(agent)) !== lock.agent.sha256) throw new Error('AGENT_HASH_MISMATCH');
const extensionHash = digest(await readFile(extension));
if (extensionHash !== lockedExtension.sha256)
  throw new Error('EXTENSION_HASH_MISMATCH');
const work = path.join(root, 'services', 'security-core', 'target', 'r8-av23');
await mkdir(path.join(work, 'classes'), { recursive: true });
const report = await readFile(path.join(root, 'services', 'security-core', 'target', 'surefire-reports',
  'TEST-com.contoso.security.RequestAuthenticatorTest.xml'), 'utf8');
const property = /<property name="surefire.test.class.path" value="([^"]*)"/.exec(report) ??
  /<property name="java.class.path" value="([^"]*)"/.exec(report);
if (!property) throw new Error('EXISTING_SECURITY_CLASSPATH_MISSING');
const securityArtifact = path.join(root, 'services', 'security-core', 'target', 'security-core-1.0.0.jar');
const securityArtifactBytes = await readFile(securityArtifact);
const securityArtifactHash = digest(securityArtifactBytes);
const wrapperMemberHash = jarMemberSha256(securityArtifactBytes,
  'com/contoso/security/IdentityHttpClients$ContextFreeRestClient.class');
const sdkArtifact = path.join(tools, 'm2', 'com', 'azure', 'azure-core-http-okhttp', '1.13.8', 'azure-core-http-okhttp-1.13.8.jar');
const sdkArtifactBytes = await readFile(sdkArtifact);
const sdkArtifactHash = digest(sdkArtifactBytes);
const sdkMemberHash = jarMemberSha256(sdkArtifactBytes, 'com/azure/core/http/okhttp/OkHttpAsyncHttpClient.class');
const classpath = [path.join(work, 'classes'), securityArtifact, ...property[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"')
  .split(path.delimiter)].concat([
    path.join(tools, 'm2', 'io', 'opentelemetry', 'opentelemetry-api', '1.65.0', 'opentelemetry-api-1.65.0.jar'),
    path.join(tools, 'm2', 'io', 'opentelemetry', 'opentelemetry-context', '1.65.0', 'opentelemetry-context-1.65.0.jar'),
    path.join(tools, 'm2', 'io', 'opentelemetry', 'opentelemetry-common', '1.65.0', 'opentelemetry-common-1.65.0.jar')
  ]).join(path.delimiter);
const javaHome = process.env.JAVA_HOME;
if (!javaHome) throw new Error('SOURCE_EXISTING_PORTABLE_TOOLCHAIN_FIRST');

async function command(executable, args, environment, timeoutMs) {
  const startedAtUtc = new Date().toISOString();
  const child = spawn(executable, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', value => { if (output.length < 65536) output += value.toString(); });
  child.stderr.on('data', value => { if (output.length < 65536) output += value.toString(); });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    return { code, output, pid: child.pid, startedAtUtc, endedAtUtc: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}

const env = { ...process.env, TEMP: work, TMP: work };
for (const name of ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS',
  'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', 'APPLICATIONINSIGHTS_CONFIGURATION_FILE',
  'AZURE_CLIENT_SECRET', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_FEDERATED_TOKEN_FILE',
  'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'APPLICATIONINSIGHTS_PROXY',
  'WEBSITE_SITE_NAME', 'MSI_ENDPOINT', 'MSI_SECRET', 'IMDS_ENDPOINT']) delete env[name];
const probeSource = path.join(root, 'services', 'security-core', 'src', 'test', 'java', 'com', 'contoso', 'security', 'AuthPropagationProbe.java');
const collectorSource = path.join(root, 'tools', 'security', 'native-identity-client.mjs');
const probeSourceHashBefore = digest(await readFile(probeSource));
const collectorHashBefore = digest(await readFile(collectorSource));
const helperHashBefore = digest(await readFile(fileURLToPath(import.meta.url)));
const compilerExecutable = path.join(javaHome, 'bin', 'javac.exe');
const compilerExecutableHash = digest(await readFile(compilerExecutable));
const compileArguments = [
  '-cp', classpath, '-d', path.join(work, 'classes'),
  probeSource
];
const compile = await command(compilerExecutable, compileArguments, env, 30000);
if (compile.code !== 0) throw new Error('AV23_PROBE_COMPILE_FAILED');
const probeClass = path.join(work, 'classes', 'com', 'contoso', 'security', 'AuthPropagationProbe.class');
const probeClassHashBefore = digest(await readFile(probeClass));

const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
Object.assign(publicKey, { kid: 'av23', use: 'sig', alg: 'RS256' });
const fields = ['traceparent', 'tracestate', 'baggage', 'request-id', 'correlation-context',
  'x-business-invocation-id', 'x-business-correlation-id'];
const wire = { jwks: [], identity: [], transportControl: [], trusted: [] };
let nativeCollector;
const nativeInFlight = new Set();
const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && ['/v2/track', '/v2.1/track'].includes(url.pathname)) {
    const receive = (async () => {
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > NATIVE_PAYLOAD_LIMIT) throw new Error('NATIVE_PAYLOAD_BOUND');
          chunks.push(chunk);
        }
        const accepted = nativeCollector.ingest(Buffer.concat(chunks), request.headers['content-encoding']);
        response.writeHead(accepted ? 200 : 400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(accepted ?? { errors: [{ message: 'native payload rejected' }] }));
      } catch {
        nativeCollector?.reject('NATIVE_RECEIVER_INCOMPLETE');
        if (!response.headersSent) response.writeHead(400);
        response.end();
      }
    })();
    nativeInFlight.add(receive);
    receive.finally(() => nativeInFlight.delete(receive));
    return;
  }
  const category = url.pathname === '/identity/jwks' ? 'jwks' :
    url.pathname === '/identity/token' ? 'identity' :
      url.pathname === '/identity/transport-control' ? 'transportControl' :
        url.pathname === '/trusted/api' ? 'trusted' : null;
  if (category) wire[category].push(Object.fromEntries(fields.map(name => [name, request.headers[name] !== undefined])));
  request.resume();
  request.on('end', () => {
    if (category === 'identity' && process.argv.includes('--retry-control') && wire.identity.length === 1) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
      response.end('{"error":"synthetic_fixture_retry"}');
      return;
    }
    if (category === 'trusted' && typeof request.headers.traceparent === 'string')
      response.setHeader('x-contoso-fixture-observed-parent', request.headers.traceparent);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (category === 'jwks') response.end(JSON.stringify({ keys: [publicKey] }));
    else if (category === 'identity') response.end(JSON.stringify({
      access_token: ['av23', 'fixture', randomUUID()].join('-'), token_type: 'Bearer',
      expires_on: String(Math.floor(Date.now() / 1000) + 3600),
      resource: url.searchParams.get('resource')
    }));
    else if (category === 'trusted') response.end('{}');
    else response.end('{"itemsReceived":1,"itemsAccepted":1,"errors":[]}');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const fixtureKey = randomUUID();
nativeCollector = createIdentityClientCollector({ endpoint, fixtureKey });
Object.assign(env, {
  APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${fixtureKey};IngestionEndpoint=${endpoint};LiveEndpoint=${endpoint}`,
  APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-av23-probe', OTEL_SERVICE_NAME: 'contoso-av23-probe',
  APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true',
  APPLICATIONINSIGHTS_CONFIGURATION_CONTENT: JSON.stringify({
    sampling: { percentage: 100, overrides: [] },
    selfDiagnostics: { level: 'WARN', destination: 'console' },
    instrumentation: { azureSdk: { enabled: false }, jdbc: { enabled: false }, redis: { enabled: false } }
  }),
  IDENTITY_ENDPOINT: `${endpoint}/identity/token`, IDENTITY_HEADER: 'av23-fixture-' + randomUUID()
});
try {
  const run = await command(path.join(javaHome, 'bin', 'java.exe'), [
    `-javaagent:${agent}`, `-Dotel.javaagent.extensions=${extension}`,
    `-Djava.io.tmpdir=${work}`, '-cp', classpath, 'com.contoso.security.AuthPropagationProbe', endpoint,
    process.argv.includes('--sdk-tracing-disabled') ? 'sdk-tracing-disabled' : 'sdk-tracing-default'
    , process.argv.includes('--isolated-transport') ? 'isolated-transport' : 'default-transport',
    extensionHash
  ], env, 60000);
  let nativeDrainTimer;
  try {
    const drained = await Promise.race([
      Promise.all([...nativeInFlight]).then(() => true),
      new Promise(resolve => { nativeDrainTimer = setTimeout(() => resolve(false), 5000); })
    ]);
    if (!drained) nativeCollector.reject('NATIVE_RECEIVER_INCOMPLETE');
  } finally { clearTimeout(nativeDrainTimer); }
  const matched = /AV23_JAVA_READY (\{[^\r\n]+\})/.exec(run.output);
  const ready = matched ? JSON.parse(matched[1]) : null;
  const usedIdentityScope = checkUsedIdentityScope(ready, wire, {
    securityArtifactUri: pathToFileURL(securityArtifact).href,
    securityArtifactSha256: securityArtifactHash, wrapperMemberSha256: wrapperMemberHash,
    sdkArtifactUri: pathToFileURL(sdkArtifact).href,
    sdkArtifactSha256: sdkArtifactHash, sdkMemberSha256: sdkMemberHash, childPid: run.pid
  });
  const securityArtifactAfter = digest(await readFile(securityArtifact));
  const headerIsolation = checkHeaderIsolation(ready, wire);
  const identityClientOutput = nativeCollector.assess(ready, wire);
  const probeClassHashAfter = digest(await readFile(probeClass));
  const probeSourceHashAfter = digest(await readFile(probeSource));
  const collectorHashAfter = digest(await readFile(collectorSource));
  const helperHashAfter = digest(await readFile(fileURLToPath(import.meta.url)));
  let probeOriginMatches = false;
  try {
    probeOriginMatches = path.resolve(fileURLToPath(ready?.probeCodeSource)).toLowerCase() ===
      path.resolve(path.join(work, 'classes')).toLowerCase();
  } catch {}
  const probeCompilationVerified = probeOriginMatches &&
    ready?.probeClassResourceSha256 === probeClassHashBefore && probeClassHashBefore === probeClassHashAfter &&
    probeSourceHashBefore === probeSourceHashAfter && collectorHashBefore === collectorHashAfter &&
    helperHashBefore === helperHashAfter;
  const trustedPositive = wire.trusted.some(row => row.traceparent && row['x-business-invocation-id']);
  const qualified = run.code === 0 && ready?.mode === 'header_isolation_only' && ready?.headerPolicyVersion === 1 &&
    ready?.isolatedCredentialTransport === true &&
    ready?.providerActive === true && ready?.guardLoadedFromFrozenBytes === true &&
    ready?.jwksCompleted === true &&
    ready?.identityCompleted === true && ready?.trustedCompleted === true &&
    ready?.rawTransportControlCompleted === true && wire.transportControl.length > 0 &&
    wire.jwks.length > 0 && wire.identity.length > 0;
  const result = {
    schema: 'contoso.av23-java-wire.v3', sourceKind: 'real-local-agent-loopback',
    assessmentScope: 'protected-identity-headers-and-actual-native-JWKS-MI-CLIENT-outputs-with-root-binding-and-raw-negative-trusted-positive-controls-not-full-export-completeness',
    providerActive: ready?.providerActive ?? false, agentSha256: lock.agent.sha256,
    guardLoadedFromFrozenBytes: ready?.guardLoadedFromFrozenBytes ?? false,
    guardArtifactVersion: ready?.guardArtifactVersion ?? null, guardPolicy: ready?.guardPolicy ?? null,
    sdkAbi: ready?.sdkAbi ?? null,
    mode: 'header_isolation_only',
    headerPolicyVersion: 1,
    headerIsolation,
    identityClientOutput,
    probeCompilation: {
      verified: probeCompilationVerified,
      compilerPid: compile.pid, compilerExitCode: compile.code,
      compilerExecutable, compilerExecutableSha256: compilerExecutableHash,
      compilerArguments: compileArguments,
      compilerStartedAtUtc: compile.startedAtUtc, compilerEndedAtUtc: compile.endedAtUtc,
      actualCodeSource: ready?.probeCodeSource ?? null,
      classResourceSha256: ready?.probeClassResourceSha256 ?? null,
      compiledClassSha256Before: probeClassHashBefore, compiledClassSha256After: probeClassHashAfter,
      sourceSha256Before: probeSourceHashBefore, sourceSha256After: probeSourceHashAfter,
      productionModuleRebuilt: false,
      widerSourceBuildLineageClaimed: false
    },
    rawTransportControlCompleted: ready?.rawTransportControlCompleted ?? false,
    rawNativeInterceptorPresent: ready?.rawNativeInterceptorPresent ?? null,
    identitySendCalls: ready?.identitySendCalls ?? 0,
    clientObservations: ready?.clientObservations ?? [],
    usedIdentityScope,
    configuredNetworkInterceptorClasses: ready?.configuredNetworkInterceptorClasses ?? [],
    pid: ready?.pid ?? null, processStartUtc: ready?.processStartUtc ?? null,
    observedAtUtc: ready?.observedAtUtc ?? null,
    sdkTracingOptionsDisabled: ready?.sdkTracingOptionsDisabled ?? false,
    isolatedCredentialTransport: ready?.isolatedCredentialTransport ?? false,
    extensionSha256: extensionHash, qualified,
    securityArtifactSha256Before: securityArtifactHash,
    securityArtifactSha256After: securityArtifactAfter,
    securityArtifactStable: securityArtifactHash === securityArtifactAfter,
    capturedAtUtc: new Date().toISOString(),
    harnessSha256: helperHashAfter,
    nativeCollectorSha256Before: collectorHashBefore, nativeCollectorSha256After: collectorHashAfter,
    checkerSha256: digest(await readFile(path.join(root, 'tools', 'security', 'av23-check.mjs'))),
    probeSourceSha256: probeSourceHashAfter,
    exitCode: run.code,
    failureCategories: ['NATIVE_PROVIDER_NOT_ACTIVE', 'CURRENT_GUARD_NOT_LOADED', 'SECURITY_LOGGING_UNSAFE', 'FIXTURE_ENDPOINT_INVALID',
      'TOKEN_UNAVAILABLE', 'JWKS_UNAVAILABLE', 'JWT_REJECTED', 'ClassNotFoundException',
      'NoClassDefFoundError', 'NoSuchMethodError', 'InstanceNotFoundException', 'AttributeNotFoundException', 'IllegalArgumentException']
      .filter(code => run.output.includes(code)),
    missingClasses: [...run.output.matchAll(/(?:NoClassDefFoundError|ClassNotFoundException): ([A-Za-z0-9_.$/]+)/g)]
      .map(match => match[1]).filter(name => /^(?:org[./]slf4j|com[./](?:azure|contoso)|io[./]opentelemetry|ch[./]qos[./]logback)[./]/.test(name)),
    authHeadersAbsent: headerIsolation.productionAuthHeadersAbsent, trustedPropagationObserved: trustedPositive,
    trustedParentAdvanced: ready?.trustedParentAdvanced ?? false,
    retryControlRequested: process.argv.includes('--retry-control'), retryObserved: wire.identity.length > 1,
    requestCounts: Object.fromEntries(Object.entries(wire).map(([name, rows]) => [name, rows.length])),
    wireHeaderPresence: wire, result: qualified && headerIsolation.verified && trustedPositive && ready?.trustedParentAdvanced === true &&
      identityClientOutput.verified && probeCompilationVerified &&
      usedIdentityScope.verified && securityArtifactHash === securityArtifactAfter &&
      (!process.argv.includes('--retry-control') || wire.identity.length > 1) ? 'PASS' : 'FAIL',
    certification: 'NOT_CERTIFIED', sourceAcceptanceIsCertification: false, rawOutputRetained: false
  };
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) {
    const target = path.resolve(process.argv[reportIndex + 1] ?? '');
    const docs = path.join(root, 'services', 'security-core', 'docs');
    const relative = path.relative(docs, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('OWNED_REPORT_PATH_REQUIRED');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.result === 'PASS' ? 0 : 1;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
