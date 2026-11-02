import { gunzipSync } from 'node:zlib';
import { TextDecoder } from 'node:util';
import { TRACE, SPAN, canonicalSpanId, requireUtc, TELEMETRY_CONTRACT_SOURCE_SHA256 } from '../observability/telemetry-contract.mjs';
import { forbiddenField, forbiddenString } from './values.mjs';

export const NATIVE_PAYLOAD_LIMIT = 1_048_576;
export const NATIVE_SCALAR_BYTE_LIMIT = 4096;
export const NATIVE_FIELD_KEY_BYTE_LIMIT = 128;
const ENVELOPE_LIMIT = 512;
const ROLE = 'contoso-av23-probe';
const HTTP_TYPES = new Set(['HTTP', 'Http']);
const ROUTES = new Map([['/identity/jwks', 'jwks'], ['/identity/token', 'managed-identity']]);
const failure = code => { throw new Error(code); };

export function decodeNativePayload(bytes, encoding) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > NATIVE_PAYLOAD_LIMIT)
    failure('NATIVE_PAYLOAD_BOUND');
  let data;
  try {
    if (encoding && !['identity', 'gzip'].includes(encoding)) failure('NATIVE_PAYLOAD_ENCODING');
    data = encoding === 'gzip' ? gunzipSync(bytes, { maxOutputLength: NATIVE_PAYLOAD_LIMIT }) : bytes;
    if (data.length > NATIVE_PAYLOAD_LIMIT) failure('NATIVE_PAYLOAD_BOUND');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    let envelopes;
    try {
      const value = JSON.parse(text);
      envelopes = Array.isArray(value) ? value : [value];
    } catch {
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length > ENVELOPE_LIMIT) failure('NATIVE_PAYLOAD_BOUND');
      envelopes = lines.map(line => JSON.parse(line));
    }
    if (!envelopes.length || envelopes.length > ENVELOPE_LIMIT ||
        envelopes.some(item => !item || typeof item !== 'object' || Array.isArray(item)))
      failure('NATIVE_ENVELOPE_SCHEMA');
    return envelopes;
  } catch (error) {
    if (/^NATIVE_[A-Z_]+$/.test(error?.message ?? '')) throw error;
    failure('NATIVE_PAYLOAD_INVALID');
  }
}

function scanOriginal(envelope, fixtureKey) {
  let fields = 0;
  function scan(value, key = '', depth = 0) {
    if (++fields > 8192 || depth > 32) failure('NATIVE_PAYLOAD_BOUND');
    if (Buffer.byteLength(key, 'utf8') > NATIVE_FIELD_KEY_BYTE_LIMIT) failure('NATIVE_FIELD_KEY_BOUND');
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > NATIVE_SCALAR_BYTE_LIMIT)
      failure('NATIVE_SCALAR_BOUND');
    if (['__proto__', 'prototype', 'constructor'].includes(key)) failure('NATIVE_PAYLOAD_UNSAFE');
    if (key === 'iKey') {
      if (value !== fixtureKey) failure('NATIVE_PUBLISHER_UNEXPECTED');
      return;
    }
    if (forbiddenField(key) || (typeof value === 'string' && forbiddenString(value)))
      failure('NATIVE_PAYLOAD_UNSAFE');
    if (value && typeof value === 'object')
      for (const [childKey, child] of Object.entries(value)) scan(child, childKey, depth + 1);
  }
  if (envelope.iKey !== fixtureKey) failure('NATIVE_PUBLISHER_UNEXPECTED');
  scan(envelope);
}

export function projectNativeClientEnvelopes(envelopes, { fixtureKey, endpoint, ordinalStart = 0 }) {
  const origin = new URL(endpoint);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/' ||
      origin.search || origin.hash || origin.username || origin.password)
    failure('NATIVE_FIXTURE_ENDPOINT_INVALID');
  const records = [];
  for (let index = 0; index < envelopes.length; index++) {
    const envelope = envelopes[index];
    scanOriginal(envelope, fixtureKey);
    if (envelope.data?.baseType !== 'RemoteDependencyData') continue;
    const data = envelope.data.baseData;
    if (!data || typeof data !== 'object') failure('NATIVE_ENVELOPE_SCHEMA');
    if (!HTTP_TYPES.has(data.type)) continue;
    let url;
    try { url = new URL(data.data); } catch { failure('NATIVE_HTTP_URL_UNVERIFIED'); }
    const route = ROUTES.get(url.pathname);
    if (!route) continue;
    if (url.origin !== origin.origin || url.username || url.password || url.hash ||
        envelope.tags?.['ai.cloud.role'] !== ROLE)
      failure('NATIVE_IDENTITY_ROUTE_UNVERIFIED');
    const traceId = envelope.tags?.['ai.operation.id'];
    let spanId, parentSpanId, time;
    try {
      spanId = canonicalSpanId(data.id, traceId);
      parentSpanId = canonicalSpanId(envelope.tags?.['ai.operation.parentId'], traceId);
      time = requireUtc(envelope.time, 'native event time');
    } catch { failure('NATIVE_ID_SERIALIZATION_UNVERIFIED'); }
    if (!TRACE.test(traceId ?? '') || !SPAN.test(spanId ?? '') || !SPAN.test(parentSpanId ?? ''))
      failure('NATIVE_ID_SERIALIZATION_UNVERIFIED');
    records.push({
      nativeEnvelopeOrdinal: ordinalStart + index,
      route, nativeBaseType: envelope.data.baseType, nativeDependencyType: data.type,
      nativeRoleName: envelope.tags['ai.cloud.role'],
      nativeTraceId: traceId, nativeSpanId: data.id,
      nativeParentId: envelope.tags['ai.operation.parentId'],
      traceId, spanId, parentSpanId, nativeTimeUtc: time
    });
  }
  return records;
}

