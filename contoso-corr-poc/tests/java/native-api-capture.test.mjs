import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureNativeApiPayloads, MAX_NATIVE_SCALAR_LENGTH } from '../../tools/java/native-api-capture.mjs';
import { NATIVE_PAYLOAD_LIMIT } from '../../tools/security/native-identity-client.mjs';
import { digest } from '../../tools/security/values.mjs';

function fixture() {
  const publisherKeys = [randomUUID(), randomUUID()];
  const envelope = {
    iKey: publisherKeys[0],
    time: '2026-11-01T19:00:00.000Z',
    tags: {
      'ai.cloud.role': 'contoso-orders-api',
      'ai.cloud.roleInstance': 'fixture-machine',
      'ai.operation.id': '1'.repeat(32),
      'ai.operation.parentId': '2'.repeat(16)
    },
    data: {
      baseType: 'RemoteDependencyData',
      baseData: { id: '3'.repeat(16), type: 'Http', data: 'http://127.0.0.1:1234/api/inventory/CONTOSO-001' }
    }
  };
  return { publisherKeys, envelope };
}
function input(publisherKeys, bytes, encoding = 'identity', forbiddenValues = []) {
  return { publisherKeys, forbiddenValues, payloads: [{ rawBase64: bytes.toString('base64'), encoding }] };
}

test('original values are scanned before publisher/machine projection; technical values remain exact', () => {
  const { publisherKeys, envelope } = fixture();
  const bytes = Buffer.from(JSON.stringify(envelope));
  const output = captureNativeApiPayloads(input(publisherKeys, bytes));
  assert.equal(output.payloadReceipts[0].originalPayloadSha256, digest(bytes));
  assert.equal(output.payloadReceipts[0].originalEnvelopeCount, 1);
  assert.equal(output.payloadReceipts[0].scannedAllOriginalValues, true);
  assert.equal(output.payloadReceipts[0].projectedAfterScan, true);
  assert.equal(output.payloadReceipts[0].originalPayloadRetained, false);
  assert.ok(!Object.hasOwn(output.nativeEnvelopes[0], 'iKey'));
  assert.ok(!Object.hasOwn(output.nativeEnvelopes[0].tags, 'ai.cloud.roleInstance'));
  assert.equal(output.nativeEnvelopes[0].tags['ai.operation.id'], envelope.tags['ai.operation.id']);
  assert.equal(output.nativeEnvelopes[0].tags['ai.operation.parentId'], envelope.tags['ai.operation.parentId']);
  assert.deepEqual(output.nativeEnvelopes[0].data, envelope.data);
  assert.ok(Object.hasOwn(envelope, 'iKey'));
});

test('redactable tags cannot conceal original personal values, credentials or exact identity markers', () => {
  for (const [key, value, markers] of [
    ['ai.user.id', 'fixture-person', []],
    ['ai.user.authUserId', 'synthetic@example.invalid', []],
    ['ai.cloud.roleInstance', 'Bearer fixture-credential', []],
    ['ai.location.ip', 'fixture-private-marker', ['fixture-private-marker']]
  ]) {
    const { publisherKeys, envelope } = fixture();
    envelope.tags[key] = value;
    assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)), 'identity', markers)),
      /NATIVE_PRIVACY_UNSAFE/);
  }
});

test('original properties reject credential fields, SQL capture and JWT-shaped strings without synthetic waivers', () => {
  const jwt = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"sub":"fixture"}').toString('base64url')}.${'A'.repeat(32)}`;
  for (const properties of [
    { authorization: 'short' },
    { 'db.statement': 'SELECT * FROM inventory WHERE sku=?' },
    { 'redis.key': 'fixture' },
    { 'fixture.label': jwt }
  ]) {
    const { publisherKeys, envelope } = fixture();
    envelope.data.baseData.properties = properties;
    assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))),
      /NATIVE_PRIVACY_UNSAFE/);
  }
});

test('unknown or nested publisher credentials are rejected before any projection', () => {
  for (const nested of [false, true]) {
    const { publisherKeys, envelope } = fixture();
    if (nested) envelope.data.baseData.iKey = publisherKeys[0];
    else envelope.iKey = randomUUID();
    assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))),
      /NATIVE_PUBLISHER_UNEXPECTED/);
  }
  const { publisherKeys, envelope } = fixture();
  envelope.data.baseData.properties = { 'fixture.marker': publisherKeys[0] };
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))),
    /NATIVE_PRIVACY_UNSAFE/);
});

test('NDJSON and gzip preserve separate original payload and envelope counts', () => {
  const { publisherKeys, envelope } = fixture();
  const second = structuredClone(envelope);
  second.iKey = publisherKeys[1];
  second.data.baseData.id = '4'.repeat(16);
  const ndjson = Buffer.from(`${JSON.stringify(envelope)}\n${JSON.stringify(second)}\n`);
  const compressed = gzipSync(ndjson);
  const output = captureNativeApiPayloads({
    publisherKeys, forbiddenValues: [],
    payloads: [{ rawBase64: compressed.toString('base64'), encoding: 'gzip' }]
  });
  assert.equal(output.payloadReceipts.length, 1);
  assert.equal(output.payloadReceipts[0].originalPayloadSha256, digest(compressed));
  assert.equal(output.payloadReceipts[0].originalEnvelopeCount, 2);
  assert.equal(output.nativeEnvelopes.length, 2);
  assert.equal(output.nativeEnvelopes[1].data.baseData.id, second.data.baseData.id);
});

