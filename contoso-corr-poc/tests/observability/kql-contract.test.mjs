import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderKql, loadRootMap, compileBoundaryBindings, PROCEDURES } from '../../tools/observability/kql.mjs';
import { canonicalSpanId, normalizeTelemetryRows, nativeLinks, validateSamplingControlAck, legacyDurationMilliseconds } from '../../tools/observability/telemetry-contract.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const trace = '11111111111111111111111111111111';
const span = 'aaaaaaaaaaaaaaaa';
const hash = 'a'.repeat(64);
const input = { schema: 'workspace', fromUtc: '2026-10-31T21:00:00Z', toUtc: '2026-10-31T21:30:00Z',
  traceId: trace, invocationId: 'd7e820dc-44b0-4730-b70e-bbedfd97eb5b',
  appResourceId: '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso/providers/Microsoft.Insights/components/contoso-appi' };
const options = { schema: 'workspace', scope: { workspaceId: 'workspace', resourceId: input.appResourceId },
  captureId: 'unit-fixture', capturedAtUtc: '2026-10-31T21:00:00Z', sourceKind: 'fixture-check',
  privacyDisposition: { result: 'PASS', policySha256: hash } };

test('six procedures render complete distinct schemas without broad materialization', async () => {
  for (const schema of ['workspace', 'legacy']) for (const procedure of PROCEDURES) {
    const result = await renderKql(procedure, { ...input, schema });
    assert(!result.query.includes('{{'));
    assert(result.query.includes(schema === 'workspace' ? 'AppRequests' : '(requests'));
    assert(!result.query.includes('isfuzzy'));
    assert(!result.query.includes('(?!'));
    assert(!result.query.includes('materialize('));
    assert.equal(result.azureExecution, 'To Do');
    assert.equal(result.certificationEligible, false);
  }
});

test('root map is the only topology source and contains eight mandatory core boundaries', async () => {
  const { map } = await loadRootMap();
  assert.equal(map.coreSynchronousBoundaries.length, 8);
  const binding = compileBoundaryBindings(map);
  assert(binding.BoundaryMap.includes('orders.request'));
  assert(binding.BoundaryMap.includes('aggregator.fanin'));
  const source = await readFile(join(project, 'tools', 'observability', 'kql.mjs'), 'utf8');
  assert(source.includes('expected-boundary-map.v1.json'));
  assert(!source.includes('namespace-sb'));
});

test('missing map parent edges never silently create declared roots', async () => {
  const { map } = await loadRootMap();
  const bindings = compileBoundaryBindings(map);
  assert(bindings.BoundaryMap.includes('"orders.servicebus.send","contoso-orders-api","PRODUCER","unspecified"'));
});

test('query inputs reject injection, zero identities, unapproved windows and map drift', async () => {
  await assert.rejects(renderKql('trace-reconstruct', { ...input, traceId: '0'.repeat(32) }));
  await assert.rejects(renderKql('business-lookup', { ...input, invocationId: "'; union *" }));
  await assert.rejects(renderKql('trace-reconstruct', { ...input, lookbackMinutes: -1 }));
  await assert.rejects(renderKql('trace-reconstruct', { ...input, boundaryMapSha256: hash }));
  await assert.rejects(renderKql('trace-reconstruct', { ...input, toUtc: input.fromUtc }));
});

test('actual boundary/reference keys require evidence and cannot fan out through duplicates', async () => {
  const { map } = await loadRootMap();
  const assignment = { traceId: trace, spanId: span, boundaryId: 'orders.request', evidenceSha256: hash };
  assert.throws(() => compileBoundaryBindings(map, [assignment, assignment]));
  assert.throws(() => compileBoundaryBindings(map, [{ ...assignment, boundaryId: 'invented' }]));
  const proof = { childTraceId: trace, childSpanId: span, targetTraceId: trace, targetSpanId: 'b'.repeat(16),
    relation: 'parent', classification: 'sampled', evidenceSha256: hash };
  assert.throws(() => compileBoundaryBindings(map, [], [proof, proof]));
});

