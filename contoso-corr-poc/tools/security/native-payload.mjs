import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { digest, forbiddenField, forbiddenString, PSEUDONYM, UUID4 } from './values.mjs';

export const NATIVE_LIMITS = Object.freeze({
  payloadBytes: 1_048_576,
  decodedPayloadBytes: 1_048_576,
  payloads: 16,
  sessionPayloads: 128,
  totalRawBytes: 16_777_216,
  totalDecodedBytes: 16_777_216,
  envelopesPerPayload: 512,
  totalEnvelopes: 8192,
  depth: 32,
  fieldKeyBytes: 128,
  scalarBytes: 4096,
  fieldsPerEnvelope: 8192,
  parsedNodesPerPayload: 131072,
  totalParsedNodes: 1_048_576,
  publisherKeys: 16,
  forbiddenValues: 64,
  forbiddenValueBytes: 16384,
  totalForbiddenValueBytes: 65536,
  inputBytes: 33_554_432
});
export const NATIVE_POLICY_SOURCE_SHA256 = digest(readFileSync(fileURLToPath(import.meta.url)));
export const SHARED_VALUE_POLICY_SHA256 = digest(readFileSync(new URL('./values.mjs', import.meta.url)));
const USER_TAGS = new Set(['ai.user.id', 'ai.user.authUserId', 'user.id', 'enduser.id']);
const REMOVED_TAGS = ['ai.cloud.roleInstance', 'ai.user.id', 'ai.user.authUserId', 'ai.location.ip'];
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ERROR_CODES = new Set([
  'NATIVE_CAPTURE_SCHEMA', 'NATIVE_CAPTURE_BOUND', 'NATIVE_CAPTURE_TIMEOUT', 'NATIVE_PAYLOAD_BOUND', 'NATIVE_PAYLOAD_ENCODING',
  'NATIVE_PAYLOAD_INVALID', 'NATIVE_JSON_INVALID', 'NATIVE_JSON_DUPLICATE_KEY', 'NATIVE_ENVELOPE_SCHEMA',
  'NATIVE_DEPTH_BOUND', 'NATIVE_FIELD_KEY_BOUND', 'NATIVE_SCALAR_BOUND', 'NATIVE_FIELD_COUNT_BOUND',
  'NATIVE_TOTAL_BOUND', 'NATIVE_PUBLISHER_UNEXPECTED', 'NATIVE_MARKER_PUBLISHER_CONFLICT',
  'NATIVE_PRIVACY_UNSAFE', 'NATIVE_SESSION_EMPTY'
]);
const fail = code => { throw new Error(code); };
export const nativePayloadErrorCode = error => ERROR_CODES.has(error?.message)
  ? error.message : 'NATIVE_PAYLOAD_INVALID';
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const utf8Bytes = value => Buffer.byteLength(value, 'utf8');

