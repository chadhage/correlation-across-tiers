import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertInvariants } from '../../tools/verification/invariants.mjs';
import { projectRoot } from '../../tools/verification/files.mjs';

const map = JSON.parse(await readFile(path.join(projectRoot, 'contracts', 'expected-boundary-map.v1.json')));
const trace = 'a'.repeat(32);
const digest = 'b'.repeat(64);
const fromUtc = '2026-10-31T12:00:00.000Z';
const toUtc = '2026-10-31T12:02:00.000Z';
const business = '12345678-1234-4234-8234-123456789012';
const spanId = index => index.toString(16).padStart(16, '0');

function fixture() {
  const rows = map.coreSynchronousBoundaries.map((id, index) => {
    const boundary = map.spans.find(item => item.id === id);
    const edge = map.edges.find(item => item.to === id && ['spa', 'sync'].includes(item.path) && item.type === 'parent');
    return {
      schemaVersion: 'contoso.telemetry-evidence.v1', recordKind: 'span',
      sourceKind: 'fixture-check', traceId: trace, spanId: spanId(index + 1),
      parentSpanId: edge ? spanId(map.coreSynchronousBoundaries.indexOf(edge.from) + 1) : null,
      semanticKind: boundary.semanticKind, roleName: boundary.roleName,
      nativeTable: boundary.semanticKind === 'SERVER' ? 'AppRequests' : 'AppDependencies',
      nativeProperties: { 'business.invocation_id': business },
      timeGeneratedUtc: '2026-10-31T12:01:00.000Z',
      recordLocator: { nativeTable: 'test-only-fixture', captureId: 'fixture', rowOrdinal: index }
    };
  });
  const assignments = rows.map((row, index) => ({
    traceId: trace, spanId: row.spanId, boundaryId: map.coreSynchronousBoundaries[index],
    observed: true, evidenceSha256: digest
  }));
  return {
    map, rows, assignments, fromUtc, toUtc, mode: 'LocalValidate',
    expectation: { traceIds: [trace], paths: ['spa', 'sync'], businessInvocationId: business,
      requireBusinessOnSpans: true, boundaryCounts: Object.fromEntries(map.coreSynchronousBoundaries.map(id => [id, 1])) }
  };
}
const rejects = (value, code) => assert.throws(() => assertInvariants(value), error => error.code === code);

test('exact A/B/C fixture check never claims live or certification', () => {
  const result = assertInvariants(fixture());
  assert.equal(result.spans, 8);
  assert.equal(result.sourceAcceptanceIsCertification, false);
  const live = fixture();
  live.mode = 'Certify';
  rejects(live, 'E_FIXTURE');
});

test('empty telemetry and logs-only cannot pass', () => {
  const value = fixture();
  value.rows = [];
  rejects(value, 'A_ABSENCE');
  value.rows = [{ ...fixture().rows[0], recordKind: 'log', associatedSpanId: spanId(1) }];
  rejects(value, 'A_ABSENCE');
});

test('A fails a split, zero, or silently absent expected trace', () => {
  const split = fixture();
  split.rows[3].traceId = 'c'.repeat(32);
  rejects(split, 'A_SPLIT_TRACE');
  split.rows[3].traceId = '0'.repeat(32);
  rejects(split, 'A_SPLIT_TRACE');
  const value = fixture();
  value.expectation.traceIds.push('c'.repeat(32));
  rejects(value, 'A_SPLIT_TRACE');
});

test('B rejects duplicate emitted records, nonzero ID reuse and bad parents', () => {
  const duplicate = fixture();
  duplicate.rows.push({ ...duplicate.rows[2], recordLocator: { ...duplicate.rows[2].recordLocator, rowOrdinal: 9 } });
  rejects(duplicate, 'B_DUPLICATE_SPAN');
  const sameRecord = fixture();
  sameRecord.rows.push({ ...sameRecord.rows[2] });
  rejects(sameRecord, 'B_DUPLICATE_RECORD');
  const zero = fixture();
  zero.rows[2].spanId = '0'.repeat(16);
  rejects(zero, 'B_SPAN_ID');
  const parent = fixture();
  parent.rows[3].parentSpanId = parent.rows[1].spanId;
  rejects(parent, 'B_WRONG_EDGE');
});

test('missing Gateway request/backend hop names the actual broken boundary', () => {
  for (const boundary of ['gateway.request', 'gateway.backend']) {
    const value = fixture();
    const binding = value.assignments.find(item => item.boundaryId === boundary);
    value.rows = value.rows.filter(item => item.spanId !== binding.spanId);
    value.assignments = value.assignments.filter(item => item !== binding);
    assert.throws(() => assertInvariants(value), new RegExp(`Missing observed boundary ${boundary}`));
  }
});

test('logs/events/exceptions and page-view display IDs are not counted as new spans', () => {
  const value = fixture();
  const parent = value.rows[3];
  for (const [index, kind] of ['log', 'event', 'exception', 'view'].entries()) {
    value.rows.push({
      ...parent, recordKind: kind, associatedSpanId: parent.spanId, viewId: parent.spanId,
      recordLocator: { ...parent.recordLocator, rowOrdinal: 20 + index }
    });
  }
  const result = assertInvariants(value);
  assert.equal(result.spans, 8);
  assert.equal(result.associatedRecords, 3);
  assert.equal(result.pageViews, 1);
  value.rows[8].associatedSpanId = spanId(999);
  rejects(value, 'B_ASSOCIATION');
});

test('kind/role expectations cannot overwrite missing native facts', () => {
  const value = fixture();
  value.rows[6].semanticKind = 'SERVER';
  rejects(value, 'C_KIND');
  value.rows[6].semanticKind = 'CLIENT';
  value.rows[6].roleName = 'contoso-postgres-server';
  rejects(value, 'C_ROLE');
  value.rows[6].roleName = 'contoso-inventory-api';
  value.rows[6].nativeTable = 'AppRequests';
  rejects(value, 'C_DATA_SERVER');
});

