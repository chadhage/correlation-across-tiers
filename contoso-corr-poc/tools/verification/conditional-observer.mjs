import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { request } from 'node:http';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types } from 'node:util';
import { canonicalSpanId, SPAN, TRACE, UUID, ownedConfigurationHash } from '../observability/telemetry-contract.mjs';
import { jarMemberSha256 } from '../security/av23-check.mjs';
import { createBoundDirectory, HASH, jsonBytes, nativeEvidenceHash, projectRoot, readBoundFile, sha256, writeManifest } from './files.mjs';
import { snapshotQualificationMetadata } from './sampling-qualification.mjs';
import { openSamplerNativeReceiver } from '../observability/sampler-native-intake.mjs';
import { parseNativeCaptureInput } from '../security/native-payload.mjs';
import { forbiddenField, forbiddenString } from '../security/values.mjs';

const executions = new WeakMap();
const captures = new WeakMap();
const bindingFailures = new WeakMap();
const factories = new Map();
const caseKinds = Object.freeze(['absent', 'invalid-zero-trace', 'invalid-zero-parent', 'valid-parent',
  'invalid-tracestate-only', 'changed-business-id-valid-parent', 'valid-unsampled-parent']);
const failureCodes = new Set([
  'E_CONDITIONAL_AGENT', 'E_CONDITIONAL_ARGUMENT', 'E_CONDITIONAL_BASELINE',
  'E_CONDITIONAL_CALLER_ENROLLMENT', 'E_CONDITIONAL_CASE_BINDING_SCOPE', 'E_CONDITIONAL_CASE_COVERAGE',
  'E_CONDITIONAL_CHILD_EXIT', 'E_CONDITIONAL_CLASSPATH', 'E_CONDITIONAL_CLASS_ORIGIN',
  'E_CONDITIONAL_CONTEXT_NOT_RESTARTED', 'E_CONDITIONAL_CPU_SOURCE', 'E_CONDITIONAL_EXECUTION_FAILED',
  'E_CONDITIONAL_EXIT_BEFORE_READY', 'E_CONDITIONAL_FACTORY_REGISTRY', 'E_CONDITIONAL_FIXTURE_COMPILE',
  'E_CONDITIONAL_GRAPH_BINDING', 'E_CONDITIONAL_GUARD', 'E_CONDITIONAL_HTTP_PORT',
  'E_CONDITIONAL_HTTP_PREMATURE_CLOSE', 'E_CONDITIONAL_HTTP_RESPONSE',
  'E_CONDITIONAL_HTTP_RESPONSE_ABORTED', 'E_CONDITIONAL_HTTP_RESPONSE_ERROR',
  'E_CONDITIONAL_HTTP_TIMEOUT', 'E_CONDITIONAL_HTTP_TRANSPORT', 'E_CONDITIONAL_INSTRUMENTATION_SCOPE',
  'E_CONDITIONAL_INTAKE_SOURCE', 'E_CONDITIONAL_INTAKE_SOURCE_NOT_READY', 'E_CONDITIONAL_JAVA_PORT_REQUIRED',
  'E_CONDITIONAL_NATIVE_ABSENCE_OR_DUPLICATE', 'E_CONDITIONAL_NATIVE_PARENT', 'E_CONDITIONAL_NATIVE_SCOPE',
  'E_CONDITIONAL_ORIGINAL_POLICY_SOURCE', 'E_CONDITIONAL_ORIGINAL_PRIVACY_BINDING',
  'E_CONDITIONAL_PLAIN_DATA', 'E_CONDITIONAL_PRIVATE_CAPTURE', 'E_CONDITIONAL_PRIVATE_EXECUTION',
  'E_CONDITIONAL_PROCESS_BOUND', 'E_CONDITIONAL_PROCESS_DEADLINE', 'E_CONDITIONAL_PROCESS_START',
  'E_CONDITIONAL_PRODUCT_BYTES', 'E_CONDITIONAL_READY_PORT', 'E_CONDITIONAL_READY_TIMEOUT',
  'E_CONDITIONAL_RESPONSE_BOUND', 'E_CONDITIONAL_ROOT_PARENT', 'E_CONDITIONAL_RUNTIME_ABSENCE_OR_DUPLICATE',
  'E_CONDITIONAL_RUNTIME_BOUND', 'E_CONDITIONAL_RUNTIME_DRIFT', 'E_CONDITIONAL_RUNTIME_PRIVACY',
  'E_CONDITIONAL_RUNTIME_SCHEMA', 'E_CONDITIONAL_RUNTIME_SOURCE', 'E_CONDITIONAL_RUNTIME_UTC',
  'E_CONDITIONAL_SOURCE_BINDING', 'E_CONDITIONAL_SOURCE_BOUND', 'E_CONDITIONAL_SOURCE_DRIFT',
  'E_CONDITIONAL_TOOL_BYTES', 'E_CONDITIONAL_UNAVAILABLE', 'E_CONDITIONAL_UNSAMPLED_CONTINUATION',
  'E_CONDITIONAL_VALID_PARENT_RESTART', 'E_CONDITIONAL_WIRE'
]);
const observerId = 'r9-local-api-conditional-v1';
const baseline = 'evidence\\java-local\\source-builds\\20261102T020237806Z-integrated-reactor-bbf3e7ef-36b8-4d66-b009-df47b708d6d3';
const baselineSha256 = 'd3ff1ed1755c258066a6ee8f07f5cecce33423fb9d8f2e6a70e6eff858d2c7df';
const fixtureSource = 'services\\orders-api\\src\\test\\java\\com\\contoso\\orders\\NativeApiFixture.java';
const filterSource = 'services\\orders-api\\src\\test\\java\\com\\contoso\\orders\\NativeTrustRootObservationFilter.java';
const rootPolicy = 'ADR-A03/agent-framework-http-extraction';
const privacySourceSha256 = 'd3fa9007028fc8b69b4a0a4595a086f0256620124b3f68d1f901d9ba8f782e63';
const intakeSourceSha256 = 'dfaf82c159277b721c0f4e3f939110af5452235c106a3e6e2374d4994c814207';
const self = fileURLToPath(import.meta.url);
const policySources = [
  'contracts\\conditional-native-observer.v1.json', 'contracts\\expected-boundary-map.v1.json',
  'contracts\\verification-observer-registry.v1.json',
  'config\\versions.lock.json', 'config\\java-agent.json', 'tools\\verification\\conditional-observer.mjs',
  'tools\\verification\\run-conditional-observer.mjs',
  'tools\\observability\\sampler-native-intake.mjs',
  'tools\\security\\native-payload.mjs', 'tools\\security\\values.mjs'
];
let completedNativeExecutions = 0;
const failureError = code => Object.assign(new Error(code), { code });
const fail = code => { throw failureError(code); };
const requireThat = (value, code) => { if (!value) fail(code); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const utc = value => {
  if (typeof value !== 'string') return false;
  const parsed = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!parsed) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() ===
    `${parsed[1]}.${(parsed[2] ?? '').padEnd(3, '0').slice(0, 3)}Z`;
};
const hashJson = value => sha256(Buffer.from(JSON.stringify(value)));
const uriPath = value => {
  try {
    const url = new URL(value);
    requireThat(url.protocol === 'file:' && !url.username && !url.password &&
      ['', 'localhost'].includes(url.hostname) && !url.href.includes('?') && !url.href.includes('#'),
    'E_CONDITIONAL_CLASS_ORIGIN');
    return path.resolve(fileURLToPath(url)).toLowerCase();
  }
  catch { fail('E_CONDITIONAL_CLASS_ORIGIN'); }
};
const runtimeTypes = Object.freeze({
  schema: 'string', caseId: 'string', businessInvocationId: 'string', pid: 'number',
  processStartUtc: 'string', observedAtUtc: 'string', roleName: 'string',
  requestMethod: 'string', requestPath: 'string', traceparentFields: 'array', tracestateFields: 'array',
  sdkTraceId: 'string', sdkSpanId: 'string', sdkSampled: 'boolean', sdkRecording: 'boolean',
  fixtureCodeSource: 'string', fixtureClassSha256: 'string',
  observerCodeSource: 'string', observerClassSha256: 'string',
  applicationCodeSource: 'string', applicationClassSha256: 'string',
  runtimeGuardCodeSource: 'string', runtimeGuardClassSha256: 'string'
});

export function conditionalFailureCode(error, fallback = 'E_CONDITIONAL_EXECUTION_FAILED') {
  const unavailable = typeof fallback === 'string' && failureCodes.has(fallback)
    ? fallback : 'E_CONDITIONAL_EXECUTION_FAILED';
  if (!error || typeof error !== 'object' || types.isProxy(error)) return unavailable;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && Object.hasOwn(descriptor, 'value') &&
    typeof descriptor.value === 'string' && failureCodes.has(descriptor.value)
    ? descriptor.value : unavailable;
}

