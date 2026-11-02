import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  captureNativePayloads, captureNativeApiPayloads, createNativePayloadSession, decodeNativePayload,
  parseNativeCaptureInput, NATIVE_LIMITS, NATIVE_POLICY_SOURCE_SHA256, SHARED_VALUE_POLICY_SHA256
} from '../../tools/security/native-payload.mjs';
import { digest } from '../../tools/security/values.mjs';

const cli = fileURLToPath(new URL('../../tools/security/Scan-NativePayloads.mjs', import.meta.url));

function fixture() {
  const publisherKeys = [randomUUID()];
  const envelope = {
    iKey: publisherKeys[0], time: '2026-11-01T23:00:00.000Z',
    tags: { 'ai.cloud.role': 'contoso-native-fixture', 'ai.cloud.roleInstance': 'fixture-process',
      'ai.operation.id': '1'.repeat(32), 'ai.operation.parentId': '2'.repeat(16) },
    data: { baseType: 'RemoteDependencyData',
      baseData: { id: '3'.repeat(16), type: 'Http', data: 'GET', properties: {} } }
  };
  return { publisherKeys, envelope };
}
const encode = (bytes, encoding = 'identity') => ({ rawBase64: bytes.toString('base64'), encoding });
function input(publisherKeys, envelopes, forbiddenValues = []) {
  return { publisherKeys, forbiddenValues, payloads: [encode(Buffer.from(JSON.stringify(envelopes)))] };
}
const code = expected => error => error.message === expected && error.cause === undefined;

function paddedPayload(envelope, size) {
  const result = structuredClone(envelope);
  const values = result.data.baseData.properties.padding = [];
  let bytes = Buffer.byteLength(JSON.stringify(result));
  while (bytes < size) {
    values.push('');
    bytes = Buffer.byteLength(JSON.stringify(result));
    const remaining = size - bytes;
    assert(remaining >= 0);
    values[values.length - 1] = ' '.repeat(Math.min(NATIVE_LIMITS.scalarBytes, remaining));
    bytes = Buffer.byteLength(JSON.stringify(result));
  }
  return Buffer.from(JSON.stringify(result));
}

test('one generic port preserves the API shape and actual native context without authority', () => {
  assert.equal(captureNativeApiPayloads, captureNativePayloads);
  const { publisherKeys, envelope } = fixture();
  const original = JSON.stringify(envelope);
  const bytes = Buffer.from(original);
  const output = captureNativePayloads(input(publisherKeys, envelope));
  assert.equal(output.schema, 'contoso.native-api-safe-capture.v1');
  assert.equal(output.verified, true);
  assert.equal(output.validatorPid, process.pid);
  assert.equal(output.validatorSourceSha256, NATIVE_POLICY_SOURCE_SHA256);
  assert.equal(output.sharedPolicySha256, SHARED_VALUE_POLICY_SHA256);
  assert.equal(output.independentProducerAuthorityVerified, false);
  assert.equal(output.allTablePrivacyGateVerified, false);
  assert.equal(output.sourceAcceptanceIsCertification, false);
  assert.equal(output.payloadReceipts[0].originalPayloadSha256, digest(bytes));
  assert.equal(output.payloadReceipts[0].originalPayloadBytes, bytes.length);
  assert.equal(output.payloadReceipts[0].strictDuplicateKeysVerified, true);
  assert.equal(output.payloadReceipts[0].projectedAfterScan, true);
  assert.equal(output.payloadReceipts[0].originalPayloadRetained, false);
  assert.deepEqual(output.nativeEnvelopes[0].data, envelope.data);
  assert.equal(output.nativeEnvelopes[0].tags['ai.operation.id'], envelope.tags['ai.operation.id']);
  assert.equal(output.nativeEnvelopes[0].tags['ai.operation.parentId'], envelope.tags['ai.operation.parentId']);
  assert.equal(JSON.stringify(output).includes(publisherKeys[0]), false);
  assert.equal(Object.hasOwn(output.nativeEnvelopes[0].tags, 'ai.cloud.roleInstance'), false);
  assert.equal(JSON.stringify(envelope), original);
});

