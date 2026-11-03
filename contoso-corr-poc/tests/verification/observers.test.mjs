import assert from 'node:assert/strict';
import test from 'node:test';
import { immutableReceiptMetadata, requireVerifiedQueryReceiptIdentity, validateNativeResponseBindings, validateObserverSourceClosure, verifyCapturedQueryCapabilities, verifyObservedAssignments, verifyQueryExecutorReceipt } from '../../tools/verification/observers.mjs';
import { nativeEvidenceHash } from '../../tools/verification/files.mjs';

test('source/binary hashes alone cannot enroll an actual Azure observer', async () => {
  const receipt = { schema: 'contoso.query-executor-code-receipt.v1', sourceKind: 'azure-monitor-logs',
    observerId: 'pretend-native', azureCliExecutableSha256: 'a'.repeat(64) };
  await assert.rejects(verifyQueryExecutorReceipt(receipt, {
    registry: { schema: 'contoso.verification-observer-registry.v1', observers: [], sourceAcceptanceIsCertification: false },
    currentSources: [], mode: 'Certify', scope: {}
  }), error => error.code === 'E_UNTRUSTED_OBSERVER');
  assert.equal((await verifyQueryExecutorReceipt({ sourceKind: 'fixture-check' }, { mode: 'LocalValidate' })).certificationEligible, false);
  assert.throws(() => requireVerifiedQueryReceiptIdentity({ verified: true, phase: 'post-query', provenanceVerified: true }), /Caller JSON/);
});

test('authoritative observer source closure rejects omitted/duplicate/changed dependencies', () => {
  const sources = [{ path: 'tools\\observability\\raw-query.mjs', sha256: 'a'.repeat(64) },
    { path: 'tools\\observability\\telemetry-contract.mjs', sha256: 'b'.repeat(64) }];
  assert.equal(validateObserverSourceClosure({ codeFiles: sources }, { codeFiles: sources }, sources).sourceAcceptanceIsCertification, false);
  assert.throws(() => validateObserverSourceClosure({ codeFiles: sources.slice(0, 1) }, { codeFiles: sources }, sources), /Exact authoritative/);
  assert.throws(() => validateObserverSourceClosure({ codeFiles: [sources[0], sources[0]] }, { codeFiles: sources }, sources), /Duplicate/);
  assert.throws(() => validateObserverSourceClosure({ codeFiles: sources }, { codeFiles: sources }, [sources[0], { ...sources[1], sha256: 'c'.repeat(64) }]), /changed/);
});

test('private-response structure must bind exact actual query, resource, workspace and content', () => {
  const scope = { workspaceId: 'actual-workspace', resourceId: 'actual-resource' };
  const identity = { ...scope, sourceKind: 'azure-monitor-logs', transport: 'pinned-azure-cli-native-stdout',
    querySha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), observedAtUtc: new Date().toISOString() };
  const options = { scope, queries: [{ querySha256: identity.querySha256 }] };
  assert.equal(validateNativeResponseBindings([identity], options).sourceAcceptanceIsCertification, false);
  for (const changed of [{ ...identity, resourceId: 'other-resource' }, { ...identity, workspaceId: 'other-workspace' },
    { ...identity, querySha256: 'c'.repeat(64) }, { ...identity, responseSha256: null }]) {
    assert.throws(() => validateNativeResponseBindings([changed], options), /differs/);
  }
  assert.throws(() => validateNativeResponseBindings([{ ...identity, observedAtUtc: '2026-01-01T00:00:00.000Z' }], options), /bounded verification window/);
  assert.throws(() => requireVerifiedQueryReceiptIdentity({ verified: true, nativeResponseVerified: true,
    nativeHttpStatus: 200, nativeRequestId: 'fake', authenticatedPeerVerified: true }), /Caller JSON/);
});

test('persisted caller JSON cannot replace an original private post-query capability', () => {
  assert.throws(() => verifyCapturedQueryCapabilities([{ verified: true, phase: 'post-query', sourceOriginVerified: true,
    nativeResponseVerified: true, authenticatedPeerVerified: true, querySha256: 'a'.repeat(64) }], {
    scope: { workspaceId: 'actual', resourceId: 'actual' }, queries: [{ querySha256: 'a'.repeat(64) }]
  }), /Caller JSON/);
});

test('receipt metadata snapshots cannot alias caller scope or getter-copy nested objects', () => {
  const source = { scope: { workspaceId: 'original', resourceId: 'original-resource' },
    queries: [{ querySha256: 'a'.repeat(64) }] };
  const stored = immutableReceiptMetadata(source);
  source.scope.workspaceId = 'mutated';
  source.queries[0].querySha256 = 'b'.repeat(64);
  assert.equal(stored.scope.workspaceId, 'original');
  assert.equal(stored.queries[0].querySha256, 'a'.repeat(64));
  assert.throws(() => { stored.scope.workspaceId = 'changed'; }, TypeError);
  const getterCopy = immutableReceiptMetadata(stored);
  assert.notEqual(getterCopy.scope, stored.scope);
  assert.throws(() => { getterCopy.scope.resourceId = 'changed'; }, TypeError);
  assert.equal(stored.scope.resourceId, 'original-resource');
});

test('observed assignment locators/digests bind the actual native trace/span, never the expected map', () => {
  const raw = { nativeTable: 'AppRequests', OperationId: 'a'.repeat(32), Id: 'b'.repeat(16), AppRoleName: 'contoso-orders-api' };
  const digest = nativeEvidenceHash(raw);
  const assignment = { traceId: raw.OperationId, spanId: raw.Id, boundaryId: 'orders.request', observed: true,
    evidenceSha256: digest, sourceLocator: { captureId: 'test-only', nativeTable: 'AppRequests', rowOrdinal: 0 } };
  const input = {
    rawRows: [raw], normalizedRows: [{ recordKind: 'span', traceId: raw.OperationId, spanId: raw.Id,
      nativeTable: 'AppRequests', recordLocator: { captureId: 'test-only', rowOrdinal: 0 } }],
    receipt: { captureId: 'test-only', sourceKind: 'fixture-check' },
    proofArtifacts: [{ kind: 'native-row', value: raw, sha256: digest, sourceKind: 'fixture-check' }]
  };
  assert.equal(verifyObservedAssignments([assignment], input), true);
  assert.throws(() => verifyObservedAssignments([{ ...assignment, spanId: 'c'.repeat(16) }], input), /cannot replace/);
  assert.throws(() => verifyObservedAssignments([{ ...assignment, evidenceSha256: 'd'.repeat(64) }], input), /cannot replace/);
  assert.throws(() => verifyObservedAssignments([{ ...assignment, sourceLocator: { ...assignment.sourceLocator, rowOrdinal: 1 } }], input), /locator/);
});
