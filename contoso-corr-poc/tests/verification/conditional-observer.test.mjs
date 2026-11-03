import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { projectRoot, readBoundFile, sha256, nativeEvidenceHash } from '../../tools/verification/files.mjs';
import { openSamplerNativeReceiver } from '../../tools/observability/sampler-native-intake.mjs';
import { checkConditionalObservedCase, conditionalSourceRegistry, executeConditionalSourceProbe,
  executeLocalConditionalObserver, requireConditionalExecution, requireLocalConditionalCapture,
  requireLocalConditionalEvidence, parseConditionalRuntimeFrame,
  sendConditionalControl, selectConditionalExecutionClasspath, checkConditionalObservedCaseBinding,
  conditionalFailureCode, conditionalFailureDiagnostics, conditionalEvidenceHash } from '../../tools/verification/conditional-observer.mjs';
import { classifyVerifiedTrustRoots } from '../../tools/verification/trust-roots.mjs';
import { verifyGraphIntake } from '../../tools/verification/pipeline.mjs';
import { conditionalObserverMain } from '../../tools/verification/run-conditional-observer.mjs';
import { captureNativePayloads } from '../../tools/security/native-payload.mjs';

const trace = 'a'.repeat(32), span = 'b'.repeat(16), parent = 'c'.repeat(16);
const source = pathToFileURL(path.join(projectRoot, '.cache', 'checker-only-classes') + path.sep).href;

test('actual immutable Surefire classpath removes only its single terminal implicit-CWD element', async () => {
  const xml = (await readBoundFile('evidence\\java-local\\source-builds\\20261102T020237806Z-integrated-reactor-bbf3e7ef-36b8-4d66-b009-df47b708d6d3\\support\\services\\orders-api\\target\\surefire-reports\\TEST-com.contoso.orders.NativeApiIntegrationTest.xml')).toString('utf8');
  const encoded = /<property\b[^>]*name="surefire\.test\.class\.path"[^>]*value="([^"]*)"/.exec(xml)?.[1];
  assert.ok(encoded);
  const raw = encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  const selection = selectConditionalExecutionClasspath(raw);
  assert.equal(selection.rawEntryCount, 137);
  assert.equal(selection.executedEntryCount, 136);
  assert.deepEqual(selection.entries, raw.split(';').slice(0, -1));
  assert.equal(selection.executionClasspath, raw.slice(0, -1));
  assert.equal(selection.rawClasspathSha256, sha256(raw));
  assert.equal(selection.executionClasspathSha256, sha256(raw.slice(0, -1)));
  assert.deepEqual({ ...selection.exclusion },
    { index: 136, rawValue: '', reason: 'SINGLE_TERMINAL_IMPLICIT_CWD_NOT_EXECUTED' });
  assert.equal(selection.implicitCurrentDirectoryExecuted, false);
  assert.equal(selection.nonemptyEntryBytesAndOrderPreserved, true);
  assert.ok(Object.isFrozen(selection.entries));
  assert.throws(() => requireLocalConditionalCapture(selection), /PRIVATE_EXECUTION/);
});

test('classpath selection preserves nonempty bytes/order and rejects all relative/interior/ambiguous empties', () => {
  const raw = 'C:\\absolute\\test classes;D:\\m2\\second.jar;C:\\m2\\first.jar';
  const selection = selectConditionalExecutionClasspath(raw);
  assert.equal(selection.executionClasspath, raw);
  assert.equal(selection.exclusion, null);
  assert.deepEqual(selection.entries, raw.split(';'));
  for (const bad of ['', ';', raw + ';;', ';' + raw, raw.replace(';', ';;'),
    raw + ';.', raw + ';relative.jar', raw + ';C:relative.jar', raw + ';\\drive-relative\\classes',
    raw + '; ', raw + ';C:\\absolute\\..\\ambiguous.jar', '"C:\\absolute\\quoted.jar"']) {
    assert.throws(() => selectConditionalExecutionClasspath(bad), /E_CONDITIONAL_CLASSPATH/);
  }
});

function fixture(traceparentFields = []) {
  const wire = { schema: 'contoso.actual-observer-wire.v1',
    caseId: '12345678-1234-4234-8234-123456789012',
    businessInvocationId: '23456789-1234-4234-8234-123456789012',
    traceparentFields, tracestateFields: [], sentAtUtc: '2026-11-02T00:00:01.000Z' };
  const runtime = {
    schema: 'contoso.actual-api-root-observation.v1', caseId: wire.caseId,
    pid: 1234, processStartUtc: '2026-11-02T00:00:00.500Z', observedAtUtc: '2026-11-02T00:00:01.100Z',
    roleName: 'contoso-orders-api', requestMethod: 'GET', requestPath: '/api/me',
    businessInvocationId: wire.businessInvocationId,
    traceparentFields: [...traceparentFields], tracestateFields: [],
    sdkTraceId: trace, sdkSpanId: span, sdkSampled: true, sdkRecording: true,
    fixtureCodeSource: source, fixtureClassSha256: '1'.repeat(64),
    observerCodeSource: source, observerClassSha256: '2'.repeat(64),
    applicationCodeSource: source, applicationClassSha256: '3'.repeat(64),
    runtimeGuardCodeSource: source, runtimeGuardClassSha256: '4'.repeat(64)
  };
  return {
    wire, runtime,
    childIdentity: { pid: 1234, startedAtUtc: '2026-11-02T00:00:00.000Z',
      finishedAtUtc: '2026-11-02T00:00:02.000Z', codeSource: source,
      fixtureClassSha256: runtime.fixtureClassSha256, observerClassSha256: runtime.observerClassSha256,
      applicationCodeSource: source, applicationClassSha256: runtime.applicationClassSha256,
      runtimeGuardCodeSource: source, runtimeGuardClassSha256: runtime.runtimeGuardClassSha256 },
    nativeEnvelopes: [{ time: '2026-11-02T00:00:01.000Z',
      tags: { 'ai.cloud.role': runtime.roleName, 'ai.operation.id': trace },
      data: { baseType: 'RequestData', baseData: { id: span } } }]
  };
}