test('single, array, NDJSON, gzip and multiple known publishers keep actual separate counters', () => {
  const { publisherKeys, envelope } = fixture();
  publisherKeys.push(randomUUID());
  const next = structuredClone(envelope);
  next.iKey = publisherKeys[1];
  next.data.baseData.id = '4'.repeat(16);
  for (const raw of [JSON.stringify([envelope, next]), JSON.stringify(envelope) + '\n' + JSON.stringify(next) + '\n']) {
    const bytes = gzipSync(Buffer.from(raw));
    const output = captureNativePayloads({ publisherKeys, forbiddenValues: [], payloads: [encode(bytes, 'gzip')] });
    assert.equal(output.payloadReceipts[0].originalPayloadSha256, digest(bytes));
    assert.equal(output.payloadReceipts[0].originalEnvelopeCount, 2);
    assert.equal(output.actualCounts.envelopes, 2);
    assert.equal(output.actualCounts.payloads, 1);
    assert.equal(output.nativeEnvelopes[1].data.baseData.id, next.data.baseData.id);
  }
});

test('duplicate JSON names including escaped equivalents fail at every nesting before projection', () => {
  const { publisherKeys, envelope } = fixture();
  const original = JSON.stringify(envelope);
  const cases = [
    original.replace('"iKey":', '"iKey":"duplicate-fixture","iKey":'),
    original.replace('"iKey":', '"\\u0069Key":"duplicate-fixture","iKey":'),
    original.replace('"properties":{}', '"properties":{"field":1,"field":2}'),
    original.replace('"properties":{}', '"properties":{"field":1,"\\u0066ield":2}'),
    original.replace('"properties":{}', '"properties":{"\\u0061":1,"a":2}'),
    original.replace('"properties":{}', '"properties":{"é":1,"\\u00e9":2}'),
    original.replace('"properties":{}', '"properties":{"x":[{"name":1,"na\\u006de":2}]}')
  ];
  for (const raw of cases) {
    for (const body of [raw, `[${raw}]`, original + '\n' + raw]) {
      assert.throws(() => captureNativePayloads({ publisherKeys, forbiddenValues: [],
        payloads: [encode(Buffer.from(body))] }), code('NATIVE_JSON_DUPLICATE_KEY'));
    }
  }
  assert.throws(() => parseNativeCaptureInput(Buffer.from('{"payloads":[],"\\u0070ayloads":[]}')),
    code('NATIVE_JSON_DUPLICATE_KEY'));
});

test('malformed, partial, nonfinite, invalid UTF-8 and unsupported encodings fail redacted', () => {
  for (const bytes of [
    Buffer.from('{"iKey":'), Buffer.from('{"x":1e9999}'), Buffer.from('{"x":01}'),
    Buffer.from('{"x":"\\uD800"}'), Buffer.from('{"x":"bad\\q"}'), Buffer.from('[{}'),
    Buffer.from([0xff]), Buffer.alloc(0)
  ]) assert.throws(() => decodeNativePayload(bytes));
  const { publisherKeys, envelope } = fixture();
  for (const encoding of ['br', 'deflate', 'GZIP', null]) {
    assert.throws(() => captureNativePayloads({ publisherKeys, forbiddenValues: [],
      payloads: [encode(Buffer.from(JSON.stringify(envelope)), encoding)] }), code('NATIVE_PAYLOAD_ENCODING'));
  }
  assert.throws(() => decodeNativePayload(Buffer.from('not-gzip'), 'gzip'), code('NATIVE_PAYLOAD_INVALID'));
  const compressed = gzipSync(Buffer.from(JSON.stringify(envelope)));
  assert.throws(() => decodeNativePayload(compressed.subarray(0, -4), 'gzip'), code('NATIVE_PAYLOAD_INVALID'));
});

