import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { classifyVerifiedTrustRoots, requireClassifiedTrustRootBindings } from '../../tools/verification/trust-roots.mjs';
import { assertInvariants } from '../../tools/verification/invariants.mjs';
import { nativeEvidenceHash, projectRoot } from '../../tools/verification/files.mjs';

const originalMap = JSON.parse(await readFile(path.join(projectRoot, 'contracts', 'expected-boundary-map.v1.json')));
const hash = 'd'.repeat(64);
const id = index => index.toString(16).padStart(16, '0');

function fixture(disposition = 'absent') {
  const map = structuredClone(originalMap);
  map.conditionalRoots = [{ boundary: 'gateway.request', allowedDispositions: ['absent', 'duplicate', 'invalid'], policyRef: 'ADR-A03' }];
  const rows = map.coreSynchronousBoundaries.map((boundary, ordinal) => {
    const definition = map.spans.find(item => item.id === boundary);
    const edge = map.edges.find(item => item.to === boundary && item.type === 'parent' && ['spa', 'sync'].includes(item.path));
    return {
      schemaVersion: 'contoso.telemetry-evidence.v1', sourceKind: 'fixture-check', recordKind: 'span',
      traceId: (ordinal === 0 ? 'a' : 'b').repeat(32), spanId: id(ordinal + 1),
      parentSpanId: ordinal === 1 ? null : edge ? id(map.coreSynchronousBoundaries.indexOf(edge.from) + 1) : null,
      roleName: definition.roleName, semanticKind: definition.semanticKind,
      nativeTable: definition.semanticKind === 'SERVER' ? 'AppRequests' : 'AppDependencies',
      nativeProperties: {}, timeGeneratedUtc: '2026-10-31T12:01:00.000Z',
      recordLocator: { captureId: 'fixture-only', nativeTable: 'fixture-only', rowOrdinal: ordinal }
    };
  });
  const wire = { schema: 'contoso.native-carrier-disposition.v1', disposition,
    traceId: rows[1].traceId, spanId: rows[1].spanId, traceparentFieldCount: disposition === 'duplicate' ? 2 : 0,
    validTraceparent: false, validTrustedParent: false };
  const receipt = { schema: 'contoso.native-trust-root.v1', boundaryId: 'gateway.request',
    traceId: rows[1].traceId, spanId: rows[1].spanId, parentSpanId: null, disposition,
    policyRef: 'ADR-A03', technicalContextRestarted: true, invalidTracestateOnly: false,
    carrierEvidenceSha256: nativeEvidenceHash(wire) };
  const root = { boundaryId: 'gateway.request', traceId: rows[1].traceId, spanId: rows[1].spanId,
    disposition, reason: 'Explicit fixture A03 receipt, not Azure proof', observed: true, evidenceSha256: nativeEvidenceHash(receipt) };
  const proofs = [
    { kind: 'native-wire', sourceKind: 'fixture-check', value: wire, sha256: nativeEvidenceHash(wire) },
    { kind: 'native-runtime', sourceKind: 'fixture-check', value: receipt, sha256: nativeEvidenceHash(receipt) }
  ];
  const input = {
    map, rows, mode: 'LocalValidate', fromUtc: '2026-10-31T12:00:00.000Z', toUtc: '2026-10-31T12:02:00.000Z',
    assignments: rows.map((row, ordinal) => ({ traceId: row.traceId, spanId: row.spanId,
      boundaryId: map.coreSynchronousBoundaries[ordinal], observed: true, evidenceSha256: hash })),
    expectation: { traceIds: ['a'.repeat(32), 'b'.repeat(32)], paths: ['spa', 'sync'], trustRoots: [root],
      independentCohorts: ['a', 'b'].map(letter => ({ traceId: letter.repeat(32), observed: true, evidenceSha256: hash, reason: 'Fixture cohort' })) }
  };
  return { input, root, proofs, receipt, wire };
}

const classify = value => classifyVerifiedTrustRoots({
  map: value.input.map, rows: value.input.rows, requests: [value.root], proofArtifacts: value.proofs, mode: 'LocalValidate'
});

test('missing/forged receipt or disposition cannot waive parentage even if map labels root', () => {
  const value = fixture();
  assert.throws(() => assertInvariants(value.input), /Broken actual parent edge/);
  value.input.trustRootClassification = { verified: true };
  assert.throws(() => assertInvariants(value.input), /Broken actual parent edge/);
  const missing = fixture();
  missing.proofs = [];
  assert.throws(() => classify(missing), /Missing\/forged/);
  const wrong = fixture('valid');
  assert.throws(() => classify(wrong), /Exact source-defined/);
});