test('native ID deserialization is source/role-bound and never an arbitrary GUID conversion', () => {
  assert.equal(canonicalSpanId(span, trace), span);
  assert.throws(() => canonicalSpanId(`|${trace}.${span}.`, trace));
  assert.equal(canonicalSpanId(`|${trace}.${span}.`, trace, { format: 'ai-composite', evidenceSha256: hash }), span);
  assert.throws(() => canonicalSpanId(`|${'2'.repeat(32)}.${span}.`, trace, { format: 'ai-composite', evidenceSha256: hash }));
  assert.throws(() => canonicalSpanId('0000000000000000', trace));
});

test('logs and views do not become duplicate span records; physical span duplicates remain', () => {
  const native = [
    { Type: 'AppRequests', OperationId: trace, Id: span, ParentId: '', Properties: {} },
    { Type: 'AppRequests', OperationId: trace, Id: span, ParentId: '', Properties: {} },
    { Type: 'AppTraces', OperationId: trace, ParentId: span, Properties: {} },
    { Type: 'AppExceptions', OperationId: trace, ParentId: span, Properties: {} },
    { Type: 'AppPageViews', OperationId: trace, Id: 'b'.repeat(16), ParentId: '', Properties: {} }
  ];
  const rows = normalizeTelemetryRows(native, options);
  assert.equal(rows.filter(row => row.recordKind === 'span').length, 2);
  assert.equal(rows.find(row => row.recordKind === 'log').associatedSpanId, span);
  assert(!('spanId' in rows.find(row => row.recordKind === 'log')));
  assert.equal(rows.find(row => row.recordKind === 'view').viewId, 'b'.repeat(16));
  assert(rows.every(row => row.certificationEligible === false));
});

test('links use their own trace/span context; unsupported native fields stay null', () => {
  const links = nativeLinks(JSON.stringify([{ operation_Id: '2'.repeat(32), id: 'b'.repeat(16) }]));
  assert.equal(links[0].targetTraceId, '2'.repeat(32));
  assert.equal(links[0].sampledFlag, null);
  assert.equal(links[0].linkAttributes, null);
  assert.throws(() => nativeLinks('{not-an-array}'));
  assert.throws(() => nativeLinks([{ operation_Id: trace, id: '' }]));
  assert.throws(() => nativeLinks(Array.from({ length: 33 }, () => ({ operation_Id: trace, id: span }))));
});

test('normalization requires prior privacy disposition, known source/schema and actual span identity', () => {
  const row = { Type: 'AppRequests', OperationId: trace, Id: span, ParentId: '', Properties: {} };
  assert.throws(() => normalizeTelemetryRows([row], { ...options, privacyDisposition: { result: 'FAIL', policySha256: hash } }));
  assert.throws(() => normalizeTelemetryRows([{ ...row, Type: 'requests' }], options));
  assert.throws(() => normalizeTelemetryRows([{ ...row, Id: '' }], options));
  assert.throws(() => normalizeTelemetryRows([{ ...row, OperationId: '' }], options));
});

test('sampling acknowledgements cannot turn stale RPS or a missing guard into eligible-full mode', () => {
  const expected = { layerId: 'orders', revision: 'cert-1', guardRequired: true, guardSha256: hash, eligibleFull: true };
  const ack = { schema: 'contoso.sampling-control-ack.v1', layerId: 'orders', revision: 'cert-1',
    guardPresent: true, guardSha256: hash, configSha256: hash, percentage: 100, requestsPerSecond: null,
    privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false };
  assert.equal(validateSamplingControlAck(ack, expected), ack);
  assert.throws(() => validateSamplingControlAck({ ...ack, requestsPerSecond: 5 }, expected));
  assert.throws(() => validateSamplingControlAck({ ...ack, guardPresent: false }, expected));
});
test('native link-count disagreement and legacy duration do not default to fabricated values', () => {
  assert.equal(legacyDurationMilliseconds('00:00:01.2500000'), 1250);
  assert.equal(legacyDurationMilliseconds(null), null);
  assert.throws(() => legacyDurationMilliseconds('unknown'));
  const row = { Type: 'AppRequests', OperationId: trace, Id: span, ParentId: '', Properties: {
    'contoso.link.count': 2, '_MS.links': JSON.stringify([{ operation_Id: '2'.repeat(32), id: 'b'.repeat(16) }])
  } };
  assert.throws(() => normalizeTelemetryRows([row], options));
});
