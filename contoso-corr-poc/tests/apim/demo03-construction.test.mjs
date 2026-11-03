import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBoundFile } from '../../tools/verification/files.mjs';
import * as runtime from '../../tools/verification/adapters/demo03-runtime.mjs';

const manifest = async () => JSON.parse((await readBoundFile('apim\\demo03-cases.v1.json')).toString('utf8'));
const code = expected => error => error?.code === expected;

test('positive: four real source vectors retain sampled, absent, invalid and unsampled meanings without generated observations', async () => {
  const input = await manifest(), before = JSON.stringify(input);
  const report = runtime.inspectDemo03Carriers(input);
  assert.equal(report.sourceKind, 'synthetic-carrier-inputs');
  assert.equal(report.nativeExecution, 'NOT RUN');
  assert.equal(report.sourceAcceptanceIsCertification, false);
  assert.deepEqual(report.requiredCases.map(item => item.caseId), ['valid-sampled', 'absent', 'invalid-zero-trace', 'valid-unsampled']);
  assert.deepEqual(report.requiredCases.map(item => item.tracerRootRequired), [false, true, true, false]);
  assert.ok(report.requiredCases.every(item => item.nativeAssertion === 'NOT RUN' && !Object.hasOwn(item, 'spanRows') && !Object.hasOwn(item, 'rootTraceId')));
  assert.equal(report.requiredCases[3].headers.traceparent.endsWith('-00'), true);
  assert.equal(report.additionalCaseIds.length, 6);
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => { report.requiredCases[3].headers.traceparent = 'forged'; }, TypeError);
});

test('negative: missing/repeated carriers and invented native observations never become a valid plan', async () => {
  for (const mutate of [
    value => { value.cases = value.cases.filter(item => item.caseId !== 'valid-unsampled'); },
    value => { value.cases.push(value.cases[0]); },
    value => { value.cases[0].spanRows = []; },
    value => { value.cases[0].observationOrigin = 'native-runtime'; },
    value => { value.nativeExecution = 'PASS'; },
    value => { value.liveAcceptance = 'PASS'; }
  ]) {
    const input = await manifest(); mutate(input);
    assert.throws(() => runtime.inspectDemo03Carriers(input), code('D_DEMO03_CARRIERS'));
  }
});

test('negative: credentials, alternate targets, fabricated identities and incorrect deletion expectations fail', async () => {
  for (const mutate of [
    value => { value.cases[0].headers.Authorization = 'fixture-not-a-credential'; },
    value => { value.publicOperation = 'https://not-approved.invalid/contoso/v1/demo-runs'; },
    value => { value.requestBody.runId = 'caller-chosen'; },
    value => { value.requestBody.demoId = 1; },
    value => { value.cases[0].headers.traceparent = ['valid-looking', null]; },
    value => { value.cases[1].expectedPolicyDeletion = []; },
    value => { value.cases[2].headers.traceparent = value.cases[0].headers.traceparent; value.cases[2].expectedPolicyDeletion = []; },
    value => { value.cases[3].headers.traceparent = value.cases[3].headers.traceparent.replace(/-00$/, '-01'); }
  ]) {
    const input = await manifest(); mutate(input);
    assert.throws(() => runtime.inspectDemo03Carriers(input), code('D_DEMO03_CARRIERS'));
  }
});

test('positive: concrete source and forbidden-fixture scans report all unavailable native operations honestly', async () => {
  const report = await runtime.inspectDemo03Construction();
  assert.equal(report.schema, 'contoso.demo03-runtime-construction.v1');
  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.runnableDemoAdapter, false);
  assert.equal(report.nativeExecution, 'NOT RUN');
  assert.equal(report.sourceAcceptanceIsCertification, false);
  assert.equal(report.certificationStatus, 'NOT CERTIFIED');
  assert.equal(report.localProtocolChecks.policySourcesScanned, 13);
  assert.deepEqual(report.localProtocolChecks.findings, []);
  assert.equal(report.localProtocolChecks.negativeControls.length, 2);
  assert.ok(report.localProtocolChecks.negativeControls.every(item => item.forbiddenInputRejected));
  assert.deepEqual(report.blockingInterfaces.map(item => item.id), [
    'native-gateway-execution', 'native-query-enrollment', 'native-sampling-control',
    'owned-baseline-reset', 'durable-owned-recovery', 'reviewed-shared-native-pattern'
  ]);
  assert.deepEqual(report.sources.map(item => item.path), runtime.DEMO03_SOURCE_PATHS);
  assert.ok(Object.isFrozen(report.sources) && Object.isFrozen(report.blockingInterfaces[0]));
  assert.equal(typeof runtime.createAdapter, 'undefined');
  assert.equal(typeof runtime.adapter, 'undefined');
});

test('negative: source hashes, omissions, duplication, escapes and callback options cannot mint authority', async () => {
  const report = await runtime.inspectDemo03Construction();
  await runtime.verifyDemo03Sources(report.sources);
  for (const candidate of [
    report.sources.slice(1),
    report.sources.map((item, index) => index ? item : { ...item, sha256: 'a'.repeat(64) }),
    report.sources.map((item, index) => index ? item : report.sources[1]),
    report.sources.map((item, index) => index ? item : { ...item, path: '..\\outside.mjs' }),
    report.sources.map((item, index) => index ? item : { ...item, enrolled: true })
  ]) await assert.rejects(runtime.verifyDemo03Sources(candidate), code('D_DEMO03_SOURCE'));
  await assert.rejects(runtime.inspectDemo03Construction({ execute: () => ({ observationOrigin: 'native-runtime' }) }), code('D_ARGUMENT'));
});

test('negative: caller mutation during an awaited source check cannot alter its verified receipt', async () => {
  const report = await runtime.inspectDemo03Construction();
  const candidate = structuredClone(report.sources);
  const verification = runtime.verifyDemo03Sources(candidate);
  candidate[0].path = 'forged.mjs';
  candidate[0].sha256 = 'f'.repeat(64);
  const verified = await verification;
  assert.deepEqual(verified, report.sources);
  assert.equal(verified.some(item => item.path === 'forged.mjs'), false);
});

test('negative: only source --check is accepted; CLI BLOCKED exits nonzero and never creates native authority', async () => {
  for (const args of [[], ['--run'], ['--check', '--mode', 'Certify'], ['--check', '--allow-azure-writes']]) {
    await assert.rejects(runtime.demo03ConstructionMain(args), code('D_ARGUMENT'));
  }
  const executable = fileURLToPath(new URL('../../tools/verification/adapters/demo03-runtime.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [executable, '--check'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.result, 'BLOCKED');
  assert.equal(receipt.runnableDemoAdapter, false);
  const invalid = spawnSync(process.execPath, [executable, '--run'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr.trim(), 'D_ARGUMENT');
});