test('publisher membership and top-level placement cannot be hidden by later projection', () => {
  for (const mutate of [
    item => { delete item.iKey; },
    item => { item.iKey = randomUUID(); },
    item => { item.data.baseData.properties.iKey = item.iKey; }
  ]) {
    const { publisherKeys, envelope } = fixture();
    mutate(envelope);
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_PUBLISHER_UNEXPECTED'));
  }
  for (const asKey of [false, true]) {
    const { publisherKeys, envelope } = fixture();
    const marker = publisherKeys[0].toUpperCase();
    if (asKey) envelope.data.baseData.properties[marker] = 'value';
    else envelope.data.baseData.properties.publisherCopy = marker;
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_PRIVACY_UNSAFE'));
  }
});

test('shared credential, personal, SQL and Redis fields/values reject before removals', () => {
  const jwt = [
    Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ oid: randomUUID() })).toString('base64url'), 'A'.repeat(32)
  ].join('.');
  for (const [key, value] of [
    ['authorization', String.fromCharCode(33)],
    ['db.statement', ['SELECT *', 'FROM inventory', 'WHERE sku=?'].join(' ')],
    ['redis.key', randomUUID()],
    ['fixture-value', jwt],
    ['fixture-value', ['private.fixture', 'example.invalid'].join('@')],
    ['fixture-value', ['Bearer', randomUUID()].join(' ')],
    ['ai.user.authUserId', 'raw-fixture-user']
  ]) {
    const { publisherKeys, envelope } = fixture();
    envelope.data.baseData.properties[key] = value;
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_PRIVACY_UNSAFE'));
  }
  for (const key of ['ai.user.id', 'ai.user.authUserId']) {
    const { publisherKeys, envelope } = fixture();
    envelope.tags[key] = 'raw-fixture-user';
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_PRIVACY_UNSAFE'));
  }
  const { publisherKeys, envelope } = fixture();
  envelope.tags['ai.user.authUserId'] = 'h1:' + 'a'.repeat(32) + ':' + 'B'.repeat(43);
  assert.equal(captureNativePayloads(input(publisherKeys, envelope)).nativeEnvelopes[0].tags['ai.user.authUserId'], undefined);
});

test('exact caller markers apply to keys and removed original tags without any waiver', () => {
  const marker = 'fixture-marker-' + randomUUID();
  for (const mutate of [
    item => { item.tags['ai.cloud.roleInstance'] = marker; },
    item => { item.tags['ai.location.ip'] = marker; },
    item => { item.data.baseData.properties.key = 'prefix-' + marker + '-suffix'; },
    item => { item.data.baseData.properties[marker] = 'safe'; }
  ]) {
    const { publisherKeys, envelope } = fixture();
    mutate(envelope);
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope, [marker])), code('NATIVE_PRIVACY_UNSAFE'));
  }
});

test('explicit forbidden markers cannot be waived by known publisher membership', () => {
  const { publisherKeys, envelope } = fixture();
  for (const marker of [publisherKeys[0], publisherKeys[0].slice(0, 8), publisherKeys[0].slice(-8)]) {
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope, [marker])),
      code('NATIVE_MARKER_PUBLISHER_CONFLICT'));
    assert.throws(() => createNativePayloadSession({ publisherKeys, forbiddenValues: [marker] }),
      code('NATIVE_MARKER_PUBLISHER_CONFLICT'));
  }
  const ordinary = captureNativePayloads(input(publisherKeys, envelope, ['independent-caller-marker']));
  assert.equal(ordinary.verified, true);
  assert.equal(ordinary.independentProducerAuthorityVerified, false);
});

test('known publisher and marker configuration is sealed, bounded and cannot disable policy', () => {
  const { publisherKeys, envelope } = fixture();
  const base = input(publisherKeys, envelope);
  assert.equal(captureNativePayloads({ ...base, publisherKeys: Array.from({ length: 16 }, (_, index) =>
    index === 0 ? publisherKeys[0] : randomUUID()) }).verified, true);
  assert.equal(captureNativePayloads({ ...base, forbiddenValues: Array.from({ length: 64 }, () => randomUUID()) }).verified, true);
  for (const altered of [
    { publisherKeys: [] }, { publisherKeys: Array.from({ length: 17 }, randomUUID) },
    { publisherKeys: [publisherKeys[0], publisherKeys[0].toUpperCase()] },
    { publisherKeys: ['not-uuid'] }, { forbiddenValues: ['short'] },
    { forbiddenValues: [' '.repeat(16385)] },
    { forbiddenValues: Array(65).fill('exact-marker') },
    { forbiddenValues: Array(5).fill(' '.repeat(16384)) },
    { skipOriginalScan: true }, { limits: { scalarBytes: 65536 } }
  ]) assert.throws(() => captureNativePayloads({ ...base, ...altered }), code('NATIVE_CAPTURE_SCHEMA'));
});