test('APIM/non-W3C identifier substitutions are rejected, including GUID conversion', () => {
  const value = fixture();
  value.expectation.forbiddenIdentifiers = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', trace];
  rejects(value, 'C_IDENTIFIER_SUBSTITUTION');
});

function linkedFixture() {
  const value = fixture();
  const descriptors = ['fulfillment.process', 'notify.process', 'aggregator.fanin'];
  descriptors.forEach((id, index) => {
    const boundary = map.spans.find(item => item.id === id);
    const row = {
      ...value.rows[0], spanId: spanId(10 + index), parentSpanId: null,
      semanticKind: boundary.semanticKind, roleName: boundary.roleName,
      nativeTable: 'AppDependencies', nativeProperties: { 'business.invocation_id': business },
      recordLocator: { ...value.rows[0].recordLocator, rowOrdinal: 30 + index }
    };
    value.rows.push(row);
    value.assignments.push({ traceId: trace, spanId: row.spanId, boundaryId: id, evidenceSha256: digest, observed: true });
  });
  const source = value.rows[10];
  value.expectation.paths.push('fanin');
  value.expectation.requiredBoundaries = [...map.coreSynchronousBoundaries, ...descriptors];
  const contributors = [value.rows[8], value.rows[9]].map(item => ({ traceId: item.traceId, spanId: item.spanId }));
  source.nativeProperties['contoso.link.count'] = 2;
  value.expectation.linkCoverage = [{
    sourceTraceId: trace, sourceSpanId: source.spanId, contributors,
    evidenceSha256: digest, observed: true, dropped: 0
  }];
  contributors.forEach((target, index) => value.rows.push({
    ...source, recordKind: 'link', sourceTraceId: trace, sourceSpanId: source.spanId,
    targetTraceId: target.traceId, targetSpanId: target.spanId, linkIndex: index
  }));
  return value;
}

test('native fan-in links equal every contributor, not an arbitrary first parent', () => {
  const value = linkedFixture();
  assert.equal(assertInvariants(value).links, 2);
  const missing = linkedFixture();
  missing.rows.pop();
  rejects(missing, 'C_LINK_COVERAGE');
  const arbitrary = linkedFixture();
  arbitrary.rows[10].parentSpanId = arbitrary.rows[8].spanId;
  rejects(arbitrary, 'C_ARBITRARY_PARENT');
  const duplicate = linkedFixture();
  duplicate.rows[12].targetSpanId = duplicate.rows[11].targetSpanId;
  rejects(duplicate, 'C_DUPLICATE_LINK');
  const dropped = linkedFixture();
  dropped.expectation.linkCoverage[0].dropped = 1;
  rejects(dropped, 'C_LINK_COVERAGE');
});

test('actual result SEND links require independent complete ledgers, not just renamed expected roots', () => {
  const value = linkedFixture();
  const boundary = map.spans.find(item => item.id === 'fulfillment.result');
  const result = { ...value.rows[8], spanId: spanId(99), semanticKind: boundary.semanticKind,
    roleName: boundary.roleName, nativeProperties: { 'business.invocation_id': business },
    recordLocator: { ...value.rows[8].recordLocator, rowOrdinal: 99 } };
  value.rows.push(result, { ...result, recordKind: 'link', sourceTraceId: trace, sourceSpanId: result.spanId,
    targetTraceId: trace, targetSpanId: value.rows[8].spanId, linkIndex: 0 });
  value.assignments.push({ traceId: trace, spanId: result.spanId, boundaryId: boundary.id, evidenceSha256: digest, observed: true });
  value.expectation.paths.push('result-outbox');
  rejects(value, 'C_LINK_COVERAGE');
  value.expectation.linkCoverage.push({ sourceTraceId: trace, sourceSpanId: result.spanId,
    contributors: [{ traceId: trace, spanId: value.rows[8].spanId }], evidenceSha256: digest, observed: true, dropped: 0 });
  assert.equal(assertInvariants(value).links, 3);
  value.expectation.linkCoverage.at(-1).dropped = 1;
  rejects(value, 'C_LINK_COVERAGE');
});

test('map deliberate roots alone never authorize a split-trace claim', () => {
  const value = fixture();
  value.expectation.traceIds.push('d'.repeat(32));
  value.expectation.trustRoots = [{ traceId: 'd'.repeat(32), spanId: spanId(99), boundaryId: 'aggregator.fanin' }];
  rejects(value, 'A_TRUST_ROOT');
});

test('an opaque page-view display ID, even 16hex, cannot authorize missing parentage', () => {
  const value = fixture();
  value.rows[0].parentSpanId = spanId(999);
  value.rows.push({ ...value.rows[0], recordKind: 'view', viewId: spanId(999),
    recordLocator: { ...value.rows[0].recordLocator, rowOrdinal: 999 } });
  rejects(value, 'B_MISSING_PARENT');
});

test('browser context-only events require a separately observed SDK context, not a display-ID cast', () => {
  const value = fixture();
  value.rows.push({ ...value.rows[0], recordKind: 'event', associatedSpanId: null,
    recordLocator: { ...value.rows[0].recordLocator, rowOrdinal: 1000 } });
  rejects(value, 'B_ASSOCIATION');
  value.expectation.browserContexts = [{ traceId: trace, contextSpanId: null, roleName: 'contoso-storefront-spa',
    identityKind: 'sdk-browser-context-not-span', observed: true, evidenceSha256: digest }];
  assert.equal(assertInvariants(value).spans, 8);
});
