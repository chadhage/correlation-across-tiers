import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { digest } from './values.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const watchdog = setTimeout(() => process.exit(1), 30000);
watchdog.unref();
const portal = path.join(root, 'web', 'portal-ssr');
const requirePortal = createRequire(pathToFileURL(path.join(portal, 'package.json')));
const packageModule = async name => import(pathToFileURL(requirePortal.resolve(name)).href);
const { AzureLogger, setLogLevel } = await packageModule('@azure/logger');
setLogLevel(undefined);
AzureLogger.log = () => undefined;

const fields = ['traceparent', 'tracestate', 'baggage', 'request-id', 'correlation-context', 'x-business-invocation-id'];
const wire = { jwks: [], identity: [], metadata: [], trusted: [] };
let publicKey;
const identityReceiver = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const category = url.pathname === '/identity/jwks' ? 'jwks' : url.pathname === '/identity/token' ? 'identity' :
    url.pathname.startsWith('/metadata/') ? 'metadata' : null;
  if (category) wire[category].push(Object.fromEntries(fields.map(name => [name, request.headers[name] !== undefined])));
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (category === 'jwks') response.end(JSON.stringify({ keys: [publicKey] }));
    else if (category === 'identity') response.end(JSON.stringify({
      access_token: ['av23', 'fixture', randomUUID()].join('-'), token_type: 'Bearer',
      expires_on: String(Math.floor(Date.now() / 1000) + 3600), resource: url.searchParams.get('resource')
    }));
    else if (category === 'metadata') response.end(JSON.stringify({ compute: {
      vmId: randomUUID(), name: 'contoso-av23-fixture', location: 'loopback',
      resourceGroupName: 'contoso-av23-fixture', subscriptionId: randomUUID()
    } }));
    else response.end('{"itemsReceived":1,"itemsAccepted":1,"errors":[]}');
  });
});
const gatewayReceiver = createServer((request, response) => {
  wire.trusted.push(Object.fromEntries(fields.map(name => [name, request.headers[name] !== undefined])));
  let body = '';
  request.on('data', part => { if (body.length < 16384) body += part.toString(); });
  request.on('end', () => {
    const command = JSON.parse(body);
    response.writeHead(200, { 'Content-Type': 'application/json',
      'x-business-invocation-id': request.headers['x-business-invocation-id'] });
    response.end(JSON.stringify({ schemaVersion: 1, id: command.orderId,
      businessInvocationId: request.headers['x-business-invocation-id'], state: 'DURABLE_STAGED', details: {} }));
  });
});
await Promise.all([identityReceiver, gatewayReceiver].map(server =>
  new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
const identityOrigin = `http://127.0.0.1:${identityReceiver.address().port}`;
const gatewayOrigin = `http://127.0.0.1:${gatewayReceiver.address().port}`;
const allowedPorts = new Set([identityReceiver.address().port, gatewayReceiver.address().port]);
const originalConnect = Socket.prototype.connect;
let externalConnectionsBlocked = 0;
let metadataConnectionsRerouted = 0;
Socket.prototype.connect = function (...args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const host = options.host ?? options.hostname ?? 'localhost';
  if (host === '169.254.169.254') {
    metadataConnectionsRerouted++;
    options.host = '127.0.0.1';
    options.hostname = '127.0.0.1';
    options.port = identityReceiver.address().port;
    return originalConnect.apply(this, args);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !allowedPorts.has(Number(options.port))) {
    externalConnectionsBlocked++;
    queueMicrotask(() => this.destroy(new Error('AV23_EXTERNAL_CONNECTION_BLOCKED')));
    return this;
  }
  return originalConnect.apply(this, args);
};
for (const name of ['AZURE_CLIENT_SECRET', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_FEDERATED_TOKEN_FILE',
  'MSI_ENDPOINT', 'MSI_SECRET', 'IMDS_ENDPOINT', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete process.env[name];
process.env.IDENTITY_ENDPOINT = `${identityOrigin}/identity/token`;
process.env.IDENTITY_HEADER = 'av23-fixture-' + randomUUID();

let telemetry;
let qualified = false;
let failureCategory = null;
try {
  const { fixtureConfig } = await import(pathToFileURL(path.join(portal, 'tests', 'fixture-config.ts')).href);
  const config = fixtureConfig(identityOrigin, gatewayOrigin);
  config.telemetry.connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=${identityOrigin}/`;
  config.certification.endsAtUtc = new Date(Date.now() + 60000).toISOString();
  const { initializeTelemetry } = await import(pathToFileURL(path.join(portal, 'dist', 'telemetry.js')).href);
  telemetry = await initializeTelemetry(config, {
    CONTOSO_SERVER_SAMPLING_PERCENTAGE: '10', CONTOSO_CERT_START: config.certification.startsAtUtc,
    CONTOSO_CERT_END: config.certification.endsAtUtc, CONTOSO_CERT_WINDOW_ID: config.certification.windowId
  });
  const { trace } = await packageModule('@opentelemetry/api');
  const { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet } = await packageModule('jose');
  const keys = await generateKeyPair('RS256', { modulusLength: 2048 });
  publicKey = { ...await exportJWK(keys.publicKey), kid: 'av23', use: 'sig', alg: 'RS256' };
  const { portalControlAuthorizer } = await import(pathToFileURL(path.join(portal, 'dist', 'control-auth.js')).href);
  const { managedIdentityTokenProvider, createPortalGateway } = await import(pathToFileURL(path.join(portal, 'dist', 'gateway.js')).href);
  const clientId = randomUUID(), principalId = randomUUID();
  const control = portalControlAuthorizer({
    CONTOSO_TENANT_ID: config.identity.tenantId, CONTOSO_ORDERS_API_CLIENT_ID: config.identity.apiClientId,
    CONTOSO_PORTAL_CONTROL_CLIENT_ID: clientId, CONTOSO_PORTAL_CONTROL_PRINCIPAL_ID: principalId
  }, createRemoteJWKSet(new URL(`${identityOrigin}/identity/jwks`), { timeoutDuration: 5000, cooldownDuration: 30000 }));
  const signed = await new SignJWT({ tid: config.identity.tenantId, ver: '2.0', idtyp: 'app',
    azp: clientId, oid: principalId, roles: ['Portal.Invoke'] })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'av23' }).setIssuer(`https://login.microsoftonline.com/${config.identity.tenantId}/v2.0`)
    .setAudience(config.identity.apiClientId).setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 1)
    .setExpirationTime('5m').sign(keys.privateKey);
  const tokenProvider = managedIdentityTokenProvider(config.identity.apiClientId);
  await trace.getTracer('contoso-av23-probe').startActiveSpan('contoso.av23.node.root', async span => {
    assert(span.isRecording() && span.spanContext().traceId !== '0'.repeat(32));
    try {
      await control(signed);
      await tokenProvider(AbortSignal.timeout(5000));
      const gateway = createPortalGateway(config, async () => 'av23-fixture-only', 5000);
      await gateway.createOrder({ schemaVersion: 1, orderId: randomUUID(), sku: 'CONTOSO-AV23', quantity: 1 }, randomUUID());
      qualified = true;
    } finally { span.end(); }
  });
} catch (error) {
  failureCategory = ['PORTAL_CONTROL_REJECTED', 'PORTAL_TOKEN_UNAVAILABLE', 'API_REQUEST_FAILED',
    'API_RESPONSE_INVALID', 'CONFIG_INVALID'].includes(error?.code) ? error.code : 'NATIVE_PROBE_FAILED';
} finally {
  try { if (telemetry) await Promise.race([telemetry.shutdown(), new Promise((_, reject) => setTimeout(() => reject(new Error('DRAIN_TIMEOUT')), 5000))]); }
  catch { failureCategory ??= 'DRAIN_TIMEOUT'; }
  const authClean = wire.jwks.length > 0 && wire.identity.length > 0 &&
    wire.jwks.concat(wire.identity, wire.metadata).every(row => fields.every(name => !row[name]));
  const trusted = wire.trusted.some(row => row.traceparent && row['x-business-invocation-id']);
  const result = {
    schema: 'contoso.av23-node-wire.v1', sourceKind: 'real-local-Microsoft-distro-loopback',
    assessmentScope: 'actual-Portal-JOSE-fetch-MI-and-trusted-Gateway-loopback-not-cloud',
    capturedAtUtc: new Date().toISOString(),
    harnessSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    productionSourceSha256: Object.fromEntries(await Promise.all(['telemetry.ts', 'gateway.ts', 'control-auth.ts']
      .map(async name => [name, digest(await readFile(path.join(portal, 'src', name)))]))),
    qualified, failureCategory, authHeadersAbsent: authClean, trustedPropagationObserved: trusted,
    externalConnectionsBlocked, metadataConnectionsRerouted, metadataWireObserved: wire.metadata.length > 0,
    requestCounts: Object.fromEntries(Object.entries(wire).map(([name, rows]) => [name, rows.length])),
    wireHeaderPresence: wire, result: qualified && authClean && trusted && !failureCategory ? 'PASS' : 'FAIL',
    certification: 'NOT_CERTIFIED', sourceAcceptanceIsCertification: false, rawOutputRetained: false
  };
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) {
    const target = path.resolve(process.argv[reportIndex + 1] ?? '');
    const docs = path.join(root, 'services', 'security-core', 'docs');
    const relative = path.relative(docs, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('OWNED_REPORT_PATH_REQUIRED');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(result, null, 2) + '\n');
  }
  await new Promise(resolve => process.stdout.write(JSON.stringify(result, null, 2) + '\n', resolve));
  process.exitCode = result.result === 'PASS' ? 0 : 1;
  for (const server of [identityReceiver, gatewayReceiver]) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  clearTimeout(watchdog);
  process.exit(process.exitCode);
}
