import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ownedConfigurationHash } from '../observability/telemetry-contract.mjs';
import { openSamplerNativeReceiver } from '../observability/sampler-native-intake.mjs';
import { mergeLocalTraceTree, checkSeededLocalFailures } from '../observability/local-trace-tree.mjs';
import { repositoryPath, runLocalRehearsal } from '../../web/portal-ssr/scripts/local-rehearsal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRACE = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN = /^(?!0{16}$)[0-9a-f]{16}$/;
const requireValue = (condition, code) => { if (!condition) throw new Error(code); };
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
async function within(promise, milliseconds, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export function selectLocalClasspath(value, inventoryClasses) {
  requireValue(typeof value === 'string' && value.length > 0, 'LOCAL_PAIR_CLASSPATH_REQUIRED');
  const entries = value.split(path.delimiter);
  if (entries.at(-1) === '') entries.pop();
  requireValue(entries.length > 1 && entries.every(entry => entry && path.isAbsolute(entry)),
    'LOCAL_PAIR_ABSOLUTE_CLASSPATH_REQUIRED');
  return [...entries, inventoryClasses].join(path.delimiter);
}

export function validateIngress(record) {
  const required = ['schema', 'profile', 'method', 'path', 'traceparent', 'sdkTraceId', 'sdkSpanId',
    'observedAtUtc', 'businessInvocationId'];
  requireValue(record && required.every(key => Object.hasOwn(record, key)) &&
    Object.keys(record).every(key => [...required, 'tracestate'].includes(key)) &&
    record.schema === 'contoso.local-pair-ingress.v1' && record.profile === 'LOCAL REHEARSAL' &&
    record.method === 'POST' && record.path === '/api/orders' &&
    /^00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-01$/.test(record.traceparent) &&
    TRACE.test(record.sdkTraceId) && SPAN.test(record.sdkSpanId) && UUID.test(record.businessInvocationId) &&
    record.sdkTraceId === record.traceparent.slice(3, 35) &&
    typeof record.observedAtUtc === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(record.observedAtUtc) &&
    Number.isFinite(Date.parse(record.observedAtUtc)) &&
    new Date(record.observedAtUtc).toISOString().slice(0, 19) === record.observedAtUtc.slice(0, 19) &&
    (!Object.hasOwn(record, 'tracestate') || record.tracestate === 'contoso=cert'), 'LOCAL_PAIR_INGRESS_REJECTED');
  return record;
}

function credentials(durationSeconds) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const identity = Object.fromEntries(['TENANT', 'PUBLIC_AUDIENCE', 'ORDERS_AUDIENCE', 'INVENTORY_AUDIENCE',
    'STOREFRONT_CLIENT', 'PORTAL_CLIENT', 'PORTAL_OBJECT', 'ORDERS_CLIENT', 'ORDERS_OBJECT',
    'GATEWAY_CLIENT', 'GATEWAY_OBJECT'].map(name => [`CONTOSO_TEST_${name}`, randomUUID()]));
  const kid = 'contoso-local-pair';
  identity.CONTOSO_TEST_PUBLIC_JWK = JSON.stringify({ ...publicKey.export({ format: 'jwk' }), kid });
  const userObject = randomUUID();
  function token(audience, client, object, actor, roles, scope) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: `https://login.microsoftonline.com/${identity.CONTOSO_TEST_TENANT}/v2.0`,
      aud: audience, iat: now, nbf: now - 5, exp: now + durationSeconds + 60, ver: '2.0',
      tid: identity.CONTOSO_TEST_TENANT, azp: client, oid: object, idtyp: actor, roles, ...(scope ? { scp: scope } : {}) })).toString('base64url');
    const content = `${header}.${body}`;
    return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
  }
  const accessToken = token(identity.CONTOSO_TEST_PUBLIC_AUDIENCE, identity.CONTOSO_TEST_STOREFRONT_CLIENT,
    userObject, 'user', [], 'Orders.Invoke');
  const gatewayAccessToken = token(identity.CONTOSO_TEST_ORDERS_AUDIENCE, identity.CONTOSO_TEST_GATEWAY_CLIENT,
    identity.CONTOSO_TEST_GATEWAY_OBJECT, 'app', ['Gateway.Invoke']);
  const inventoryToken = token(identity.CONTOSO_TEST_INVENTORY_AUDIENCE, identity.CONTOSO_TEST_ORDERS_CLIENT,
    identity.CONTOSO_TEST_ORDERS_OBJECT, 'app', ['Inventory.Invoke']);
  return { identity, accessToken, gatewayAccessToken, inventoryToken,
    forbiddenValues: [accessToken, gatewayAccessToken, inventoryToken, userObject, identity.CONTOSO_TEST_TENANT,
      ...Object.entries(identity).filter(([name]) => name.endsWith('_OBJECT')).map(([, value]) => value)] };
}

