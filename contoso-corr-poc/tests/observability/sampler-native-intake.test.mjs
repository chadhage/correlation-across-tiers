import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { connect, createServer as createPortReservation } from 'node:net';
import { Agent, request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { NATIVE_LIMITS, NATIVE_POLICY_SOURCE_SHA256 } from '../../tools/security/native-payload.mjs';
import {
  createSamplerEvidenceDirectory, createSamplerNativeIntake, isNativeSamplerPost,
  NATIVE_BODY_TIMEOUT_MS, openSamplerNativeReceiver, projectSamplerFailureObservation, projectSamplerNativeSpans,
  readNativeSamplerBody, samplerFailureDiagnostic, selectSamplerNativeSpans, writeSamplerEvidence
} from '../../tools/observability/sampler-native-intake.mjs';

const publisher = randomUUID();
const marker = `sampler-fixture-marker-${randomUUID()}`;
const options = () => ({ publisherKeys: [publisher], forbiddenValues: [marker] });
const envelope = (baseType = 'RequestData') => ({
  name: 'Microsoft.ApplicationInsights.Request', time: '2026-11-01T23:00:00.000Z',
  iKey: publisher, tags: {
    'ai.operation.id': '1'.repeat(32), 'ai.operation.parentId': '2'.repeat(16),
    'ai.cloud.role': 'contoso-parent-safe-probe', 'ai.cloud.roleInstance': 'fixture-instance'
  },
  data: { baseType, baseData: {
    id: '3'.repeat(16), name: 'GET /probe', duration: '00:00:00.0250000', success: true,
    properties: { fixture: 'synthetic-parser-input-not-live-evidence' }
  } }
});
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
function request(body, { encoding, path = '/v2.1/track', method = 'POST', headers = {} } = {}) {
  return {
    method, url: path, headers: { ...headers, ...(encoding ? { 'content-encoding': encoding } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.isBuffer(body) ? body : bytes(body); },
    destroy() {}
  };
}
const intake = () => createSamplerNativeIntake(options());

test('safe incremental capture callbacks are immutable, per-payload and awaited before acceptance', async () => {
  const captures = [];
  let release, observed;
  const gate = new Promise(done => { release = done; });
  const entered = new Promise(done => { observed = done; });
  const collector = createSamplerNativeIntake({ ...options(), onCapture: async capture => {
    captures.push(capture);
    observed();
    await gate;
  } });
  const receiving = collector.receive(request(envelope()));
  await entered;
  assert.equal(collector.diagnostics().counts.acceptedPayloads, 0);
  assert.throws(() => collector.finish(), /NATIVE_RECEIVER_INCOMPLETE/);
  assert.equal(captures[0].nativeEnvelopes[0].iKey, undefined);
  assert.equal(captures[0].payloadReceipts[0].scannedAllOriginalValues, true);
  assert.throws(() => { captures[0].nativeEnvelopes[0].tags['ai.operation.id'] = 'f'.repeat(32); }, TypeError);
  release();
  await receiving;
  await collector.receive(request(envelope('RemoteDependencyData')));
  assert.equal(captures.length, 2);
  assert(captures.every(capture => capture.nativeEnvelopes.length === 1 && capture.payloadReceipts.length === 1));
  assert.equal(collector.finish().observations.length, 2);
});

test('unsafe originals never reach an incremental callback and callback failures poison all acceptance', async () => {
  let callbacks = 0;
  const unsafeCollector = createSamplerNativeIntake({ ...options(), onCapture() { callbacks++; } });
  const unsafe = envelope();
  unsafe.extra = marker;
  await assert.rejects(unsafeCollector.receive(request(unsafe)), /NATIVE_PRIVACY_UNSAFE/);
  assert.equal(callbacks, 0);
  assert.throws(() => unsafeCollector.finish(), /NATIVE_PRIVACY_UNSAFE/);
  const failedCollector = createSamplerNativeIntake({ ...options(), onCapture() { throw new Error(marker); } });
  await assert.rejects(failedCollector.receive(request(envelope())), /NATIVE_CAPTURE_CALLBACK_FAILED/);
  assert.equal(failedCollector.diagnostics().firstPoison.event, 'capture');
  assert.equal(failedCollector.diagnostics().counts.acceptedPayloads, 0);
  assert(!JSON.stringify(failedCollector.diagnostics()).includes(marker));
  assert.throws(() => failedCollector.finish(), /NATIVE_CAPTURE_CALLBACK_FAILED/);
  assert.throws(() => createSamplerNativeIntake({ ...options(), onCapture: 'not-a-function' }), /NATIVE_CAPTURE_CALLBACK_INVALID/);
});

test('a stalled incremental capture callback has a fixed deadline and cannot qualify a partial capture', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let observed;
  const entered = new Promise(done => { observed = done; });
  const collector = createSamplerNativeIntake({ ...options(), onCapture() {
    observed();
    return new Promise(() => {});
  } });
  const receiving = assert.rejects(collector.receive(request(envelope())), /NATIVE_CAPTURE_CALLBACK_TIMEOUT/);
  await entered;
  context.mock.timers.tick(NATIVE_BODY_TIMEOUT_MS);
  await receiving;
  assert.equal(collector.diagnostics().firstPoison.event, 'capture');
  assert.throws(() => collector.finish(), /NATIVE_CAPTURE_CALLBACK_TIMEOUT/);
});

test('the receiver honors an explicit unique loopback port and invokes the safe callback before HTTP success', async () => {
  const reservation = createPortReservation();
  await new Promise((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const port = reservation.address().port;
  await new Promise((done, reject) => reservation.close(error => error ? reject(error) : done()));
  const captures = [];
  const receiver = await openSamplerNativeReceiver({ ...options(), port, onCapture: async capture => { captures.push(capture); } });
  try {
    assert.equal(receiver.endpoint, `http://127.0.0.1:${port}`);
    const response = await fetch(`${receiver.endpoint}/v2.1/track`, {
      method: 'POST', body: JSON.stringify(envelope()), signal: AbortSignal.timeout(3000)
    });
    assert.equal(response.status, 200);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].nativeEnvelopes[0].iKey, undefined);
    assert.equal((await response.json()).itemsAccepted, 1);
    assert.equal((await receiver.finish()).observations.length, 1);
  } finally { await receiver.stop(); }
});

test('invalid configured ports are rejected before creating a loopback listener', async () => {
  for (const port of [-1, 65536, 1.5, '19343', NaN]) {
    await assert.rejects(openSamplerNativeReceiver({ ...options(), port }), /NATIVE_RECEIVER_PORT/);
  }
});

test('sampler intake scans every original before projection and retains exact native identities and raw hash receipt', async () => {
  const original = bytes([envelope(), envelope('RemoteDependencyData'), envelope('MetricData')]);
  const compressed = gzipSync(original);
  const collector = intake();
  assert.deepEqual(await collector.receive(request(compressed, { encoding: 'gzip' })),
    { itemsReceived: 3, itemsAccepted: 3, errors: [] });
  const result = collector.finish();
  assert.equal(result.observations.length, 3);
  assert.equal(result.originalPrivacyCapture.validatorPid, process.pid);
  assert.equal(result.originalPrivacyCapture.nodeVersion, process.version);
  assert.equal(result.originalPrivacyCapture.validatorSourceSha256, NATIVE_POLICY_SOURCE_SHA256);
  assert.equal(result.originalPrivacyCapture.actualCounts.originalRawBytes, compressed.length);
  assert.equal(result.originalPrivacyCapture.actualCounts.decodedBytes, original.length);
  assert.equal(result.originalPrivacyCapture.actualCounts.envelopes, 3);
  assert.equal(result.originalPrivacyCapture.payloadReceipts[0].originalPayloadSha256,
    createHash('sha256').update(compressed).digest('hex'));
  assert.equal(result.originalPrivacyCapture.payloadReceipts[0].originalPayloadBytes, compressed.length);
  assert.equal(result.originalPrivacyCapture.payloadReceipts[0].decodedPayloadBytes, original.length);
  assert.equal(result.originalPrivacyCapture.payloadReceipts[0].scannedAllOriginalValues, true);
  assert.equal(result.originalPrivacyCapture.payloadReceipts[0].strictDuplicateKeysVerified, true);
  assert.equal(result.originalPrivacyCapture.payloadReceipts[0].originalPayloadRetained, false);
  assert.equal(result.originalPrivacyCapture.allTablePrivacyGateVerified, false);
  assert.equal(result.originalPrivacyCapture.independentProducerAuthorityVerified, false);
  const projected = projectSamplerNativeSpans(result.observations.map(value => value.envelope));
  assert.equal(projected.length, 2);
  assert.equal(projected[0].data.baseData.id, envelope().data.baseData.id);
  assert.equal(projected[0].tags['ai.operation.parentId'], envelope().tags['ai.operation.parentId']);
  assert.equal(projected[0].tags['ai.cloud.role'], envelope().tags['ai.cloud.role']);
  assert.equal(result.observations[0].envelope.iKey, undefined);
  assert.equal(result.observations[0].envelope.tags['ai.cloud.roleInstance'], undefined);
  assert.match(result.encodedBytesScope, /not original wire bytes or Azure billable size/);
  assert.throws(() => { result.observations[0].envelope.tags['ai.cloud.role'] = 'other'; }, TypeError);
  await assert.rejects(collector.receive(request(envelope())), /NATIVE_RECEIVER_SEALED/);
});

test('zero observed native payloads are explicit absence, never an invented successful privacy scan', () => {
  const result = intake().finish();
  assert.deepEqual(result.observations, []);
  assert.deepEqual(result.originalPrivacyCapture.payloadReceipts, []);
  assert.equal(result.originalPrivacyCapture.observedNativePayloads, 0);
  assert.equal(result.originalPrivacyCapture.verified, false);
  assert.equal(result.originalPrivacyCapture.validatorPid, null);
  assert.equal(result.originalPrivacyCapture.allTablePrivacyGateVerified, false);
});

test('a later unsafe non-span original poisons the whole current JVM and prevents any partial file persistence', async () => {
  const collector = intake();
  await collector.receive(request(envelope()));
  const unsafe = envelope('MetricData');
  unsafe.extra = marker;
  await assert.rejects(collector.receive(request(unsafe)), error => {
    assert.equal(error.message, 'NATIVE_PRIVACY_UNSAFE');
    assert(!error.message.includes(marker));
    return true;
  });
  const diagnosis = collector.diagnostics();
  assert.equal(diagnosis.firstPoison.event, 'parse');
  assert.equal(diagnosis.firstPoison.underlyingCode, 'NATIVE_PRIVACY_UNSAFE');
  assert.equal(diagnosis.counts.acceptedPayloads, 1);
  assert.equal(diagnosis.counts.nativePosts, 2);
  assert.equal(diagnosis.lastRequest.methodClass, 'POST');
  assert.equal(diagnosis.lastRequest.routeClass, 'native-v2.1-track');
  await assert.rejects(collector.receive(request(envelope())), /NATIVE_PRIVACY_UNSAFE/);
  const folder = join(process.cwd(), '.cache', 'r7', 'sampler-intake-tests', randomUUID());
  await createSamplerEvidenceDirectory(folder);
  try {
    await assert.rejects(async () => {
      const captured = collector.finish();
      await writeSamplerEvidence(folder, 'unexpected.json', captured);
    }, /NATIVE_PRIVACY_UNSAFE/);
    assert.deepEqual(await readdir(folder), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('strict decoded duplicate JSON and NDJSON keys fail before overwritten marker fields can disappear', async () => {
  const duplicate = JSON.stringify(envelope()).slice(0, -1) +
    `,"extra":${JSON.stringify(marker)},"\\u0065xtra":"safe"}`;
  for (const raw of [duplicate, `${JSON.stringify(envelope())}\n${duplicate}\n`]) {
    const collector = intake();
    await assert.rejects(collector.receive(request(raw)), /NATIVE_JSON_DUPLICATE_KEY/);
    assert.throws(() => collector.finish(), /NATIVE_JSON_DUPLICATE_KEY/);
  }
});

test('scalar, UTF8 key and envelope limits are applied to originals before shared patterns or span filtering', async () => {
  const scalar = envelope('MetricData');
  scalar.extra = 'x'.repeat(65536);
  const started = performance.now();
  const scalarCollector = intake();
  await assert.rejects(scalarCollector.receive(request(scalar)), /NATIVE_SCALAR_BOUND/);
  assert(performance.now() - started < 2000, 'Bounded 64KiB scalar control exceeded its finite CPU envelope');
  const tooWide = envelope('MetricData');
  tooWide['é'.repeat(65)] = 'safe';
  await assert.rejects(intake().receive(request(tooWide)), /NATIVE_FIELD_KEY_BOUND/);
  const boundary = envelope();
  boundary['é'.repeat(64)] = 'x'.repeat(NATIVE_LIMITS.scalarBytes);
  const accepted = intake();
  await accepted.receive(request(boundary));
  assert.equal(accepted.finish().observations.length, 1);
  await assert.rejects(intake().receive(request(Array.from({ length: 513 }, () => envelope()))),
    /NATIVE_(ENVELOPE_SCHEMA|PAYLOAD_BOUND)/);
});

test('raw body limit is checked while reading and does not drain an oversized stream', async () => {
  let chunks = 0, destroyed = false;
  const stream = {
    headers: {},
    async *[Symbol.asyncIterator]() {
      chunks++; yield Buffer.alloc(NATIVE_LIMITS.payloadBytes);
      chunks++; yield Buffer.alloc(1);
      chunks++; yield Buffer.alloc(1);
    },
    destroy() { destroyed = true; }
  };
  await assert.rejects(readNativeSamplerBody(stream), /NATIVE_WIRE_BOUND/);
  assert.equal(chunks, 2);
  assert.equal(destroyed, true);
  const exact = Buffer.concat([bytes(envelope()), Buffer.alloc(NATIVE_LIMITS.payloadBytes - bytes(envelope()).length, 32)]);
  const accepted = intake();
  await accepted.receive(request(exact));
  assert.equal(accepted.finish().originalPrivacyCapture.payloadReceipts[0].originalPayloadBytes, NATIVE_LIMITS.payloadBytes);
});

test('oversized declared or truncated body rejects without fabricated native receipts', async () => {
  let read = false, destroyed = false;
  const stream = {
    headers: { 'content-length': String(NATIVE_LIMITS.payloadBytes + 1) },
    async *[Symbol.asyncIterator]() { read = true; yield Buffer.from('not read'); },
    destroy() { destroyed = true; }
  };
  await assert.rejects(readNativeSamplerBody(stream), /NATIVE_WIRE_BOUND/);
  assert.equal(read, false);
  assert.equal(destroyed, true);
  const collector = intake();
  await assert.rejects(collector.receive(request(envelope(), {
    headers: { 'content-length': String(bytes(envelope()).length + 1) }
  })), /NATIVE_WIRE_INCOMPLETE/);
  assert.throws(() => collector.finish(), /NATIVE_WIRE_INCOMPLETE/);
});

test('fixed absolute body deadline stops a stalled native stream and poisons partial acceptance', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let destroyed = false;
  const collector = intake();
  const stalled = {
    method: 'POST', url: '/v2/track', headers: {},
    [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; },
    destroy() { destroyed = true; }
  };
  const receiving = assert.rejects(collector.receive(stalled), /NATIVE_WIRE_TIMEOUT/);
  context.mock.timers.tick(NATIVE_BODY_TIMEOUT_MS);
  await receiving;
  assert.equal(destroyed, true);
  assert.equal(collector.diagnostics().firstPoison.event, 'receive');
  assert.equal(collector.diagnostics().firstPoison.underlyingCode, 'NATIVE_WIRE_TIMEOUT');
  assert.throws(() => collector.finish(), /NATIVE_WIRE_TIMEOUT/);
});

test('gzip bombs, invalid compression and unsupported encoding cannot release any native projection', async () => {
  for (const [body, encoding] of [
    [gzipSync(Buffer.alloc(NATIVE_LIMITS.decodedPayloadBytes + 1, 32)), 'gzip'],
    [Buffer.from('not gzip'), 'gzip'],
    [bytes(envelope()), 'deflate']
  ]) {
    const collector = intake();
    await assert.rejects(collector.receive(request(body, { encoding })), /^Error: NATIVE_[A-Z_]+$/);
    assert.throws(() => collector.finish(), /^Error: NATIVE_[A-Z_]+$/);
  }
});

test('one current JVM has a fixed128 POST budget and never rotates sessions after the129th request', async () => {
  assert.equal(NATIVE_LIMITS.sessionPayloads, 128);
  const accepted = intake();
  for (let index = 0; index < 128; index++) await accepted.receive(request(envelope()));
  assert.equal(accepted.finish().originalPrivacyCapture.actualCounts.payloads, 128);
  const rejected = intake();
  for (let index = 0; index < 128; index++) await rejected.receive(request(envelope()));
  await assert.rejects(rejected.receive(request(envelope())), /NATIVE_TOTAL_BOUND/);
  assert.throws(() => rejected.finish(), /NATIVE_TOTAL_BOUND/);
  await assert.rejects(rejected.receive(request(envelope())), /NATIVE_TOTAL_BOUND/);
});

test('known publisher placement and exact forbidden marker conflicts cannot be waived by the consumer', async () => {
  for (const marker of [publisher, publisher.slice(0, 8), publisher.slice(-8)])
    assert.throws(() => createSamplerNativeIntake({ publisherKeys: [publisher], forbiddenValues: [marker] }),
      /NATIVE_MARKER_PUBLISHER_CONFLICT/);
  const foreign = { ...envelope(), iKey: randomUUID() };
  await assert.rejects(intake().receive(request(foreign)), /NATIVE_PUBLISHER_UNEXPECTED/);
  const nested = envelope();
  nested.data.baseData.iKey = publisher;
  await assert.rejects(intake().receive(request(nested)), /NATIVE_PUBLISHER_UNEXPECTED/);
  const spilled = envelope();
  spilled.extra = publisher;
  await assert.rejects(intake().receive(request(spilled)), /NATIVE_PRIVACY_UNSAFE/);
});

test('pending original scan cannot be finalized or mislabeled as a complete receiver', async () => {
  let release;
  const ready = new Promise(done => { release = done; });
  const collector = intake();
  const current = collector.receive({
    method: 'POST', url: '/v2.1/track', headers: {},
    async *[Symbol.asyncIterator]() { await ready; yield bytes(envelope()); },
    destroy() {}
  });
  assert.throws(() => collector.finish(), /NATIVE_RECEIVER_INCOMPLETE/);
  assert.equal(collector.diagnostics().poisoned, false);
  assert.equal(collector.diagnostics().firstPoison, null);
  assert.equal(collector.diagnostics().lastBarrierFailure.event, 'pending');
  release();
  await current;
  assert.equal(collector.finish().observations.length, 1);
});

test('only exact native POST routes receive ingestion acknowledgement; echo and foreign routes never count as telemetry', async () => {
  for (const [method, url, expected] of [
    ['POST', '/v2/track', true], ['POST', '/v2.1/track', true],
    ['GET', '/v2/track', false], ['POST', '/v2.1/track?ignored=1', false],
    ['POST', '/echo', false], ['POST', 'http://127.0.0.1/v2/track', false]
  ]) assert.equal(isNativeSamplerPost({ method, url }), expected);
  let echoes = 0;
  const receiver = await openSamplerNativeReceiver({ ...options(), onEcho() { echoes++; } });
  try {
    for (const [method, path] of [['GET', '/v2/track'], ['POST', '/echo'], ['POST', '/v2.1/track?ignored=1']]) {
      const response = await fetch(receiver.endpoint + path, { method });
      assert.equal(response.status, 404);
      await response.arrayBuffer();
    }
    const echo = await fetch(receiver.endpoint + '/echo', { headers: { traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-00' } });
    assert.equal(echo.status, 200);
    assert.equal(echoes, 1);
    await echo.arrayBuffer();
    const native = await fetch(receiver.endpoint + '/v2.1/track', {
      method: 'POST', body: bytes([envelope(), envelope('MetricData')])
    });
    assert.equal(native.status, 200);
    assert.equal((await native.json()).itemsAccepted, 2);
    const captured = await receiver.finish();
    assert.equal(captured.originalPrivacyCapture.actualCounts.payloads, 1);
    assert.equal(captured.observations.length, 2);
  } finally { await receiver.stop(); }
});

test('real loopback receiver fails closed across good then unsafe non-span and never resumes from the partial prefix', async () => {
  const receiver = await openSamplerNativeReceiver({ ...options(), onEcho() {} });
  try {
    const post = raw => fetch(receiver.endpoint + '/v2/track', { method: 'POST', body: bytes(raw) });
    const first = await post(envelope());
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    const unsafe = { ...envelope('MetricData'), extra: marker };
    const rejected = await post(unsafe);
    assert.equal(rejected.status, 400);
    await rejected.arrayBuffer();
    const later = await post(envelope());
    assert.equal(later.status, 400);
    await later.arrayBuffer();
    await assert.rejects(receiver.finish(), /^Error: NATIVE_[A-Z_]+$/);
  } finally { await receiver.stop(); }
});

test('fresh evidence directories and exclusive JSON writes never overwrite an old epoch or selected native report', async () => {
  const parent = join(process.cwd(), '.cache', 'r7', 'sampler-intake-tests', randomUUID());
  await mkdir(parent, { recursive: true });
  const directory = join(parent, 'fresh');
  try {
    await createSamplerEvidenceDirectory(directory);
    await writeSamplerEvidence(directory, 'result.json', { fixture: 'first-unmodified-epoch' });
    const original = await readFile(join(directory, 'result.json'));
    await assert.rejects(createSamplerEvidenceDirectory(directory), /SAMPLER_EVIDENCE_DIRECTORY_EXISTS/);
    await assert.rejects(writeSamplerEvidence(directory, 'result.json', { fixture: 'must-not-replace' }), { code: 'EEXIST' });
    assert.deepEqual(await readFile(join(directory, 'result.json')), original);
    await assert.rejects(writeSamplerEvidence(directory, '..\\escape.json', {}), /SAMPLER_EVIDENCE_FILE_INVALID/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('failed runtime observation diagnostics persist only bounded safe scalar fields, not malformed nested values', () => {
  const observation = {
    nativeStateAvailable: true, effectiveSamplingPercentage: 100, requestsPerSecond: null,
    loadedCount: 1, guardSha256: 'a'.repeat(64), runtimeInstanceId: '12345'
  };
  assert.equal(projectSamplerFailureObservation(observation).guardSha256, observation.guardSha256);
  for (const unsafe of [{ nested: marker }, Infinity, 'x'.repeat(65536), 'Bearer synthetic-fixture-not-a-credential',
    'https://private.invalid/path?token=synthetic', 'C:\\private\\diagnostic'])
    assert.equal(projectSamplerFailureObservation({ ...observation, providerClass: unsafe }), null);
});

test('echo callback records actual input and receiver returns the exact carrier required by the production Java fixture', async () => {
  const source = await readFile(new URL('../../extensions/parent-safe-sampler/src/test/java/com/contoso/correlation/sampling/ParentSafeProbeApplication.java', import.meta.url), 'utf8');
  assert(source.includes('.header("x-contoso-probe-case", caseId)'));
  assert(source.includes('outbound.GET().build()'));
  assert(source.includes('.firstValue("x-contoso-observed-traceparent").orElseThrow()'));
  const pattern = /wire\.matches\("([^"\r\n]+)"\)/.exec(source)?.[1];
  assert(pattern, 'Actual Java fixture wire acceptance contract is required');
  const javaAccepts = value => new RegExp(`^(?:${pattern})$`).test(value ?? '');
  const echoes = new Map();
  const receiver = await openSamplerNativeReceiver({
    ...options(),
    onEcho(request) {
      echoes.set(request.headers['x-contoso-probe-case'], request.headers.traceparent ?? null);
    }
  });
  try {
    for (const flags of ['01', '00']) {
      const field = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-${flags}`;
      const id = `eligible-on-${flags === '01' ? 'sampled' : 'unsampled'}`;
      const response = await fetch(receiver.endpoint + '/echo', {
        headers: { traceparent: field, 'x-contoso-probe-case': id }
      });
      await response.arrayBuffer();
      assert.equal(response.status, 200);
      assert.equal(echoes.get(id), field);
      assert.equal(response.headers.get('x-contoso-observed-traceparent'), field);
      assert.equal(javaAccepts(response.headers.get('x-contoso-observed-traceparent')), true);
    }
    const absent = await fetch(receiver.endpoint + '/echo', {
      headers: { 'x-contoso-probe-case': 'eligible-on-sampled' }
    });
    await absent.arrayBuffer();
    assert.equal(echoes.get('eligible-on-sampled'), null);
    assert.equal(javaAccepts(absent.headers.get('x-contoso-observed-traceparent')), false);
    await receiver.finish();
  } finally { await receiver.stop(); }
});

test('safe failures retain only a fixed stage and static reason, never raw message, expected values, stack or cause', () => {
  const unsafe = new Error(`https://private.invalid/?credential=${marker}`);
  unsafe.actual = marker;
  unsafe.expected = marker;
  unsafe.cause = new Error(marker);
  const unknown = samplerFailureDiagnostic(unsafe, marker);
  assert.equal(unknown.failureStage, 'unclassified');
  assert.equal(unknown.failureCode, 'SAMPLER_FAILURE');
  assert.equal(unknown.rawDiagnosticsPersisted, false);
  assert(!JSON.stringify(unknown).includes(marker));
  assert(!JSON.stringify(unknown).includes('private.invalid'));
  assert.equal(samplerFailureDiagnostic(new Error('NATIVE_PRIVACY_UNSAFE'), 'native-intake').failureCode,
    'NATIVE_PRIVACY_UNSAFE');
  assert.equal(samplerFailureDiagnostic(new Error('NATIVE_WIRE_TIMEOUT'), 'native-intake').failureCode,
    'NATIVE_WIRE_TIMEOUT');
  assert.equal(samplerFailureDiagnostic(Object.assign(new Error(marker), { code: 'ENOENT' }), 'readiness').failureCode,
    'ENOENT');
  let reads = 0;
  const getter = {};
  for (const key of ['message', 'code', 'cause', 'stack'])
    Object.defineProperty(getter, key, { get() { reads++; return marker; } });
  assert.equal(samplerFailureDiagnostic(getter, 'sampled-status').failureCode, 'SAMPLER_FAILURE');
  assert.equal(samplerFailureDiagnostic(new Proxy(unsafe, {}), 'sampled-status').failureCode, 'SAMPLER_FAILURE');
  assert.equal(reads, 0);
});

test('scoped native count selection preserves both request and client identities and rejects related00 exports unchanged', () => {
  const traceA = 'a'.repeat(32), trace00 = 'b'.repeat(32);
  const server = envelope(), client = envelope('RemoteDependencyData'), unrelated = envelope();
  server.tags['ai.operation.id'] = traceA;
  client.tags['ai.operation.id'] = traceA;
  client.data.baseData.id = '4'.repeat(16);
  unrelated.tags['ai.operation.id'] = 'c'.repeat(32);
  const metric = { ...envelope('MetricData'), tags: { 'ai.operation.id': traceA } };
  const traces = new Set([traceA, trace00]);
  const selected = selectSamplerNativeSpans([server, client, unrelated, metric], traces);
  assert.equal(selected.length, 2);
  const projected = projectSamplerNativeSpans(selected);
  assert.equal(projected[0].data.baseData.id, server.data.baseData.id);
  assert.equal(projected[1].data.baseData.id, client.data.baseData.id);
  const illegal00 = envelope('RemoteDependencyData');
  illegal00.tags['ai.operation.id'] = trace00;
  const invalid = selectSamplerNativeSpans([...selected, illegal00], traces);
  let failure;
  try { assert.equal(invalid.length, 2, 'Unchanged eligible phase expected native count'); }
  catch (error) { failure = error; }
  assert(failure);
  const diagnostic = samplerFailureDiagnostic(failure, 'native-count');
  assert.equal(diagnostic.failureStage, 'native-count');
  assert.equal(diagnostic.failureCode, 'ERR_ASSERTION');
  assert.equal(selectSamplerNativeSpans([], new Set([trace00])).length, 0);
});

test('forced failure evidence preserves stage and static code without persisting unsafe diagnostic originals', async () => {
  const directory = join(process.cwd(), '.cache', 'r7', 'sampler-intake-tests', randomUUID());
  await createSamplerEvidenceDirectory(directory);
  try {
    const failure = new Error('NATIVE_JSON_DUPLICATE_KEY');
    failure.cause = { Authorization: `Bearer ${marker}` };
    const diagnostic = samplerFailureDiagnostic(failure, 'native-intake');
    await writeSamplerEvidence(directory, 'failed-observation.json', {
      schema: 'contoso.sampler-safe-failure.v1', result: 'FAIL_OR_UNVERIFIED',
      ...diagnostic, certificationEligible: false
    });

    const saved = await readFile(join(directory, 'failed-observation.json'), 'utf8');
    const value = JSON.parse(saved);
    assert.equal(value.failureStage, 'native-intake');
    assert.equal(value.failureCode, 'NATIVE_JSON_DUPLICATE_KEY');
    assert.equal(value.rawDiagnosticsPersisted, false);
    assert(!saved.includes(marker));
    assert(!saved.includes('Authorization'));
    await assert.rejects(writeSamplerEvidence(directory, 'failed-observation.json', {}), { code: 'EEXIST' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('receiver preserves first transport cause and static HTTP code across later generic rejects and finish checks', () => {
  for (const [event, code] of [
    ['serverError', 'EADDRINUSE'], ['close', 'ERR_SERVER_NOT_RUNNING'], ['finish', 'ERR_STREAM_DESTROYED']
  ]) {
    const collector = intake();
    const original = Object.assign(new Error(`https://private.invalid/?token=${marker}`), { code });
    collector.reject('NATIVE_RECEIVER_INCOMPLETE', event, original);
    collector.reject('NATIVE_RECEIVER_INCOMPLETE', 'clientError',
      Object.assign(new Error(marker), { code: 'ECONNRESET' }));
    assert.throws(() => collector.finish(), /NATIVE_RECEIVER_INCOMPLETE/);
    const value = collector.diagnostics();
    assert.equal(value.firstPoison.event, event);
    assert.equal(value.firstPoison.underlyingCode, code);
    assert.equal(value.events.clientError, 1);
    assert.equal(value.poisoned, true);
    assert(!JSON.stringify(value).includes(marker));
    assert(!JSON.stringify(value).includes('private.invalid'));
    assert.throws(() => { value.firstPoison.underlyingCode = 'other'; }, TypeError);
  }
});

test('receive cause tracks safe declared-length and partial byte counts without reading hostile error descriptors', async () => {
  let reads = 0;
  const hostile = {};
  for (const name of ['message', 'code', 'bytesParsed', 'rawPacket', 'stack', 'cause'])
    Object.defineProperty(hostile, name, { get() { reads++; return marker; } });
  const collector = intake();
  await assert.rejects(collector.receive({
    method: 'POST', url: '/v2/track',
    headers: { 'content-length': '100000', Authorization: marker },
    async *[Symbol.asyncIterator]() { yield Buffer.from('partial'); throw hostile; },
    destroy() {}
  }), /NATIVE_PAYLOAD_INVALID/);
  const value = collector.diagnostics();
  assert.equal(reads, 0);
  assert.equal(value.firstPoison.event, 'receive');
  assert.equal(value.firstPoison.underlyingCode, 'SAMPLER_FAILURE');
  assert.equal(value.firstPoison.request.methodClass, 'POST');
  assert.equal(value.firstPoison.request.routeClass, 'native-v2-track');
  assert.equal(value.firstPoison.request.declaredLength, 100000);
  assert.equal(value.firstPoison.request.wireBytesObserved, 7);
  assert.equal(value.counts.rawBytesObserved, 7);
  assert.equal(value.counts.acceptedPayloads, 0);
  assert(!JSON.stringify(value).includes('Authorization'));
  assert(!JSON.stringify(value).includes(marker));
  assert.throws(() => collector.finish(), /NATIVE_PAYLOAD_INVALID/);
});

test('actual malformed HTTP records clientError parser code without raw packet, URL, query or headers', async () => {
  const receiver = await openSamplerNativeReceiver({ ...options(), onEcho() {} });
  const url = new URL(receiver.endpoint);
  const socket = connect({ host: url.hostname, port: Number(url.port) });
  socket.on('error', () => {});
  const ended = new Promise(done => socket.once('close', done));
  try {
    await new Promise((done, reject) => {
      socket.once('connect', done);
      socket.once('error', reject);
    });
    socket.end(`BAD@METHOD /?token=${marker} HTTP/1.1\r\nHost: private.invalid\r\n\r\n`);
    await ended;
    await assert.rejects(receiver.finish(), /NATIVE_RECEIVER_INCOMPLETE/);
    const value = receiver.diagnostics();
    assert.equal(value.firstPoison.event, 'clientError');
    assert.equal(value.firstPoison.underlyingCode, 'HPE_INVALID_METHOD');
    assert.equal(value.firstPoison.transportPhase, 'listening');
    assert.equal(value.firstPoison.request, null);
    assert.equal(value.http.requests, 0);
    assert.equal(value.poisoned, true);
    assert(!JSON.stringify(value).includes(marker));
    assert(!JSON.stringify(value).includes('private.invalid'));
    assert(!JSON.stringify(value).includes('rawPacket'));
  } finally { socket.destroy(); await receiver.stop(); }
});

test('actual ninth connection records drop and retains the unchanged eight-connection poison limit', async () => {
  const receiver = await openSamplerNativeReceiver({ ...options(), onEcho() {} });
  const url = new URL(receiver.endpoint);
  const sockets = [], ended = [];
  try {
    const connecting = [];
    for (let index = 0; index < 9; index++) {
      const socket = connect({ host: url.hostname, port: Number(url.port) });
      sockets.push(socket);
      socket.on('error', () => {});
      ended.push(new Promise(done => socket.once('close', done)));
      connecting.push(new Promise(done => { socket.once('connect', done); socket.once('error', done); }));
    }
    await Promise.all(connecting);
    const deadline = Date.now() + 2000;
    while (receiver.diagnostics().events.drop === 0 && Date.now() < deadline)
      await new Promise(done => setTimeout(done, 10));
    const value = receiver.diagnostics();
    assert.equal(value.firstPoison.event, 'drop');
    assert.equal(value.firstPoison.underlyingCode, null);
    assert.equal(value.firstPoison.transportPhase, 'listening');
    assert.equal(value.limits.maxConnections, 8);
    assert.equal(value.poisoned, true);
    for (const socket of sockets) socket.destroy();
    await Promise.all(ended);
    await assert.rejects(receiver.finish(), /NATIVE_RECEIVER_INCOMPLETE/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await receiver.stop();
  }
});

test('successful native and echo responses explicitly close completed connections', async () => {
  const receiver = await openSamplerNativeReceiver({ ...options(), onEcho() {} });
  const agent = new Agent({ keepAlive: true, maxSockets: 1, agentKeepAliveTimeoutBuffer: 0 });
  const sockets = [], closed = [];
  async function send(path, method, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? bytes(body) : undefined;
      const outgoing = httpRequest(new URL(path, receiver.endpoint), {
        agent, method, headers: payload ? { 'Content-Length': payload.length } : {}
      }, response => {
        try {
          const socket = response.socket;
          sockets.push(socket);
          closed.push(socket.destroyed ? Promise.resolve() : new Promise(done => socket.once('close', done)));
          assert.equal(response.statusCode, 200);
          assert.equal(response.headers.connection, 'close');
          assert.equal(outgoing.reusedSocket, false);
          response.resume();
          response.once('error', reject);
          response.once('end', resolve);
        } catch (error) { response.destroy(); reject(error); }
      });
      outgoing.once('error', reject);
      outgoing.end(payload);
    });
  }
  try {
    await send('/echo', 'GET');
    await send('/v2/track', 'POST', envelope());
    await send('/echo', 'GET');
    await send('/v2.1/track', 'POST', envelope('MetricData'));
    let timer;
    await Promise.race([Promise.all(closed), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('CPU_CONNECTION_CLOSE_DEADLINE')), NATIVE_BODY_TIMEOUT_MS);
    })]).finally(() => clearTimeout(timer));
    assert.equal(new Set(sockets).size, 4);
    agent.destroy();
    const captured = await receiver.finish();
    assert.equal(captured.originalPrivacyCapture.actualCounts.payloads, 2);
    assert.equal(captured.observations.length, 2);
    assert.equal(captured.receiverDiagnostics.poisoned, false);
    assert.equal(captured.receiverDiagnostics.events.clientError, 0);
    assert.equal(captured.receiverDiagnostics.pendingReceives, 0);
  } finally { agent.destroy(); await receiver.stop(); }
});

test('aborted native upload still poisons a previously accepted prefix after connection-close change', async () => {
  const receiver = await openSamplerNativeReceiver({ ...options(), onEcho() {} });
  const url = new URL(receiver.endpoint);
  const socket = connect({ host: url.hostname, port: Number(url.port) });
  socket.on('error', () => {});
  const ended = new Promise(done => socket.once('close', done));
  try {
    const good = await fetch(receiver.endpoint + '/v2/track', { method: 'POST', body: bytes(envelope()) });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('connection'), 'close');
    await good.arrayBuffer();
    if (socket.connecting) await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write('POST /v2/track HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\n\r\n{');
    const admittedDeadline = Date.now() + NATIVE_BODY_TIMEOUT_MS;
    while (receiver.diagnostics().pendingReceives !== 1 && Date.now() < admittedDeadline)
      await new Promise(done => setTimeout(done, 10));
    assert.equal(receiver.diagnostics().pendingReceives, 1);
    assert.equal(typeof socket.resetAndDestroy, 'function');
    socket.resetAndDestroy();
    await ended;
    const failedDeadline = Date.now() + NATIVE_BODY_TIMEOUT_MS;
    while (!receiver.diagnostics().poisoned && Date.now() < failedDeadline)
      await new Promise(done => setTimeout(done, 10));
    const diagnosis = receiver.diagnostics();
    assert.equal(diagnosis.poisoned, true);
    assert.equal(diagnosis.counts.acceptedPayloads, 1);
    assert(['receive', 'clientError'].includes(diagnosis.firstPoison.event));
    assert(['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE', 'NATIVE_WIRE_INCOMPLETE', 'NATIVE_PAYLOAD_INVALID']
      .includes(diagnosis.firstPoison.underlyingCode));
    await assert.rejects(receiver.finish(), /^Error: NATIVE_[A-Z_]+$/);
  } finally { socket.destroy(); await receiver.stop(); }
});
