import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalNativeAsync, checkLocalNativeCorrespondence, describeOwnedRuntimeClasspath } from '../../tools/verification/local-native.mjs';

const fixture = () => {
  const properties = { 'contoso.span.kind': 'INTERNAL', 'business.invocation_id': '11111111-1111-4111-8111-111111111111',
    '_MS.links': JSON.stringify([{ operation_Id: 'c'.repeat(32), id: 'd'.repeat(16) }]), 'contoso.link.count': '1' };
  const span = { name: 'actual.local.name', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16),
    parentSpanId: '', kind: 'INTERNAL', roleName: 'contoso-fulfillment-worker',
    businessInvocationId: properties['business.invocation_id'], messageId: '', attempt: '',
    links: JSON.parse(properties['_MS.links']) };
  return { proof: { schemaVersion: 1, evidenceKind: 'real-local-agent-loopback', certified: false,
    agentSha256: 'e'.repeat(64), spans: [span] },
  inspection: [{ name: span.name, traceId: span.traceId, id: span.spanId, parentId: '', properties }] };
};

test('a caller file/hash/origin/boolean cannot forge the actual local-native source capability', () => {
  assert.throws(() => assertLocalNativeAsync({
    sourceKind: 'real-local-agent-loopback', verified: true, spans: [], proofSha256: 'a'.repeat(64)
  }), error => error.code === 'E_LOCAL_AUTHORITY');
});

test('local record correspondence is checker-only and immutable, not an execution capability', () => {
  const { proof, inspection } = fixture();
  const result = checkLocalNativeCorrespondence(proof, inspection, proof.agentSha256);
  assert.equal(result.checkerOnly, true);
  assert.equal(result.sourceAcceptanceIsCertification, false);
  assert.throws(() => assertLocalNativeAsync(result), error => error.code === 'E_LOCAL_AUTHORITY');
  inspection[0].properties['business.invocation_id'] = '22222222-2222-4222-8222-222222222222';
  assert.equal(result.spans[0].businessInvocationId, '11111111-1111-4111-8111-111111111111');
  assert.throws(() => { result.spans[0].links[0].id = 'f'.repeat(16); }, TypeError);
});

test('local native correspondence rejects missing, added and repeated emitted spans', () => {
  const { proof, inspection } = fixture();
  for (const rows of [[], [...inspection, ...inspection]]) {
    assert.throws(() => checkLocalNativeCorrespondence(proof, rows, proof.agentSha256), /Complete current/);
  }
  const doubled = { ...proof, spans: [...proof.spans, ...proof.spans] };
  assert.throws(() => checkLocalNativeCorrespondence(doubled, [...inspection, ...inspection], proof.agentSha256), /repeated\/invalid/);
  assert.throws(() => checkLocalNativeCorrespondence(proof, inspection, 'f'.repeat(64)), /Complete current/);
});

test('both declared worker roles are preserved, never filled from configuration or claimed sidecar-verified', () => {
  for (const role of ['contoso-fulfillment-worker', 'contoso-notify-worker']) {
    const { proof, inspection } = fixture();
    proof.spans[0].roleName = role;
    const result = checkLocalNativeCorrespondence(proof, inspection, proof.agentSha256);
    assert.equal(result.spans[0].roleName, role);
    assert.equal(result.independentlyVerifiedNativeRoles, false);
    assert.equal(result.roleCorrespondence, 'PRESERVED_PROOF_ROLES_NO_ROLE_COLUMN_IN_SIDECAR');
    assert.throws(() => assertLocalNativeAsync(result), /authority/);
  }
  for (const role of [undefined, 'contoso-inventory-api', 'configuredRole']) {
    const { proof, inspection } = fixture();
    proof.spans[0].roleName = role;
    assert.throws(() => checkLocalNativeCorrespondence(proof, inspection, proof.agentSha256), /E_LOCAL_NATIVE_IDENTITY/);
  }
});
test('local native proof cannot change actual names, parents, attempts or native links', () => {
  for (const mutate of [
    value => { value.proof.spans[0].name = 'expected.invented.name'; },
    value => { value.proof.spans[0].parentSpanId = 'f'.repeat(16); },
    value => { value.proof.spans[0].attempt = '1'; },
    value => { value.proof.spans[0].links[0].id = 'f'.repeat(16); },
    value => { value.inspection[0].properties['_MS.links'] = '{}'; },
    value => { value.inspection[0].properties['_MS.links'] = 'invalid'; },
    value => { value.inspection[0].properties['contoso.link.count'] = '2'; }
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => checkLocalNativeCorrespondence(value.proof, value.inspection, value.proof.agentSha256), /E_LOCAL_NATIVE_/);
  }
});

test('local native links reject duplicates, self-link and over-bound representations', () => {
  for (const links of [
    [{ operation_Id: 'c'.repeat(32), id: 'd'.repeat(16) }, { operation_Id: 'c'.repeat(32), id: 'd'.repeat(16) }],
    [{ operation_Id: 'a'.repeat(32), id: 'b'.repeat(16) }],
    Array.from({ length: 33 }, (_, index) => ({ operation_Id: 'c'.repeat(32), id: (index + 1).toString(16).padStart(16, '0') }))
  ]) {
    const { proof, inspection } = fixture();
    proof.spans[0].links = links;
    inspection[0].properties['_MS.links'] = JSON.stringify(links);
    inspection[0].properties['contoso.link.count'] = String(links.length);
    assert.throws(() => checkLocalNativeCorrespondence(proof, inspection, proof.agentSha256), /E_LOCAL_NATIVE_LINK/);
  }
});

test('owned installed library classpath is explicit but never a current-source/build qualification', () => {
  const cp = 'C:\\approved\\m2\\contoso-correlation-core-1.0.0.jar;C:\\approved\\m2\\inventory-data-1.0.0.jar';
  const result = describeOwnedRuntimeClasspath(`<property name="java.class.path" value="${cp}"/>`);
  assert.equal(result.sourceExecutionBinding, 'UNVERIFIED');
  assert.equal(result.currentSourceQualification, false);
  assert.equal(result.loadedCodeSourceVerified, false);
  assert.equal(result.ownedLibraries.length, 2);
  assert.throws(() => { result.currentSourceQualification = true; }, TypeError);
});

test('missing, duplicated or relative owned library classpaths fail without a build-lineage guess', () => {
  for (const cp of ['', 'inventory-data-1.0.0.jar',
    'C:\\m2\\contoso-correlation-core-1.0.0.jar;C:\\m2\\contoso-correlation-core-2.0.0.jar;C:\\m2\\inventory-data-1.0.0.jar']) {
    assert.throws(() => describeOwnedRuntimeClasspath(`<property name="java.class.path" value="${cp}"/>`),
      error => error.code === 'E_LOCAL_BINARY_EVIDENCE');
  }
});
