import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { boundedJsonResponse, createAzureExampleClient, decodeObservedLogsResult,
  validateAzureExampleConfig } from '../../tools/verification/adapters/azure-operator.mjs';
import { runAzureExample, azureExamplesMain } from '../../tools/verification/azure-examples.mjs';
import { assertAzureScenario, assertObservedHttpPath, executeAzureScenario } from '../../tools/verification/azure-scenarios.mjs';
import { projectRoot, verifyManifest } from '../../tools/verification/files.mjs';
import { prepareExampleWindow, prepareOperatorParameters } from '../../examples/azure-operator/prepare.mjs';
import { validateRuntimeLease } from '../../tools/observability/runtime-lease.mjs';
import { UUID } from '../../tools/observability/telemetry-contract.mjs';

const config = () => ({
  schema: 'contoso.azure-examples.v1', operatorOrigin: 'https://contoso-operator.example.test',
  operatorTokenScope: 'api://11111111-1111-4111-8111-111111111111/.default',
  portalOrigin: 'https://contoso-portal.example.test', ordersTokenScope: 'api://22222222-2222-4222-8222-222222222222/.default',
  managedIdentityClientId: null, operatorTokenEnvironment: 'CONTOSO_OPERATOR_TOKEN',
  portalTokenEnvironment: 'CONTOSO_PORTAL_CONTROLLER_TOKEN', userTokenEnvironment: 'CONTOSO_DEMO_USER_TOKEN',
  browserStorageStateFile: null, headless: true, settleSeconds: 30, ingestionGraceSeconds: 30,
  waitSeconds: 30, pageSize: 5000, maxRows: 10000, load: { requestsPerSecond: 1, durationSeconds: 1 }
});

test('Azure examples reject unsafe destinations, credential-bearing config and unbounded traffic before requests', () => {
  assert.equal(validateAzureExampleConfig(config()).pageSize, 5000);
  for (const change of [
    { operatorOrigin: 'http://contoso.example.test' }, { operatorOrigin: 'https://user:password@contoso.example.test' },
    { operatorOrigin: 'https://contoso.example.test/?token=secret' }, { operatorTokenScope: config().ordersTokenScope },
    { managedIdentityClientId: '00000000-0000-0000-0000-000000000000' }, { clientSecret: 'not-allowed' },
    { operatorTokenEnvironment: 'Bearer supplied-token' }, { settleSeconds: 0 },
    { load: { requestsPerSecond: 11, durationSeconds: 120 } },
    { browserStorageStateFile: path.join(projectRoot, '.cache', 'credentials.json') }
  ]) assert.throws(() => validateAzureExampleConfig({ ...config(), ...change }));
});

test('the concrete operator client scopes paths, suppresses redirects and never exposes unsafe remote error bodies', async () => {
  const calls = [];
  const client = createAzureExampleClient(config(), async () => 'fixture-not-a-real-token', async (url, request) => {
    calls.push({ url, request });
    return new Response('{"code":"raw-value-with-secret","detail":"sensitive-untrusted-response"}', { status: 500 });
  });
  await assert.rejects(client.post('/describe', {}), error =>
    error.code === 'AZURE_EXAMPLE_OPERATOR_REJECTED' && !error.message.includes('sensitive'));
  assert.equal(calls[0].request.redirect, 'error');
  assert.equal(calls[0].url, config().operatorOrigin + '/describe');
  await assert.rejects(client.post('//external.example.test', {}), /ROUTE_INVALID/);
  assert.equal(calls.length, 1);
});

test('response decoding rejects duplicate keys, including duplicate keys hidden inside native dynamic columns', async () => {
  await assert.rejects(boundedJsonResponse(new Response('{"safe":1,"safe":2}')), /RESPONSE_INVALID/);
  const result = { tables: [{ name: 'PrimaryResult', columns: [{ name: 'Properties', type: 'dynamic' }],
    rows: [['{"Authorization":"synthetic forbidden first value","Authorization":""}']] }] };
  assert.throws(() => decodeObservedLogsResult(result), /DUPLICATE_KEY/);
  const valid = decodeObservedLogsResult({ tables: [{ name: 'PrimaryResult',
    columns: [{ name: 'Properties', type: 'dynamic' }], rows: [['{"contoso.outcome":"SUCCESS"}']] }] });
  assert.deepEqual(valid.rows[0].Properties, { 'contoso.outcome': 'SUCCESS' });
});