function bindingFixture(index) {
  const kinds = ['absent', 'invalid-zero-trace', 'invalid-zero-parent', 'valid-parent',
    'invalid-tracestate-only', 'changed-business-id-valid-parent', 'valid-unsampled-parent'];
  const fields = index === 0 ? [] : index === 1 ? [`00-${'0'.repeat(32)}-${parent}-01`] :
    index === 2 ? [`00-${trace}-${'0'.repeat(16)}-01`] :
      [`00-${trace}-${parent}-${index === 6 ? '00' : '01'}`];
  const value = fixture(fields);
  value.wire.name = kinds[index];
  if (index === 2) {
    value.runtime.sdkTraceId = 'd'.repeat(32);
    value.nativeEnvelopes[0].tags['ai.operation.id'] = value.runtime.sdkTraceId;
  }
  if (index >= 3 && index < 6) value.nativeEnvelopes[0].tags['ai.operation.parentId'] = parent;
  if (index === 4) {
    value.wire.tracestateFields = ['bad key=value'];
    value.runtime.tracestateFields = ['bad key=value'];
  }
  if (index === 6) {
    value.runtime.sdkSampled = false;
    value.runtime.sdkRecording = false;
    value.nativeEnvelopes = [];
  }
  const { runtime, ...rest } = value;
  return { ...rest, observed: [runtime] };
}

test('production hash boundary accepts all seven saved returned runtime snapshots without enrolling saved evidence', async () => {
  const directory = 'evidence\\verification\\conditional-native\\20261102T040609266Z-9fa81256-2ad3-44bf-8b52-8759a5c2d2d6\\';
  const caseBytes = await readBoundFile(directory + 'failure-actual-cases.json');
  const nativeBytes = await readBoundFile(directory + 'failure-native-safe-capture.json');
  assert.equal(sha256(caseBytes), 'fa36c1aa76287ec237bd3417139ff54ba97fb0900c5722d7b0f6bbeccd23c655');
  assert.equal(sha256(nativeBytes), '4c5ef55ff8b5a95f830f882068c70e3f4ac5a5f109f4a2c6c30428ce1182a73e');
  const saved = JSON.parse(caseBytes), native = JSON.parse(nativeBytes).originalPrivacyValidatedProjection;
  assert.equal(saved.wires.length, 7);
  for (const [index, wire] of saved.wires.entries()) {
    const binding = checkConditionalObservedCaseBinding({ wire, observed: saved.observed,
      nativeEnvelopes: native.nativeEnvelopes, childIdentity: saved.childIdentity }, index);
    assert.equal(binding.checked.checkerOnly, true);
    assert.equal(binding.checked.authorityGranted, false);
    assert.equal(binding.checked.rootEligible, index < 3);
    assert.equal(Object.getPrototypeOf(binding.runtime), null);
    assert.ok(Object.isFrozen(binding.runtime));
    assert.throws(() => nativeEvidenceHash(binding.runtime),
      /Owned configuration requires finite canonical JSON values/);
    const digest = conditionalEvidenceHash(binding.runtime);
    assert.equal(digest, nativeEvidenceHash({ ...binding.runtime }));
    assert.equal(digest, nativeEvidenceHash(JSON.parse(JSON.stringify(binding.runtime))));
    assert.throws(() => requireLocalConditionalCapture(binding), /PRIVATE_EXECUTION/);
    assert.throws(() => requireLocalConditionalEvidence({ nativeRuntime: true,
      actualSourceVerified: true, runtimeEvidenceSha256: digest }, saved), /PRIVATE_EXECUTION/);
  }
  assert.equal(conditionalSourceRegistry().completedNativeExecutions, 0);
});