test('only precise verified absent/duplicate/invalid classification permits the deliberate null-parent boundary', () => {
  for (const disposition of ['absent', 'duplicate', 'invalid']) {
    const value = fixture(disposition);
    value.input.trustRootClassification = classify(value);
    assert.equal(assertInvariants(value.input).result, 'PASS');
  }
});

test('valid trusted sampled golden-path missing downstream edges still fail with a permitted ingress root', () => {
  const value = fixture();
  value.input.trustRootClassification = classify(value);
  value.input.rows[3].parentSpanId = id(999);
  assert.throws(() => assertInvariants(value.input), /Broken actual parent edge/);
});

test('invalid tracestate-only, valid parent, non-null parent and fabricated native capability never qualify', () => {
  const stateOnly = fixture();
  stateOnly.receipt.invalidTracestateOnly = true;
  stateOnly.proofs[1].sha256 = nativeEvidenceHash(stateOnly.receipt);
  stateOnly.root.evidenceSha256 = stateOnly.proofs[1].sha256;
  assert.throws(() => classify(stateOnly), /Missing\/forged/);
  const valid = fixture();
  valid.wire.validTrustedParent = true;
  valid.proofs[0].sha256 = nativeEvidenceHash(valid.wire);
  valid.receipt.carrierEvidenceSha256 = valid.proofs[0].sha256;
  valid.proofs[1].sha256 = nativeEvidenceHash(valid.receipt);
  valid.root.evidenceSha256 = valid.proofs[1].sha256;
  assert.throws(() => classify(valid), /precise conditional root/);
  const native = fixture();
  assert.throws(() => classifyVerifiedTrustRoots({ map: native.input.map, rows: native.input.rows,
    requests: [native.root], proofArtifacts: native.proofs, mode: 'Certify', observerCapability: { verified: true } }), /Caller JSON/);
});

test('sealed binding getter retains exact checked disposition/policy/carrier/locator, never caller rereads', () => {
  const value = fixture();
  const capability = classify(value);
  value.root.disposition = 'valid';
  value.receipt.policyRef = 'changed-after-validation';
  const result = requireClassifiedTrustRootBindings(capability, { map: value.input.map, rows: value.input.rows, mode: 'LocalValidate' });
  assert.equal(result.checkerOnly, true);
  assert.equal(result.actualSourceVerified, false);
  assert.equal(result.nativeRuntimeCarrierObserverEnrolled, false);
  assert.equal(result.roots[0].disposition, 'absent');
  assert.equal(result.roots[0].policyRef, 'ADR-A03');
  assert.equal(result.roots[0].sourceLocator.captureId, 'fixture-only');
  assert.equal(result.roots[0].carrierEvidenceSha256, nativeEvidenceHash(value.wire));
  assert.ok(Object.isFrozen(result.roots[0].sourceLocator));
  assert.throws(() => { result.roots[0].sourceLocator.rowOrdinal = 100; }, TypeError);
});

test('cloned capabilities, map/row/locator drift and getter values cannot provide root bindings', () => {
  const value = fixture();
  const capability = classify(value);
  const options = { map: value.input.map, rows: value.input.rows, mode: 'LocalValidate' };
  assert.throws(() => requireClassifiedTrustRootBindings({ verified: true }, options), /Private original/);
  assert.throws(() => requireClassifiedTrustRootBindings(JSON.parse(JSON.stringify(capability)), options), /Private original/);
  const changedMap = structuredClone(value.input.map);
  changedMap.conditionalRoots[0].policyRef = 'wrong';
  assert.throws(() => requireClassifiedTrustRootBindings(capability, { ...options, map: changedMap }), /drift/);
  const changedRows = structuredClone(value.input.rows);
  changedRows[1].recordLocator.rowOrdinal++;
  assert.throws(() => requireClassifiedTrustRootBindings(capability, { ...options, rows: changedRows }), /drift/);
  let reads = 0;
  const getterMap = structuredClone(value.input.map);
  Object.defineProperty(getterMap, 'conditionalRoots', { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => requireClassifiedTrustRootBindings(capability, { ...options, map: getterMap }), /accessors/);
  assert.equal(reads, 0);
});
