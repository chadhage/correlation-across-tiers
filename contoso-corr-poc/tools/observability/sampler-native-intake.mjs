import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { types } from 'node:util';
import {
  createNativePayloadSession, nativePayloadErrorCode, NATIVE_LIMITS,
  NATIVE_POLICY_SOURCE_SHA256, SHARED_VALUE_POLICY_SHA256
} from '../security/native-payload.mjs';
import { forbiddenString } from '../security/values.mjs';

export const NATIVE_BODY_TIMEOUT_MS = 5000;
const RECEIVER_ERRORS = new Set([
  'NATIVE_WIRE_BOUND', 'NATIVE_WIRE_TIMEOUT', 'NATIVE_WIRE_INCOMPLETE',
  'NATIVE_ROUTE_UNEXPECTED', 'NATIVE_RECEIVER_INCOMPLETE', 'NATIVE_RECEIVER_SEALED'
]);
const FAILURE_STAGES = new Set([
  'readiness', 'sampling-response', 'sampling-parse', 'sampling-state', 'rate-observation',
  'sampled-request', 'sampled-status', 'sampled-parse', 'sampled-identity', 'sampled-echo', 'sampled-wire', 'sampled-decision',
  'unsampled-request', 'unsampled-status', 'unsampled-parse', 'unsampled-identity', 'unsampled-echo', 'unsampled-wire', 'unsampled-decision',
  'provider-identity', 'shutdown', 'native-intake', 'spi-loaders', 'native-count', 'native-correspondence',
  'evidence-write', 'load', 'load-baseline', 'load-instrumented', 'load-correspondence', 'load-summary'
]);
const FAILURE_CODES = new Set([
  'ERR_ASSERTION', 'ENOENT', 'EACCES', 'EPERM', 'EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EADDRINUSE',
  'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END',
  'ERR_HTTP_HEADERS_SENT', 'ERR_HTTP_REQUEST_TIMEOUT', 'ERR_HTTP_CONTENT_LENGTH_MISMATCH',
  'ERR_INVALID_CHAR', 'ERR_SERVER_NOT_RUNNING',
  'HPE_INVALID_METHOD', 'HPE_INVALID_CONSTANT', 'HPE_INVALID_HEADER_TOKEN', 'HPE_INVALID_CONTENT_LENGTH',
  'HPE_UNEXPECTED_CONTENT_LENGTH', 'HPE_HEADER_OVERFLOW', 'HPE_INVALID_EOF_STATE', 'HPE_INVALID_VERSION',
  'HPE_INVALID_URL', 'HPE_INVALID_CHUNK_SIZE', 'HPE_INVALID_TRANSFER_ENCODING',
  'HPE_PAUSED', 'HPE_PAUSED_UPGRADE', 'HPE_PAUSED_H2_UPGRADE', 'HPE_USER',
  'HPE_CB_HEADERS_COMPLETE', 'HPE_CLOSED_CONNECTION'
]);
const RECEIVER_EVENTS = new Set(['receive', 'parse', 'finish', 'pending', 'clientError', 'drop', 'serverError', 'close']);
const COUNTER_LIMIT = 4_294_967_295;
const increment = (object, key, amount = 1) => {
  object[key] = Math.min(COUNTER_LIMIT, object[key] + amount);
};
const errorCode = error => {
  const message = error && typeof error === 'object' && !types.isProxy(error)
    ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined;
  const safe = typeof message === 'string' && message.length <= 128 ? message : undefined;
  return RECEIVER_ERRORS.has(safe) ? safe : nativePayloadErrorCode({ message: safe });
};
const fail = code => { throw new Error(code); };
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export function isNativeSamplerPost(request) {
  return request?.method === 'POST' && ['/v2/track', '/v2.1/track'].includes(request.url);
}

export function samplerFailureDiagnostic(error, stage) {
  let code = 'SAMPLER_FAILURE';
  if (error && typeof error === 'object' && !types.isProxy(error)) {
    const ownCode = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    const message = Object.getOwnPropertyDescriptor(error, 'message')?.value;
    if (typeof message === 'string' && message.length <= 128) {
      const nativeCode = nativePayloadErrorCode({ message });
      if (nativeCode !== 'NATIVE_PAYLOAD_INVALID' || message === nativeCode) code = nativeCode;
      if (RECEIVER_ERRORS.has(message)) code = message;
      if (['Graceful shutdown deadline', 'Actual Java shutdown deadline'].includes(message))
        code = 'SAMPLER_SHUTDOWN_TIMEOUT';
    }
    if (FAILURE_CODES.has(ownCode)) code = ownCode;
  }
  return Object.freeze({
    failureStage: FAILURE_STAGES.has(stage) ? stage : 'unclassified',
    failureCode: code,
    rawDiagnosticsPersisted: false
  });
}

