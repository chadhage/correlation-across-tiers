import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLinkedSamplingQualification, loadPreservedLinkedSamplingQualification, requireLinkedSamplingQualification, snapshotQualificationMetadata } from '../../tools/verification/sampling-qualification.mjs';
import { samplingFixture } from './sampling-fixture.mjs';

const rejects = value => assert.throws(() => checkLinkedSamplingQualification(value), error => error.code === 'E_LOCAL_QUALIFICATION');

test('complete synthetic qualification checks semantics only and cannot mint a report capability', () => {
  const value = samplingFixture();
  const result = checkLinkedSamplingQualification(value);
  assert.equal(result.checkerOnly, true);
  assert.equal(result.sourceExecutionBinding, 'UNVERIFIED');
  assert.equal(result.boundedFullPathEvidence, false);
  assert.throws(() => requireLinkedSamplingQualification(result, value.metadata), /Caller metadata/);
});

test('local qualifier rejects wrong owner, failed/missing assertions and parent-only policy', () => {
  for (const mutate of [
    value => { value.metadata.ownerRole = 'R8'; },
    value => { value.metadata.ownerExecutedTests.passed = 0; value.metadata.ownerExecutedTests.failed = 1; },
    value => { delete value.metadata.ownerExecutedTests; },
    value => { value.metadata.everyOutgoingZeroSatisfied = false; },
    value => { value.metadata.guardPolicy = 'DROP_VALID_UNSAMPLED_PARENT'; },
    value => { value.qualification.guardPolicy = 'DROP_VALID_UNSAMPLED_PARENT'; }
  ]) { const value = samplingFixture(); mutate(value); rejects(value); }
});

test('source and actual execution receipts must bind complete scopes and successful literal testcase', () => {
  for (const mutate of [
    value => { value.sourceReceipt.sources.pop(); },
    value => { value.sourceReceipt.ownerRole = 'R8'; },
    value => { value.executionReceipt.failed = 1; },
    value => { value.executionReceipt.tests = 0; },
    value => { value.executionReceipt.testMethod = 'collectObservationOnly'; },
    value => { value.executionReceipt.qualificationSha256 = 'f'.repeat(64); }
  ]) { const value = samplingFixture(); mutate(value); rejects(value); }
});

test('missing/failing00 SDK decisions cannot pass from zero exports or a caller PASS flag', () => {
  for (const mutate of [
    value => { value.qualification.observations[0].everyOutgoingZeroSatisfied = false; },
    value => { value.qualification.observations[0].actualDecisions.fanIn.sampled = true; },
    value => { value.qualification.observations[0].actualDecisions.resultSends.pop(); },
    value => { value.qualification.observations.shift(); }
  ]) { const value = samplingFixture(); mutate(value); rejects(value); }
});

test('positive and MIX require actual native exports and unchanged original producer contexts', () => {
  for (const mutate of [
    value => { value.qualification.observations[1].actualDecisions.replaySend.sampled = false; },
    value => { value.qualification.observations[1].actualNativeSpans.pop(); },
    value => { value.qualification.observations[2].actualDecisions.inputContexts[3] =
      { ...value.qualification.observations[2].actualDecisions.inputContexts[3], spanId: 'e'.repeat(16) }; },
    value => { value.qualification.observations[2].actualDecisions.inputContexts[3].sampled = true; }
  ]) { const value = samplingFixture(); mutate(value); rejects(value); }
});

test('native replay/fanin/batch links and parentage must match independent actual inputs/contributors', () => {
  for (const mutate of [
    row => { row.parentId = 'e'.repeat(16); },
    row => { const links = JSON.parse(row.links); links.pop(); row.links = JSON.stringify(links); },
    row => { const links = JSON.parse(row.links); links[1] = links[0]; row.links = JSON.stringify(links); }
  ]) {
    const value = samplingFixture();
    mutate(value.qualification.observations[1].actualNativeSpans.find(row => row.name === 'contoso.fanin.process'));
    rejects(value);
  }
});

test('changing owner accessor is rejected before any asynchronous load or accessor invocation', async () => {
  const metadata = samplingFixture().metadata;
  let reads = 0;
  Object.defineProperty(metadata, 'ownerRole', { enumerable: true,
    get: () => ++reads === 1 ? 'R5' : 'R8' });
  await assert.rejects(loadPreservedLinkedSamplingQualification(metadata), /plain JSON without accessors/);
  assert.equal(reads, 0);
});

test('changing version accessors and non-JSON proxy objects cannot become metadata snapshots', () => {
  const metadata = samplingFixture().metadata;
  let reads = 0;
  Object.defineProperty(metadata, 'guardArtifactVersion', { enumerable: true,
    get: () => ++reads === 1 ? '1.1.0' : 'CHECKER_ONLY_WRONG_VERSION' });
  assert.throws(() => snapshotQualificationMetadata(metadata), /plain JSON without accessors/);
  assert.equal(reads, 0);
  assert.throws(() => snapshotQualificationMetadata(new Proxy(samplingFixture().metadata, {})), /plain JSON/);
});

test('metadata snapshots isolate nested mutable count objects and freeze returned identity fields', () => {
  const original = samplingFixture().metadata;
  const snapshot = snapshotQualificationMetadata(original);
  original.ownerRole = 'R8';
  original.ownerExecutedTests.passed = 0;
  original.ownerExecutedTests.failed = 1;
  assert.equal(snapshot.ownerRole, 'R5');
  assert.equal(snapshot.ownerExecutedTests.passed, 1);
  assert.equal(snapshot.ownerExecutedTests.failed, 0);
  assert.notEqual(snapshot.ownerExecutedTests, original.ownerExecutedTests);
  assert.throws(() => { snapshot.ownerExecutedTests.failed = 1; }, TypeError);
});
