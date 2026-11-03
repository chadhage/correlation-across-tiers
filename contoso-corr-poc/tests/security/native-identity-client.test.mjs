import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createIdentityClientCollector, decodeNativePayload, NATIVE_PAYLOAD_LIMIT,
  NATIVE_SCALAR_BYTE_LIMIT, NATIVE_FIELD_KEY_BYTE_LIMIT } from '../../tools/security/native-identity-client.mjs';

const fixtureKey = 'native-fixture-publisher';
const endpoint = 'http://127.0.0.1:12345';
const traceId = 'a'.repeat(32);
const rootSpanId = 'b'.repeat(16);
const configuration = { fixtureKey, endpoint };
const ready = {
  providerActive: true, actualRootContext: { traceId, spanId: rootSpanId },
  processStartUtc: '2026-11-01T17:00:00.000Z', observedAtUtc: '2026-11-01T17:00:02.000Z',
  identitySendCalls: 2
};
const wire = { jwks: [{}], identity: [{}, {}] };

function envelope(route, id) {
  return {
    iKey: fixtureKey, name: 'Microsoft.ApplicationInsights.RemoteDependency',
    time: '2026-11-01T17:00:01.000Z',
    tags: { 'ai.operation.id': traceId, 'ai.operation.parentId': rootSpanId, 'ai.cloud.role': 'contoso-av23-probe' },
    data: { baseType: 'RemoteDependencyData', baseData: {
      id, name: `GET ${route}`, type: 'HTTP',
      data: `${endpoint}${route}?resource=discarded-query-metadata`, target: 'discarded-target',
      duration: '00:00:00.001', resultCode: '200', success: true, properties: {}
    } }
  };
}

function inputs() { return [envelope('/identity/jwks', 'c'.repeat(16)), envelope('/identity/token', 'd'.repeat(16))]; }
function capture(rows, root = ready, receipts = wire, encoding) {
  const collector = createIdentityClientCollector(configuration);
  const bytes = Buffer.from(JSON.stringify(rows));
  assert.notEqual(collector.ingest(encoding === 'gzip' ? gzipSync(bytes) : bytes, encoding), null);
  return collector.assess(root, receipts);
}

test('actual-format HTTP client outputs retain native context while counts remain layer-separated', () => {
  const result = capture(inputs());
  assert.equal(result.verified, true);
  assert.deepEqual(result.nativeIdentityClientSpanCounts, { jwks: 1, managedIdentity: 1 });
  assert.equal(result.logicalIdentitySendCalls, 2);
  assert.equal(result.physicalIdentityWireAttempts, 3);
  assert.equal(result.spanCountsEqualPhysicalAttemptsClaimed, false);
  assert.equal(result.safeNativeClientProjection[0].nativeSpanId, 'c'.repeat(16));
  assert.equal(result.safeNativeClientProjection[0].nativeParentId, rootSpanId);
  const saved = JSON.stringify(result);
  for (const value of [fixtureKey, endpoint, 'discarded-query-metadata', 'discarded-target', 'InstrumentationKey'])
    assert.equal(saved.includes(value), false, value);
  assert.equal(result.fullExporterCompletenessVerified, false);
  assert.equal(result.globalRawTelemetrySafetyVerified, false);
});

test('JSON, NDJSON and gzip use the existing native ingestion format without file writes', () => {
  assert.equal(capture(inputs(), ready, wire, 'gzip').verified, true);
  const legacyType = inputs();
  for (const item of legacyType) item.data.baseData.type = 'Http';
  const observed = capture(legacyType);
  assert.equal(observed.verified, true);
  assert.equal(observed.safeNativeClientProjection[0].nativeDependencyType, 'Http');
  const ndjson = Buffer.from(inputs().map(value => JSON.stringify(value)).join('\n'));
  assert.equal(decodeNativePayload(ndjson).length, 2);
  assert.equal(decodeNativePayload(gzipSync(ndjson), 'gzip').length, 2);
  assert.equal(decodeNativePayload(Buffer.from(JSON.stringify(inputs()[0]))).length, 1);
});