test('canonical Base64 and payload object schema fail closed', () => {
  const { publisherKeys, envelope } = fixture();
  const base = input(publisherKeys, envelope);
  for (const payload of [
    { rawBase64: '' }, { rawBase64: 'Zg' }, { rawBase64: 'Zg==\n' },
    { rawBase64: base.payloads[0].rawBase64, ignored: true },
    { rawBase64: 1 }, null
  ]) assert.throws(() => captureNativePayloads({ ...base, payloads: [payload] }), code('NATIVE_CAPTURE_SCHEMA'));
});

test('exact UTF-8 key/scalar limits precede shared regex; oversized originals are not truncated', () => {
  for (const padding of ['A'.repeat(4096), 'é'.repeat(2048), '😀'.repeat(1024)]) {
    const { publisherKeys, envelope } = fixture();
    envelope.data.baseData.properties.padding = padding;
    assert.equal(captureNativePayloads(input(publisherKeys, envelope)).verified, true);
  }
  for (const padding of ['A'.repeat(4097), 'é'.repeat(2049), '😀'.repeat(1025), 'A'.repeat(65536)]) {
    const { publisherKeys, envelope } = fixture();
    envelope.data.baseData.properties.padding = padding;
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_SCALAR_BOUND'));
  }
  for (const key of ['A'.repeat(128), 'é'.repeat(64), '😀'.repeat(32)]) {
    const { publisherKeys, envelope } = fixture();
    envelope.data.baseData.properties[key] = 'safe';
    assert.equal(captureNativePayloads(input(publisherKeys, envelope)).verified, true);
  }
  for (const key of ['A'.repeat(129), 'é'.repeat(65), '😀'.repeat(33)]) {
    const { publisherKeys, envelope } = fixture();
    envelope.data.baseData.properties[key] = 'safe';
    assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_FIELD_KEY_BOUND'));
  }
});

test('depth and field limits reject original nested/node expansion before projection', () => {
  for (const [depth, accepted] of [[28, true], [29, false]]) {
    const { publisherKeys, envelope } = fixture();
    let nested = '';
    for (let index = 0; index < depth; index++) nested = { p: nested };
    envelope.data.baseData.properties.nested = nested;
    if (accepted) assert.equal(captureNativePayloads(input(publisherKeys, envelope)).verified, true);
    else assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_DEPTH_BOUND'));
  }
  const { publisherKeys, envelope } = fixture();
  function nodeCount(value) {
    return 1 + (value && typeof value === 'object'
      ? Object.values(value).reduce((total, child) => total + nodeCount(child), 0) : 0);
  }
  envelope.data.baseData.properties.nodes = [];
  const overhead = nodeCount(envelope);
  envelope.data.baseData.properties.nodes = Array(NATIVE_LIMITS.fieldsPerEnvelope - overhead).fill('');
  assert.equal(nodeCount(envelope), NATIVE_LIMITS.fieldsPerEnvelope);
  assert.equal(captureNativePayloads(input(publisherKeys, envelope)).verified, true);
  envelope.data.baseData.properties.nodes.push('');
  assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_FIELD_COUNT_BOUND'));
  envelope.data.baseData.properties.nodes = Array(8192).fill('');
  assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_FIELD_COUNT_BOUND'));
  envelope.data.baseData.properties.nodes = Array(131072).fill(null);
  assert.throws(() => captureNativePayloads(input(publisherKeys, envelope)), code('NATIVE_FIELD_COUNT_BOUND'));
});