export function conditionalFailureDiagnostics(error) {
  return Object.freeze({
    code: conditionalFailureCode(error),
    bindingCase: bindingFailures.get(error) ?? null,
    diagnosticsOnly: true, authorityGranted: false, savedJsonCanEnroll: false
  });
}

function validateRuntimeMetadata(runtime, markers) {
  requireThat(runtime && typeof runtime === 'object' && !Array.isArray(runtime) &&
    same(Object.keys(runtime).sort(), Object.keys(runtimeTypes).sort()) &&
    Array.isArray(markers) && markers.length <= 64 &&
    markers.every(value => typeof value === 'string' && Buffer.byteLength(value) >= 8 &&
      Buffer.byteLength(value) <= 4096), 'E_CONDITIONAL_RUNTIME_SCHEMA');
  for (const [key, value] of Object.entries(runtime)) {
    requireThat(Buffer.byteLength(key) <= 128 && !forbiddenField(key) &&
      (runtimeTypes[key] === 'array' ? Array.isArray(value) : typeof value === runtimeTypes[key]),
    'E_CONDITIONAL_RUNTIME_SCHEMA');
    const strings = runtimeTypes[key] === 'array' ? value : typeof value === 'string' ? [value] : [];
    requireThat(strings.length <= (runtimeTypes[key] === 'array' ? 8 : 1) &&
      strings.every(item => typeof item === 'string' && Buffer.byteLength(item) <=
        (key === 'traceparentFields' ? 256 : key === 'tracestateFields' ? 512 : 4096)),
    'E_CONDITIONAL_RUNTIME_BOUND');
    requireThat(strings.every(item => !forbiddenString(item) && !markers.some(marker => item.includes(marker))),
      'E_CONDITIONAL_RUNTIME_PRIVACY');
    if (key === 'processStartUtc' || key === 'observedAtUtc') {
      requireThat(utc(value), 'E_CONDITIONAL_RUNTIME_UTC');
    }
    if (key.endsWith('CodeSource')) uriPath(value);
  }
}

function observedSnapshot(value) {
  const visiting = new WeakSet();
  let fields = 0;
  const copy = (item, depth = 0) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' ||
        typeof item === 'number' && Number.isFinite(item)) return item;
    requireThat(item && typeof item === 'object' && !types.isProxy(item) && depth <= 64 &&
      (Array.isArray(item) ? [Array.prototype, null] : [Object.prototype, null])
        .includes(Object.getPrototypeOf(item)) &&
      !visiting.has(item), 'E_CONDITIONAL_PLAIN_DATA');
    visiting.add(item);
    const result = Array.isArray(item) ? [] : Object.create(null);
    let arrayIndex = 0;
    if (Array.isArray(item)) requireThat(Reflect.ownKeys(item).length === item.length + 1, 'E_CONDITIONAL_PLAIN_DATA');
    for (const name of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && name === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      requireThat(typeof name === 'string' && descriptor?.enumerable &&
        (!Array.isArray(item) || name === String(arrayIndex++)) &&
        Object.hasOwn(descriptor, 'value') && ++fields <= 1_048_576,
      'E_CONDITIONAL_PLAIN_DATA');
      result[name] = copy(descriptor.value, depth + 1);
    }
    visiting.delete(item);
    return Object.freeze(result);
  };
  return copy(value);
}

export function conditionalEvidenceHash(value) {
  const normalize = item => {
    if (item === null || typeof item !== 'object') return item;
    const result = Array.isArray(item) ? [] : {};
    for (const name of Object.keys(item)) {
      Object.defineProperty(result, name, {
        value: normalize(item[name]), enumerable: true, configurable: true, writable: true
      });
    }
    return result;
  };
  return nativeEvidenceHash(normalize(observedSnapshot(value)));
}

export function conditionalSourceRegistry() {
  return Object.freeze({
    schema: 'contoso.local-conditional-source-registry.v1',
    observerId, factory: 'executeLocalConditionalObserver', sourceKind: 'real-local-agent-loopback',
    allowedMode: 'LocalValidate', allowedBoundaries: Object.freeze(['orders.request']),
    sourceFactoryRegistered: factories.get(observerId) === executeLocalConditionalObserver, completedNativeExecutions,
    reviewedIntakeReady: HASH.test(intakeSourceSha256 ?? ''),
    savedJsonCanEnroll: false, queryCapabilityCanEnroll: false,
    azureAuthority: false, certificationEligible: false
  });
}

const cpuSource = `const issuedAtUtc=new Date().toISOString();process.stdout.write(JSON.stringify({
schema:"contoso.actual-cpu-execution.v1",nonce:process.argv[1],pid:process.pid,
parentPid:process.ppid,issuedAtUtc,nativeRuntime:false}));`;