test('failure after preparing a live example still stops and restores the owned run and records no raw error', async () => {
  const scratch = path.join(projectRoot, '.cache', `azure-example-test-${randomUUID()}`);
  const id = randomUUID(), workflow = randomUUID(), calls = [];
  const client = {
    config: config(),
    async post(route) {
      calls.push(route);
      if (route === '/describe') return { approvalReference: 'fixture-approval', certificationStatus: 'NOT CERTIFIED',
        startsAtUtc: new Date(Date.now() - 1000).toISOString(), expiresAtUtc: new Date(Date.now() + 60000).toISOString() };
      if (route === '/runs') return { runId: id, baselineSha256: 'a'.repeat(64) };
      if (route.endsWith('/sampling-on')) return { configurationPercentage: 100, nativeFidelityVerified: false };
      if (route.endsWith('/allocate')) return { workflowId: workflow };
      if (route.endsWith('/gateway')) throw new Error('never persist this raw sensitive fixture failure');
      if (route.endsWith('/stop')) return { admissionStopped: true };
      if (route.endsWith('/reset')) return { result: 'RESTORED', runId: id, certificationStatus: 'NOT CERTIFIED' };
      throw new Error('unexpected fixture route');
    }
  };
  try {
    const result = await runAzureExample({ id: '06', client, approvalReference: 'fixture-approval', outputRoot: scratch });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.failure.code, 'AZURE_EXAMPLE_FAILED');
    assert.equal(result.reset.result, 'RESTORED');
    assert.deepEqual(calls.slice(-2), [`/runs/${id}/stop`, `/runs/${id}/reset`]);
    const directory = path.join(projectRoot, result.evidencePath);
    const manifest = await verifyManifest(directory);
    assert.equal(manifest.sourceKind, 'azure-operator-observation-not-enrolled');
    const text = await readFile(path.join(directory, 'result.json'), 'utf8');
    assert.doesNotMatch(text, /sensitive fixture/);
    assert.equal(manifest.files.some(file => file.path === 'observed-safe-rows.json'), false);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

function retryEvidence() {
  const invocation = randomUUID(), message = randomUUID(), trace = 'a'.repeat(32), parent = 'b'.repeat(16);
  const evidence = { id: '06', assertions: [], calls: [], retryFailures: 2,
    observations: { workflows: [{ invocation_id: invocation }],
      publications: [{ destination: 'SERVICE_BUS_ORDER', envelope_json: { traceparent: `00-${trace}-${parent}-01`,
        messageId: message, 'business.invocation_id': invocation } }] } };
  const capture = { rows: [1, 2, 3].map(attempt => ({
    recordKind: 'span', traceId: trace, spanId: String(attempt).repeat(16), parentSpanId: parent,
    businessInvocationId: invocation, nativeItemCount: 1, semanticKind: 'CONSUMER',
    operationName: 'contoso.fulfillment.process', nativeLinksJson: null,
    nativeProperties: { 'contoso.process.attempt': String(attempt), 'contoso.message.id': message,
      'contoso.outcome': attempt === 3 ? 'SUCCESS' : 'RETRY' }
  })) };
  return { evidence, capture };
}

test('native retry assertions reject missing and extra deliveries without promoting a valid subset to certification', () => {
  const { evidence, capture } = retryEvidence();
  const result = assertAzureScenario(evidence, capture);
  assert.equal(result.result, 'OBSERVED');
  assert.equal(result.formalAcceptance, false);
  assert.equal(result.certificationStatus, 'NOT CERTIFIED');
  assert.throws(() => assertAzureScenario(evidence, { rows: capture.rows.slice(1) }), /unexpected delivery attempts/);
  assert.throws(() => assertAzureScenario(evidence, { rows: [...capture.rows, capture.rows[0]] }), /DUPLICATE_NATIVE_SPAN/);
});

test('fan-in checks the received result SEND contexts, not an arbitrary earlier publication', () => {
  const invocation = randomUUID();
  const contexts = ['1', '2', '3', '4'].map((value, index) => ({
    traceId: String.fromCharCode(97 + index).repeat(32), spanId: value.repeat(16)
  }));
  const parent = value => `00-${value.traceId}-${value.spanId}-01`;
  const evidence = { id: '08', assertions: [], calls: [],
    observations: { workflows: [{ invocation_id: invocation }], publications: [],
      contributors: [
        { branch: 'FULFILLMENT', process_traceparent: parent(contexts[0]), result_traceparent: parent(contexts[1]) },
        { branch: 'NOTIFY', process_traceparent: parent(contexts[2]), result_traceparent: parent(contexts[3]) }
      ] } };
  const aggregate = { recordKind: 'span', traceId: 'e'.repeat(32), spanId: '5'.repeat(16), parentSpanId: null,
    businessInvocationId: invocation, nativeItemCount: 1, semanticKind: 'INTERNAL', operationName: 'contoso.fanin.process',
    nativeProperties: {}, nativeLinksJson: JSON.stringify(contexts.map(value => ({ operation_Id: value.traceId, id: value.spanId }))) };
  assert.equal(assertAzureScenario(evidence, { rows: [aggregate] }).result, 'OBSERVED');
  const incomplete = { ...aggregate, nativeLinksJson: JSON.stringify(contexts.slice(1).map(value => ({ operation_Id: value.traceId, id: value.spanId }))) };
  assert.throws(() => assertAzureScenario(evidence, { rows: [incomplete] }), /missing or invented contributor links/);
});

test('HTTP observations require the exact actual parent chain, not just a plausible inventory of roles', () => {
  const traceId = 'a'.repeat(32);
  const definitions = [
    ['contoso-storefront-spa', 'AppDependencies', '1', null],
    ['contoso-corr-poc-apim', 'AppRequests', '2', '1'],
    ['contoso-corr-poc-apim', 'AppDependencies', '3', '2'],
    ['contoso-orders-api', 'AppRequests', '4', '3'],
    ['contoso-orders-api', 'AppDependencies', '5', '4'],
    ['contoso-inventory-api', 'AppRequests', '6', '5'],
    ['contoso-inventory-api', 'AppDependencies', '7', '6'],
    ['contoso-inventory-api', 'AppDependencies', '8', '6']
  ];
  const spans = definitions.map(([roleName, nativeTable, id, parent], index) => ({
    roleName, nativeTable, traceId, spanId: id.repeat(16), parentSpanId: parent?.repeat(16) ?? null,
    semanticKind: index >= 6 ? 'CLIENT' : null, durationMs: 1,
    nativeProperties: index >= 6 ? { 'db.system': index === 6 ? 'postgresql' : 'redis' } : {}
  }));
  const browser = { traceId, spanId: '1'.repeat(16) };
  assertObservedHttpPath(spans, { browser });
  const wrong = structuredClone(spans); wrong[4].parentSpanId = '2'.repeat(16);
  assert.throws(() => assertObservedHttpPath(wrong, { browser }), /PARENT_CHAIN_BROKEN/);
  assert.throws(() => assertObservedHttpPath(spans.filter((_, index) => index !== 2), { browser }), /PARENT_CHAIN_BROKEN/);
});

test('window preparation reuses exact runtime lease hashes and is not an execution or runtime acknowledgement', async () => {
  const start = new Date(Date.now() - 1000).toISOString(), end = new Date(Date.now() + 1800000).toISOString();
  const result = await prepareExampleWindow({ startsAtUtc: start, expiresAtUtc: end, approvalReference: 'fixture-only-approval' });
  assert.equal(result.metadata.authorityGranted, false);
  assert.equal(result.metadata.runtimeAcknowledgements, 'NOT OBSERVED');
  for (const [role, lease] of Object.entries(result.leases)) {
    assert.equal(validateRuntimeLease(lease, { layerId: role }).runId, result.metadata.runId);
    assert.equal(lease.ownedConfiguration['sampling.percentage'], 100);
    assert.deepEqual(lease.ownedConfiguration['sampling.requestsPerSecond'], { $contosoAbsent: true });
  }
  await assert.rejects(prepareExampleWindow({ startsAtUtc: start,
    expiresAtUtc: new Date(Date.parse(start) + 3600001).toISOString(), approvalReference: 'fixture' }), /PREPARATION_WINDOW/);
});

test('operator infrastructure preparation canonicalizes approved CIDRs and refuses secrets or a universal runner route', () => {
  const input = {
    schema: 'contoso.azure-operator-infra.v1', subscriptionId: '474c40eb-d385-40d8-baa2-06883dbdca2d',
    appServicePlanResourceId: '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-unit/providers/Microsoft.Web/serverfarms/contoso-unit-plan',
    integrationSubnetResourceId: '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-unit/providers/Microsoft.Network/virtualNetworks/contoso-unit-vnet/subnets/compute',
    names: { operator: 'contoso-unit-operator', watchdog: 'contoso-unit-watchdog', inventoryFixture: 'contoso-unit-inventory-fixture' },
    runnerCidrs: ['192.0.2.27/24'], operatorSettings: {}, watchdogSettings: {}, inventoryFixtureSettings: {}, location: 'centralus'
  };
  assert.deepEqual(prepareOperatorParameters(input).parameters.runnerCidrs.value, ['192.0.2.0/24']);
  assert.throws(() => prepareOperatorParameters({ ...input, runnerCidrs: ['1.2.3.4/0'] }), /RUNNER_CIDRS/);
  assert.throws(() => prepareOperatorParameters({ ...input, operatorSettings: { CLIENT_SECRET: 'not-a-real-secret' } }), /NON_SECRET/);
});

test('Demo 01 reads the durable order identity without waiting for asynchronous completion', async () => {
  const workflowId = randomUUID(), invocationId = randomUUID(), runId = randomUUID(), calls = [];
  let storedId = invocationId;
  const client = {
    config: config(),
    async post(route, body) {
      const action = route.split('/').at(-1);
      calls.push({ action, body });
      if (action === 'allocate') return { workflowId };
      if (action === 'attach') return { attached: true };
      if (action === 'gateway') return { status: 200, invocationId: randomUUID(),
        body: { id: workflowId, state: 'QUEUED', businessInvocationId: storedId } };
      if (action === 'observations') return { workflows: [], attempts: [], events: [], publications: [], contributors: [], drained: false };
      throw new Error('unexpected fixture operation');
    }
  };
  let status = 202;
  const browser = { ready: { apiOrigin: 'https://contoso-gateway.example.test' },
    async drive() { return { backendId: workflowId, businessInvocationId: invocationId, outcome: 'staged', executionMode: 'live',
      backendState: 'QUEUED', observations: [{ method: 'POST', path: '/contoso/v1/orders', status }] }; } };
  const input = { id: '01', client, browser, run: { runId },
    metadata: { gatewayUrl: 'https://contoso-gateway.example.test/contoso/v1' } };
  await executeAzureScenario(input);
  assert.deepEqual(calls.filter(call => call.action === 'gateway').map(call => [call.body.method, call.body.route]),
    [['GET', `/orders/${workflowId}`]]);
  storedId = randomUUID();
  await assert.rejects(executeAzureScenario(input), /AZURE_EXAMPLE_DURABLE_ORDER_IDENTITY_MISMATCH/);
  status = 200;
  await assert.rejects(executeAzureScenario(input), /AZURE_EXAMPLE_ORDER_NOT_STAGED/);
});

test('all fifteen Azure recipes execute their concrete control flow with a deterministic checker-only transport', async () => {
  for (let number = 1; number <= 15; number++) {
    const id = String(number).padStart(2, '0'), runId = randomUUID();
    const calls = [], workflows = [], attempts = [], rejections = [];
    const browserInvocationId = randomUUID();
    let fault = 'NONE';
    const client = {
      config: config(),
      async post(route, body) {
        const action = route.split('/').at(-1); calls.push({ action, body });
        if (action === 'allocate') return { workflowId: randomUUID() };
        if (action === 'attach') return { attached: true };
        if (action === 'fault') { fault = body.mode; return { configured: fault }; }
        if (action === 'gateway') {
          if (body.route.endsWith('/controls')) {
            attempts.push({ branch: body.body.target, outcome: 'SUCCESS' });
            return { status: 202, body: {}, durationMs: 1 };
          }
          if (body.method === 'POST' && ['INVENTORY_TIMEOUT', 'POSTGRES_ERROR'].includes(fault)) {
            return { status: 503, body: { code: 'DATA_UNAVAILABLE' }, durationMs: 1 };
          }
          const workflowId = body.body?.orderId ?? body.body?.runId ?? body.route.split('/').at(-1);
          const invocationId = UUID.test(body.headers?.['x-business-invocation-id'] ?? '')
            ? body.headers['x-business-invocation-id'] : randomUUID();
          if (body.method === 'POST' && workflowId) {
            workflows.push({ workflow_id: workflowId, invocation_id: invocationId });
            if (body.body.scenario === 'DLQ') {
              attempts.push({ branch: 'FULFILLMENT', outcome: 'DEAD_LETTERED' }, { branch: 'NOTIFY', outcome: 'DEAD_LETTERED' });
            }
          }
          return { status: 200, invocationId, durationMs: 1, body: { id: workflowId, state: 'COMPLETED',
            businessInvocationId: browserInvocationId } };
        }
        if (action === 'redeliver') {
          assert.ok(['EVENT_GRID', 'STORAGE_QUEUE'].includes(body.destination));
          attempts.push({ branch: body.destination, outcome: 'DUPLICATE' }); return { sent: true };
        }
        if (action === 'inject') {
          const messageId = randomUUID();
          rejections.push({ messageId, reason: body.kind === 'OVERSIZE' ? 'ENVELOPE_TOO_LARGE' : 'UNTRUSTED_PUBLICATION' });
          return { messageId };
        }
        if (action === 'rejections') return rejections;
        if (action === 'observations') return { workflows, attempts, events: [], publications: [], contributors: [], drained: true };
        if (['sampling-on', 'sampling-off'].includes(action)) return { nativeFidelityVerified: false };
        throw new Error('Unimplemented fixture operation: ' + action);
      },
      async userRequest(url, route, request) {
        return { status: request.invalidToken ? 401 : 200, invocationId: randomUUID(), pseudonymObserved: !request.invalidToken };
      }
    };
    const browser = { ready: { apiOrigin: 'https://contoso-gateway.example.test' },
      async drive(workflowId) { return { backendId: workflowId, businessInvocationId: browserInvocationId, outcome: 'staged',
        executionMode: 'live', backendState: 'QUEUED', observations: [{ method: 'POST', path: '/contoso/v1/orders', status: 202 }] }; } };
    const result = await executeAzureScenario({ id, client, run: { runId }, browser,
      metadata: { gatewayUrl: 'https://contoso-gateway.example.test/contoso/v1' } });
    assert.equal(result.id, id);
    assert.ok(result.observations);
    if (id === '05' || id === '12') {
      assert.equal(fault, 'NONE');
      assert.ok(calls.some(call => call.action === 'fault' && call.body.mode !== 'NONE'));
    }
    if (id === '07') assert.deepEqual(calls.filter(call => call.body?.route?.endsWith('/controls')).map(call => call.body.body.target),
      ['FULFILLMENT', 'NOTIFY']);
    if (id === '15') {
      assert.deepEqual(calls.filter(call => call.action.startsWith('sampling-')).map(call => call.action), ['sampling-off']);
      assert.equal(result.load.receipts.length, 1);
    }
  }
});

test('examples cannot select the original Certify mode and configuration checking cannot invoke Azure', async () => {
  const scratch = path.join(projectRoot, '.cache', `azure-example-cli-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  const file = path.join(scratch, 'client.json');
  await writeFile(file, JSON.stringify(config()));
  try {
    await assert.rejects(azureExamplesMain(['--config', file, '--execute', '--mode', 'Certify']), /CANNOT_CERTIFY/);
    await assert.rejects(azureExamplesMain(['--config', file, '--demo', '01']), /EXPLICIT_EXECUTION_APPROVAL_REQUIRED/);
    await azureExamplesMain(['--config', file, '--check']);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