test('raw and gzip exact one-MiB multi-scalar boundary accepts while one byte beyond rejects', () => {
  const { publisherKeys, envelope } = fixture();
  const bytes = paddedPayload(envelope, NATIVE_LIMITS.payloadBytes);
  assert.equal(bytes.length, NATIVE_LIMITS.payloadBytes);
  for (const encoding of ['identity', 'gzip']) {
    const raw = encoding === 'gzip' ? gzipSync(bytes) : bytes;
    const output = captureNativePayloads({ publisherKeys, forbiddenValues: [], payloads: [encode(raw, encoding)] });
    assert.equal(output.payloadReceipts[0].decodedPayloadBytes, NATIVE_LIMITS.decodedPayloadBytes);
    const over = Buffer.concat([bytes, Buffer.from(' ')]);
    assert.throws(() => captureNativePayloads({ publisherKeys, forbiddenValues: [],
      payloads: [encode(encoding === 'gzip' ? gzipSync(over) : over, encoding)] }), code('NATIVE_PAYLOAD_BOUND'));
  }
});

test('session total byte limits accept exact 16-MiB multi-payload boundaries without retaining originals', () => {
  const { publisherKeys, envelope } = fixture();
  const bytes = paddedPayload(envelope, NATIVE_LIMITS.payloadBytes);
  const session = createNativePayloadSession({ publisherKeys, forbiddenValues: [] });
  for (let index = 0; index < NATIVE_LIMITS.payloads; index++) session.ingest(bytes);
  const result = session.snapshot();
  assert.equal(result.actualCounts.originalRawBytes, NATIVE_LIMITS.totalRawBytes);
  assert.equal(result.actualCounts.decodedBytes, NATIVE_LIMITS.totalDecodedBytes);
  assert.equal(result.actualCounts.payloads, 16);
  assert.equal(result.payloadReceipts.every(receipt => receipt.originalPayloadRetained === false), true);
  assert.throws(() => session.ingest(Buffer.from(' ')), code('NATIVE_TOTAL_BOUND'));
});

test('512 envelopes and 16 payloads accept exactly; session state rejects beyond and stays poisoned', () => {
  const { publisherKeys, envelope } = fixture();
  const bytes = Buffer.from(JSON.stringify(Array(512).fill(envelope)));
  const session = createNativePayloadSession({ publisherKeys, forbiddenValues: [] });
  assert.throws(() => session.snapshot(), code('NATIVE_SESSION_EMPTY'));
  for (let index = 0; index < 16; index++) session.ingest(bytes);
  assert.equal(session.snapshot().actualCounts.envelopes, 8192);
  assert.equal(session.snapshot().actualCounts.payloads, 16);
  assert.throws(() => session.ingest(bytes), code('NATIVE_TOTAL_BOUND'));
  assert.throws(() => session.snapshot(), code('NATIVE_TOTAL_BOUND'));
  assert.throws(() => session.ingest(bytes), code('NATIVE_TOTAL_BOUND'));
  assert.throws(() => captureNativePayloads(input(publisherKeys, Array(513).fill(envelope))),
    code('NATIVE_ENVELOPE_SCHEMA'));
  const request = input(publisherKeys, envelope);
  request.payloads = Array(17).fill(request.payloads[0]);
  assert.throws(() => captureNativePayloads(request), code('NATIVE_CAPTURE_SCHEMA'));
});

test('one streaming session permits 128 bounded POSTs while API batches stay limited to 16', () => {
  const { publisherKeys, envelope } = fixture();
  const bytes = Buffer.from(JSON.stringify(envelope));
  const session = createNativePayloadSession({ publisherKeys, forbiddenValues: [] });
  assert.equal(NATIVE_LIMITS.sessionPayloads, 128);
  for (let index = 0; index < 128; index++) session.ingest(bytes);
  assert.equal(session.snapshot().actualCounts.payloads, 128);
  assert.equal(session.snapshot().actualCounts.envelopes, 128);
  assert.throws(() => session.ingest(bytes), code('NATIVE_TOTAL_BOUND'));
  assert.throws(() => session.snapshot(), code('NATIVE_TOTAL_BOUND'));
  const batch = input(publisherKeys, envelope);
  batch.payloads = Array(16).fill(encode(bytes));
  assert.equal(captureNativePayloads(batch).actualCounts.payloads, 16);
  batch.payloads.push(encode(bytes));
  assert.throws(() => captureNativePayloads(batch), code('NATIVE_CAPTURE_SCHEMA'));
});