function child(command, args, { env, input, timeout = 30000, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(command, args, { cwd: projectRoot, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let size = 0, rejected = false;
    const abort = code => {
      if (rejected) return;
      rejected = true;
      processChild.kill();
      reject(Object.assign(new Error(code), { code }));
    };
    const timer = setTimeout(() => abort('E_CONDITIONAL_PROCESS_DEADLINE'), timeout);
    for (const [stream, output] of [[processChild.stdout, stdout], [processChild.stderr, stderr]]) {
      stream.on('data', bytes => {
        size += bytes.length;
        if (size > maxBytes) abort('E_CONDITIONAL_PROCESS_BOUND');
        else output.push(bytes);
      });
    }
    processChild.on('error', () => abort('E_CONDITIONAL_PROCESS_START'));
    processChild.on('close', (code, signal) => {
      clearTimeout(timer);
      if (!rejected) resolve({ pid: processChild.pid, code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    processChild.stdin.end(input);
  });
}

export async function executeConditionalSourceProbe(...args) {
  requireThat(args.length === 0, 'E_CONDITIONAL_CALLER_ENROLLMENT');
  const before = sha256(await readFile(self));
  const nonce = randomUUID(), startedAtUtc = new Date().toISOString();
  const run = await child(process.execPath, ['-e', cpuSource, nonce], { env: { ...process.env, NODE_OPTIONS: '' } });
  let observed;
  try { observed = JSON.parse(run.stdout); } catch { fail('E_CONDITIONAL_CPU_SOURCE'); }
  requireThat(run.code === 0 && !run.signal && observed.nonce === nonce && observed.pid === run.pid &&
    observed.parentPid === process.pid && observed.nativeRuntime === false &&
    utc(observed.issuedAtUtc) && Date.parse(observed.issuedAtUtc) >= Date.parse(startedAtUtc) &&
    sha256(await readFile(self)) === before, 'E_CONDITIONAL_CPU_SOURCE');
  const capability = Object.freeze(Object.create(null));
  executions.set(capability, snapshotQualificationMetadata({
    schema: 'contoso.direct-observer-execution.v1', observerId, sourceKind: 'actual-cpu-process-not-native',
    nativeRuntime: false, pid: run.pid, parentPid: process.pid, startedAtUtc,
    finishedAtUtc: new Date().toISOString(), executable: process.execPath,
    commandSourceSha256: sha256(cpuSource), observerSourceSha256: before,
    directChildObserved: true, certificationEligible: false
  }));
  return capability;
}

export function requireConditionalExecution(capability, { nativeRequired = true } = {}) {
  const execution = executions.get(capability);
  requireThat(execution && (!nativeRequired || execution.nativeRuntime === true),
    'E_CONDITIONAL_PRIVATE_EXECUTION');
  return execution;
}

function parentContext(fields) {
  if (!Array.isArray(fields) || fields.length !== 1 || typeof fields[0] !== 'string') return null;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(fields[0]);
  return match && TRACE.test(match[1]) && SPAN.test(match[2])
    ? { traceId: match[1], spanId: match[2], sampled: (parseInt(match[3], 16) & 1) === 1 } : null;
}

export function checkConditionalObservedCase(candidate) {
  const { wire, runtime, nativeEnvelopes, childIdentity, forbiddenValues = [] } = observedSnapshot(candidate);
  validateRuntimeMetadata(runtime, forbiddenValues);
  requireThat(wire?.schema === 'contoso.actual-observer-wire.v1' && UUID.test(wire.caseId ?? '') &&
    UUID.test(wire.businessInvocationId ?? '') &&
    Array.isArray(wire.traceparentFields) && Array.isArray(wire.tracestateFields) &&
    wire.traceparentFields.length <= 8 && wire.tracestateFields.length <= 8 &&
    wire.traceparentFields.every(value => typeof value === 'string' && Buffer.byteLength(value) <= 256) &&
    wire.tracestateFields.every(value => typeof value === 'string' && Buffer.byteLength(value) <= 512) &&
    utc(wire.sentAtUtc), 'E_CONDITIONAL_WIRE');
  requireThat(runtime?.schema === 'contoso.actual-api-root-observation.v1' &&
    runtime.caseId === wire.caseId && runtime.pid === childIdentity?.pid &&
    Number.isSafeInteger(runtime.pid) && runtime.pid > 0 &&
    utc(runtime.processStartUtc) && utc(runtime.observedAtUtc) &&
    utc(childIdentity.finishedAtUtc) &&
    Date.parse(runtime.processStartUtc) >= Date.parse(childIdentity.startedAtUtc) - 1000 &&
    Date.parse(runtime.processStartUtc) <= Date.parse(runtime.observedAtUtc) &&
    Date.parse(runtime.observedAtUtc) >= Date.parse(wire.sentAtUtc) &&
    Date.parse(runtime.observedAtUtc) <= Date.parse(childIdentity.finishedAtUtc) &&
    runtime.roleName === 'contoso-orders-api' && runtime.requestMethod === 'GET' &&
    runtime.requestPath === '/api/me' && same(runtime.traceparentFields, wire.traceparentFields) &&
    runtime.businessInvocationId === wire.businessInvocationId &&
    same(runtime.tracestateFields, wire.tracestateFields) &&
    TRACE.test(runtime.sdkTraceId ?? '') && SPAN.test(runtime.sdkSpanId ?? '') &&
    typeof runtime.sdkRecording === 'boolean' && typeof runtime.sdkSampled === 'boolean' &&
    runtime.fixtureClassSha256 === childIdentity.fixtureClassSha256 &&
    runtime.observerClassSha256 === childIdentity.observerClassSha256 &&
    [runtime.fixtureClassSha256, runtime.observerClassSha256,
      runtime.applicationClassSha256, runtime.runtimeGuardClassSha256]
      .every(value => typeof value === 'string' && HASH.test(value)) &&
    uriPath(runtime.fixtureCodeSource) === uriPath(childIdentity.codeSource) &&
    uriPath(runtime.observerCodeSource) === uriPath(childIdentity.codeSource) &&
    runtime.applicationClassSha256 === childIdentity.applicationClassSha256 &&
    runtime.runtimeGuardClassSha256 === childIdentity.runtimeGuardClassSha256 &&
    uriPath(runtime.applicationCodeSource) === uriPath(childIdentity.applicationCodeSource) &&
    uriPath(runtime.runtimeGuardCodeSource) === uriPath(childIdentity.runtimeGuardCodeSource),
  'E_CONDITIONAL_RUNTIME_SOURCE');
  const incoming = parentContext(wire.traceparentFields);
  requireThat(Array.isArray(nativeEnvelopes), 'E_CONDITIONAL_NATIVE_SCOPE');
  const scopedSpans = nativeEnvelopes.filter(value =>
    ['RequestData', 'RemoteDependencyData'].includes(value.data?.baseType) &&
    value.tags?.['ai.operation.id'] === runtime.sdkTraceId);
  const rows = nativeEnvelopes.map((value, ordinal) => ({ value, ordinal })).filter(({ value }) =>
    value.data?.baseType === 'RequestData' && value.tags?.['ai.operation.id'] === runtime.sdkTraceId &&
    value.data.baseData?.id === runtime.sdkSpanId);
  if (incoming && !incoming.sampled) {
    requireThat(runtime.sdkTraceId === incoming.traceId && runtime.sdkSpanId !== incoming.spanId &&
      runtime.sdkSampled === false && runtime.sdkRecording === false && scopedSpans.length === 0,
    'E_CONDITIONAL_UNSAMPLED_CONTINUATION');
    return Object.freeze({ checkerOnly: true, authorityGranted: false, rootEligible: false,
      disposition: null, unsampledControl: true });
  }
  requireThat(rows.length === 1 && runtime.sdkSampled === true && runtime.sdkRecording === true,
    'E_CONDITIONAL_NATIVE_ABSENCE_OR_DUPLICATE');
  const { value: envelope, ordinal } = rows[0];
  requireThat(envelope.tags['ai.cloud.role'] === runtime.roleName && utc(envelope.time) &&
    Date.parse(envelope.time) >= Date.parse(wire.sentAtUtc) - 1000 &&
    Date.parse(envelope.time) <= Date.parse(runtime.observedAtUtc) + 1000, 'E_CONDITIONAL_NATIVE_SCOPE');
  const rawParent = envelope.tags['ai.operation.parentId'];
  let parent;
  try { parent = canonicalSpanId(rawParent, runtime.sdkTraceId); }
  catch { fail('E_CONDITIONAL_NATIVE_PARENT'); }
  requireThat(rawParent === undefined || rawParent === null || rawParent === '' || parent !== null,
    'E_CONDITIONAL_NATIVE_PARENT');
  if (incoming) {
    requireThat(runtime.sdkTraceId === incoming.traceId && runtime.sdkSpanId !== incoming.spanId &&
      parent === incoming.spanId, 'E_CONDITIONAL_VALID_PARENT_RESTART');
    return Object.freeze({ checkerOnly: true, authorityGranted: false, rootEligible: false,
      disposition: null, nativeEnvelopeOrdinal: ordinal, unsampledControl: false });
  }
  requireThat(parent === null, 'E_CONDITIONAL_ROOT_PARENT');
  const invalidClaim = wire.traceparentFields.length === 1
    ? /^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/.exec(wire.traceparentFields[0])?.[1] : null;
  requireThat(!invalidClaim || !TRACE.test(invalidClaim) || runtime.sdkTraceId !== invalidClaim,
    'E_CONDITIONAL_CONTEXT_NOT_RESTARTED');
  const disposition = wire.traceparentFields.length === 0 ? 'absent' : 'invalid';
  return Object.freeze({ checkerOnly: true, authorityGranted: false, rootEligible: true,
    disposition, nativeEnvelopeOrdinal: ordinal, unsampledControl: false });
}

function bindingFacts(snapshot, index, matching) {
  const { wire, childIdentity, nativeEnvelopes } = snapshot;
  const runtime = matching.length === 1 ? matching[0] : null;
  const incoming = parentContext(wire.traceparentFields);
  const related = runtime ? nativeEnvelopes.filter(value =>
    ['RequestData', 'RemoteDependencyData'].includes(value?.data?.baseType) &&
    value?.tags?.['ai.operation.id'] === runtime.sdkTraceId) : [];
  const requests = runtime ? nativeEnvelopes.filter(value => value?.data?.baseType === 'RequestData' &&
    value?.tags?.['ai.operation.id'] === runtime.sdkTraceId &&
    value?.data?.baseData?.id === runtime.sdkSpanId) : [];
  const request = requests.length === 1 ? requests[0] : null;
  let parent = null, parentValid = false, runtimeMetadataValid = false, originsMatch = false;
  try {
    if (runtime) {
      validateRuntimeMetadata(runtime, snapshot.forbiddenValues ?? []);
      runtimeMetadataValid = true;
      originsMatch = uriPath(runtime.fixtureCodeSource) === uriPath(childIdentity.codeSource) &&
        uriPath(runtime.observerCodeSource) === uriPath(childIdentity.codeSource) &&
        uriPath(runtime.applicationCodeSource) === uriPath(childIdentity.applicationCodeSource) &&
        uriPath(runtime.runtimeGuardCodeSource) === uriPath(childIdentity.runtimeGuardCodeSource);
    }
  } catch {}
  try {
    if (request) {
      const raw = request.tags?.['ai.operation.parentId'];
      parent = canonicalSpanId(raw, runtime.sdkTraceId);
      parentValid = raw === undefined || raw === null || raw === '' || parent !== null;
    }
  } catch {}
  return Object.freeze({
    index, kind: caseKinds[index], runtimeMatchCount: matching.length,
    matchFactsAvailable: true,
    nativeRequestMatchCount: requests.length, nativeRelatedSpanCount: related.length,
    runtimeMetadataValid,
    sdkSampled: typeof runtime?.sdkSampled === 'boolean' ? runtime.sdkSampled : null,
    sdkRecording: typeof runtime?.sdkRecording === 'boolean' ? runtime.sdkRecording : null,
    validIncomingParent: incoming !== null, incomingSampled: incoming?.sampled ?? null,
    sdkTraceMatchesIncoming: runtime && incoming ? runtime.sdkTraceId === incoming.traceId : null,
    sdkSpanAdvancesIncoming: runtime && incoming ? runtime.sdkSpanId !== incoming.spanId : null,
    runtimePidMatches: runtime ? runtime.pid === childIdentity?.pid : null,
    runtimeWireMatches: runtime ? runtime.caseId === wire.caseId &&
      runtime.businessInvocationId === wire.businessInvocationId &&
      same(runtime.traceparentFields, wire.traceparentFields) &&
      same(runtime.tracestateFields, wire.tracestateFields) : null,
    runtimeTimeMatches: runtime ? utc(runtime.processStartUtc) && utc(runtime.observedAtUtc) &&
      utc(childIdentity?.startedAtUtc) && utc(childIdentity?.finishedAtUtc) && utc(wire.sentAtUtc) &&
      Date.parse(runtime.processStartUtc) >= Date.parse(childIdentity.startedAtUtc) - 1000 &&
      Date.parse(runtime.processStartUtc) <= Date.parse(runtime.observedAtUtc) &&
      Date.parse(runtime.observedAtUtc) >= Date.parse(wire.sentAtUtc) &&
      Date.parse(runtime.observedAtUtc) <= Date.parse(childIdentity.finishedAtUtc) : null,
    runtimeClassHashesMatch: runtime ? runtime.fixtureClassSha256 === childIdentity?.fixtureClassSha256 &&
      runtime.observerClassSha256 === childIdentity?.observerClassSha256 &&
      runtime.applicationClassSha256 === childIdentity?.applicationClassSha256 &&
      runtime.runtimeGuardClassSha256 === childIdentity?.runtimeGuardClassSha256 : null,
    runtimeClassOriginsMatch: runtime ? originsMatch : null,
    nativeRoleMatches: request ? request.tags?.['ai.cloud.role'] === runtime.roleName : null,
    nativeTimeMatches: request ? utc(request.time) && utc(wire.sentAtUtc) && utc(runtime.observedAtUtc) &&
      Date.parse(request.time) >= Date.parse(wire.sentAtUtc) - 1000 &&
      Date.parse(request.time) <= Date.parse(runtime.observedAtUtc) + 1000 : null,
    nativeParentValid: request ? parentValid : null,
    nativeParentAbsent: request && parentValid ? parent === null : null,
    nativeParentMatchesIncoming: request && incoming && parentValid ? parent === incoming.spanId : null
  });
}

export function checkConditionalObservedCaseBinding(candidate, index) {
  const snapshot = observedSnapshot(candidate);
  requireThat(Number.isInteger(index) && index >= 0 && index < caseKinds.length &&
    snapshot.wire?.name === caseKinds[index] && Array.isArray(snapshot.observed) &&
    snapshot.observed.length <= 7 && Array.isArray(snapshot.nativeEnvelopes) &&
    snapshot.nativeEnvelopes.length <= 8192, 'E_CONDITIONAL_CASE_BINDING_SCOPE');
  const matching = snapshot.observed.filter(runtime => runtime?.caseId === snapshot.wire.caseId);
  try {
    requireThat(matching.length === 1, 'E_CONDITIONAL_RUNTIME_ABSENCE_OR_DUPLICATE');
    const runtime = matching[0];
    const checked = checkConditionalObservedCase({ wire: snapshot.wire, runtime,
      nativeEnvelopes: snapshot.nativeEnvelopes, childIdentity: snapshot.childIdentity,
      forbiddenValues: snapshot.forbiddenValues ?? [] });
    return Object.freeze({ runtime, checked });
  } catch (error) {
    const closed = failureError(conditionalFailureCode(error));
    try { bindingFailures.set(closed, bindingFacts(snapshot, index, matching)); }
    catch {
      bindingFailures.set(closed, Object.freeze({ index, kind: caseKinds[index],
        runtimeMatchCount: matching.length, matchFactsAvailable: false }));
    }
    throw closed;
  }
}

export function parseConditionalRuntimeFrame(bytes, forbiddenValues = []) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 8192,
    'E_CONDITIONAL_RUNTIME_BOUND');
  let runtime;
  try { runtime = parseNativeCaptureInput(bytes); }
  catch { fail('E_CONDITIONAL_RUNTIME_SCHEMA'); }
  const snapshot = observedSnapshot({ runtime, forbiddenValues });
  validateRuntimeMetadata(snapshot.runtime, snapshot.forbiddenValues);
  return snapshot.runtime;
}

function cases() {
  const valid = () => `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
  const controlParent = valid(), business = randomUUID();
  return [
    { name: 'absent', traceparentFields: [], tracestateFields: [] },
    { name: 'invalid-zero-trace', traceparentFields: [`00-${'0'.repeat(32)}-${randomBytes(8).toString('hex')}-01`], tracestateFields: [] },
    { name: 'invalid-zero-parent', traceparentFields: [`00-${randomBytes(16).toString('hex')}-${'0'.repeat(16)}-01`], tracestateFields: [] },
    { name: 'valid-parent', traceparentFields: [controlParent], tracestateFields: [], businessInvocationId: business },
    { name: 'invalid-tracestate-only', traceparentFields: [controlParent], tracestateFields: ['bad key=value'], businessInvocationId: business },
    { name: 'changed-business-id-valid-parent', traceparentFields: [controlParent], tracestateFields: [], businessInvocationId: randomUUID() },
    { name: 'valid-unsampled-parent', traceparentFields: [valid().slice(0, -2) + '00'], tracestateFields: [] }
  ].map(value => ({ businessInvocationId: randomUUID(), ...value, schema: 'contoso.actual-observer-wire.v1', caseId: randomUUID() }));
}

async function sourceSnapshot(files) {
  const found = new Map();
  const visit = async file => {
    if (found.has(file)) return;
    requireThat(found.size < 512, 'E_CONDITIONAL_SOURCE_BOUND');
    const bytes = await readBoundFile(file);
    found.set(file, sha256(bytes));
    if (!file.endsWith('.mjs')) return;
    for (const match of bytes.toString('utf8').matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      await visit(path.relative(projectRoot, path.resolve(projectRoot, path.dirname(file), match[1])));
    }
  };
  for (const file of [...new Set(files)].sort()) await visit(file);
  return [...found].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([file, digest]) => ({ path: file, sha256: digest }));
}

function childEnvironment(directory, extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(?:SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|OS|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|USERPROFILE)$/i.test(name)) env[name] = value;
  }
  return { ...env, TEMP: directory, TMP: directory, ...extra };
}

function jwt(key, fields) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const content = `${encoded({ alg: 'RS256', typ: 'JWT', kid: 'contoso-conditional-observer' })}.${encoded({
    ver: '2.0', iat: now, nbf: now - 5, exp: now + 600, ...fields
  })}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), key).toString('base64url')}`;
}

export async function sendConditionalControl(port, wire, tokens) {
  requireThat(Number.isInteger(port) && port > 0 && port < 65536, 'E_CONDITIONAL_HTTP_PORT');
  wire.sentAtUtc = new Date().toISOString();
  const headers = {
    Authorization: `Bearer ${tokens.user}`, 'X-Contoso-Gateway-Authorization': `Bearer ${tokens.gateway}`,
    'X-Contoso-Native-Case': wire.caseId, 'X-Business-Invocation-Id': wire.businessInvocationId,
    ...(wire.traceparentFields.length ? { traceparent: wire.traceparentFields } : {}),
    ...(wire.tracestateFields.length ? { tracestate: wire.tracestateFields } : {})
  };
  await new Promise((resolve, reject) => {
    let outgoing, incoming, timer, settled = false, ended = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code) {
        outgoing?.destroy();
        incoming?.destroy();
        reject(Object.assign(new Error(code), { code }));
      } else resolve();
    };
    outgoing = request({ host: '127.0.0.1', port, path: '/api/me', method: 'GET', headers, timeout: 10000 }, response => {
      incoming = response;
      let size = 0;
      response.on('aborted', () => finish('E_CONDITIONAL_HTTP_RESPONSE_ABORTED'));
      response.on('error', () => finish('E_CONDITIONAL_HTTP_RESPONSE_ERROR'));
      response.on('close', () => {
        if (!ended) finish('E_CONDITIONAL_HTTP_PREMATURE_CLOSE');
      });
      response.on('data', bytes => {
        size += bytes.length;
        if (size > 65536) finish('E_CONDITIONAL_RESPONSE_BOUND');
      });
      response.on('end', () => {
        ended = true;
        if (!response.complete) finish('E_CONDITIONAL_HTTP_PREMATURE_CLOSE');
        else finish(response.statusCode === 200 ? null : 'E_CONDITIONAL_HTTP_RESPONSE');
      });
    });
    outgoing.on('timeout', () => finish('E_CONDITIONAL_HTTP_TIMEOUT'));
    outgoing.on('error', () => finish('E_CONDITIONAL_HTTP_TRANSPORT'));
    timer = setTimeout(() => finish('E_CONDITIONAL_HTTP_TIMEOUT'), 10000);
    outgoing.end();
  });
}

async function classFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    requireThat(!entry.isSymbolicLink(), 'E_CONDITIONAL_CLASS_ORIGIN');
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await classFiles(directory, relative));
    else if (entry.isFile() && entry.name.endsWith('.class')) result.push(relative);
  }
  return result;
}

async function runtimeSnapshot(entries) {
  const files = new Set();
  for (const entry of entries) {
    requireThat(path.isAbsolute(entry), 'E_CONDITIONAL_CLASSPATH');
    const status = await lstat(entry);
    requireThat(!status.isSymbolicLink(), 'E_CONDITIONAL_CLASS_ORIGIN');
    if (status.isDirectory()) {
      for (const relative of await classFiles(entry)) files.add(path.join(entry, relative));
    } else {
      requireThat(status.isFile() && status.size <= 128 * 1024 * 1024, 'E_CONDITIONAL_RUNTIME_BOUND');
      files.add(entry);
    }
    requireThat(files.size <= 4096, 'E_CONDITIONAL_RUNTIME_BOUND');
  }
  const result = [];
  for (const file of [...files].sort()) result.push({ path: file, sha256: sha256(await readFile(file)) });
  return result;
}

export function selectConditionalExecutionClasspath(rawClasspath) {
  requireThat(typeof rawClasspath === 'string' && rawClasspath.length > 0 &&
    Buffer.byteLength(rawClasspath) <= 1_048_576, 'E_CONDITIONAL_CLASSPATH');
  const rawEntries = rawClasspath.split(';');
  requireThat(rawEntries.length <= 1024, 'E_CONDITIONAL_CLASSPATH');
  const terminalEmpty = rawEntries.length > 1 && rawEntries.at(-1) === '';
  const entries = terminalEmpty ? rawEntries.slice(0, -1) : rawEntries;
  requireThat(entries.length > 0 && entries.every(entry =>
    entry.length > 0 && entry === entry.trim() && !/[\u0000-\u001f]/.test(entry) &&
    path.win32.isAbsolute(entry) &&
    /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(entry) &&
    !entry.split(/[\\/]/).some(part => part === '.' || part === '..')),
  'E_CONDITIONAL_CLASSPATH');
  const executionClasspath = entries.join(';');
  return observedSnapshot({
    schema: 'contoso.fixed-execution-classpath.v1',
    rawPropertyScope: 'XML_ATTRIBUTE_DECODED_SUREFIRE_TEST_CLASSPATH',
    rawClasspathSha256: sha256(rawClasspath), rawEntryCount: rawEntries.length,
    executionClasspath, executionClasspathSha256: sha256(executionClasspath),
    executedEntryCount: entries.length, entries,
    exclusion: terminalEmpty
      ? { index: rawEntries.length - 1, rawValue: '', reason: 'SINGLE_TERMINAL_IMPLICIT_CWD_NOT_EXECUTED' }
      : null,
    nonemptyEntryBytesAndOrderPreserved: true,
    implicitCurrentDirectoryExecuted: false,
    sourceAcceptanceIsCertification: false
  });
}

async function executionInputs() {
  const bytes = await readBoundFile(path.join(baseline, 'source-build.json'));
  requireThat(sha256(bytes) === baselineSha256, 'E_CONDITIONAL_BASELINE');
  const build = JSON.parse(bytes);
  requireThat(build.schema === 'contoso.parent-java-reactor-build.v1' && build.result === 'PASS' &&
    build.tests === 182 && build.failures === 0 && build.errors === 0 && build.skipped === 0 &&
    build.sourcesStable === true && same(build.beforeSources, build.afterSources) &&
    build.moduleOutputs.length === 11, 'E_CONDITIONAL_BASELINE');
  const suite = build.moduleOutputs.find(value => value.module === 'services\\orders-api')?.suites
    .find(value => value.path.endsWith('TEST-com.contoso.orders.NativeApiIntegrationTest.xml'));
  requireThat(suite, 'E_CONDITIONAL_BASELINE');
  const xmlBytes = await readBoundFile(path.join(baseline, 'support', suite.path));
  requireThat(sha256(xmlBytes) === suite.sha256, 'E_CONDITIONAL_BASELINE');
  const xml = xmlBytes.toString('utf8');
  const encoded = /<property\b[^>]*name="surefire\.test\.class\.path"[^>]*value="([^"]*)"/.exec(xml)?.[1];
  requireThat(encoded, 'E_CONDITIONAL_CLASSPATH');
  const classpathSelection = selectConditionalExecutionClasspath(
    encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  const classpath = classpathSelection.executionClasspath;
  const moduleNames = new Map([
    ['contoso-correlation-core', 'services\\correlation-core'], ['security-core', 'services\\security-core'],
    ['inventory-data', 'services\\inventory-data'], ['messaging-core', 'workers\\messaging-core']
  ]);
  let coreArchive;
  for (const [artifact, module] of moduleNames) {
    const matches = classpath.split(';').filter(file => path.basename(file) === `${artifact}-1.0.0.jar`);
    const produced = build.moduleOutputs.find(value => value.module === module)?.artifact;
    requireThat(matches.length === 1 && produced &&
      sha256(await readFile(matches[0])) === produced.sha256, 'E_CONDITIONAL_CLASSPATH');
    if (artifact === 'contoso-correlation-core') coreArchive = matches[0];
  }
  const orders = build.moduleOutputs.find(value => value.module === 'services\\orders-api').artifact;
  const jar = await readBoundFile(orders.path);
  requireThat(sha256(jar) === orders.sha256, 'E_CONDITIONAL_PRODUCT_BYTES');
  const applicationClasses = path.join(projectRoot, 'services', 'orders-api', 'target', 'classes');
  const classes = await classFiles(applicationClasses);
  requireThat(classes.length > 0, 'E_CONDITIONAL_PRODUCT_BYTES');
  for (const file of classes) {
    requireThat(jarMemberSha256(jar, `BOOT-INF/classes/${file.replaceAll('\\', '/')}`) ===
      sha256(await readFile(path.join(applicationClasses, file))), 'E_CONDITIONAL_PRODUCT_BYTES');
  }
  const selected = build.afterSources.filter(source =>
    /^(?:services\\(?:orders-api|security-core|correlation-core|inventory-data)|workers\\messaging-core)\\src\\main\\/.test(source.path) ||
    source.path === 'pom.xml' || /^(?:services|workers)\\[^\\]+\\pom\.xml$/.test(source.path));
  for (const source of selected) requireThat(sha256(await readBoundFile(source.path)) === source.sha256, 'E_CONDITIONAL_SOURCE_DRIFT');
  const applicationOrigins = {
    applicationCodeSource: pathToFileURL(applicationClasses + path.sep).href,
    applicationClassSha256: sha256(await readFile(path.join(applicationClasses, 'com', 'contoso', 'orders', 'OrdersApplication.class'))),
    runtimeGuardCodeSource: pathToFileURL(coreArchive).href,
    runtimeGuardClassSha256: jarMemberSha256(await readFile(coreArchive), 'com/contoso/correlation/RuntimeGuard.class')
  };
  return { build, classpath, classpathSelection, selected, applicationOrigins };
}

export async function executeLocalConditionalObserver(...args) {
  requireThat(args.length === 0, 'E_CONDITIONAL_CALLER_ENROLLMENT');
  // A real Java fixture port and direct execution are mandatory; a receipt file is not an alternative.
  try { await readBoundFile(filterSource); } catch { fail('E_CONDITIONAL_JAVA_PORT_REQUIRED'); }
  const { build, classpath, classpathSelection, selected, applicationOrigins } = await executionInputs();
  const registry = JSON.parse(await readBoundFile('contracts\\verification-observer-registry.v1.json'));
  const registration = registry.localNativeExecutionFactories?.find(value => value.id === observerId);
  requireThat(factories.get(observerId) === executeLocalConditionalObserver &&
    registration?.factory === 'executeLocalConditionalObserver' &&
    registration.module === 'tools\\verification\\conditional-observer.mjs' &&
    registration.sourceKind === 'real-local-agent-loopback' && registration.allowedMode === 'LocalValidate' &&
    same(registration.allowedBoundaries, ['orders.request']) &&
    registration.requiresDirectChildExecution === true && registration.savedJsonCanEnroll === false &&
    registration.queryReceiptCanEnroll === false && registration.azureAuthority === false,
  'E_CONDITIONAL_FACTORY_REGISTRY');
  requireThat(sha256(await readBoundFile('tools\\security\\native-payload.mjs')) === privacySourceSha256,
    'E_CONDITIONAL_ORIGINAL_POLICY_SOURCE');
  requireThat(HASH.test(intakeSourceSha256 ?? ''), 'E_CONDITIONAL_INTAKE_SOURCE_NOT_READY');
  requireThat(sha256(await readBoundFile('tools\\observability\\sampler-native-intake.mjs')) === intakeSourceSha256,
    'E_CONDITIONAL_INTAKE_SOURCE');
  const { NATIVE_POLICY_SOURCE_SHA256 } = await import('../security/native-payload.mjs');
  requireThat(NATIVE_POLICY_SOURCE_SHA256 === privacySourceSha256, 'E_CONDITIONAL_ORIGINAL_POLICY_SOURCE');
  const sourceFiles = [...policySources, fixtureSource, filterSource, ...selected.map(source => source.path)];
  const before = await sourceSnapshot(sourceFiles);
  const startedAtUtc = new Date().toISOString();
  const captureId = randomUUID(), publisher = randomUUID();
  const pack = path.join(projectRoot, 'evidence', 'verification', 'conditional-native',
    `${startedAtUtc.replaceAll(/[-:.]/g, '')}-${captureId}`);
  await createBoundDirectory(pack);
  const compiled = path.join(pack, 'classes');
  await createBoundDirectory(compiled);
  await writeFile(path.join(pack, 'classpath-selection.json'), jsonBytes({
    classpathSelection,
    plannedJvmClasspathSha256: sha256(compiled + ';' + classpath),
    plannedJvmClasspathEntryCount: classpathSelection.executedEntryCount + 1,
    plannedPrepend: 'FRESH_RUN_OWNED_COMPILED_TEST_PORT_DIRECTORY',
    status: 'CONSTRUCTED_INPUT_NOT_PROOF_OF_EXECUTION',
    implicitCurrentDirectoryPlanned: false,
    sourceAcceptanceIsCertification: false
  }), { flag: 'wx' });
  requireThat(sha256(await readFile(build.toolchain.java)) === build.toolchain.javaSha256 &&
    sha256(await readFile(build.toolchain.javac)) === build.toolchain.javacSha256, 'E_CONDITIONAL_TOOL_BYTES');
  const compilerStartedAtUtc = new Date().toISOString();
  const compile = await child(build.toolchain.javac, ['-cp', classpath, '-d', compiled,
    path.join(projectRoot, fixtureSource), path.join(projectRoot, filterSource)],
  { timeout: 60000, env: childEnvironment(pack) });
  const compilerFinishedAtUtc = new Date().toISOString();
  requireThat(compile.code === 0 && !compile.signal, 'E_CONDITIONAL_FIXTURE_COMPILE');
  const fixtureClassSha256 = sha256(await readFile(path.join(compiled, 'com', 'contoso', 'orders', 'NativeApiFixture.class')));
  const observerClassSha256 = sha256(await readFile(path.join(compiled, 'com', 'contoso', 'orders', 'NativeTrustRootObservationFilter.class')));
  const identities = Object.fromEntries(['TENANT', 'PUBLIC_AUDIENCE', 'ORDERS_AUDIENCE', 'INVENTORY_AUDIENCE',
    'STOREFRONT_CLIENT', 'PORTAL_CLIENT', 'PORTAL_OBJECT', 'ORDERS_CLIENT', 'ORDERS_OBJECT',
    'GATEWAY_CLIENT', 'GATEWAY_OBJECT'].map(name => [`CONTOSO_TEST_${name}`, randomUUID()]));
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'contoso-conditional-observer', alg: 'RS256', use: 'sig' };
  const issuer = `https://login.microsoftonline.com/${identities.CONTOSO_TEST_TENANT}/v2.0`;
  const userObject = randomUUID();
  const tokens = {
    user: jwt(key.privateKey, { iss: issuer, tid: identities.CONTOSO_TEST_TENANT,
      aud: identities.CONTOSO_TEST_PUBLIC_AUDIENCE, azp: identities.CONTOSO_TEST_STOREFRONT_CLIENT,
      oid: userObject, idtyp: 'user', roles: [], scp: 'Orders.Invoke' }),
    gateway: jwt(key.privateKey, { iss: issuer, tid: identities.CONTOSO_TEST_TENANT,
      aud: identities.CONTOSO_TEST_ORDERS_AUDIENCE, azp: identities.CONTOSO_TEST_GATEWAY_CLIENT,
      oid: identities.CONTOSO_TEST_GATEWAY_OBJECT, idtyp: 'app', roles: ['Gateway.Invoke'] })
  };
  const forbiddenValues = [tokens.user, tokens.gateway, userObject, ...Object.values(identities)];
  const runtimeForbiddenValues = [...forbiddenValues, publisher];
  let captureFailure;
  const lock = JSON.parse(await readBoundFile('config\\versions.lock.json'));
  const extension = lock.extensions?.[0];
  requireThat(extension?.sha256 === 'bb829be676bdc86e9a0657391764a419c7665c47542c2e53f64c37761f45193f', 'E_CONDITIONAL_GUARD');
  const extensionFile = path.join(projectRoot, extension.module, extension.file);
  requireThat(sha256(await readFile(extensionFile)) === extension.sha256, 'E_CONDITIONAL_GUARD');
  const toolRoot = path.resolve(path.dirname(build.toolchain.java), '..', '..');
  const agentFile = path.join(toolRoot, 'agent', 'applicationinsights-agent-3.7.10.jar');
  requireThat(sha256(await readFile(agentFile)) === lock.agent.sha256, 'E_CONDITIONAL_AGENT');
  const configuration = JSON.parse(await readBoundFile('config\\java-agent.json'));
  delete configuration.sampling.requestsPerSecond;
  configuration.sampling.percentage = 100;
  const configFile = path.join(pack, 'java-agent.json'), leaseFile = path.join(pack, 'sampling-lease.json');
  await writeFile(configFile, jsonBytes(configuration), { flag: 'wx' });
  const absent = { $contosoAbsent: true };
  const owned = { 'sampling.percentage': 100, 'sampling.requestsPerSecond': absent, 'sampling.overrides': [] };
  const prior = { 'sampling.percentage': absent, 'sampling.requestsPerSecond': 5, 'sampling.overrides': [] };
  const now = Date.now();
  await writeFile(leaseFile, jsonBytes({
    schema: 'contoso.sampling-runtime-lease.v1', runId: captureId, layerId: 'contoso-orders-api',
    revision: `cert-${captureId}`, startsAtUtc: new Date(now - 1000).toISOString(),
    expiresAtUtc: new Date(now + 150000).toISOString(), drainAtUtc: new Date(now + 140000).toISOString(),
    restoreDeadlineUtc: new Date(now + 170000).toISOString(), hashAlgorithm: 'contoso.canonical-json.sha256.v1',
    ownedConfigSha256: ownedConfigurationHash(owned), baselineOwnedConfigSha256: ownedConfigurationHash(prior),
    ownedConfiguration: owned, guard: { sha256: extension.sha256, providerClass: extension.providerClass,
      sdkAbi: extension.sdkAbi, version: extension.version, policy: extension.guardPolicy }
  }), { flag: 'wx' });
  const env = childEnvironment(pack, { ...identities, CONTOSO_TEST_PUBLIC_JWK: JSON.stringify(publicJwk),
    CONTOSO_TEST_INVENTORY_BASE: 'http://127.0.0.1:1/api', CONTOSO_TEST_INVENTORY_TOKEN: tokens.user,
    CONTOSO_TRUST_ROOT_OBSERVER: 'true', SERVER_PORT: '0',
    APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true',
    APPLICATIONINSIGHTS_CONFIGURATION_FILE: configFile, APPLICATIONINSIGHTS_ROLE_NAME: 'contoso-orders-api',
    OTEL_SERVICE_NAME: 'contoso-orders-api', CONTOSO_SAMPLING_LEASE_FILE: leaseFile, CONTOSO_CERTIFICATION_MODE: 'false',
    CONTOSO_CERT_START: new Date(now - 1000).toISOString(), CONTOSO_CERT_END: new Date(now + 150000).toISOString(),
    CONTOSO_CERT_WINDOW_ID: captureId });
  for (const name of ['JDBC', 'REDIS', 'AZURE_SDK']) env[`APPLICATIONINSIGHTS_INSTRUMENTATION_${name}_ENABLED`] = 'false';
  for (const name of ['APPLICATIONINSIGHTS_ENABLE_AGENT', 'JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY', 'INITIALIZED_FROM_PLACEHOLDER']) env[name] = 'false';
  const guardSource = (await readBoundFile('services\\correlation-core\\src\\main\\java\\com\\contoso\\correlation\\RuntimeGuard.java')).toString('utf8');
  const manual = /MANUAL_MODULES\s*=\s*List\.of\(([\s\S]*?)\);/.exec(guardSource)?.[1];
  const modules = manual ? [...manual.matchAll(/"([^"]+)"/g)].map(match => match[1]) : [];
  requireThat(same(modules, ['jdbc', 'jdbc-datasource', 'lettuce', 'jedis', 'redisson', 'azure-core', 'ai-azure-functions']),
    'E_CONDITIONAL_INSTRUMENTATION_SCOPE');
  const javaArgs = ['-Djava.io.tmpdir=' + pack, '-javaagent:' + agentFile,
    '-Dotel.javaagent.extensions=' + extensionFile,
    ...modules.map(module => `-Dotel.instrumentation.${module}.enabled=false`),
    '-cp', compiled + ';' + classpath,
    'com.contoso.orders.NativeApiFixture', 'orders'];
  const runtimeFiles = [build.toolchain.java, build.toolchain.javac, process.execPath,
    agentFile, extensionFile, compiled, ...classpath.split(';')];
  const runtimeBefore = await runtimeSnapshot(runtimeFiles);
  const receiver = await openSamplerNativeReceiver({
    publisherKeys: [publisher], forbiddenValues,
    onEcho() { throw new Error('UNUSED_OBSERVER_ECHO_ROUTE'); }
  });
  const endpoint = receiver.endpoint;
  env.APPLICATIONINSIGHTS_CONNECTION_STRING = `InstrumentationKey=${publisher};IngestionEndpoint=${endpoint};LiveEndpoint=${endpoint}`;
  const childStartedAtUtc = new Date().toISOString();
  const processChild = spawn(build.toolchain.java, javaArgs, { cwd: projectRoot, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const observed = [];
  let partial = Buffer.alloc(0), outputBytes = 0, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const closed = new Promise(resolve => processChild.once('close', (code, signal) => {
    readyReject(failureError('E_CONDITIONAL_EXIT_BEFORE_READY'));
    resolve({ code, signal });
  }));
  const timer = setTimeout(() => { captureFailure = 'E_CONDITIONAL_PROCESS_DEADLINE'; processChild.kill(); }, 180000);
  processChild.on('error', () => readyReject(failureError('E_CONDITIONAL_PROCESS_START')));
  processChild.stdout.on('data', bytes => {
    outputBytes += bytes.length;
    if (outputBytes > 2 * 1024 * 1024) { captureFailure = 'E_CONDITIONAL_PROCESS_BOUND'; processChild.kill(); return; }
    partial = Buffer.concat([partial, bytes]);
    let index;
    while ((index = partial.indexOf(0x0a)) >= 0) {
      let rawLine = partial.subarray(0, index);
      if (rawLine.at(-1) === 0x0d) rawLine = rawLine.subarray(0, rawLine.length - 1);
      partial = partial.subarray(index + 1);
      const line = rawLine.toString('utf8');
      if (line.startsWith('CONTOSO_NATIVE_API_READY ')) readyResolve(Number(line.slice('CONTOSO_NATIVE_API_READY '.length)));
      if (line.startsWith('CONTOSO_NATIVE_ROOT_OBSERVATION ')) {
        try {
          requireThat(rawLine.length <= 8192 && observed.length < 7, 'E_CONDITIONAL_RUNTIME_BOUND');
          observed.push(parseConditionalRuntimeFrame(rawLine.subarray(Buffer.byteLength('CONTOSO_NATIVE_ROOT_OBSERVATION ')),
            runtimeForbiddenValues));
        } catch (error) {
          captureFailure = conditionalFailureCode(error, 'E_CONDITIONAL_RUNTIME_SCHEMA');
          processChild.kill();
        }
      }
    }
  });
  processChild.stderr.on('data', bytes => {
    outputBytes += bytes.length;
    if (outputBytes > 2 * 1024 * 1024) { captureFailure = 'E_CONDITIONAL_PROCESS_BOUND'; processChild.kill(); }
  });
  const wires = cases();
  let readyTimer;
  let verificationStage = 'CHILD_READINESS';
  let failureArtifacts = null;
  let failureArtifactState = 'NOT_ELIGIBLE_ORIGINAL_PRIVACY_NOT_COMPLETED';
  try {
    const port = await Promise.race([ready, new Promise((_, reject) => {
      readyTimer = setTimeout(() => reject(failureError('E_CONDITIONAL_READY_TIMEOUT')), 45000);
    })]);
    clearTimeout(readyTimer);
    requireThat(Number.isInteger(port) && port > 0 && port < 65536, 'E_CONDITIONAL_READY_PORT');
    verificationStage = 'ACTUAL_HTTP_CONTROLS';
    for (const wire of wires) await sendConditionalControl(port, wire, tokens);
    processChild.stdin.end('\n');
    const result = await closed;
    clearTimeout(timer);
    requireThat(result.code === 0 && !result.signal && !captureFailure, captureFailure ?? 'E_CONDITIONAL_CHILD_EXIT');
    verificationStage = 'NATIVE_RECEIVER_DRAIN';
    const intake = await receiver.finish();
    const native = { ...intake.originalPrivacyCapture,
      nativeEnvelopes: intake.observations.map(value => value.envelope) };
    requireThat(native.verified === true && native.validatorPid === process.pid &&
      native.nodeVersion === process.version && native.validatorSourceSha256 === privacySourceSha256 &&
      native.sharedPolicySha256 === sha256(await readBoundFile('tools\\security\\values.mjs')) &&
      native.independentProducerAuthorityVerified === false && native.allTablePrivacyGateVerified === false &&
      native.sourceAcceptanceIsCertification === false &&
      native.actualCounts.payloads === native.payloadReceipts.length && native.actualCounts.payloads > 0 &&
      native.actualCounts.originalRawBytes === native.payloadReceipts.reduce((sum, value) => sum + value.originalPayloadBytes, 0) &&
      native.actualCounts.decodedBytes === native.payloadReceipts.reduce((sum, value) => sum + value.decodedPayloadBytes, 0) &&
      native.actualCounts.envelopes === native.nativeEnvelopes.length &&
      native.actualCounts.envelopes === native.payloadReceipts.reduce((sum, value) => sum + value.originalEnvelopeCount, 0) &&
      native.payloadReceipts.every(receipt =>
        HASH.test(receipt.originalPayloadSha256 ?? '') &&
        receipt.originalPayloadBytes > 0 && receipt.decodedPayloadBytes > 0 && receipt.strictDuplicateKeysVerified === true &&
        receipt.scannedAllOriginalValues === true && receipt.projectedAfterScan === true &&
        receipt.originalPayloadRetained === false), 'E_CONDITIONAL_ORIGINAL_PRIVACY_BINDING');
    const childIdentity = {
      pid: processChild.pid, startedAtUtc: childStartedAtUtc, finishedAtUtc: new Date().toISOString(),
      codeSource: pathToFileURL(compiled + path.sep).href,
      fixtureClassSha256, observerClassSha256, ...applicationOrigins
    };
    const diagnosticMetadata = { diagnosticsOnly: true, authorityGranted: false,
      savedJsonCanEnroll: false, sourceAcceptanceIsCertification: false, certification: 'NOT_CERTIFIED' };
    const artifacts = [
      { path: 'failure-actual-cases.json', bytes: jsonBytes({
        schema: 'contoso.local-conditional-failed-observations.v1', ...diagnosticMetadata,
        ...observedSnapshot({ wires, observed, childIdentity })
      }) },
      { path: 'failure-native-safe-capture.json', bytes: jsonBytes({
        schema: 'contoso.local-conditional-failed-native.v1', ...diagnosticMetadata,
        originalPrivacyValidatedProjection: observedSnapshot(native)
      }) },
      { path: 'failure-input-context.json', bytes: jsonBytes({
        schema: 'contoso.local-conditional-failed-inputs.v1', ...diagnosticMetadata,
        sourceBefore: before, runtimeBefore, classpathSelection,
        actualJavaPid: processChild.pid, compilerPid: compile.pid,
        actualJvmClasspathSha256: sha256(compiled + ';' + classpath),
        actualJvmClasspathEntryCount: classpathSelection.executedEntryCount + 1,
        implicitCurrentDirectoryExecuted: false,
        afterSourceAndRuntimeChecks: 'NOT_COMPLETED_AT_CASE_BINDING'
      }) }
    ];
    if (artifacts.reduce((sum, value) => sum + value.bytes.length, 0) <= 4 * 1024 * 1024) {
      failureArtifacts = artifacts;
      failureArtifactState = 'BOUNDED_VALIDATED_DATA_READY_NOT_PUBLISHED';
    } else failureArtifactState = 'OMITTED_FOUR_MIB_BOUND';
    const map = JSON.parse(await readBoundFile('contracts\\expected-boundary-map.v1.json'));
    const rows = [], requests = [], proofArtifacts = [];
    const locators = native.payloadReceipts.flatMap((receipt, payloadOrdinal) =>
      Array.from({ length: receipt.originalEnvelopeCount }, (_, envelopeOrdinal) =>
        ({ payloadOrdinal, envelopeOrdinal, originalPayloadSha256: receipt.originalPayloadSha256 })));
    verificationStage = 'ACTUAL_RUNTIME_NATIVE_CASE_BINDING';
    for (const [index, wire] of wires.entries()) {
      const { runtime, checked } = checkConditionalObservedCaseBinding({
        wire, observed, nativeEnvelopes: native.nativeEnvelopes,
        childIdentity, forbiddenValues: runtimeForbiddenValues
      }, index);
      if (!checked.rootEligible) continue;
      const envelope = native.nativeEnvelopes[checked.nativeEnvelopeOrdinal];
      const locator = { captureId, nativeTable: 'requests', rowOrdinal: checked.nativeEnvelopeOrdinal,
        ...locators[checked.nativeEnvelopeOrdinal] };
      const row = {
        schemaVersion: 'contoso.telemetry-evidence.v1', sourceKind: 'real-local-agent-loopback', recordKind: 'span',
        traceId: envelope.tags['ai.operation.id'], spanId: envelope.data.baseData.id, parentSpanId: null,
        semanticKind: 'SERVER', roleName: envelope.tags['ai.cloud.role'], nativeTable: 'requests',
        timeGeneratedUtc: envelope.time, nativeProperties: {}, recordLocator: locator
      };
      rows.push(row);
      const carrier = { schema: 'contoso.native-carrier-disposition.v1', disposition: checked.disposition,
        traceId: row.traceId, spanId: row.spanId, traceparentFieldCount: wire.traceparentFields.length,
        validTraceparent: false, validTrustedParent: false, caseId: wire.caseId,
        runtimeEvidenceSha256: conditionalEvidenceHash(runtime), wireEvidenceSha256: conditionalEvidenceHash(wire) };
      const receipt = { schema: 'contoso.native-trust-root.v1', boundaryId: 'orders.request',
        traceId: row.traceId, spanId: row.spanId, parentSpanId: null, disposition: checked.disposition,
        policyRef: rootPolicy, technicalContextRestarted: true, invalidTracestateOnly: false,
        carrierEvidenceSha256: conditionalEvidenceHash(carrier) };
      proofArtifacts.push({ kind: 'native-wire', sourceKind: row.sourceKind, sha256: conditionalEvidenceHash(carrier), value: carrier },
        { kind: 'native-runtime', sourceKind: row.sourceKind, sha256: conditionalEvidenceHash(receipt), value: receipt });
      requests.push({ boundaryId: 'orders.request', traceId: row.traceId, spanId: row.spanId,
        disposition: checked.disposition, reason: 'Actual direct child wire/SDK/native case', observed: true,
        evidenceSha256: conditionalEvidenceHash(receipt) });
    }
    requireThat(requests.length === 3 && new Set(requests.map(value => value.traceId)).size === 3 &&
      observed.length === wires.length &&
      new Set(observed.map(value => `${value.sdkTraceId}:${value.sdkSpanId}`)).size === wires.length,
    'E_CONDITIONAL_CASE_COVERAGE');
    verificationStage = 'AFTER_SOURCE_AND_RUNTIME_BYTES';
    const after = await sourceSnapshot(sourceFiles);
    requireThat(same(before, after), 'E_CONDITIONAL_SOURCE_DRIFT');
    const runtimeAfter = await runtimeSnapshot(runtimeFiles);
    requireThat(same(runtimeBefore, runtimeAfter), 'E_CONDITIONAL_RUNTIME_DRIFT');
    const execution = observedSnapshot({
      schema: 'contoso.direct-observer-execution.v1', observerId, captureId,
      evidenceDirectory: path.relative(projectRoot, pack), sourceKind: 'real-local-agent-loopback',
      nativeRuntime: true, pid: processChild.pid, startedAtUtc, finishedAtUtc: new Date().toISOString(),
      directChildObserved: true, compilerPid: compile.pid, compilerExitCode: compile.code,
      compilerStartedAtUtc, compilerFinishedAtUtc, compilerExecutableSha256: build.toolchain.javacSha256,
      javaExecutableSha256: build.toolchain.javaSha256, fixtureClassSha256, observerClassSha256,
      applicationOrigins, childStartedAtUtc,
      classpathSelection,
      actualJvmClasspathSha256: sha256(compiled + ';' + classpath),
      actualJvmClasspathEntryCount: classpathSelection.executedEntryCount + 1,
      actualJvmClasspathPrepend: 'FRESH_RUN_OWNED_COMPILED_TEST_PORT_DIRECTORY',
      implicitCurrentDirectoryExecuted: false,
      runtimeByteClosure: runtimeAfter, runtimeBeforeAfterMatched: true,
      baselineSha256, sources: after, sourcesBeforeAfterMatched: true,
      originalPrivacyPolicySha256: NATIVE_POLICY_SOURCE_SHA256,
      originalIntakeSourceSha256: intakeSourceSha256,
      receiverDiagnostics: intake.receiverDiagnostics,
      nativePayloads: native.payloadReceipts.length, nativeEnvelopes: native.nativeEnvelopes.length,
      caseControls: wires.map(wire => wire.name), nativeAuthorityScope: 'LOCAL_ORDERS_CONDITIONAL_CASES_ONLY',
      azureAuthority: false, fullPathVerified: false, globalPrivacyVerified: false, certificationEligible: false
    });
    const capability = Object.freeze(Object.create(null));
    executions.set(capability, execution);
    captures.set(capability, observedSnapshot({
      observerId, mode: 'LocalValidate', map, rows, requests, proofArtifacts, execution,
      mapSha256: conditionalEvidenceHash(map), rowsSha256: conditionalEvidenceHash(rows),
      requestsSha256: conditionalEvidenceHash(requests), proofArtifactsSha256: conditionalEvidenceHash(proofArtifacts),
      actualSourceVerified: true, nativeRuntimeCarrierObserverEnrolled: true,
      originScope: 'DIRECT_EXECUTED_LOCAL_ORDERS_CONDITIONAL_CASES_ONLY_NOT_FULL_GRAPH'
    }));
    verificationStage = 'IMMUTABLE_SAFE_PUBLICATION';
    await writeFile(path.join(pack, 'execution.json'), jsonBytes(execution), { flag: 'wx' });
    await writeFile(path.join(pack, 'case-proofs.json'), jsonBytes({ rows, requests, proofArtifacts }), { flag: 'wx' });
    await writeFile(path.join(pack, 'actual-cases.json'), jsonBytes({ wires, observed, childIdentity }), { flag: 'wx' });
    await writeFile(path.join(pack, 'native-safe-capture.json'), jsonBytes(native), { flag: 'wx' });
    await writeManifest(pack, { sourceKind: execution.sourceKind, sourceAcceptanceIsCertification: false,
      scope: execution.nativeAuthorityScope, certification: 'NOT_CERTIFIED' });
    completedNativeExecutions++;
    return capability;
  } catch (error) {
    const diagnostics = conditionalFailureDiagnostics(error);
    const publishedFailureArtifacts = [];
    if (failureArtifacts) {
      try {
        for (const artifact of failureArtifacts) {
          await writeFile(path.join(pack, artifact.path), artifact.bytes, { flag: 'wx' });
          publishedFailureArtifacts.push({ path: artifact.path, sha256: sha256(artifact.bytes),
            bytes: artifact.bytes.length });
        }
        failureArtifactState = 'PUBLISHED_VALIDATED_DIAGNOSTICS_ONLY';
      } catch { failureArtifactState = 'SAFE_ARTIFACT_WRITE_FAILED'; }
    }
    try {
      await writeFile(path.join(pack, 'failure.json'), jsonBytes({
        schema: 'contoso.local-conditional-failure.v2', result: 'FAIL_OR_UNVERIFIED',
        verificationStage, ...diagnostics,
        actualJavaPid: processChild.pid ?? null, compilerPid: compile.pid,
        observedRuntimeRecordCount: observed.length, expectedRuntimeRecordCount: wires.length,
        failureArtifactState, publishedFailureArtifacts,
        receiverDiagnostics: receiver.diagnostics(),
        diagnosticsTiming: 'AT_FAILURE_BEFORE_FINALLY_STOP',
        rawRuntimeOrProcessDiagnosticsPersisted: false,
        sourceAcceptanceIsCertification: false, certification: 'NOT_CERTIFIED'
      }), { flag: 'wx' });
      await writeManifest(pack, { sourceAcceptanceIsCertification: false, certification: 'NOT_CERTIFIED',
        result: 'FAIL_OR_UNVERIFIED' });
    } catch { /* Publication failure must not replace the original closed assertion or expose an I/O error. */ }
    const closedFailure = failureError(diagnostics.code);
    if (diagnostics.bindingCase) bindingFailures.set(closedFailure, diagnostics.bindingCase);
    throw closedFailure;
  } finally {
    clearTimeout(timer);
    clearTimeout(readyTimer);
    if (processChild.exitCode === null && processChild.signalCode === null) { processChild.kill(); await closed; }
    await receiver.stop();
  }
}

export function requireLocalConditionalCapture(capability) {
  requireConditionalExecution(capability);
  const capture = captures.get(capability);
  requireThat(capture, 'E_CONDITIONAL_PRIVATE_CAPTURE');
  return capture;
}

export function requireLocalConditionalEvidence(capability, candidate) {
  const capture = requireLocalConditionalCapture(capability);
  const { map, rows, requests, proofArtifacts, mode } = observedSnapshot(candidate);
  requireThat(mode === 'LocalValidate' && capture.mode === mode &&
    capture.mapSha256 === conditionalEvidenceHash(map) && capture.rowsSha256 === conditionalEvidenceHash(rows) &&
    capture.requestsSha256 === conditionalEvidenceHash(requests) &&
    capture.proofArtifactsSha256 === conditionalEvidenceHash(proofArtifacts), 'E_CONDITIONAL_SOURCE_BINDING');
  return capture;
}

factories.set(observerId, executeLocalConditionalObserver);
