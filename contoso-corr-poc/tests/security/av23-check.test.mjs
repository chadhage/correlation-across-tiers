import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUsedIdentityScope, jarMemberSha256, checkHeaderIsolation } from '../../tools/security/av23-check.mjs';
import { digest } from '../../tools/security/values.mjs';

function fixture() {
  const expected = {
    securityArtifactUri: 'file:///C:/contoso-fixture/security-core.jar',
    securityArtifactSha256: 'a'.repeat(64), wrapperMemberSha256: 'b'.repeat(64),
    sdkArtifactUri: 'file:///C:/contoso-fixture/azure-core-http-okhttp.jar',
    sdkArtifactSha256: 'c'.repeat(64), sdkMemberSha256: 'd'.repeat(64), childPid: 123
  };
  const ready = {
    pid: 123, processStartUtc: '2026-11-01T16:00:00Z', observedAtUtc: '2026-11-01T16:00:01Z',
    identitySendCalls: 2,
    clientObservations: [
      { purpose: 'identity-wrapper', concreteClass: 'com.contoso.security.IdentityHttpClients$ContextFreeRestClient',
        classLoader: 'fixture-loader', codeSource: expected.securityArtifactUri,
        artifactSha256: expected.securityArtifactSha256, classResourceSha256: expected.wrapperMemberSha256,
        usage: 'USED_VIA_PUBLIC_HTTP_CLIENT_SEND' },
      { purpose: 'identity-sdk-client', concreteClass: 'com.azure.core.http.okhttp.OkHttpAsyncHttpClient',
        classLoader: 'fixture-loader', codeSource: expected.sdkArtifactUri,
        artifactSha256: expected.sdkArtifactSha256, classResourceSha256: expected.sdkMemberSha256,
        usage: 'USED_VIA_PUBLIC_HTTP_CLIENT_SEND' }
    ]
  };
  return { ready, expected, wire: { jwks: [{}], identity: [{}, {}] } };
}

test('finite USED scope permits logical sends fewer than actual 503 wire attempts', () => {
  const { ready, wire, expected } = fixture();
  const result = checkUsedIdentityScope(ready, wire, expected);
  assert.equal(result.verified, true);
  assert.equal(result.logicalIdentitySendCalls, 2);
  assert.equal(result.physicalIdentityWireAttempts, 3);
  assert.equal(result.broaderSourceBuildLineage, 'UNVERIFIED_BY_THIS_FINITE_CHECK');
});

test('R2 missing clients/send-zero counter cannot qualify identity-used scope', () => {
  const { ready, wire, expected } = fixture();
  ready.clientObservations = [];
  ready.identitySendCalls = 0;
  const result = checkUsedIdentityScope(ready, wire, expected);
  assert.equal(result.verified, false);
  assert(result.findings.some(value => value.code === 'USED_CLIENT_ORIGIN_UNVERIFIED'));
  assert(result.findings.some(value => value.code === 'LOGICAL_SEND_WIRE_SCOPE_UNVERIFIED'));
});

test('old package, class-resource, creation-only or different original child all fail', () => {
  for (const mutate of [
    ready => { ready.clientObservations[0].artifactSha256 = 'e'.repeat(64); },
    ready => { ready.clientObservations[0].classResourceSha256 = 'e'.repeat(64); },
    ready => { ready.clientObservations[0].codeSource = 'file:///C:/contoso-fixture/old-security-core.jar'; },
    ready => { ready.clientObservations[1].usage = 'CREATED_ONLY'; },
    ready => { ready.pid = 456; }
  ]) {
    const { ready, wire, expected } = fixture();
    mutate(ready);
    assert.equal(checkUsedIdentityScope(ready, wire, expected).verified, false);
  }
});

test('JAR member hash is derived from exact bytes, missing/truncated archive fails closed', () => {
  const name = Buffer.from('fixture/Member.class');
  const member = Buffer.from('synthetic-class-member');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(member.length, 18);
  local.writeUInt32LE(member.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(member.length, 20);
  central.writeUInt32LE(member.length, 24);
  central.writeUInt16LE(name.length, 28);
  const first = Buffer.concat([local, name, member]);
  const directory = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(first.length, 16);
  const archive = Buffer.concat([first, directory, end]);
  assert.equal(jarMemberSha256(archive, name.toString()), digest(member));
  assert.throws(() => jarMemberSha256(archive, 'missing'), /ARTIFACT_MEMBER_UNAVAILABLE/);
  assert.throws(() => jarMemberSha256(Buffer.alloc(10), name.toString()), /ARTIFACT_MEMBER_UNAVAILABLE/);
});

test('user-selected header isolation preserves raw native negative-control observations', () => {
  const row = { traceparent: false, tracestate: false, baggage: false, 'request-id': false,
    'correlation-context': false, 'x-business-invocation-id': false, 'x-business-correlation-id': false };
  const wire = { jwks: [{ ...row }], identity: [{ ...row }, { ...row }],
    transportControl: [{ ...row, traceparent: true }] };
  const result = checkHeaderIsolation({ rawNativeInterceptorPresent: true }, wire);
  assert.equal(result.verified, true);
  assert.equal(result.productionAuthHeadersAbsent, true);
  assert.equal(result.negativeControlObserved, true);
  assert.equal(wire.transportControl[0].traceparent, true);
  for (const name of Object.keys(row)) {
    wire.identity[1][name] = true;
    assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: true }, wire).verified, false, name);
    wire.identity[1][name] = false;
  }
  assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: false }, wire).verified, false);
});

test('empty identity receipts or silently greened raw control never pass', () => {
  assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: true }, {}).verified, false);
  const row = { traceparent: false, tracestate: false, baggage: false, 'request-id': false,
    'correlation-context': false, 'x-business-invocation-id': false, 'x-business-correlation-id': false };
  assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: true },
    { jwks: [{ ...row }], identity: [{ ...row }], transportControl: [{ ...row }] }).verified, false);
  assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: true },
    { jwks: [{ ...row }], identity: [], transportControl: [{ ...row, traceparent: true }] }).verified, false);
  const omitted = { ...row };
  delete omitted.tracestate;
  assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: true },
    { jwks: [omitted], identity: [{ ...row }], transportControl: [{ ...row, traceparent: true }] }).verified, false);
  assert.equal(checkHeaderIsolation({ rawNativeInterceptorPresent: true },
    { jwks: [{ ...row }], identity: [{ ...row }], transportControl: [] }).verified, false);
});