function parseStrictJson(text, limits) {
  let position = 0, nodes = 0;
  const whitespace = () => {
    while (text[position] === ' ' || text[position] === '\n' ||
        text[position] === '\r' || text[position] === '\t') position++;
  };
  function string(key = false) {
    const start = position++;
    const maximum = key ? limits.keyBytes : limits.scalarBytes;
    let closed = false;
    while (position < text.length) {
      if (position - start > 6 * maximum + 2)
        fail(key ? 'NATIVE_FIELD_KEY_BOUND' : 'NATIVE_SCALAR_BOUND');
      const code = text.charCodeAt(position++);
      if (code === 34) { closed = true; break; }
      if (code < 32) fail('NATIVE_JSON_INVALID');
      if (code === 92) {
        const escape = text[position++];
        if (escape === 'u') {
          for (let index = 0; index < 4; index++) {
            const digit = text.charCodeAt(position++);
            if (!((digit >= 48 && digit <= 57) || (digit >= 65 && digit <= 70) || (digit >= 97 && digit <= 102)))
              fail('NATIVE_JSON_INVALID');
          }
        } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail('NATIVE_JSON_INVALID');
      }
    }
    if (!closed) fail('NATIVE_JSON_INVALID');
    let value;
    try { value = JSON.parse(text.slice(start, position)); } catch { fail('NATIVE_JSON_INVALID'); }
    if (utf8Bytes(value) > maximum) fail(key ? 'NATIVE_FIELD_KEY_BOUND' : 'NATIVE_SCALAR_BOUND');
    for (const character of value) {
      const point = character.codePointAt(0);
      if (point >= 0xd800 && point <= 0xdfff) fail('NATIVE_JSON_INVALID');
    }
    return value;
  }
  function value(depth) {
    if (depth > limits.depth) fail('NATIVE_DEPTH_BOUND');
    if (++nodes > limits.nodes) fail('NATIVE_FIELD_COUNT_BOUND');
    whitespace();
    const initial = text[position];
    if (initial === '"') return string();
    if (initial === '{') {
      position++;
      const result = {};
      const keys = new Set();
      whitespace();
      if (text[position] === '}') { position++; return result; }
      while (true) {
        whitespace();
        if (text[position] !== '"') fail('NATIVE_JSON_INVALID');
        const key = string(true);
        if (keys.has(key)) fail('NATIVE_JSON_DUPLICATE_KEY');
        keys.add(key);
        if (PROTOTYPE_KEYS.has(key)) fail('NATIVE_PRIVACY_UNSAFE');
        whitespace();
        if (text[position++] !== ':') fail('NATIVE_JSON_INVALID');
        result[key] = value(depth + 1);
        whitespace();
        const end = text[position++];
        if (end === '}') return result;
        if (end !== ',') fail('NATIVE_JSON_INVALID');
      }
    }
    if (initial === '[') {
      position++;
      const result = [];
      whitespace();
      if (text[position] === ']') { position++; return result; }
      while (true) {
        result.push(value(depth + 1));
        whitespace();
        const end = text[position++];
        if (end === ']') return result;
        if (end !== ',') fail('NATIVE_JSON_INVALID');
      }
    }
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, position)) { position += literal.length; return parsed; }
    }
    const start = position;
    if (text[position] === '-') position++;
    if (text[position] === '0') position++;
    else {
      if (!(text[position] >= '1' && text[position] <= '9')) fail('NATIVE_JSON_INVALID');
      while (text[position] >= '0' && text[position] <= '9') position++;
    }
    if (text[position] === '.') {
      position++;
      if (!(text[position] >= '0' && text[position] <= '9')) fail('NATIVE_JSON_INVALID');
      while (text[position] >= '0' && text[position] <= '9') position++;
    }
    if (text[position] === 'e' || text[position] === 'E') {
      position++;
      if (text[position] === '+' || text[position] === '-') position++;
      if (!(text[position] >= '0' && text[position] <= '9')) fail('NATIVE_JSON_INVALID');
      while (text[position] >= '0' && text[position] <= '9') position++;
    }
    if (position - start > 128) fail('NATIVE_SCALAR_BOUND');
    const result = Number(text.slice(start, position));
    if (!Number.isFinite(result)) fail('NATIVE_JSON_INVALID');
    return result;
  }
  const parsed = value(0);
  whitespace();
  if (position !== text.length) fail('NATIVE_JSON_INVALID');
  return { value: parsed, nodes };
}

function decodePayload(bytes, encoding = 'identity') {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > NATIVE_LIMITS.payloadBytes)
    fail('NATIVE_PAYLOAD_BOUND');
  if (!['identity', 'gzip'].includes(encoding)) fail('NATIVE_PAYLOAD_ENCODING');
  let decoded, text;
  try {
    decoded = encoding === 'gzip' ? gunzipSync(bytes, { maxOutputLength: NATIVE_LIMITS.decodedPayloadBytes }) : bytes;
    if (!decoded.length || decoded.length > NATIVE_LIMITS.decodedPayloadBytes) fail('NATIVE_PAYLOAD_BOUND');
    text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') fail('NATIVE_PAYLOAD_BOUND');
    fail(nativePayloadErrorCode(error));
  }
  const limits = {
    depth: NATIVE_LIMITS.depth + 1,
    nodes: NATIVE_LIMITS.parsedNodesPerPayload,
    keyBytes: NATIVE_LIMITS.fieldKeyBytes,
    scalarBytes: NATIVE_LIMITS.scalarBytes
  };
  let parsed, nodes;
  try {
    const json = parseStrictJson(text, limits);
    parsed = Array.isArray(json.value) ? json.value : [json.value];
    nodes = json.nodes;
  } catch (error) {
    if (error?.message !== 'NATIVE_JSON_INVALID' || !text.includes('\n')) throw error;
    const lines = text.split(/\r?\n/).filter(line => line.trim().length);
    if (!lines.length || lines.length > NATIVE_LIMITS.envelopesPerPayload) fail('NATIVE_PAYLOAD_BOUND');
    parsed = [];
    nodes = 0;
    for (const line of lines) {
      const json = parseStrictJson(line, limits);
      nodes += json.nodes;
      if (nodes > NATIVE_LIMITS.parsedNodesPerPayload) fail('NATIVE_FIELD_COUNT_BOUND');
      parsed.push(json.value);
    }
  }
  if (!parsed.length || parsed.length > NATIVE_LIMITS.envelopesPerPayload ||
      parsed.some(envelope => !plainObject(envelope))) fail('NATIVE_ENVELOPE_SCHEMA');
  return { envelopes: parsed, decodedBytes: decoded.length, parsedNodes: nodes };
}

