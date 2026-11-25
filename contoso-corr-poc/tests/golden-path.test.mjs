import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { localDemoCheckpoint, parseLocalPairArguments, selectLocalClasspath, startLocalPair, validateIngress } from '../tools/java/local-pair.mjs';
import { runOrderClient } from '../demos/01/order-client.mjs';

test('local launcher keeps the fresh explicit classpath, never an implicit current directory', () => {
  const first = path.resolve('services', 'orders-api', 'target', 'test-classes');
  const second = path.resolve('services', 'orders-api', 'target', 'classes');
  const inventory = path.resolve('services', 'inventory-api', 'target', 'classes');
  const original = [first, second].join(path.delimiter);
  assert.equal(selectLocalClasspath(original + path.delimiter, inventory),
    [first, second, inventory].join(path.delimiter));
  for (const value of ['', `.${path.delimiter}${second}`, `${first}${path.delimiter}${path.delimiter}${second}`,
    `${original}${path.delimiter}${path.delimiter}`]) {
    assert.throws(() => selectLocalClasspath(value, inventory), /LOCAL_PAIR_.*CLASSPATH_REQUIRED/);
  }
});

test('ingress persistence rejects leaked fields, mismatched trace identity and invalid carriers', () => {
  const trace = 'a'.repeat(32);
  const record = { schema: 'contoso.local-pair-ingress.v1', profile: 'LOCAL REHEARSAL', method: 'POST',
    path: '/api/orders', traceparent: `00-${trace}-${'b'.repeat(16)}-01`, sdkTraceId: trace,
    sdkSpanId: 'c'.repeat(16), observedAtUtc: new Date().toISOString(), businessInvocationId: randomUUID() };
  assert.equal(validateIngress(record), record);
  assert.equal(Object.hasOwn(record, 'tracestate'), false);
  for (const observedAtUtc of ['2026-11-17T04:09:36Z', '2026-11-17T04:09:36.150121Z']) {
    assert.equal(validateIngress({ ...record, observedAtUtc }).observedAtUtc, observedAtUtc);
  }
  for (const change of [{ authorization: 'must-not-persist' }, { sdkTraceId: 'd'.repeat(32) },
    { traceparent: record.traceparent.replace(/01$/, '00') }, { tracestate: 'unapproved=value' },
    { observedAtUtc: 'invalid' }, { observedAtUtc: '2026-02-30T00:00:00Z' },
    { observedAtUtc: '2026-11-17T04:09:36+00:00' }, { sdkSpanId: '0'.repeat(16) }]) {
    assert.throws(() => validateIngress({ ...record, ...change }), /LOCAL_PAIR_INGRESS_REJECTED/);
  }
});

test('local startup rejects unbounded windows before creating files or starting processes', async () => {
  for (const durationSeconds of [0, 179, 1801, Infinity, NaN]) {
    await assert.rejects(() => startLocalPair({ durationSeconds, outputDirectory: 'must-not-be-created' }),
      /LOCAL_PAIR_DURATION/);
  }
});

test('presenter arguments require the browser and reject duplicate or unknown flags', () => {
  const base = ['--out', 'new-run', '--duration', '900'];
  assert.equal(parseLocalPairArguments(base).present, false);
  const options = parseLocalPairArguments([...base, '--run-browser', '--present', '--debug-java']);
  assert.equal(options.present, true);
  assert.equal(options.runBrowser, true);
  assert.equal(options.debugJava, true);
  for (const flags of [['--present'], ['--run-browser', '--present', '--present'], ['--run-browser', '--azure']]) {
    assert.throws(() => parseLocalPairArguments([...base, ...flags]), /LOCAL_PAIR_(?:ARGUMENTS|PRESENT_REQUIRES_BROWSER)/);
  }
});

test('presenter checkpoints wait for Enter and fail on closed input, stopped pairs or expired cleanup budgets', async () => {
  const expiresAtUtc = new Date(Date.now() + 180000).toISOString();
  const input = new PassThrough(), output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  const checkpoint = localDemoCheckpoint({ phase: 'BEFORE_REQUEST', expiresAtUtc, input, output });
  assert.match(text, /LOCAL_DEMO_CHECKPOINT BEFORE_REQUEST/);
  input.write('\n');
  await checkpoint;
  input.destroy(); output.destroy();

  for (const stopped of [false, true]) {
    const input = new PassThrough(), output = new PassThrough();
    try {
      const pending = localDemoCheckpoint({ phase: 'AFTER_REQUEST', expiresAtUtc, input, output,
        ...(stopped ? { finished: Promise.resolve() } : {}) });
      if (!stopped) input.end();
      await assert.rejects(pending, stopped ? /LOCAL_DEMO_PAIR_STOPPED/ : /LOCAL_DEMO_INPUT_CLOSED/);
    } finally { input.destroy(); output.destroy(); }
  }
  await assert.rejects(localDemoCheckpoint({ phase: 'BEFORE_REQUEST',
    expiresAtUtc: new Date(Date.now() + 30000).toISOString() }), /LOCAL_DEMO_CHECKPOINT_EXPIRED/);
});