test('compressed, envelope-count, payload-count and prototype bounds fail closed', () => {
  const { publisherKeys, envelope } = fixture();
  const ordinary = input(publisherKeys, Buffer.from(JSON.stringify(envelope)));
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, gzipSync(Buffer.alloc(NATIVE_PAYLOAD_LIMIT + 1, 65)), 'gzip')),
    /NATIVE_PAYLOAD_BOUND|NATIVE_PAYLOAD_INVALID/);
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(Array(513).fill(envelope))))),
    /NATIVE_ENVELOPE_SCHEMA/);
  assert.throws(() => captureNativeApiPayloads({ ...ordinary, payloads: Array(17).fill(ordinary.payloads[0]) }),
    /NATIVE_CAPTURE_SCHEMA/);
  const prototype = JSON.stringify(envelope).replace('"baseData":{', '"baseData":{"__proto__":"fixture",');
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(prototype))), /NATIVE_PRIVACY_UNSAFE/);
});

test('the exact 512-envelope and one-MiB thresholds accept at the boundary and reject above it', () => {
  const { publisherKeys, envelope } = fixture();
  const full = captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(Array(512).fill(envelope)))));
  assert.equal(full.nativeEnvelopes.length, 512);
  const padded = structuredClone(envelope);
  padded.safePadding = Array(4096).fill('');
  const overhead = Buffer.byteLength(JSON.stringify(padded));
  const paddingBytes = NATIVE_PAYLOAD_LIMIT - overhead;
  const perScalar = Math.floor(paddingBytes / padded.safePadding.length);
  const remainder = paddingBytes % padded.safePadding.length;
  padded.safePadding = padded.safePadding.map((_, index) => 'A'.repeat(perScalar + (index < remainder ? 1 : 0)));
  const bytes = Buffer.from(JSON.stringify(padded));
  assert.equal(bytes.length, NATIVE_PAYLOAD_LIMIT);
  assert.equal(captureNativeApiPayloads(input(publisherKeys, bytes)).nativeEnvelopes.length, 1);
  padded.safePadding[0] += 'A';
  const excessive = Buffer.from(JSON.stringify(padded));
  assert.equal(excessive.length, NATIVE_PAYLOAD_LIMIT + 1);
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, excessive)), /NATIVE_PAYLOAD_BOUND/);
  padded.safePadding = 'A'.repeat(MAX_NATIVE_SCALAR_LENGTH);
  assert.equal(captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(padded)))).nativeEnvelopes.length, 1);
  padded.safePadding += 'A';
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(padded)))), /NATIVE_SCALAR_BOUND/);
});

test('the actual CLI binds its PID and never emits unsafe originals on stdout or stderr', () => {
  const { publisherKeys, envelope } = fixture();
  const script = fileURLToPath(new URL('../../tools/java/native-api-capture.mjs', import.meta.url));
  const positive = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))), encoding: 'utf8'
  });
  assert.equal(positive.status, 0, positive.stderr);
  assert.equal(JSON.parse(positive.stdout).validatorPid, positive.pid);
  envelope.tags['ai.user.id'] = 'fixture-private-marker';
  const rejected = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))), encoding: 'utf8'
  });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr.trim(), 'NATIVE_PRIVACY_UNSAFE');
  assert.ok(!rejected.stderr.includes('fixture-private-marker'));
});

test('the API consumer rejects duplicate original fields and publisher-marker conflicts through the shared policy', () => {
  const { publisherKeys, envelope } = fixture();
  const duplicate = JSON.stringify(envelope).replace('"baseData":{', '"baseData":{"type":"first",');
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(duplicate))), /NATIVE_JSON_DUPLICATE_KEY/);
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)),
    'identity', [publisherKeys[0]])), /NATIVE_MARKER_PUBLISHER_CONFLICT/);
  envelope.safePadding = '\u00e9'.repeat(MAX_NATIVE_SCALAR_LENGTH / 2);
  assert.equal(captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))).nativeEnvelopes.length, 1);
  envelope.safePadding += '\u00e9';
  assert.throws(() => captureNativeApiPayloads(input(publisherKeys, Buffer.from(JSON.stringify(envelope)))), /NATIVE_SCALAR_BOUND/);
});

test('default Netty qualification tests the sampled bit without rejecting or rewriting other W3C bits', () => {
  const script = fileURLToPath(new URL('../../tools/java/Run-DefaultNettyWireProbe.mjs', import.meta.url));
  const check = spawnSync(process.execPath, [script, '--verify-sampling-bit'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /8 exact controls; flags are never rewritten/);
});
