import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { captureNativePayloads, NATIVE_POLICY_SOURCE_SHA256, SHARED_VALUE_POLICY_SHA256 } from '../../tools/security/native-payload.mjs';

const cli = fileURLToPath(new URL('../../tools/security/Scan-NativePayloads.mjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const java = name => readFile(new URL(`../../workers/messaging-core/src/test/java/com/contoso/messaging/${name}.java`, import.meta.url), 'utf8');

function fixture() {
  const publisher = randomUUID();
  const tokenMarker = `ASYNC_EXACT_TOKEN_${randomUUID()}`;
  const objectMarker = randomUUID();
  const rows = [1, 2, 3].map(attempt => ({
    iKey: publisher, time: '2026-11-01T23:00:00.000Z',
    tags: { 'ai.cloud.role': 'contoso-fulfillment-worker', 'ai.cloud.roleInstance': 'fixture-process',
      'ai.operation.id': '1'.repeat(32), 'ai.operation.parentId': '2'.repeat(16) },
    data: { baseType: 'RequestData', baseData: {
      id: String(attempt + 2).repeat(16), name: 'contoso.fulfillment.process',
      properties: { 'contoso.process.attempt': String(attempt), 'contoso.span.kind': 'CONSUMER',
        '_MS.links': JSON.stringify([{ operation_Id: '4'.repeat(32), id: '5'.repeat(16) }]) }
    } }
  }));
  const raw = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n'));
  const input = {
    publisherKeys: [publisher], forbiddenValues: [tokenMarker, objectMarker],
    payloads: [{ rawBase64: raw.toString('base64'), encoding: 'identity' }]
  };
  return { publisher, tokenMarker, objectMarker, rows, raw, input };
}

test('fixture-only original NDJSON/gzip keeps actual supplied retry IDs, kinds, parents and links after shared scan', () => {
  const { rows, raw, input } = fixture();
  for (const encoding of ['identity', 'gzip']) {
    const bytes = encoding === 'gzip' ? gzipSync(raw) : raw;
    const result = captureNativePayloads({ ...input, payloads: [{ rawBase64: bytes.toString('base64'), encoding }] });
    assert.equal(result.verified, true);
    assert.equal(result.payloadReceipts[0].originalPayloadSha256, digest(bytes));
    assert.equal(result.actualCounts.envelopes, 3);
    assert.equal(result.nativeEnvelopes.length, rows.length);
    for (let index = 0; index < rows.length; index++) {
      assert.deepEqual(result.nativeEnvelopes[index].data, rows[index].data);
      assert.equal(result.nativeEnvelopes[index].tags['ai.operation.id'], rows[index].tags['ai.operation.id']);
      assert.equal(result.nativeEnvelopes[index].tags['ai.operation.parentId'], rows[index].tags['ai.operation.parentId']);
    }
    assert.equal(result.independentProducerAuthorityVerified, false);
    assert.equal(result.allTablePrivacyGateVerified, false);
  }
});

test('duplicate plain, escaped and nested names fail before any async projection', () => {
  const { raw, input } = fixture();
  const first = raw.toString().split('\n')[0];
  for (const original of [
    first.replace('"iKey":', '"\\u0069Key":"duplicate-only","iKey":'),
    first.replace('"properties":{', '"properties":{"field":1,"\\u0066ield":2,'),
    first + '\n' + first.replace('"id":', '"id":"duplicate-only","id":')
  ]) {
    assert.throws(() => captureNativePayloads({
      ...input, payloads: [{ rawBase64: Buffer.from(original).toString('base64') }]
    }), /^Error: NATIVE_JSON_DUPLICATE_KEY$/);
  }
});

test('exact synthetic token/OID markers and values in removed tags reject the complete original capture', () => {
  for (const location of ['token', 'object', 'removed-tag']) {
    const { rows, input, tokenMarker, objectMarker } = fixture();
    if (location === 'removed-tag') rows[1].tags['ai.cloud.roleInstance'] = tokenMarker;
    else rows[1].data.baseData.properties.unclassified = location === 'token' ? tokenMarker : objectMarker;
    assert.throws(() => captureNativePayloads({
      ...input, payloads: [{ rawBase64: Buffer.from(JSON.stringify(rows)).toString('base64') }]
    }), /^Error: NATIVE_PRIVACY_UNSAFE$/);
  }
  const { input, publisher } = fixture();
  assert.throws(() => captureNativePayloads({ ...input, forbiddenValues: [publisher] }),
    /^Error: NATIVE_MARKER_PUBLISHER_CONFLICT$/);
});

test('actual CPU-only stdin CLI binds child PID, raw digest, counts and current shared source bytes', async () => {
  const { input, raw, publisher, tokenMarker } = fixture();
  const run = text => spawnSync(process.execPath, [cli], {
    input: text, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1_048_576, windowsHide: true
  });
  const positive = run(JSON.stringify(input));
  assert.equal(positive.status, 0);
  assert.equal(positive.stderr, '');
  const capture = JSON.parse(positive.stdout);
  assert.equal(capture.validatorPid, positive.pid);
  assert.equal(capture.validatorSourceSha256, NATIVE_POLICY_SOURCE_SHA256);
  assert.equal(capture.sharedPolicySha256, SHARED_VALUE_POLICY_SHA256);
  assert.equal(capture.validatorCliSourceSha256, digest(await readFile(cli)));
  assert.equal(capture.payloadReceipts[0].originalPayloadSha256, digest(raw));
  assert.equal(capture.payloadReceipts[0].originalEnvelopeCount, 3);
  assert.equal(capture.payloadReceipts[0].scannedAllOriginalValues, true);
  assert.equal(capture.payloadReceipts[0].projectedAfterScan, true);
  assert.equal(capture.payloadReceipts[0].originalPayloadRetained, false);
  assert.equal(positive.stdout.includes(publisher), false);
  assert.equal(positive.stdout.includes(tokenMarker), false);
  const negative = run(JSON.stringify({ ...input, forbiddenValues: [publisher] }));
  assert.equal(negative.status, 1);
  assert.equal(negative.stdout, '');
  assert.equal(negative.stderr.trim(), 'NATIVE_MARKER_PUBLISHER_CONFLICT');
});

test('SOURCE ONLY: both supporting Java tests consume policy-approved rows before any immutable proof write', async () => {
  const [async, linked, adapter] = await Promise.all([
    java('AsyncNativeAgentTest'), java('LinkedRootSamplingTest'), java('NativeTestCapture')
  ]);
  for (const source of [async, linked]) {
    assert.doesNotMatch(source, /getRequestBody\(\)\.readAllBytes|new GZIPInputStream|new ObjectMapper/);
    assert.match(source, /capture\.approve\(root\)/);
    assert(source.indexOf('capture.approve(root)') < source.indexOf('NativeTestCapture.writeNew('));
    assert.match(source, /approved\.rows\(\)/);
    assert.match(source, /"epochs"/);
    assert.match(source, /ASYNC_NATIVE_CAPTURE_RECEIPT/);
    assert.doesNotMatch(source, /writerWithDefaultPrettyPrinter\(\)\.writeValue/);
  }
  for (const source of ['STRICT_DUPLICATE_DETECTION', 'maxNestingDepth(32)', 'maxNameLength(KEY_BYTE_LIMIT)',
    'maxStringLength(SCALAR_BYTE_LIMIT)', 'CodingErrorAction.REPORT', 'PAYLOAD_COUNT_LIMIT = 16',
    'TOTAL_BYTE_LIMIT = 4 * PAYLOAD_LIMIT', 'ENVELOPE_LIMIT = 512', 'readNBytes(maximum + 1)',
    'StandardOpenOption.CREATE_NEW', 'ORIGINAL_POLICY_REQUIRED', 'validator.pid()',
    'originalPayloadSha256', 'scannedAllOriginalValues', 'projectedAfterScan', 'strictDuplicateKeysVerified']) {
    assert(adapter.includes(source), source);
  }
  assert.match(adapter, /new ProcessBuilder\("node", root\.resolve\(sources\.getFirst\(\)\)\.toString\(\)\)/);
  assert.match(adapter, /input\.set\("forbiddenValues"/);
  assert.match(adapter, /input\.set\("publisherKeys"/);
  assert.match(adapter, /validator\.getOutputStream\(\)/);
  assert.match(adapter, /before\.equals\(sourceHashes\(root, sources\)\)/);
  assert.match(adapter, /validator\.info\(\)\.command\(\)/);
  assert.match(adapter, /executableHashBefore\.equals\(executableHashAfter\)/);
  assert.equal((linked.match(/new NativeTestCapture\(\)/g) ?? []).length, 1);
  assert(linked.indexOf('new NativeTestCapture()') < linked.indexOf('for (int sourcePercentage'));
  assert.doesNotMatch(adapter, /Bearer\\s|forbiddenString|forbiddenField|authorization\|cookie|secretValuePresent/);
});