async function assertHash(file, expected) {
  requireValue((await lstat(file)).isFile() && sha256(await readFile(file)) === expected, 'LOCAL_PAIR_PRODUCT_HASH');
}

async function startJava({ role, directory, lock, classpath, receiver, publisher, auth, inventoryBase, expiresAt, debugJava }) {
  const service = `contoso-${role}-api`;
  const guard = lock.extensions[0];
  const configFile = path.join(directory, `${role}.json`);
  const configuration = JSON.parse(await readFile(path.join(root, 'config', 'java-agent.json'), 'utf8'));
  configuration.sampling = { percentage: 100, overrides: [] };
  await writeFile(configFile, json(configuration), { flag: 'wx' });
  const absent = { $contosoAbsent: true };
  const full = { 'sampling.overrides': [], 'sampling.percentage': 100, 'sampling.requestsPerSecond': absent };
  const baseline = { 'sampling.overrides': [], 'sampling.percentage': absent, 'sampling.requestsPerSecond': 5 };
  const runId = randomUUID();
  const leaseFile = path.join(directory, `${role}.lease.json`);
  const startsAtUtc = new Date(Date.now() - 1000).toISOString();
  await writeFile(leaseFile, json({ schema: 'contoso.sampling-runtime-lease.v1', runId, layerId: service,
    revision: `cert-${runId}`, startsAtUtc, expiresAtUtc: expiresAt,
    drainAtUtc: new Date(Date.parse(expiresAt) - 10000).toISOString(),
    restoreDeadlineUtc: new Date(Date.parse(expiresAt) + 60000).toISOString(),
    hashAlgorithm: 'contoso.canonical-json.sha256.v1', ownedConfigSha256: ownedConfigurationHash(full),
    baselineOwnedConfigSha256: ownedConfigurationHash(baseline), ownedConfiguration: full,
    guard: { sha256: guard.sha256, providerClass: guard.providerClass, sdkAbi: guard.sdkAbi,
      version: guard.version, policy: guard.guardPolicy } }), { flag: 'wx' });
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(?:APPLICATIONINSIGHTS|OTEL|CONTOSO_TEST|CONTOSO_CERT|CONTOSO_SAMPLING|CONTOSO_TRUST_ROOT)/i.test(name) ||
        ['JAVA_TOOL_OPTIONS', 'JAVA_OPTS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS'].includes(name.toUpperCase())) delete env[name];
  }
  Object.assign(env, auth.identity, {
    SERVER_PORT: '0', SERVER_ADDRESS: '127.0.0.1', CONTOSO_LOCAL_PAIR_REHEARSAL: 'true',
    CONTOSO_TEST_INVENTORY_BASE: inventoryBase, CONTOSO_TEST_INVENTORY_TOKEN: auth.inventoryToken,
    APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${publisher};IngestionEndpoint=${receiver}`,
    APPLICATIONINSIGHTS_ROLE_NAME: service, OTEL_SERVICE_NAME: service,
    APPLICATIONINSIGHTS_CONFIGURATION_FILE: configFile, CONTOSO_SAMPLING_LEASE_FILE: leaseFile,
    APPLICATIONINSIGHTS_SELF_DIAGNOSTICS_LEVEL: 'WARN',
    APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true', APPLICATIONINSIGHTS_LIVEMETRICS_ENABLED: 'false',
    CONTOSO_CERTIFICATION_MODE: 'false', CONTOSO_CERT_START: startsAtUtc, CONTOSO_CERT_END: expiresAt,
    CONTOSO_CERT_WINDOW_ID: runId
  });
  for (const name of ['JDBC', 'REDIS', 'AZURE_SDK']) env[`APPLICATIONINSIGHTS_INSTRUMENTATION_${name}_ENABLED`] = 'false';
  for (const name of ['APPLICATIONINSIGHTS_ENABLE_AGENT', 'JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY', 'INITIALIZED_FROM_PLACEHOLDER'])
    env[name] = 'false';
  const extension = path.join(root, guard.module, guard.file);
  const args = ['-Xms64m', '-Xmx256m', `-Djava.io.tmpdir=${directory}`, `-javaagent:${process.env.CONTOSO_AGENT_JAR}`,
    `-Dotel.javaagent.extensions=${extension}`,
    ...['jdbc', 'jdbc-datasource', 'lettuce', 'jedis', 'redisson', 'azure-core', 'ai-azure-functions']
      .map(module => `-Dotel.instrumentation.${module}.enabled=false`),
    ...(debugJava ? ['-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:0'] : []),
    '-cp', classpath, 'com.contoso.orders.NativeApiFixture', role];
  const child = spawn(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'), args,
    { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let exited = false, exitCode, loaded = 0, debugPort = null, ingressWrites = Promise.resolve(), failure;
  const exit = new Promise(accept => {
    child.once('error', () => { failure = new Error('LOCAL_PAIR_JAVA_LAUNCH'); accept(); });
    child.once('close', code => { exited = true; exitCode = code; accept(); });
  });
  let readyResolve;
  const ready = new Promise(accept => { readyResolve = accept; });
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', line => {
      if (line.length > 131072) { failure = new Error('LOCAL_PAIR_PROCESS_OUTPUT_BOUND'); return; }
      if (line.includes('CONTOSO_PARENT_SAFE_SAMPLER_LOADED')) loaded++;
      const debug = /^Listening for transport dt_socket at address: (\d+)$/.exec(line);
      if (debug) debugPort = Number(debug[1]);
      const marker = /^CONTOSO_NATIVE_API_READY (\d+)$/.exec(line);
      if (marker) readyResolve(Number(marker[1]));
      if (line.startsWith('CONTOSO_LOCAL_PAIR_INGRESS ')) {
        ingressWrites = ingressWrites.then(async () => {
          const record = validateIngress(JSON.parse(line.slice('CONTOSO_LOCAL_PAIR_INGRESS '.length)));
          await appendFile(path.join(directory, 'ingress.ndjson'), `${JSON.stringify(record)}\n`);
        }).catch(() => { failure = new Error('LOCAL_PAIR_INGRESS_REJECTED'); });
      }
      const gate = /\b(GATE_[0-9A-Z_]+|LOCAL_PAIR_INGRESS_REJECTED)\b/.exec(line);
      if (gate) failure = new Error(gate[1]);
    });
  }
  child.stdin.on('error', () => { failure ??= new Error('LOCAL_PAIR_JAVA_INPUT'); });
  const handle = {
    pid: child.pid, origin: null, get debugPort() { return debugPort; },
    assertHealthy() { if (failure) throw failure; requireValue(!exited, 'LOCAL_PAIR_JAVA_EXITED'); },
    async stop() {
      if (!exited) {
        child.stdin.end('\n');
        try { await within(exit, 45000, 'LOCAL_PAIR_SHUTDOWN_TIMEOUT'); }
        catch (error) { child.kill(); await exit; throw error; }
      }
      await ingressWrites;
      if (failure) throw failure;
      requireValue(exitCode === 0 && loaded === 1, 'LOCAL_PAIR_SINGLE_AGENT_SHUTDOWN_REQUIRED');
    }
  };
  try {
    const port = await within(Promise.race([ready, exit.then(() => null)]), 60000, 'LOCAL_PAIR_JAVA_READY_TIMEOUT');
    if (failure) throw failure;
    requireValue(Number.isInteger(port) && port > 0 && port <= 65535, 'LOCAL_PAIR_JAVA_READY_TIMEOUT');
    handle.origin = `http://127.0.0.1:${port}`;
    const response = await fetch(`${handle.origin}/health/ready`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    requireValue(response.status === 200, 'LOCAL_PAIR_JAVA_NOT_READY');
    return handle;
  } catch (error) {
    if (!exited) { child.kill(); await exit; }
    throw error;
  }
}

export async function startLocalPair({ outputDirectory, durationSeconds = 600, debugJava = false }) {
  requireValue(Number.isInteger(durationSeconds) && durationSeconds >= 180 && durationSeconds <= 1800, 'LOCAL_PAIR_DURATION');
  const directory = repositoryPath(outputDirectory, root);
  requireValue(directory !== root, 'LOCAL_PAIR_NEW_REPOSITORY_DIRECTORY_REQUIRED');
  requireValue(typeof process.env.JAVA_HOME === 'string' && typeof process.env.CONTOSO_AGENT_JAR === 'string',
    'LOCAL_PAIR_USE_POWERSHELL_LAUNCHER');
  const lock = JSON.parse(await readFile(path.join(root, 'config', 'versions.lock.json'), 'utf8'));
  requireValue(lock.extensions.length === 1, 'LOCAL_PAIR_ONE_GUARD_REQUIRED');
  await Promise.all([
    assertHash(process.env.CONTOSO_AGENT_JAR, lock.agent.sha256),
    assertHash(path.join(root, lock.extensions[0].module, lock.extensions[0].file), lock.extensions[0].sha256)
  ]);
  const classpath = selectLocalClasspath(process.env.CONTOSO_LOCAL_PAIR_CLASSPATH,
    path.join(root, 'services', 'inventory-api', 'target', 'classes'));
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory);
  await Promise.all(['telemetry.ndjson', 'ingress.ndjson'].map(file =>
    writeFile(path.join(directory, file), '', { flag: 'wx' })));
  const auth = credentials(durationSeconds);
  const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
  const publishers = [randomUUID(), randomUUID()];
  const receiver = await openSamplerNativeReceiver({ publisherKeys: publishers, forbiddenValues: auth.forbiddenValues,
    onCapture: capture => appendFile(path.join(directory, 'telemetry.ndjson'),
      capture.nativeEnvelopes.map(envelope => JSON.stringify(envelope)).join('\n') + '\n') });
  let inventory, orders, controller, watchdog, healthcheck, closing;
  const manifestPath = path.join(directory, 'local-pair.json');
  let finishResolve, finishReject;
  const finished = new Promise((accept, reject) => { finishResolve = accept; finishReject = reject; });
  // Consumers can attach later; shutdown failures must not become unhandled rejections.
  finished.catch(() => {});
  const manifest = { schemaVersion: 1, profile: 'LOCAL REHEARSAL', ready: false, certificationEligible: false,
    expiresAtUtc: expiresAt, telemetryPath: 'telemetry.ndjson', ingressPath: 'ingress.ndjson',
    limitations: ['H2 PostgreSQL mode; not PostgreSQL', 'RESP peer; not Managed Redis',
      'Synthetic JWTs; not Entra', 'Uninstrumented browser forwarder; not APIM', 'No broker delivery'] };
  async function stop(cause) {
    closing ??= (async () => {
      clearTimeout(watchdog); clearInterval(healthcheck);
      manifest.ready = false;
      const errors = cause ? [cause] : [];
      if (controller) {
        controller.closeAllConnections();
        await new Promise(accept => controller.close(accept));
      }
      for (const child of [orders, inventory].filter(Boolean)) {
        try { await child.stop(); } catch (error) { errors.push(error); }
      }
      try {
        const capture = await receiver.finish();
        await writeFile(path.join(directory, 'capture-summary.json'), json({
          schema: 'contoso.local-pair-capture.v1', certificationEligible: false,
          originalPrivacyCapture: capture.originalPrivacyCapture, receiverDiagnostics: capture.receiverDiagnostics,
          nativeEnvelopeCount: capture.observations.length
        }), { flag: 'wx' });
      } catch (error) { errors.push(error); await receiver.stop(); }
      manifest.status = errors.length ? 'FAILED' : 'STOPPED';
      manifest.processesStopped = true;
      await writeFile(manifestPath, json(manifest));
      if (errors.length) throw errors[0];
    })();
    closing.then(finishResolve, finishReject);
    return closing;
  }
  try {
    const options = { directory, lock, classpath, receiver: receiver.endpoint, auth, expiresAt, debugJava };
    inventory = await startJava({ ...options, role: 'inventory', publisher: publishers[0], inventoryBase: 'http://127.0.0.1:1/api' });
    orders = await startJava({ ...options, role: 'orders', publisher: publishers[1], inventoryBase: `${inventory.origin}/api` });
    controller = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
      // No browser CORS grant: only the local driver may retrieve these synthetic credentials.
      if (request.method !== 'GET' || request.url !== '/token' || request.headers.origin !== undefined) {
        response.writeHead(403).end(); return;
      }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
      response.end(JSON.stringify({ accessToken: auth.accessToken, gatewayAccessToken: auth.gatewayAccessToken }));
    });
    await new Promise((accept, reject) => {
      controller.once('error', reject); controller.listen(0, '127.0.0.1', accept);
    });
    Object.assign(manifest, { ready: true, ordersOrigin: orders.origin, inventoryOrigin: inventory.origin,
      receiverOrigin: receiver.endpoint, controlOrigin: `http://127.0.0.1:${controller.address().port}`,
      processes: { orders: orders.pid, inventory: inventory.pid },
      debugPorts: { orders: orders.debugPort, inventory: inventory.debugPort } });
    await writeFile(manifestPath, json(manifest), { flag: 'wx' });
    watchdog = setTimeout(() => { void stop().catch(() => {}); }, Math.max(0, Date.parse(expiresAt) - Date.now() - 10000));
    healthcheck = setInterval(() => {
      try {
        orders.assertHealthy(); inventory.assertHealthy();
        requireValue(!receiver.diagnostics().poisoned, 'LOCAL_PAIR_NATIVE_CAPTURE_REJECTED');
      } catch (error) { void stop(error).catch(() => {}); }
    }, 500);
    return { manifest, manifestPath, finished, stop };
  } catch (error) {
    await stop(error);
    throw error;
  }
}