test('conditional hash normalization preserves ordinary canonical bytes and nested hardened map/row metadata', () => {
  const ordinary = { z: [1, -0, true, null], a: { text: 'fixture-only', flag: false } };
  const canonicalBytes = '{"a":{"flag":false,"text":"fixture-only"},"z":[1,0,true,null]}';
  assert.equal(nativeEvidenceHash(ordinary), sha256(canonicalBytes));
  assert.equal(conditionalEvidenceHash(ordinary), sha256(canonicalBytes));
  const hardened = Object.freeze(Object.assign(Object.create(null), {
    map: Object.freeze(Object.assign(Object.create(null), { rootPolicy: 'fixture-only',
      nested: Object.freeze(Object.assign(Object.create(null), { enabled: true })) })),
    rows: Object.freeze([Object.freeze(Object.assign(Object.create(null), {
      traceId: trace, spanId: span, recordLocator: Object.freeze(Object.assign(Object.create(null),
        { rowOrdinal: 0, nativeTable: 'requests' }))
    }))]),
    requests: Object.freeze([]),
    proofArtifacts: Object.freeze([Object.freeze(Object.assign(Object.create(null), {
      kind: 'fixture-only', value: Object.freeze(Object.assign(Object.create(null), { disposition: 'absent' }))
    }))])
  }));
  const plain = JSON.parse(JSON.stringify(hardened));
  assert.throws(() => nativeEvidenceHash(hardened), /finite canonical JSON/);
  assert.equal(conditionalEvidenceHash(hardened), nativeEvidenceHash(plain));
  for (const name of ['map', 'rows', 'requests', 'proofArtifacts']) {
    assert.equal(conditionalEvidenceHash(hardened[name]), nativeEvidenceHash(plain[name]));
  }
  const keys = JSON.parse('{"__proto__":{"fixtureOnly":true},"constructor":"data","toJSON":"not-a-callback"}');
  assert.equal(conditionalEvidenceHash(keys), nativeEvidenceHash(keys));
  assert.equal(Object.getPrototypeOf(keys), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, 'fixtureOnly'), false);
  for (const value of [null, true, false, 0, -0, 1.25, 'fixture-only']) {
    assert.equal(conditionalEvidenceHash(value), nativeEvidenceHash(value));
  }
  assert.throws(() => requireLocalConditionalEvidence(structuredClone(hardened), plain), /PRIVATE_EXECUTION/);
});

test('conditional hash boundary rejects callbacks, accessors, proxies, custom objects and cycles without invoking them', () => {
  let reads = 0;
  const callback = () => { reads++; return {}; };
  const cycle = {};
  cycle.self = cycle;
  const named = [];
  named.extra = 'fixture-only';
  const arrayCallback = [];
  arrayCallback.toJSON = callback;
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const value of [
    { toJSON: callback },
    Object.defineProperty({}, 'toJSON', { enumerable: true, get: callback }),
    Object.defineProperty({}, 'nested', { enumerable: true, get: callback }),
    Object.defineProperty({}, 'hidden', { value: 'fixture-only' }),
    { nested: new Proxy({}, { get: callback, getPrototypeOf: callback, ownKeys: callback }) },
    revoked.proxy, Object.create({ toJSON: callback }), Object.create(Array.prototype),
    new Date(), new Map(), new Set(), new (class Custom {})(), Buffer.from('fixture-only'),
    { [Symbol.toPrimitive]: callback }, cycle, named, arrayCallback, new Array(1),
    callback, undefined, Symbol('fixture-only'), 1n, NaN, Infinity, -Infinity
  ]) assert.throws(() => conditionalEvidenceHash(value), /E_CONDITIONAL_PLAIN_DATA/);
  assert.equal(reads, 0);
  assert.equal(conditionalSourceRegistry().completedNativeExecutions, 0);
});