function requestDiagnostics(request) {
  if (!request) return null;
  const declared = request.headers?.['content-length'];
  const numeric = typeof declared === 'string' && /^\d+$/.test(declared) ? Number(declared) : NaN;
  return {
    methodClass: ['GET', 'POST'].includes(request.method) ? request.method : 'other',
    routeClass: request.url === '/v2/track' ? 'native-v2-track' :
      request.url === '/v2.1/track' ? 'native-v2.1-track' : request.url === '/echo' ? 'echo' : 'other',
    declaredLengthState: declared === undefined ? 'absent' :
      !Number.isSafeInteger(numeric) || numeric < 0 ? 'invalid' :
        numeric > NATIVE_LIMITS.payloadBytes ? 'over-body-limit' : 'in-range',
    declaredLength: Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= COUNTER_LIMIT ? numeric : null,
    wireBytesObserved: 0
  };
}

async function readBody(request, onBytes, onFailure) {
  const chunks = [];
  let length = 0;
  const declared = request.headers?.['content-length'];
  if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) ||
      !Number.isSafeInteger(Number(declared)) || Number(declared) > NATIVE_LIMITS.payloadBytes)) {
    onFailure?.(new Error('NATIVE_WIRE_BOUND'));
    request.destroy?.();
    fail('NATIVE_WIRE_BOUND');
  }
  let timer;
  try {
    return await Promise.race([
      (async () => {
        for await (const chunk of request) {
          if (Buffer.isBuffer(chunk)) onBytes?.(chunk.length);
          if (!Buffer.isBuffer(chunk) || length + chunk.length > NATIVE_LIMITS.payloadBytes)
            fail('NATIVE_WIRE_BOUND');
          length += chunk.length;
          chunks.push(chunk);
        }
        if (declared !== undefined && length !== Number(declared)) fail('NATIVE_WIRE_INCOMPLETE');
        return Buffer.concat(chunks, length);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onFailure?.(new Error('NATIVE_WIRE_TIMEOUT'));
          request.destroy?.();
          reject(new Error('NATIVE_WIRE_TIMEOUT'));
        }, NATIVE_BODY_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    onFailure?.(error);
    request.destroy?.();
    throw new Error(errorCode(error));
  } finally { clearTimeout(timer); }
}

export async function readNativeSamplerBody(request) {
  return readBody(request);
}

export function createSamplerNativeIntake({ publisherKeys, forbiddenValues }) {
  const session = createNativePayloadSession({ publisherKeys, forbiddenValues });
  const observations = [];
  let pending = 0, accepted = 0, failed = null, sealed = false, result;
  const events = Object.fromEntries([...RECEIVER_EVENTS].map(event => [event, 0]));
  const counts = {
    receiveCalls: 0, nativePosts: 0, completedBodies: 0, rawBytesObserved: 0,
    acceptedPayloads: 0, acceptedRawBytes: 0, acceptedDecodedBytes: 0, acceptedEnvelopes: 0
  };
  let firstPoison = null, lastRequest = null, lastBarrierFailure = null, transportPhase = 'unmanaged';
  function poison(event, error, context) {
    const category = RECEIVER_EVENTS.has(event) ? event : 'receive';
    const bytesParsed = error && typeof error === 'object' && !types.isProxy(error)
      ? Object.getOwnPropertyDescriptor(error, 'bytesParsed')?.value : undefined;
    firstPoison ??= freeze({
      event: category, receiverCode: failed,
      transportPhase, observedAtUtc: new Date().toISOString(),
      underlyingCode: error === null || error === undefined ? null : samplerFailureDiagnostic(error, 'native-intake').failureCode,
      parserBytesParsed: Number.isSafeInteger(bytesParsed) && bytesParsed >= 0 && bytesParsed <= COUNTER_LIMIT ? bytesParsed : null,
      request: context ? structuredClone(context) : null
    });
  }
  const diagnostics = () => freeze({
    schema: 'contoso.sampler-receiver-diagnostics.v1', diagnosticsOnly: true,
    poisoned: failed !== null, receiverCode: failed, sealed, pendingReceives: pending, transportPhase,
    events: { ...events }, counts: { ...counts }, firstPoison,
    lastRequest: lastRequest ? structuredClone(lastRequest) : null, lastBarrierFailure,
    countersSaturateAt: COUNTER_LIMIT, independentProducerAuthorityVerified: false,
    allTablePrivacyGateVerified: false
  });
  const reject = (code, event = 'receive', error = null, request = null) => {
    const category = RECEIVER_EVENTS.has(event) ? event : 'receive';
    increment(events, category);
    failed ??= RECEIVER_ERRORS.has(code) ? code : 'NATIVE_RECEIVER_INCOMPLETE';
    poison(category, error, requestDiagnostics(request));
    observations.length = 0;
  };
  return Object.freeze({
    reject,
    diagnostics,
    setTransportPhase(phase) {
      if (['listening', 'closing', 'closed'].includes(phase)) transportPhase = phase;
    },
    async receive(request) {
      increment(events, 'receive');
      increment(counts, 'receiveCalls');
      if (failed) fail(failed);
      if (sealed) fail('NATIVE_RECEIVER_SEALED');
      pending++;
      let step = 'receive', context = null;
      try {
        context = requestDiagnostics(request);
        lastRequest = context;
        if (isNativeSamplerPost(request)) increment(counts, 'nativePosts');
        if (!isNativeSamplerPost(request)) fail('NATIVE_ROUTE_UNEXPECTED');
        const bytes = await readBody(request, size => {
          increment(counts, 'rawBytesObserved', size);
          context.wireBytesObserved = Math.min(COUNTER_LIMIT, context.wireBytesObserved + size);
        }, error => {
          failed ??= errorCode(error);
          poison('receive', error, context);
          observations.length = 0;
        });
        increment(counts, 'completedBodies');
        if (failed) fail(failed);
        step = 'parse';
        increment(events, 'parse');
        const capture = session.ingest(bytes, request.headers?.['content-encoding']);
        const observedAtUtc = new Date().toISOString();
        observations.push(...capture.nativeEnvelopes.map(envelope => ({
          envelope, observedAtUtc,
          encodedBytes: Buffer.byteLength(JSON.stringify(envelope), 'utf8')
        })));
        accepted++;
        increment(counts, 'acceptedPayloads');
        increment(counts, 'acceptedRawBytes', capture.payloadReceipts[0].originalPayloadBytes);
        increment(counts, 'acceptedDecodedBytes', capture.payloadReceipts[0].decodedPayloadBytes);
        increment(counts, 'acceptedEnvelopes', capture.payloadReceipts[0].originalEnvelopeCount);
        const count = capture.payloadReceipts[0].originalEnvelopeCount;
        return { itemsReceived: count, itemsAccepted: count, errors: [] };
      } catch (error) {
        failed ??= errorCode(error);
        poison(step, error, context);
        observations.length = 0;
        fail(failed);
      } finally { pending--; }
    },
    finish() {
      increment(events, 'finish');
      if (failed) fail(failed);
      if (pending) {
        increment(events, 'pending');
        lastBarrierFailure = freeze({ event: 'pending', code: 'NATIVE_RECEIVER_INCOMPLETE', pendingReceives: pending });
        fail('NATIVE_RECEIVER_INCOMPLETE');
      }
      if (result) return result;
      sealed = true;
      let metadata;
      if (accepted) {
        try {
          const { nativeEnvelopes, ...capture } = session.snapshot();
          metadata = capture;
        } catch (error) {
          failed = errorCode(error);
          poison('finish', error, null);
          observations.length = 0;
          fail(failed);
        }
      } else {
        metadata = {
          schema: 'contoso.sampler-native-intake-empty.v1',
          observedNativePayloads: 0, verified: false, validatorPid: null,
          expectedPolicySourceSha256: NATIVE_POLICY_SOURCE_SHA256,
          expectedSharedPolicySha256: SHARED_VALUE_POLICY_SHA256,
          payloadReceipts: [], sourceAcceptanceIsCertification: false,
          independentProducerAuthorityVerified: false,
          allTablePrivacyGateVerified: false, certification: 'NOT_CERTIFIED'
        };
      }
      result = freeze({
        originalPrivacyCapture: metadata,
        encodedBytesScope: 'Privacy-minimized native JSON projection; not original wire bytes or Azure billable size',
        observations: structuredClone(observations),
        receiverDiagnostics: diagnostics()
      });
      return result;
    }
  });
}

export async function openSamplerNativeReceiver({ publisherKeys, forbiddenValues, onEcho }) {
  const intake = createSamplerNativeIntake({ publisherKeys, forbiddenValues });
  const pending = new Set();
  const http = { requests: 0, nativePosts: 0, echoGets: 0, rejectedRoutes: 0, closeCalls: 0 };
  const server = createServer({
    requestTimeout: NATIVE_BODY_TIMEOUT_MS,
    headersTimeout: NATIVE_BODY_TIMEOUT_MS,
    maxHeaderSize: 8192
  }, (request, response) => {
    increment(http, 'requests');
    response.on('error', error => intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'receive', error, request));
    const operation = (async () => {
      try {
        if (isNativeSamplerPost(request)) {
          increment(http, 'nativePosts');
          const accepted = await intake.receive(request);
          response.writeHead(200, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify(accepted));
        } else if (request.method === 'GET' && request.url === '/echo') {
          increment(http, 'echoGets');
          await onEcho(request);
          response.writeHead(200, { 'x-contoso-observed-traceparent': request.headers.traceparent ?? '', connection: 'close' }).end('ok');
        } else {
          increment(http, 'rejectedRoutes');
          response.writeHead(404, { connection: 'close' }).end();
          request.resume();
        }
      } catch (error) {
        intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'receive', error, request);
        if (!response.headersSent) response.writeHead(400, { connection: 'close' });
        response.end();
      }
    })();
    pending.add(operation);
    operation.then(() => pending.delete(operation), error => {
      intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'receive', error, request);
      pending.delete(operation);
      request.destroy();
    });
  });
  server.maxConnections = 8;
  server.keepAliveTimeout = 1000;
  server.on('drop', () => intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'drop'));
  server.on('clientError', (error, socket) => {
    intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'clientError', error);
    socket.destroy();
  });
  await new Promise((ready, reject) => {
    const failed = error => {
      intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'serverError', error);
      reject(error);
    };
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      intake.setTransportPhase('listening');
      ready();
    });
  });
  server.on('error', error => intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'serverError', error));
  let closing;
  async function close(force) {
    increment(http, 'closeCalls');
    closing ??= new Promise((done, reject) => {
      intake.setTransportPhase('closing');
      server.close(error => {
        if (error) {
          intake.reject('NATIVE_RECEIVER_INCOMPLETE', 'close', error);
          reject(new Error('NATIVE_RECEIVER_INCOMPLETE'));
        } else {
          intake.setTransportPhase('closed');
          done();
        }
      });
    });
    if (force) server.closeAllConnections();
    await closing;
    await Promise.all([...pending]);
  }
  const diagnostics = () => freeze({
    ...intake.diagnostics(), http: { ...http },
    limits: { maxConnections: 8, bodyBytes: NATIVE_LIMITS.payloadBytes, bodyDeadlineMs: NATIVE_BODY_TIMEOUT_MS }
  });
  return Object.freeze({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    diagnostics,
    async finish() {
      await close(false);
      const captured = intake.finish();
      return freeze({ ...captured, receiverDiagnostics: diagnostics() });
    },
    async stop() { await close(true); }
  });
}