export function decodeNativePayload(bytes, encoding) {
  return decodePayload(bytes, encoding).envelopes;
}

export function parseNativeCaptureInput(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > NATIVE_LIMITS.inputBytes)
    fail('NATIVE_CAPTURE_BOUND');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('NATIVE_PAYLOAD_INVALID'); }
  return parseStrictJson(text, {
    depth: 8, nodes: 4096, keyBytes: NATIVE_LIMITS.fieldKeyBytes,
    scalarBytes: 4 * Math.ceil(NATIVE_LIMITS.payloadBytes / 3)
  }).value;
}

function configuration(options) {
  if (!plainObject(options) || Object.keys(options).some(key => !['publisherKeys', 'forbiddenValues'].includes(key)) ||
      !Array.isArray(options.publisherKeys) || !options.publisherKeys.length ||
      options.publisherKeys.length > NATIVE_LIMITS.publisherKeys ||
      options.publisherKeys.some(key => typeof key !== 'string' || utf8Bytes(key) !== 36 || !UUID4.test(key)) ||
      new Set(options.publisherKeys.map(key => key.toLowerCase())).size !== options.publisherKeys.length ||
      !Array.isArray(options.forbiddenValues) || options.forbiddenValues.length > NATIVE_LIMITS.forbiddenValues ||
      options.forbiddenValues.some(marker => typeof marker !== 'string' || utf8Bytes(marker) < 8 ||
        utf8Bytes(marker) > NATIVE_LIMITS.forbiddenValueBytes) ||
      options.forbiddenValues.reduce((total, marker) => total + utf8Bytes(marker), 0) > NATIVE_LIMITS.totalForbiddenValueBytes)
    fail('NATIVE_CAPTURE_SCHEMA');
  if (options.publisherKeys.some(key => options.forbiddenValues.some(marker => key.includes(marker))))
    fail('NATIVE_MARKER_PUBLISHER_CONFLICT');
  return {
    publishers: new Set(options.publisherKeys),
    publisherMarkers: options.publisherKeys.map(key => key.toLowerCase()),
    forbiddenValues: [...options.forbiddenValues]
  };
}

function scanOriginal(envelope, options) {
  if (!Object.hasOwn(envelope, 'iKey') || !options.publishers.has(envelope.iKey)) fail('NATIVE_PUBLISHER_UNEXPECTED');
  let fields = 0;
  function sensitive(value) {
    return forbiddenString(value) || options.forbiddenValues.some(marker => value.includes(marker)) ||
      options.publisherMarkers.some(marker => value.toLowerCase().includes(marker));
  }
  function scan(value, key = '', depth = 0) {
    if (++fields > NATIVE_LIMITS.fieldsPerEnvelope) fail('NATIVE_FIELD_COUNT_BOUND');
    if (depth > NATIVE_LIMITS.depth) fail('NATIVE_DEPTH_BOUND');
    if (utf8Bytes(key) > NATIVE_LIMITS.fieldKeyBytes) fail('NATIVE_FIELD_KEY_BOUND');
    if (typeof value === 'string' && utf8Bytes(value) > NATIVE_LIMITS.scalarBytes) fail('NATIVE_SCALAR_BOUND');
    if (PROTOTYPE_KEYS.has(key)) fail('NATIVE_PRIVACY_UNSAFE');
    if (key === 'iKey') {
      if (depth !== 1 || !options.publishers.has(value)) fail('NATIVE_PUBLISHER_UNEXPECTED');
      return;
    }
    if (forbiddenField(key) || sensitive(key) ||
        (USER_TAGS.has(key) && (typeof value !== 'string' || !PSEUDONYM.test(value))) ||
        (typeof value === 'string' && sensitive(value))) fail('NATIVE_PRIVACY_UNSAFE');
    if (value && typeof value === 'object')
      for (const [childKey, child] of Object.entries(value)) scan(child, childKey, depth + 1);
  }
  scan(envelope);
}