test('conditional observer limits direct ordinary-only hashing to its checked normalization boundary', async () => {
  const source = (await readBoundFile('tools\\verification\\conditional-observer.mjs')).toString('utf8');
  assert.equal([...source.matchAll(/\bnativeEvidenceHash\(/g)].length, 1);
  assert.ok(source.includes('return nativeEvidenceHash(normalize(observedSnapshot(value)))'));
  assert.ok(source.includes('runtimeEvidenceSha256: conditionalEvidenceHash(runtime)'));
  assert.ok(source.includes('capture.mapSha256 === conditionalEvidenceHash(map)'));
  assert.ok(source.includes('capture.rowsSha256 === conditionalEvidenceHash(rows)'));
});

test('closed failure code extraction does not read error text, accessors, inherited codes or proxy traps', () => {
  let reads = 0;
  const secret = 'fixture-only-unknown-diagnostic-data';
  const getter = () => { reads++; return secret; };
  const error = Object.defineProperties({}, {
    code: { value: 'E_CONDITIONAL_NATIVE_PARENT' },
    message: { get: getter }, stack: { get: getter }, cause: { get: getter },
    actual: { get: getter }, expected: { get: getter }, toString: { get: getter }
  });
  assert.equal(conditionalFailureCode(error), 'E_CONDITIONAL_NATIVE_PARENT');
  for (const candidate of [
    Object.defineProperty({}, 'code', { get: getter }),
    Object.create({ code: 'E_CONDITIONAL_NATIVE_PARENT' }),
    { code: { [Symbol.toPrimitive]: getter } },
    { code: `E_CONDITIONAL_${secret}` }, { message: 'E_CONDITIONAL_NATIVE_PARENT' },
    secret, null, Symbol(secret),
    new Proxy(error, { get: getter, getOwnPropertyDescriptor: getter, getPrototypeOf: getter })
  ]) {
    assert.equal(conditionalFailureCode(candidate), 'E_CONDITIONAL_EXECUTION_FAILED');
    assert.equal(conditionalFailureDiagnostics(candidate).bindingCase, null);
  }
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(conditionalFailureCode(revoked.proxy), 'E_CONDITIONAL_EXECUTION_FAILED');
  assert.equal(reads, 0);
  assert.equal(conditionalFailureCode({}, { [Symbol.toPrimitive]: getter }), 'E_CONDITIONAL_EXECUTION_FAILED');
  assert.equal(reads, 0);
});

test('production-used fixed binding helper retains exact closed failure case and actual-match booleans only', () => {
  const value = bindingFixture(2);
  value.nativeEnvelopes = [];
  let failure;
  try { checkConditionalObservedCaseBinding(value, 2); } catch (error) { failure = error; }
  assert.ok(failure);
  const diagnostic = conditionalFailureDiagnostics(failure);
  assert.equal(diagnostic.code, 'E_CONDITIONAL_NATIVE_ABSENCE_OR_DUPLICATE');
  assert.equal(diagnostic.bindingCase.index, 2);
  assert.equal(diagnostic.bindingCase.kind, 'invalid-zero-parent');
  assert.equal(diagnostic.bindingCase.runtimeMatchCount, 1);
  assert.equal(diagnostic.bindingCase.nativeRequestMatchCount, 0);
  assert.equal(diagnostic.bindingCase.nativeRelatedSpanCount, 0);
  assert.equal(diagnostic.bindingCase.sdkSampled, true);
  assert.equal(diagnostic.bindingCase.sdkRecording, true);
  assert.equal(diagnostic.bindingCase.runtimePidMatches, true);
  assert.equal(diagnostic.bindingCase.runtimeWireMatches, true);
  assert.equal(diagnostic.bindingCase.runtimeTimeMatches, true);
  assert.equal(diagnostic.bindingCase.runtimeClassHashesMatch, true);
  assert.equal(diagnostic.bindingCase.runtimeClassOriginsMatch, true);
  assert.equal(diagnostic.diagnosticsOnly, true);
  assert.equal(diagnostic.authorityGranted, false);
  assert.equal(diagnostic.savedJsonCanEnroll, false);
  assert.ok(Object.isFrozen(diagnostic.bindingCase));
  assert.equal(JSON.stringify(diagnostic).includes(value.wire.caseId), false);
  assert.equal(JSON.stringify(diagnostic).includes(value.wire.businessInvocationId), false);
  assert.equal(JSON.stringify(diagnostic).includes(value.observed[0].sdkTraceId), false);
  assert.equal(JSON.stringify(diagnostic).includes(source), false);
  assert.equal(conditionalFailureDiagnostics(structuredClone(diagnostic)).bindingCase, null);
  assert.throws(() => requireLocalConditionalCapture(diagnostic), /PRIVATE_EXECUTION/);
});

test('binding diagnostics retain all seven positive checker cases and reject each original material predicate', () => {
  for (let index = 0; index < 7; index++) {
    const checked = checkConditionalObservedCaseBinding(bindingFixture(index), index).checked;
    assert.equal(checked.rootEligible, index < 3);
    assert.equal(checked.authorityGranted, false);
  }
  for (const [index, mutation, code, property, expected] of [
    [0, value => { value.observed = []; }, 'RUNTIME_ABSENCE_OR_DUPLICATE', 'runtimeMatchCount', 0],
    [0, value => { value.observed.push(value.observed[0]); }, 'RUNTIME_ABSENCE_OR_DUPLICATE', 'runtimeMatchCount', 2],
    [0, value => { value.observed[0].pid++; }, 'RUNTIME_SOURCE', 'runtimePidMatches', false],
    [0, value => { value.observed[0].businessInvocationId = randomUUID(); }, 'RUNTIME_SOURCE', 'runtimeWireMatches', false],
    [0, value => { value.observed[0].observedAtUtc = '2026-11-02T00:00:03.000Z'; },
      'RUNTIME_SOURCE', 'runtimeTimeMatches', false],
    [0, value => { value.observed[0].applicationClassSha256 = '5'.repeat(64); },
      'RUNTIME_SOURCE', 'runtimeClassHashesMatch', false],
    [0, value => { value.observed[0].applicationCodeSource = pathToFileURL(path.join(projectRoot, 'foreign')).href; },
      'RUNTIME_SOURCE', 'runtimeClassOriginsMatch', false],
    [0, value => { value.nativeEnvelopes[0].tags['ai.cloud.role'] = 'contoso-inventory-api'; },
      'NATIVE_SCOPE', 'nativeRoleMatches', false],
    [0, value => { value.nativeEnvelopes[0].time = '2026-11-02T00:00:03.000Z'; },
      'NATIVE_SCOPE', 'nativeTimeMatches', false],
    [0, value => { value.nativeEnvelopes[0].tags['ai.operation.parentId'] = 'invalid-parent'; },
      'NATIVE_PARENT', 'nativeParentValid', false],
    [0, value => { value.nativeEnvelopes[0].tags['ai.operation.parentId'] = parent; },
      'ROOT_PARENT', 'nativeParentAbsent', false],
    [3, value => { value.nativeEnvelopes[0].tags['ai.operation.parentId'] = 'd'.repeat(16); },
      'VALID_PARENT_RESTART', 'nativeParentMatchesIncoming', false],
    [6, value => { value.nativeEnvelopes = [{ tags: { 'ai.operation.id': trace },
      data: { baseType: 'RemoteDependencyData', baseData: { id: 'd'.repeat(16) } } }]; },
      'UNSAMPLED_CONTINUATION', 'nativeRelatedSpanCount', 1]
  ]) {
    const value = bindingFixture(index);
    mutation(value);
    let failure;
    try { checkConditionalObservedCaseBinding(value, index); } catch (error) { failure = error; }
    assert.ok(failure);
    const diagnostic = conditionalFailureDiagnostics(failure);
    assert.equal(diagnostic.code, 'E_CONDITIONAL_' + code);
    assert.equal(diagnostic.bindingCase.index, index);
    assert.equal(diagnostic.bindingCase[property], expected);
  }
  assert.throws(() => checkConditionalObservedCaseBinding(bindingFixture(0), 7), /CASE_BINDING_SCOPE/);
  assert.throws(() => checkConditionalObservedCaseBinding(bindingFixture(0), 1), /CASE_BINDING_SCOPE/);
  assert.equal(conditionalSourceRegistry().completedNativeExecutions, 0);
});

test('closed diagnostic allowlist covers current literal assertions without accepting arbitrary regex-shaped codes', async () => {
  for (const file of ['tools\\verification\\conditional-observer.mjs',
    'tools\\verification\\run-conditional-observer.mjs']) {
    const text = (await readBoundFile(file)).toString('utf8');
    for (const match of text.matchAll(/'(E_CONDITIONAL_[A-Z_]+)'/g)) {
      assert.equal(conditionalFailureCode({ code: match[1] }), match[1]);
    }
  }
  assert.equal(conditionalFailureCode({ code: 'E_CONDITIONAL_UNREVIEWED_EXTRA_DETAIL' }),
    'E_CONDITIONAL_EXECUTION_FAILED');
});

test('absent/invalid structural case checking does not enroll native source authority', () => {
  for (const [fields, disposition] of [[[], 'absent'],
    [[`00-${'0'.repeat(32)}-${parent}-01`], 'invalid']]) {
    const result = checkConditionalObservedCase(fixture(fields));
    assert.equal(result.rootEligible, true);
    assert.equal(result.disposition, disposition);
    assert.equal(result.authorityGranted, false);
    assert.equal(result.checkerOnly, true);
    assert.throws(() => requireLocalConditionalCapture(result), /PRIVATE_EXECUTION/);
  }
});

test('missing/duplicate/foreign native and runtime observations cannot be repaired with expectations', () => {
  for (const change of [
    input => { input.nativeEnvelopes = []; },
    input => { input.nativeEnvelopes.push(input.nativeEnvelopes[0]); },
    input => { input.runtime.pid++; },
    input => { input.runtime.businessInvocationId = '34567890-1234-4234-8234-123456789012'; },
    input => { input.runtime.roleName = 'contoso-inventory-api'; },
    input => { input.runtime.caseId = '00000000-0000-4000-8000-000000000001'; },
    input => { input.runtime.observerClassSha256 = '3'.repeat(64); },
    input => { input.runtime.applicationClassSha256 = '5'.repeat(64); },
    input => { input.runtime.runtimeGuardClassSha256 = '5'.repeat(64); },
    input => { delete input.runtime.applicationCodeSource; },
    input => { input.runtime.fixtureCodeSource = pathToFileURL(path.join(projectRoot, 'foreign')).href; },
    input => { input.runtime.observedAtUtc = '2026-11-02T00:00:03.000Z'; },
    input => { input.nativeEnvelopes[0].tags['ai.operation.parentId'] = parent; },
    input => { input.nativeEnvelopes[0].data.baseType = 'EventData'; }
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => checkConditionalObservedCase(value));
  }
});

test('invalid partial context cannot retain a carrier trace while being labelled a technical restart', () => {
  const value = fixture([`00-${trace}-${'0'.repeat(16)}-01`]);
  assert.throws(() => checkConditionalObservedCase(value), /CONTEXT_NOT_RESTARTED/);
  value.runtime.sdkTraceId = 'd'.repeat(32);
  value.nativeEnvelopes[0].tags['ai.operation.id'] = value.runtime.sdkTraceId;
  assert.equal(checkConditionalObservedCase(value).rootEligible, true);
});

test('malformed native parents and oversize original carriers cannot be normalized into absent roots', () => {
  for (const parent of ['not-a-native-parent', '0'.repeat(16)]) {
    const value = fixture();
    value.nativeEnvelopes[0].tags['ai.operation.parentId'] = parent;
    assert.throws(() => checkConditionalObservedCase(value), /NATIVE_PARENT/);
  }
  const value = fixture(['x'.repeat(257)]);
  value.runtime.traceparentFields = [...value.wire.traceparentFields];
  assert.throws(() => checkConditionalObservedCase(value), /RUNTIME_BOUND/);
});

test('valid parent, state-only and business-identity controls never authorize a null-parent waiver', () => {
  for (const name of ['valid-parent', 'invalid-tracestate-only', 'changed-business-id-valid-parent']) {
    const value = fixture([`00-${trace}-${parent}-01`]);
    value.wire.name = name;
    if (name === 'invalid-tracestate-only') {
      value.wire.tracestateFields = ['bad key=value'];
      value.runtime.tracestateFields = [...value.wire.tracestateFields];
    }
    value.nativeEnvelopes[0].tags['ai.operation.parentId'] = parent;
    const result = checkConditionalObservedCase(value);
    assert.equal(result.rootEligible, false);
    assert.equal(result.disposition, null);
    delete value.nativeEnvelopes[0].tags['ai.operation.parentId'];
    assert.throws(() => checkConditionalObservedCase(value), /VALID_PARENT_RESTART/);
  }
});

test('unsampled continuation needs actual SDK state and never treats export absence alone as proof', () => {
  const value = fixture([`00-${trace}-${parent}-00`]);
  value.runtime.sdkRecording = false;
  value.runtime.sdkSampled = false;
  value.nativeEnvelopes = [];
  assert.equal(checkConditionalObservedCase(value).unsampledControl, true);
  value.runtime.sdkRecording = true;
  assert.throws(() => checkConditionalObservedCase(value), /UNSAMPLED_CONTINUATION/);
});

test('strict00 rejects every related Request/Dependency span, without rejecting unrelated traces or non-span records', () => {
  const value = fixture([`00-${trace}-${parent}-00`]);
  value.runtime.sdkRecording = false;
  value.runtime.sdkSampled = false;
  for (const baseType of ['RequestData', 'RemoteDependencyData']) {
    value.nativeEnvelopes = [{ time: value.wire.sentAtUtc,
      tags: { 'ai.cloud.role': value.runtime.roleName, 'ai.operation.id': trace, 'ai.operation.parentId': span },
      data: { baseType, baseData: { id: 'd'.repeat(16) } } }];
    assert.throws(() => checkConditionalObservedCase(value), /UNSAMPLED_CONTINUATION/);
  }
  value.nativeEnvelopes[0].tags['ai.operation.id'] = 'e'.repeat(32);
  assert.equal(checkConditionalObservedCase(value).unsampledControl, true);
  value.nativeEnvelopes = [{ tags: { 'ai.operation.id': trace },
    data: { baseType: 'EventData', baseData: { name: 'fixture-only-nonspan' } } }];
  assert.equal(checkConditionalObservedCase(value).unsampledControl, true);
});

test('original runtime DTO rejects unknown, forbidden and nested fields instead of retaining or masking them', () => {
  for (const [key, extra] of [
    ['Authorization', 'Bearer R9_SYNTHETIC_NONPRIVATE_MARKER'],
    ['unapproved', 'fixture-value'],
    ['unapprovedNested', { claims: { fixture: 'synthetic-only' } }]
  ]) {
    const value = fixture();
    value.runtime[key] = extra;
    assert.throws(() => checkConditionalObservedCase(value), /RUNTIME_SCHEMA/);
    assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(value.runtime))), /RUNTIME_SCHEMA/);
  }
  const valid = parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(fixture().runtime)));
  assert.ok(Object.isFrozen(valid));
  assert.throws(() => requireLocalConditionalCapture(valid), /PRIVATE_EXECUTION/);
  for (const [key, wrong] of [['pid', '1234'], ['sdkRecording', 'false'],
    ['traceparentFields', { 0: 'fixture-only', length: 1 }], ['requestPath', { nested: 'fixture-only' }]]) {
    const value = fixture();
    value.runtime[key] = wrong;
    assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(value.runtime))), /RUNTIME_SCHEMA/);
  }
});