test('failed later input poisons a session and cannot return partial projection as a successful capture', () => {
  const { publisherKeys, envelope } = fixture();
  const session = createNativePayloadSession({ publisherKeys, forbiddenValues: [] });
  const first = session.ingest(Buffer.from(JSON.stringify(envelope)));
  first.nativeEnvelopes[0].data.baseData.id = 'modified-return-value';
  assert.equal(session.snapshot().nativeEnvelopes[0].data.baseData.id, envelope.data.baseData.id);
  envelope.data.baseData.properties.oid = randomUUID();
  assert.throws(() => session.ingest(Buffer.from(JSON.stringify(envelope))), code('NATIVE_PRIVACY_UNSAFE'));
  assert.throws(() => session.snapshot(), code('NATIVE_PRIVACY_UNSAFE'));
});

test('the actual CLI binds PID/source/hash/counts and emits only static redacted failures', () => {
  const { publisherKeys, envelope } = fixture();
  const request = input(publisherKeys, envelope);
  const run = text => spawnSync(process.execPath, [cli], {
    input: text, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
  });
  const success = run(JSON.stringify(request));
  assert.equal(success.error, undefined);
  assert.equal(success.status, 0);
  const output = JSON.parse(success.stdout);
  assert.equal(output.validatorPid, success.pid);
  assert.equal(output.validatorSourceSha256, NATIVE_POLICY_SOURCE_SHA256);
  assert.match(output.validatorCliSourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(output.payloadReceipts[0].originalEnvelopeCount, 1);
  assert.equal(success.stdout.includes(publisherKeys[0]), false);
  assert.equal(success.stderr, '');
  const duplicate = run(JSON.stringify(request).replace('"publisherKeys":', '"publisherKeys":[],"\\u0070ublisherKeys":'));
  assert.equal(duplicate.status, 1);
  assert.equal(duplicate.stdout, '');
  assert.equal(duplicate.stderr.trim(), 'NATIVE_JSON_DUPLICATE_KEY');
  envelope.data.baseData.properties.padding = 'A'.repeat(65536);
  const bounded = run(JSON.stringify(input(publisherKeys, envelope)));
  assert.equal(bounded.status, 1);
  assert.equal(bounded.stdout, '');
  assert.equal(bounded.stderr.trim(), 'NATIVE_SCALAR_BOUND');
  const marker = 'caller-private-marker-' + randomUUID();
  envelope.data.baseData.properties.padding = marker;
  const unsafe = run(JSON.stringify(input(publisherKeys, envelope, [marker])));
  assert.equal(unsafe.status, 1);
  assert.equal(unsafe.stdout, '');
  assert.equal(unsafe.stderr.trim(), 'NATIVE_PRIVACY_UNSAFE');
  assert.equal(unsafe.stderr.includes(marker), false);
  const conflict = run(JSON.stringify(input(publisherKeys, fixture().envelope, [publisherKeys[0]])));
  assert.equal(conflict.status, 1);
  assert.equal(conflict.stdout, '');
  assert.equal(conflict.stderr.trim(), 'NATIVE_MARKER_PUBLISHER_CONFLICT');
  assert.equal(conflict.stderr.includes(publisherKeys[0]), false);
});

test('CLI request bytes are bounded without weakening strict wrapper parsing', () => {
  const { publisherKeys, envelope } = fixture();
  const request = Buffer.from(JSON.stringify(input(publisherKeys, envelope)));
  const exact = Buffer.concat([request, Buffer.alloc(NATIVE_LIMITS.inputBytes - request.length, 32)]);
  assert.equal(parseNativeCaptureInput(exact).payloads.length, 1);
  assert.throws(() => parseNativeCaptureInput(Buffer.concat([exact, Buffer.from(' ')])), code('NATIVE_CAPTURE_BOUND'));
  assert.throws(() => parseNativeCaptureInput(Buffer.from('{"payloads":[],"payloads":[]}')),
    code('NATIVE_JSON_DUPLICATE_KEY'));
});