test('zero/missing identity outputs, missing root or zero physical receipts never pass', () => {
  for (const [rows, root, receipts] of [
    [[], ready, wire], [[inputs()[0]], ready, wire], [inputs(), { ...ready, actualRootContext: null }, wire],
    [inputs(), { ...ready, providerActive: false }, wire], [inputs(), ready, { jwks: [], identity: [] }]
  ]) {
    const collector = createIdentityClientCollector(configuration);
    if (rows.length) collector.ingest(Buffer.from(JSON.stringify(rows)));
    assert.equal(collector.assess(root, receipts).verified, false);
  }
});

test('duplicates, wrong actual trace/parent/window and root-span substitution fail without deduplication', () => {
  assert.equal(capture([...inputs(), inputs()[1]]).verified, false);
  for (const mutate of [
    item => { item.tags['ai.operation.id'] = 'e'.repeat(32); },
    item => { item.tags['ai.operation.parentId'] = 'e'.repeat(16); },
    item => { item.data.baseData.id = rootSpanId; },
    item => { item.time = '2026-11-01T16:00:00.000Z'; }
  ]) {
    const rows = inputs();
    mutate(rows[1]);
    assert.equal(capture(rows).verified, false);
  }
});

test('foreign publisher/host/role, arbitrary native ID serialization, malformed or partial payload fail closed', () => {
  for (const mutate of [
    item => { item.iKey = 'foreign-publisher'; },
    item => { item.tags['ai.cloud.role'] = 'foreign-role'; },
    item => { item.data.baseData.data = 'https://example.invalid/identity/token'; },
    item => { item.data.baseData.id = `|${traceId}.${'d'.repeat(16)}.`; },
    item => { delete item.tags['ai.operation.parentId']; }
  ]) {
    const rows = inputs();
    mutate(rows[1]);
    const collector = createIdentityClientCollector(configuration);
    assert.equal(collector.ingest(Buffer.from(JSON.stringify(rows))), null);
    assert.equal(collector.assess(ready, wire).verified, false);
  }
  for (const [bytes, encoding] of [
    [Buffer.from('{"data":'), undefined], [Buffer.from('[{}'), undefined],
    [Buffer.from([0xff]), undefined], [Buffer.from('{}'), 'br'],
    [Buffer.alloc(NATIVE_PAYLOAD_LIMIT + 1), undefined],
    [gzipSync(Buffer.alloc(NATIVE_PAYLOAD_LIMIT + 1)), 'gzip']
  ]) assert.throws(() => decodeNativePayload(bytes, encoding), /^Error: NATIVE_/);
});

test('original prohibited fields/values are scanned before projection and never retained', () => {
  for (const mutate of [
    item => { item.data.baseData.properties.authorization = ['Bearer', 'forbidden-fixture'].join(' '); },
    item => { item.data.baseData.properties.oid = ['prohibited', 'object', 'value'].join('-'); },
    item => { item.data.baseData.properties.requestBody = ['prohibited', 'body', 'value'].join('-'); },
    item => { item.data.baseData.properties.extra = ['private.person', 'example.invalid'].join('@'); }
  ]) {
    const rows = inputs();
    mutate(rows[1]);
    const collector = createIdentityClientCollector(configuration);
    assert.equal(collector.ingest(Buffer.from(JSON.stringify(rows))), null);
    const result = collector.assess(ready, wire);
    assert.equal(result.verified, false);
    const saved = JSON.stringify(result);
    for (const value of ['forbidden-fixture', 'prohibited-object-value', 'prohibited-body-value', 'private.person'])
      assert.equal(saved.includes(value), false);
    assert.deepEqual(result.safeNativeClientProjection, []);
  }
});

test('wrong native kind cannot substitute for emitted identity CLIENT outputs', () => {
  for (const mutate of [
    item => { item.data.baseType = 'RequestData'; },
    item => { item.data.baseData.type = 'InProc'; }
  ]) {
    const rows = inputs();
    mutate(rows[1]);
    assert.equal(capture(rows).verified, false);
  }
});