test('runtime DTO value checks are bounded/shared-policy and exact-marker based; CodeSource has no query/hash/auth', () => {
  const marker = 'R9_RUNTIME_EXACT_PRIVATE_1234';
  const value = fixture();
  for (const uri of [source + '?marker=fixture-only', source + '#fixture-only', 'https://example.test/classes/',
    'file://fixture:synthetic@localhost/C:/classes/']) {
    value.runtime.fixtureCodeSource = uri;
    assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(value.runtime))), /CLASS_ORIGIN/);
  }
  value.runtime = fixture().runtime;
  value.runtime.fixtureCodeSource = 'x'.repeat(4097);
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(value.runtime))), /RUNTIME_BOUND/);
  value.runtime = fixture().runtime;
  value.runtime.tracestateFields = ['r9=' + marker];
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(value.runtime)), [marker]), /RUNTIME_PRIVACY/);
  value.runtime.tracestateFields = ['r9=Bearer R9_SYNTHETIC_NONPRIVATE_MARKER'];
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(value.runtime))), /RUNTIME_PRIVACY/);
});

test('original runtime frame uses strict UTF8/decoded-duplicate JSON parsing before object validation', () => {
  const original = JSON.stringify(fixture().runtime);
  for (const text of [
    original.replace('"schema":', '"schema":"fixture-only","schema":'),
    original.replace('"schema":', '"sch\\u0065ma":"fixture-only","schema":')
  ]) assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(text)), /RUNTIME_SCHEMA/);
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from([0xc3, 0x28])), /RUNTIME_SCHEMA/);
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.alloc(8193, 0x20)), /RUNTIME_BOUND/);
});

