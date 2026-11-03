import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { digest } from './values.mjs';

export function jarMemberSha256(bytes, member) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count > 4096 || count === 65535) throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (name === member) {
      if ((bytes.readUInt16LE(offset + 8) & 1) || size > 1048576 ||
          local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
        throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
      const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (data + compressedSize > bytes.length) throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
      const compressed = bytes.subarray(data, data + compressedSize);
      const decoded = method === 0 ? compressed : method === 8
        ? inflateRawSync(compressed, { maxOutputLength: 1048576 }) : null;
      if (!decoded || decoded.length !== size) throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
      return digest(decoded);
    }
    offset += 46 + nameSize + extraSize + commentSize;
  }
  throw new Error('ARTIFACT_MEMBER_UNAVAILABLE');
}

function sameFileOrigin(observed, expected) {
  try {
    const actual = path.resolve(fileURLToPath(observed));
    const target = path.resolve(fileURLToPath(expected));
    return process.platform === 'win32' ? actual.toLowerCase() === target.toLowerCase() : actual === target;
  } catch { return false; }
}

export function checkUsedIdentityScope(ready, wire, expected) {
  const findings = [];
  const clients = Array.isArray(ready?.clientObservations) ? ready.clientObservations : [];
  const selected = [
    ['identity-wrapper', 'com.contoso.security.IdentityHttpClients$ContextFreeRestClient',
      expected.securityArtifactUri, expected.securityArtifactSha256, expected.wrapperMemberSha256],
    ['identity-sdk-client', 'com.azure.core.http.okhttp.OkHttpAsyncHttpClient',
      expected.sdkArtifactUri, expected.sdkArtifactSha256, expected.sdkMemberSha256]
  ];
  for (const [purpose, concreteClass, origin, artifactHash, memberHash] of selected) {
    const observed = clients.filter(client => client?.purpose === purpose);
    if (observed.length !== 1 || observed[0].concreteClass !== concreteClass ||
        observed[0].usage !== 'USED_VIA_PUBLIC_HTTP_CLIENT_SEND' ||
        typeof observed[0].classLoader !== 'string' || !observed[0].classLoader ||
        !sameFileOrigin(observed[0].codeSource, origin) ||
        observed[0].artifactSha256 !== artifactHash || observed[0].classResourceSha256 !== memberHash)
      findings.push({ code: 'USED_CLIENT_ORIGIN_UNVERIFIED', purpose });
  }

  const physicalAttempts = (wire?.jwks?.length ?? 0) + (wire?.identity?.length ?? 0);
  const logicalSends = ready?.identitySendCalls;
  if (!Number.isSafeInteger(logicalSends) || logicalSends < 2 || logicalSends > physicalAttempts)
    findings.push({ code: 'LOGICAL_SEND_WIRE_SCOPE_UNVERIFIED' });
  if (!Number.isSafeInteger(expected.childPid) || ready?.pid !== expected.childPid ||
      !Number.isFinite(Date.parse(ready?.processStartUtc)) ||
      !Number.isFinite(Date.parse(ready?.observedAtUtc)) ||
      Date.parse(ready.observedAtUtc) < Date.parse(ready.processStartUtc))
    findings.push({ code: 'CHILD_PROCESS_BINDING_UNVERIFIED' });
  return {
    verified: findings.length === 0, findings,
    logicalIdentitySendCalls: Number.isSafeInteger(logicalSends) ? logicalSends : null,
    physicalIdentityWireAttempts: physicalAttempts,
    retryLayer: 'wire-attempts-may-exceed-logical-sends-via-OkHttp-or-SDK-retry',
    broaderSourceBuildLineage: 'UNVERIFIED_BY_THIS_FINITE_CHECK'
  };
}

export function checkHeaderIsolation(ready, wire) {
  const headers = ['traceparent', 'tracestate', 'baggage', 'request-id', 'correlation-context',
    'x-business-invocation-id', 'x-business-correlation-id'];
  const jwks = Array.isArray(wire?.jwks) ? wire.jwks : [];
  const identity = Array.isArray(wire?.identity) ? wire.identity : [];
  const productionAuthHeadersAbsent = jwks.length > 0 && identity.length > 0 &&
    [...jwks, ...identity].every(row => headers.every(name => row?.[name] === false));
  const raw = Array.isArray(wire?.transportControl) ? wire.transportControl : [];
  const negativeControlObserved = raw.length > 0 && ready?.rawNativeInterceptorPresent === true &&
    raw.every(row => row?.traceparent === true && headers.filter(name => name !== 'traceparent')
      .every(name => row?.[name] === false));
  return {
    mode: 'header_isolation_only', policyVersion: 1,
    productionAuthHeadersAbsent, negativeControlObserved,
    unfilteredControlExpectation: 'native-context-present-without-public-header-isolation',
    switchHonoringClaim: 'REMOVED_INEFFECTIVE_SWITCH_NOT_CLAIMED',
    verified: productionAuthHeadersAbsent && negativeControlObserved
  };
}