function clientFixture() {
  const orderId = randomUUID(), action = randomUUID(), workflow = randomUUID(), readAction = randomUUID();
  const input = { gatewayOrigin: 'https://gateway.example.invalid', accessToken: ['unit', 'only', 'notjwt'].join('.'),
    approvalReference: 'UNIT_ONLY_NOT_AUTHORITY', allowTraffic: true, orderId };
  const calls = [];
  const bodies = [
    { schemaVersion: 1, id: orderId, businessInvocationId: action, workflowBusinessInvocationId: workflow, state: 'QUEUED' },
    { schemaVersion: 1, id: orderId, businessInvocationId: workflow, state: 'QUEUED' }
  ];
  const responses = () => bodies.map((body, index) => new Response(JSON.stringify(body), {
    status: index === 0 ? 202 : 200,
    headers: { 'content-type': 'application/json', 'x-business-invocation-id': index === 0 ? action : readAction }
  }));
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return responses()[calls.length - 1];
  };
  return { input, action, workflow, calls, bodies, responses, fetcher };
}

test('API sample posts an ordinary order and reads durable workflow identity, not the new GET action header', async () => {
  const fixture = clientFixture();
  const result = await runOrderClient(fixture.input, fixture.fetcher);
  assert.equal(result.businessInvocationId, fixture.action);
  assert.equal(result.workflowBusinessInvocationId, fixture.workflow);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].url, `${fixture.input.gatewayOrigin}/contoso/v1/orders`);
  assert.equal(fixture.calls[1].url, `${fixture.input.gatewayOrigin}/contoso/v1/orders/${fixture.input.orderId}`);
  assert.equal(fixture.calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(fixture.calls[0].options.body), {
    schemaVersion: 1, orderId: fixture.input.orderId, sku: 'CONTOSO-001', quantity: 1
  });
  assert.equal(Object.hasOwn(fixture.calls[0].options.headers, 'traceparent'), false);
  assert.equal(Object.hasOwn(fixture.calls[0].options.headers, 'x-business-invocation-id'), false);
});

test('API sample rejects unapproved targets and traffic before acquiring or sending a credential', async () => {
  for (const change of [{ allowTraffic: false }, { gatewayOrigin: 'http://127.0.0.1:1234' },
    { gatewayOrigin: 'https://gateway.example.invalid/path' }, { gatewayOrigin: 'https://user@gateway.example.invalid' },
    { quantity: 0 }, { orderId: 'not-an-order' }]) {
    const fixture = clientFixture();
    await assert.rejects(() => runOrderClient({ ...fixture.input, ...change }, fixture.fetcher), /GOLDEN_PATH_/);
    assert.equal(fixture.calls.length, 0);
  }
});

test('API sample refuses inconsistent mutations or stored identities, never invents an original business ID', async () => {
  for (const change of [
    fixture => { delete fixture.bodies[0].workflowBusinessInvocationId; },
    fixture => { fixture.bodies[0].businessInvocationId = randomUUID(); },
    fixture => { fixture.bodies[1].businessInvocationId = randomUUID(); },
    fixture => { fixture.bodies[1].id = randomUUID(); }
  ]) {
    const fixture = clientFixture();
    change(fixture);
    await assert.rejects(() => runOrderClient(fixture.input, fixture.fetcher), /GOLDEN_PATH_.*IDENTITY_MISMATCH/);
  }
});

test('API sample bounds response bytes and never includes unsafe error payloads in diagnostics', async () => {
  const fixture = clientFixture();
  await assert.rejects(() => runOrderClient(fixture.input, async () => new Response('private response must not be logged', {
    status: 401
  })), error => error.message === 'GOLDEN_PATH_HTTP_STATUS_401');
  await assert.rejects(() => runOrderClient(fixture.input, async () => new Response('x'.repeat(16385), {
    status: 202, headers: { 'content-type': 'application/json', 'x-business-invocation-id': fixture.action }
  })), error => error.message === 'GOLDEN_PATH_RESPONSE_BOUND');
});