test('runtime-only publisher marker rejects original DTO spill while legitimate native top-level publisher stays allowed', () => {
  const publisher = randomUUID();
  const nativeMarkers = Array.from({ length: 14 }, () => randomUUID());
  const runtimeMarkers = [...nativeMarkers, publisher];
  const runtime = fixture().runtime;
  runtime.tracestateFields = ['r9=' + publisher];
  assert.equal(parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(runtime)), nativeMarkers).tracestateFields[0],
    runtime.tracestateFields[0]);
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(runtime)), runtimeMarkers), /RUNTIME_PRIVACY/);
  runtime.tracestateFields = [];
  runtime.processStartUtc = `Mon, 02 Nov 2026 00:00:00.500 (${publisher}) Z`;
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(runtime)), nativeMarkers), /RUNTIME_UTC/);
  assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(runtime)), runtimeMarkers), /RUNTIME_PRIVACY/);
  const envelope = { iKey: publisher, time: '2026-11-02T00:00:01.000Z',
    tags: { 'ai.cloud.role': 'contoso-orders-api', 'ai.operation.id': trace },
    data: { baseType: 'RequestData', baseData: { id: span, name: 'GET /api/me', properties: {} } } };
  const input = { publisherKeys: [publisher], forbiddenValues: nativeMarkers,
    payloads: [{ rawBase64: Buffer.from(JSON.stringify(envelope)).toString('base64'), encoding: 'identity' }] };
  assert.equal(captureNativePayloads(input).verified, true);
  assert.throws(() => captureNativePayloads({ ...input, forbiddenValues: runtimeMarkers }), /MARKER_PUBLISHER_CONFLICT/);
});