export function projectSamplerNativeSpans(envelopes) {
  return envelopes.filter(envelope => ['RequestData', 'RemoteDependencyData'].includes(envelope.data?.baseType)).map(envelope => {
    const data = envelope.data.baseData;
    return {
      name: envelope.name, time: envelope.time,
      tags: Object.fromEntries(['ai.operation.id', 'ai.operation.parentId', 'ai.cloud.role']
        .filter(key => envelope.tags?.[key] !== undefined).map(key => [key, envelope.tags[key]])),
      data: { baseType: envelope.data.baseType, baseData: Object.fromEntries(
        ['id', 'name', 'duration', 'responseCode', 'resultCode', 'success', 'type']
          .filter(key => data[key] !== undefined).map(key => [key, data[key]])) }
    };
  });
}

export function selectSamplerNativeSpans(envelopes, traceIds) {
  return envelopes.filter(row => traceIds.has(row.tags?.['ai.operation.id']) &&
    ['RequestData', 'RemoteDependencyData'].includes(row.data?.baseType));
}

export function projectSamplerFailureObservation(value) {
  const fields = ['nativeStateAvailable', 'effectiveSamplingPercentage', 'requestsPerSecond', 'loadedCount',
    'guardPolicy', 'artifactVersion', 'guardSha256', 'providerClass', 'sdkAbi', 'runtimeInstanceId',
    'providerCount', 'exporterCount', 'extensionLoader', 'delegateLoader'];
  const result = Object.fromEntries(fields.map(key => [key, value[key] ?? null]));
  return Object.values(result).every(field => field === null || typeof field === 'boolean' ||
    (typeof field === 'number' && Number.isFinite(field)) ||
    (typeof field === 'string' && Buffer.byteLength(field, 'utf8') <= NATIVE_LIMITS.scalarBytes &&
      /^[A-Za-z0-9_.$@-]+$/.test(field) && !forbiddenString(field)))
    ? result : null;
}

export async function createSamplerEvidenceDirectory(path) {
  const directory = resolve(path);
  await mkdir(dirname(directory), { recursive: true });
  try { await mkdir(directory); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('SAMPLER_EVIDENCE_DIRECTORY_EXISTS');
    throw error;
  }
  return directory;
}

export async function writeSamplerEvidence(directory, name, value) {
  if (basename(name) !== name || !name.endsWith('.json')) throw new Error('SAMPLER_EVIDENCE_FILE_INVALID');
  await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