function assessIdentityClientOutput(records, ready, wire, failures = []) {
  const findings = [...failures].map(code => ({ code }));
  const root = ready?.actualRootContext;
  const validRoot = TRACE.test(root?.traceId ?? '') && SPAN.test(root?.spanId ?? '') &&
    ready?.providerActive === true;
  if (!validRoot) findings.push({ code: 'NATIVE_ACTUAL_ROOT_UNVERIFIED' });
  const from = Date.parse(ready?.processStartUtc);
  const to = Date.parse(ready?.observedAtUtc);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
    findings.push({ code: 'NATIVE_CLIENT_WINDOW_UNVERIFIED' });
  const seen = new Set();
  for (const record of records) {
    if (!ROUTES.has(record.route === 'jwks' ? '/identity/jwks' :
        record.route === 'managed-identity' ? '/identity/token' : '') ||
        record.nativeBaseType !== 'RemoteDependencyData' || !HTTP_TYPES.has(record.nativeDependencyType) ||
        record.nativeRoleName !== ROLE || !TRACE.test(record.traceId ?? '') ||
        !SPAN.test(record.spanId ?? '') || !SPAN.test(record.parentSpanId ?? '') ||
        record.nativeTraceId !== record.traceId || record.nativeSpanId !== record.spanId ||
        record.nativeParentId !== record.parentSpanId)
      findings.push({ code: 'NATIVE_CLIENT_RECORD_UNVERIFIED' });
    if (seen.has(record.spanId)) findings.push({ code: 'NATIVE_CLIENT_DUPLICATE' });
    seen.add(record.spanId);
    if (!validRoot || record.traceId !== root.traceId || record.parentSpanId !== root.spanId ||
        record.spanId === root.spanId || Date.parse(record.nativeTimeUtc) < from ||
        Date.parse(record.nativeTimeUtc) > to)
      findings.push({ code: 'NATIVE_CLIENT_ROOT_PARENT_UNVERIFIED' });
  }
  const counts = {
    jwks: records.filter(record => record.route === 'jwks').length,
    managedIdentity: records.filter(record => record.route === 'managed-identity').length
  };
  if (counts.jwks === 0 || counts.managedIdentity === 0 ||
      !(wire?.jwks?.length > 0) || !(wire?.identity?.length > 0))
    findings.push({ code: 'NATIVE_IDENTITY_CLIENT_OUTPUT_ABSENT' });
  return {
    schema: 'contoso.identity-client-output.v1',
    originalScanPolicyVersion: 2,
    originalScalarByteLimit: NATIVE_SCALAR_BYTE_LIMIT,
    originalFieldKeyByteLimit: NATIVE_FIELD_KEY_BYTE_LIMIT,
    sourceKind: 'native-envelope-projection-requires-executed-helper-binding',
    assessmentScope: 'actual-native-HTTP-identity-CLIENT-outputs-directly-under-observed-in-app-root-not-full-export-completeness',
    verified: findings.length === 0, findings,
    actualRootContext: validRoot ? { traceId: root.traceId, spanId: root.spanId } : null,
    nativeIdentityClientSpanCounts: counts,
    logicalIdentitySendCalls: ready?.identitySendCalls ?? null,
    physicalIdentityWireAttempts: (wire?.jwks?.length ?? 0) + (wire?.identity?.length ?? 0),
    spanCountsEqualPhysicalAttemptsClaimed: false,
    nativeIdSerialization: 'strict-native-nonzero-W3C-hex-no-arbitrary-conversion',
    parserContractSha256: TELEMETRY_CONTRACT_SOURCE_SHA256,
    safeNativeClientProjection: records.map(record => ({ ...record })),
    rawPayloadRetained: false,
    globalRawTelemetrySafetyVerified: false,
    fullExporterCompletenessVerified: false,
    independentProducerAuthorityVerified: false,
    certification: 'NOT_CERTIFIED'
  };
}

export function createIdentityClientCollector(configuration) {
  const records = [];
  const failures = [];
  let envelopesReceived = 0, payloadsReceived = 0, compressedBytes = 0;
  return {
    reject(code) {
      if (!/^NATIVE_[A-Z_]+$/.test(code)) code = 'NATIVE_RECEIVER_INCOMPLETE';
      if (!failures.includes(code)) failures.push(code);
    },
    ingest(bytes, encoding) {
      try {
        compressedBytes += bytes.length;
        if (++payloadsReceived > 64 || compressedBytes > 4 * NATIVE_PAYLOAD_LIMIT)
          failure('NATIVE_PAYLOAD_BOUND');
        const envelopes = decodeNativePayload(bytes, encoding);
        if (envelopesReceived + envelopes.length > ENVELOPE_LIMIT) failure('NATIVE_PAYLOAD_BOUND');
        const projected = projectNativeClientEnvelopes(envelopes,
          { ...configuration, ordinalStart: envelopesReceived });
        envelopesReceived += envelopes.length;
        records.push(...projected);
        return { itemsReceived: envelopes.length, itemsAccepted: envelopes.length, errors: [] };
      } catch (error) {
        const code = /^NATIVE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'NATIVE_PAYLOAD_INVALID';
        if (!failures.includes(code)) failures.push(code);
        return null;
      }
    },
    assess(ready, wire) {
      return { ...assessIdentityClientOutput(records, ready, wire, failures),
        nativePayloadsReceived: payloadsReceived, nativeEnvelopesReceived: envelopesReceived };
    }
  };
}