function project(envelope) {
  const result = structuredClone(envelope);
  delete result.iKey;
  for (const key of REMOVED_TAGS) if (plainObject(result.tags)) delete result.tags[key];
  return result;
}

export function createNativePayloadSession(options) {
  const policy = configuration(options);
  const payloadReceipts = [], nativeEnvelopes = [];
  let payloads = 0, rawBytes = 0, decodedBytes = 0, envelopeCount = 0, parsedNodes = 0, failed = null;
  function output(receipts, envelopes) {
    return {
      schema: 'contoso.native-api-safe-capture.v1',
      privacyPolicy: 'contoso.original-native-payload.v1',
      validatorPid: process.pid, nodeVersion: process.version,
      validatorSourceSha256: NATIVE_POLICY_SOURCE_SHA256, sharedPolicySha256: SHARED_VALUE_POLICY_SHA256,
      verified: true, sourceAcceptanceIsCertification: false,
      independentProducerAuthorityVerified: false, allTablePrivacyGateVerified: false,
      certification: 'NOT_CERTIFIED',
      actualCounts: { payloads, originalRawBytes: rawBytes, decodedBytes, envelopes: envelopeCount },
      payloadReceipts: structuredClone(receipts), nativeEnvelopes: structuredClone(envelopes)
    };
  }
  return Object.freeze({
    ingest(bytes, encoding = 'identity') {
      if (failed) fail(failed);
      try {
        if (++payloads > NATIVE_LIMITS.sessionPayloads) fail('NATIVE_TOTAL_BOUND');
        if (!Buffer.isBuffer(bytes)) fail('NATIVE_PAYLOAD_BOUND');
        rawBytes += bytes.length;
        if (rawBytes > NATIVE_LIMITS.totalRawBytes) fail('NATIVE_TOTAL_BOUND');
        const decoded = decodePayload(bytes, encoding);
        decodedBytes += decoded.decodedBytes;
        envelopeCount += decoded.envelopes.length;
        parsedNodes += decoded.parsedNodes;
        if (decodedBytes > NATIVE_LIMITS.totalDecodedBytes || envelopeCount > NATIVE_LIMITS.totalEnvelopes ||
            parsedNodes > NATIVE_LIMITS.totalParsedNodes) fail('NATIVE_TOTAL_BOUND');
        for (const envelope of decoded.envelopes) scanOriginal(envelope, policy);
        const projected = decoded.envelopes.map(project);
        const receipt = {
          originalPayloadSha256: digest(bytes), originalPayloadBytes: bytes.length,
          decodedPayloadBytes: decoded.decodedBytes, originalEnvelopeCount: decoded.envelopes.length,
          strictDuplicateKeysVerified: true, scannedAllOriginalValues: true,
          projectedAfterScan: true, originalPayloadRetained: false
        };
        payloadReceipts.push(receipt);
        nativeEnvelopes.push(...projected);
        return output([receipt], projected);
      } catch (error) {
        failed = nativePayloadErrorCode(error);
        payloadReceipts.length = 0;
        nativeEnvelopes.length = 0;
        fail(failed);
      }
    },
    snapshot() {
      if (failed) fail(failed);
      if (!payloads) fail('NATIVE_SESSION_EMPTY');
      return output(payloadReceipts, nativeEnvelopes);
    }
  });
}

export function captureNativePayloads(input) {
  if (!plainObject(input) || Object.keys(input).some(key => !['publisherKeys', 'forbiddenValues', 'payloads'].includes(key)) ||
      !Array.isArray(input.payloads) || !input.payloads.length || input.payloads.length > NATIVE_LIMITS.payloads)
    fail('NATIVE_CAPTURE_SCHEMA');
  const session = createNativePayloadSession({ publisherKeys: input.publisherKeys, forbiddenValues: input.forbiddenValues });
  for (const payload of input.payloads) {
    if (!plainObject(payload) || Object.keys(payload).some(key => !['rawBase64', 'encoding'].includes(key)) ||
        typeof payload.rawBase64 !== 'string' || !payload.rawBase64.length ||
        payload.rawBase64.length > 4 * Math.ceil(NATIVE_LIMITS.payloadBytes / 3)) fail('NATIVE_CAPTURE_SCHEMA');
    const bytes = Buffer.from(payload.rawBase64, 'base64');
    if (bytes.toString('base64') !== payload.rawBase64) fail('NATIVE_CAPTURE_SCHEMA');
    session.ingest(bytes, payload.encoding);
  }
  return session.snapshot();
}

export const captureNativeApiPayloads = captureNativePayloads;