test('actual Instant UTC zero-to-nine fractions remain accepted, comments/offsets/rollover dates reject', () => {
  for (const fraction of ['', '.5', '.50', '.500', '.5001', '.50012', '.500123', '.5001234', '.50012345', '.500123456']) {
    const value = fixture();
    value.runtime.processStartUtc = `2026-11-02T00:00:00${fraction}Z`;
    value.runtime.observedAtUtc = `2026-11-02T00:00:01${fraction}Z`;
    assert.equal(checkConditionalObservedCase(value).rootEligible, true);
  }
  for (const value of ['Mon, 02 Nov 2026 00:00:00.500 (fixture-only) Z',
    '2026-11-02T00:00:00.500+00:00', '2026-02-30T00:00:00.500Z',
    '2026-11-02T24:00:00Z', '2026-11-02T00:00:00.1234567890Z']) {
    const runtime = fixture().runtime;
    runtime.processStartUtc = value;
    assert.throws(() => parseConditionalRuntimeFrame(Buffer.from(JSON.stringify(runtime))), /RUNTIME_UTC/);
  }
});

test('real loopback HTTP controls settle rejected on aborted200 bodies and preserve complete-response/size behavior', async () => {
  for (const mode of ['abort', 'complete', 'oversize']) {
    const sockets = new Set();
    const server = createServer((incoming, response) => {
      assert.equal(incoming.method, 'GET');
      assert.equal(incoming.url, '/api/me');
      if (mode === 'abort') {
        response.writeHead(200, { 'Content-Length': '20' });
        response.flushHeaders();
        response.write('x');
        setTimeout(() => response.destroy(), 25);
      } else if (mode === 'oversize') response.writeHead(200).end(Buffer.alloc(65537));
      else response.writeHead(200, { 'Content-Length': '2' }).end('ok');
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let timer;
    try {
      const request = sendConditionalControl(server.address().port, fixture().wire,
        { user: 'fixture-only-user', gateway: 'fixture-only-gateway' });
      const bounded = Promise.race([request, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('FIXTURE_CONTROL_DID_NOT_SETTLE')), 2000);
      })]);
      if (mode === 'complete') await bounded;
      else await assert.rejects(bounded, mode === 'oversize' ? /RESPONSE_BOUND/ :
        /HTTP_RESPONSE_ABORTED|HTTP_RESPONSE_ERROR|HTTP_PREMATURE_CLOSE|HTTP_TRANSPORT/);
    } finally {
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test('real continuously active response still reaches the absolute ten-second control deadline', async () => {
  const sockets = new Set();
  let interval, writes = 0;
  const server = createServer((_, response) => {
    response.writeHead(200);
    response.flushHeaders();
    interval = setInterval(() => { response.write('x'); writes++; }, 20);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const started = Date.now();
  try {
    await assert.rejects(sendConditionalControl(server.address().port, fixture().wire,
      { user: 'fixture-only-user', gateway: 'fixture-only-gateway' }), /E_CONDITIONAL_HTTP_TIMEOUT/);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 9000 && elapsed < 12500);
    assert.ok(writes > 100);
  } finally {
    clearInterval(interval);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('original wire mismatch and accessor/proxy inputs reject without mutable proof reads', () => {
  const value = fixture();
  value.runtime.traceparentFields = [`00-${trace}-${parent}-01`];
  assert.throws(() => checkConditionalObservedCase(value), /RUNTIME_SOURCE/);
  let reads = 0;
  const getter = fixture();
  Object.defineProperty(getter, 'runtime', { enumerable: true, get() { reads++; return {}; } });
  assert.throws(() => checkConditionalObservedCase(getter), /PLAIN_DATA/);
  assert.equal(reads, 0);
  assert.throws(() => checkConditionalObservedCase(new Proxy(fixture(), {})), /PLAIN_DATA/);
  const hole = fixture();
  hole.wire.traceparentFields = new Array(1);
  assert.throws(() => checkConditionalObservedCase(hole), /PLAIN_DATA/);
  const named = fixture();
  Object.defineProperty(named.nativeEnvelopes, '__proto__', { value: {}, enumerable: true });
  assert.throws(() => checkConditionalObservedCase(named), /PLAIN_DATA/);
});

test('genuine directly executed CPU source enrolls only its private non-native process identity', async () => {
  const capability = await executeConditionalSourceProbe();
  const receipt = requireConditionalExecution(capability, { nativeRequired: false });
  assert.equal(receipt.directChildObserved, true);
  assert.equal(receipt.nativeRuntime, false);
  assert.ok(Number.isInteger(receipt.pid) && receipt.pid > 0);
  assert.equal(receipt.parentPid, process.pid);
  assert.ok(Object.isFrozen(receipt));
  assert.throws(() => requireConditionalExecution(capability), /PRIVATE_EXECUTION/);
  assert.throws(() => requireLocalConditionalCapture(capability), /PRIVATE_EXECUTION/);
  assert.throws(() => requireConditionalExecution(structuredClone(receipt), { nativeRequired: false }), /PRIVATE_EXECUTION/);
  assert.equal(conditionalSourceRegistry().completedNativeExecutions, 0);
});

test('JSON, source hashes, callbacks, query labels and CPU identities cannot enroll native roots', async () => {
  const cpu = await executeConditionalSourceProbe();
  for (const fake of [{ verified: true, actualSourceVerified: true }, { sourceVerified: true, nativeRuntime: true },
    { sourceSha256: 'a'.repeat(64) }, JSON.parse(JSON.stringify(cpu)), cpu]) {
    assert.throws(() => requireLocalConditionalEvidence(fake, {}), /PRIVATE_EXECUTION/);
    await assert.rejects(verifyGraphIntake({
      map: {}, spec: { assertion: 'conditional-native' }, mode: 'LocalValidate', localObserverCapability: fake
    }), /PRIVATE_EXECUTION/);
    assert.throws(() => classifyVerifiedTrustRoots({
      map: {}, rows: [], requests: [], proofArtifacts: [], mode: 'LocalValidate', localObserverCapability: fake
    }), /PRIVATE_EXECUTION/);
  }
  await assert.rejects(executeConditionalSourceProbe({ nativeRuntime: true }), /CALLER_ENROLLMENT/);
  await assert.rejects(executeLocalConditionalObserver({ execute: () => ({ verified: true }) }), /CALLER_ENROLLMENT/);
  assert.equal(conditionalSourceRegistry().savedJsonCanEnroll, false);
  assert.equal(conditionalSourceRegistry().queryCapabilityCanEnroll, false);
  assert.equal(conditionalSourceRegistry().sourceFactoryRegistered, true);
});

test('declared local factory and altered registry JSON never stand in for direct native execution', async () => {
  const registry = JSON.parse(await readBoundFile('contracts\\verification-observer-registry.v1.json'));
  assert.deepEqual(registry.observers, []);
  const factory = registry.localNativeExecutionFactories.find(value => value.id === conditionalSourceRegistry().observerId);
  assert.equal(factory.factory, conditionalSourceRegistry().factory);
  assert.equal(factory.savedJsonCanEnroll, false);
  assert.equal(factory.azureAuthority, false);
  assert.throws(() => requireLocalConditionalCapture({ ...factory, actualSourceVerified: true, nativeRuntime: true }),
    /PRIVATE_EXECUTION/);
});

test('one-command source probe is real CPU-only; getter/extra/unknown command arguments reject before execution', async () => {
  for (const args of [[], ['--execute', 'caller-path.json'], ['--enroll-json'], { 0: '--execute', length: 1 }]) {
    await assert.rejects(conditionalObserverMain(args));
  }
  let reads = 0;
  const args = [];
  Object.defineProperty(args, '0', { enumerable: true, get() { reads++; return '--execute'; } });
  await assert.rejects(conditionalObserverMain(args));
  assert.equal(reads, 0);
  const result = await conditionalObserverMain(['--source-check']);
  assert.equal(result.result, 'GENUINE_CPU_SOURCE_ONLY');
  assert.equal(result.nativeRuntime, false);
  assert.equal(result.fullPathVerified, false);
  assert.equal(result.certification, 'NOT_CERTIFIED');
});

test('adopted loopback reader binds actual synthetic packet receipts/all safe kinds but grants no native source authority', async () => {
  const publisher = randomUUID();
  const envelopes = [
    { name: 'Microsoft.ApplicationInsights.Request', iKey: publisher, time: new Date().toISOString(),
      tags: { 'ai.cloud.role': 'contoso-orders-api', 'ai.operation.id': trace },
      data: { baseType: 'RequestData', baseData: { id: span, name: 'GET /api/me', properties: {} } } },
    { name: 'Microsoft.ApplicationInsights.Event', iKey: publisher, time: new Date().toISOString(),
      tags: { 'ai.cloud.role': 'contoso-orders-api' },
      data: { baseType: 'EventData', baseData: { name: 'fixture-only', properties: {} } } }
  ];
  const bytes = Buffer.from(JSON.stringify(envelopes));
  const receiver = await openSamplerNativeReceiver({ publisherKeys: [publisher], forbiddenValues: [],
    onEcho() { throw new Error('UNUSED_OBSERVER_ECHO_ROUTE'); } });
  try {
    const acknowledgement = await new Promise((resolve, reject) => {
      const outgoing = request(new URL('/v2/track', receiver.endpoint), {
        method: 'POST', agent: false, headers: { 'Content-Length': bytes.length }, timeout: 5000
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
      });
      outgoing.on('error', reject);
      outgoing.on('timeout', () => outgoing.destroy(new Error('FIXTURE_HTTP_TIMEOUT')));
      outgoing.end(bytes);
    });
    assert.equal(acknowledgement.itemsAccepted, 2);
    const captured = await receiver.finish();
    assert.equal(captured.observations.length, 2);
    assert.equal(captured.observations[0].envelope.data.baseData.id, span);
    assert.equal(captured.observations[1].envelope.data.baseType, 'EventData');
    assert.equal(captured.originalPrivacyCapture.validatorPid, process.pid);
    assert.equal(captured.originalPrivacyCapture.actualCounts.originalRawBytes, bytes.length);
    assert.equal(captured.originalPrivacyCapture.payloadReceipts[0].strictDuplicateKeysVerified, true);
    assert.equal(captured.originalPrivacyCapture.independentProducerAuthorityVerified, false);
    assert.equal(captured.originalPrivacyCapture.allTablePrivacyGateVerified, false);
    assert.throws(() => requireLocalConditionalCapture(captured), /PRIVATE_EXECUTION/);
  } finally { await receiver.stop(); }
});