test('original scalar bounds are checked before shared regex without truncation', () => {
  for (const padding of ['A'.repeat(NATIVE_SCALAR_BYTE_LIMIT), 'é'.repeat(NATIVE_SCALAR_BYTE_LIMIT / 2)]) {
    const rows = inputs();
    rows[1].data.baseData.properties.padding = padding;
    const result = capture(rows);
    assert.equal(result.verified, true);
    assert.equal(result.originalScalarByteLimit, 4096);
    assert.equal(JSON.stringify(result).includes(padding), false);
  }
  for (const padding of ['A'.repeat(NATIVE_SCALAR_BYTE_LIMIT + 1), 'é'.repeat(NATIVE_SCALAR_BYTE_LIMIT / 2 + 1)]) {
    const rows = inputs();
    rows[1].data.baseData.properties.padding = padding;
    const collector = createIdentityClientCollector(configuration);
    assert.equal(collector.ingest(Buffer.from(JSON.stringify(rows))), null);
    const result = collector.assess(ready, wire);
    assert.equal(result.verified, false);
    assert(result.findings.some(item => item.code === 'NATIVE_SCALAR_BOUND'));
    assert.deepEqual(result.safeNativeClientProjection, []);
  }
});

test('original UTF-8 field-key bounds apply before forbidden-field patterns', () => {
  for (const key of ['A'.repeat(NATIVE_FIELD_KEY_BYTE_LIMIT), 'é'.repeat(NATIVE_FIELD_KEY_BYTE_LIMIT / 2)]) {
    const rows = inputs();
    rows[1].data.baseData.properties[key] = 'safe';
    assert.equal(capture(rows).verified, true);
  }
  for (const key of ['A'.repeat(NATIVE_FIELD_KEY_BYTE_LIMIT + 1), 'é'.repeat(NATIVE_FIELD_KEY_BYTE_LIMIT / 2 + 1)]) {
    const rows = inputs();
    rows[1].data.baseData.properties[key] = 'safe';
    const collector = createIdentityClientCollector(configuration);
    assert.equal(collector.ingest(Buffer.from(JSON.stringify(rows))), null);
    assert(collector.assess(ready, wire).findings.some(item => item.code === 'NATIVE_FIELD_KEY_BOUND'));
  }
});

test('R2 64-KiB adversarial scalar is rejected in a finite isolated CPU child', () => {
  const moduleUrl = new URL('../../tools/security/native-identity-client.mjs', import.meta.url).href;
  const script = `
    const { createIdentityClientCollector } = await import(${JSON.stringify(moduleUrl)});
    const rows = ${JSON.stringify(inputs())};
    rows[1].data.baseData.properties.padding = 'A'.repeat(65536);
    const collector = createIdentityClientCollector(${JSON.stringify(configuration)});
    const accepted = collector.ingest(Buffer.from(JSON.stringify(rows)));
    const result = collector.assess(${JSON.stringify(ready)}, ${JSON.stringify(wire)});
    const rejected = accepted === null && result.verified === false &&
      result.findings.some(item => item.code === 'NATIVE_SCALAR_BOUND');
    console.log(JSON.stringify({ rejected, rawValuesRetained: result.rawPayloadRetained }));
    if (!rejected) process.exitCode = 1;
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 2000, maxBuffer: 16384, windowsHide: true
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), { rejected: true, rawValuesRetained: false });
});

test('exact 1-MiB multi-scalar native payload remains valid; one extra byte fails', () => {
  const rows = inputs();
  const properties = rows[1].data.baseData.properties;
  let index = 0;
  while (true) {
    const length = Buffer.byteLength(JSON.stringify(rows));
    if (length === NATIVE_PAYLOAD_LIMIT) break;
    const key = `padding_${index++}`;
    properties[key] = '';
    const remaining = NATIVE_PAYLOAD_LIMIT - Buffer.byteLength(JSON.stringify(rows));
    assert(remaining >= 0);
    properties[key] = ' '.repeat(Math.min(NATIVE_SCALAR_BYTE_LIMIT, remaining));
  }
  const bytes = Buffer.from(JSON.stringify(rows));
  assert.equal(bytes.length, NATIVE_PAYLOAD_LIMIT);
  const collector = createIdentityClientCollector(configuration);
  assert.notEqual(collector.ingest(bytes), null);
  assert.equal(collector.assess(ready, wire).verified, true);
  const last = `padding_${index - 1}`;
  properties[last] += ' ';
  const over = Buffer.from(JSON.stringify(rows));
  assert.equal(over.length, NATIVE_PAYLOAD_LIMIT + 1);
  const rejected = createIdentityClientCollector(configuration);
  assert.equal(rejected.ingest(over), null);
  assert(rejected.assess(ready, wire).findings.some(item => item.code === 'NATIVE_PAYLOAD_BOUND'));
});