export async function runLocalGoldenPath(pair, outputDirectory) {
  try {
    await runLocalRehearsal({ pairFile: pair.manifestPath, outputDirectory });
  } finally { await pair.stop(); }
  const [map, browserEvidence, browserLines, jvmLines] = await Promise.all([
    readFile(path.join(root, 'contracts', 'expected-boundary-map.v1.json'), 'utf8'),
    readFile(path.join(outputDirectory, 'browser-evidence.json'), 'utf8'),
    readFile(path.join(outputDirectory, 'browser-telemetry.ndjson'), 'utf8'),
    readFile(path.join(path.dirname(pair.manifestPath), 'telemetry.ndjson'), 'utf8')
  ]);
  const ndjson = text => text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const input = { map: JSON.parse(map), browserEvidence: JSON.parse(browserEvidence),
    browserEnvelopes: ndjson(browserLines), jvmEnvelopes: ndjson(jvmLines),
    businessInvocationId: JSON.parse(browserEvidence).businessInvocationId };
  const tree = mergeLocalTraceTree(input);
  const controls = checkSeededLocalFailures(input);
  await Promise.all([
    writeFile(path.join(outputDirectory, 'local-trace-tree.json'), json({ ...tree, seededFailureControls: controls,
      pairProcessesStopped: true, sourceScope: 'CURRENT_LOCAL_EXECUTION_SAVED_CAPTURE_STRUCTURAL_CHECK' }), { flag: 'wx' }),
    writeFile(path.join(outputDirectory, 'local-trace-tree.txt'), tree.tree, { flag: 'wx' })
  ]);
  return tree;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const flags = args.slice(4);
    requireValue(args[0] === '--out' && args[2] === '--duration' && flags.length <= 2 &&
      new Set(flags).size === flags.length && flags.every(flag => ['--debug-java', '--run-browser'].includes(flag)),
    'LOCAL_PAIR_ARGUMENTS');
    const pair = await startLocalPair({ outputDirectory: args[1], durationSeconds: Number(args[3]), debugJava: args.includes('--debug-java') });
    const shutdown = () => { void pair.stop().catch(() => {}); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    process.stdout.write(`LOCAL_PAIR_READY ${pair.manifestPath}\n`);
    process.stdout.write('LOCAL REHEARSAL: synthetic identity, H2/RESP, no APIM, no Azure, NOT CERTIFIED. Ctrl+C stops owned processes.\n');
    if (args.includes('--run-browser')) {
      const tree = await runLocalGoldenPath(pair, path.join(path.dirname(pair.manifestPath), 'browser'));
      process.stdout.write(tree.tree);
      process.stdout.write('LOCAL_GOLDEN_PATH_PASS: browser, two JVMs, logical data spans, parent joins and seeded checker negatives; owned processes stopped. NOT CERTIFIED.\n');
    } else await pair.finished;
    process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : error?.message;
    process.stderr.write(`${/^(?:LOCAL_|GATE_|NATIVE_|[ABC]_)[A-Z0-9_]+$/.test(code) ? code : 'LOCAL_PAIR_FAILED'}\n`);
    process.exitCode = 1;
  }
}
