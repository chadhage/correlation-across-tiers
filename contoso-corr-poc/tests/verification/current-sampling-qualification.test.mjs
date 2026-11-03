import test from 'node:test';
import assert from 'node:assert/strict';
import { samplingFixture } from './sampling-fixture.mjs';
import {
  checkCurrentLinkedSamplingQualification, loadCurrentLinkedSamplingQualification,
  loadPreservedLinkedSamplingQualification, requireLinkedSamplingQualification
} from '../../tools/verification/sampling-qualification.mjs';

function fixture() {
  const legacy = samplingFixture();
  const sources = [
    ...['ParentSafeSampler', 'ParentSafeSamplerCustomizer', 'SamplingObservation', 'SamplingObservationMBean']
      .map(name => `extensions\\parent-safe-sampler\\src\\main\\java\\com\\contoso\\correlation\\sampling\\${name}.java`),
    ...['RuntimeGuard', 'ExtensionGuard', 'Correlation']
      .map(name => `services\\correlation-core\\src\\main\\java\\com\\contoso\\correlation\\${name}.java`),
    ...['LinkedSamplingProbe', 'LinkedRootSamplingTest', 'NativeTestCapture']
      .map(name => `workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\${name}.java`),
    'pom.xml', 'extensions\\parent-safe-sampler\\pom.xml', 'config\\versions.lock.json'
  ].map(path => ({ path, sha256: 'c'.repeat(64) }));
  const metadata = { ...legacy.metadata, ownerRole: 'R4', ownerAgentId: 'checker-fixture-not-a-runtime-owner',
    qualificationKind: 'current-source-sampler-v1' };
  const compiledClasses = sources.filter(value => value.path.includes('\\src\\main\\java\\')).map(value => ({
    path: value.path.replace('\\src\\main\\java\\', '\\target\\classes\\').replace(/\.java$/, '.class'),
    sha256: 'd'.repeat(64)
  }));
  let pid = 1;
  for (const [index, phase] of legacy.qualification.observations.entries()) {
    phase.nativeChildren = Array.from({ length: [2, 2, 1][index] }, (_, child) => ({
      phase: child === 0 && index < 2 ? 'produce' : 'consume', pid: pid++, exitCode: 0,
      startedAtUtc: '2026-11-02T22:00:00Z', endedAtUtc: '2026-11-02T22:00:01Z'
    }));
  }
  const sourceBuild = {
    schema: 'contoso.current-sampler-source-build.v1', ownerRole: 'R4', ownerAgentId: metadata.ownerAgentId,
    sourceAcceptanceIsCertification: false, azureOrNativeProductAcceptance: false, completeMatrixVerified: false,
    sourcesStable: true, sourceCount: sources.length, cleanSamplerSourceFiles: 4,
    compiledClassAndResourceFiles: compiledClasses.length, runtimeDependencyJars: 1,
    extensionSha256: metadata.extensionSha256, qualificationSha256: metadata.sha256,
    agentSha256: 'e'.repeat(64), javaExecutableSha256: 'f'.repeat(64), mavenVersion: '3.10.0',
    ...Object.fromEntries(['sourcesBeforeSha256', 'sourcesAfterSha256', 'compiledClassesSha256',
      'runtimeDependenciesSha256', 'samplerBuildLogSha256', 'executionReceiptSha256'].map(field => [field, '1'.repeat(64)]))
  };
  const executionReceipt = { ...legacy.executionReceipt, schema: 'contoso.local-junit-execution.v2',
    ownerRole: 'R4', ownerAgentId: metadata.ownerAgentId, seconds: 1, javaVersion: '25.0.5',
    javaVendor: 'Eclipse Adoptium', logSha256: '2'.repeat(64),
    command: 'mvn clean test -Dtest=LinkedRootSamplingTest' };
  return { fixtureScope: 'CHECKER ONLY: synthetic input never creates a witnessed execution or native authority',
    metadata, qualification: legacy.qualification, sourceBuild, executionReceipt,
    sourcesBefore: sources, sourcesAfter: structuredClone(sources), compiledClasses,
    runtimeDependencies: [{ path: 'fixture-only.jar', sha256: '3'.repeat(64) }] };
}

test('current-source decision checker accepts complete ALL0/ALL1/MIX controls without granting authority', () => {
  const input = fixture(), summary = checkCurrentLinkedSamplingQualification(input);
  assert.equal(summary.checkerOnly, true);
  assert.equal(summary.sourceExecutionBinding, 'UNVERIFIED_CHECKER_ONLY');
  assert.equal(summary.actualAzureAuthority, false);
  assert.throws(() => requireLinkedSamplingQualification(summary, input.metadata), /cannot mint/);
});

test('seeded sampler source drift or omitted provider/class input returns UNVERIFIED', () => {
  for (const mutate of [
    value => { value.sourcesAfter[0].sha256 = 'f'.repeat(64); },
    value => { value.sourcesBefore.splice(1, 1); value.sourcesAfter.splice(1, 1); },
    value => { value.compiledClasses.splice(0, 1); },
    value => { value.sourcesAfter.push(value.sourcesAfter[0]); }
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => checkCurrentLinkedSamplingQualification(input), /incomplete|changed|duplicate/);
  }
});

test('skipped assertions, stale build identity and absent runtime dependencies fail closed', () => {
  for (const mutate of [
    value => { value.executionReceipt.skipped = 1; },
    value => { value.sourceBuild.sourcesStable = false; },
    value => { value.sourceBuild.extensionSha256 = 'a'.repeat(64); },
    value => { value.sourceBuild.ownerAgentId = 'another-owner'; },
    value => { value.executionReceipt.command = 'mvn test'; },
    value => { value.runtimeDependencies.length = 0; }
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => checkCurrentLinkedSamplingQualification(input));
  }
});

test('valid-parent00 and all-unsampled linked roots cannot become sampled; mixed and unlinked retain delegate', () => {
  for (const mutate of [
    value => { value.qualification.observations[0].actualDecisions.ordinaryProcess.sampled = true; },
    value => { value.qualification.observations[0].actualDecisions.fanIn.sampled = true; },
    value => { value.qualification.observations[0].actualDecisions.replaySend.sampled = true; },
    value => { value.qualification.observations[2].actualDecisions.fanIn.sampled = false; },
    value => { value.qualification.observations[1].actualDecisions.unlinkedRoot.sampled = false; }
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => checkCurrentLinkedSamplingQualification(input));
  }
});

test('failed, repeated or unbounded child execution labels cannot qualify a current run', () => {
  for (const mutate of [
    value => { value.qualification.observations[0].nativeChildren[0].exitCode = 1; },
    value => { value.qualification.observations[1].nativeChildren[0].pid = 1; },
    value => { value.qualification.observations[2].nativeChildren[0].endedAtUtc = 'invalid'; }
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => checkCurrentLinkedSamplingQualification(input), /processes required/);
  }
});

test('caller JSON, copied metadata and checker labels cannot enroll a current-source execution', async () => {
  const input = fixture();
  for (const additions of [{}, { witnessed: true, enrolled: true, sourceExecutionBinding: 'VERIFIED' }]) {
    await assert.rejects(loadCurrentLinkedSamplingQualification({ ...input.metadata, ...additions }),
      /No independently witnessed current-source execution enrollment/);
  }
  input.sourcesBefore[0].sha256 = input.sourcesAfter[0].sha256 = 'f'.repeat(64);
  const relabelled = checkCurrentLinkedSamplingQualification(input);
  assert.equal(relabelled.checkerOnly, true);
  assert.throws(() => requireLinkedSamplingQualification(relabelled, input.metadata), /cannot mint/);
});

test('qualification routing rejects accessors before reading owner or current-route labels', async () => {
  let invoked = false;
  const metadata = { ...fixture().metadata };
  Object.defineProperty(metadata, 'qualificationKind', { enumerable: true, get() {
    invoked = true;
    return 'current-source-sampler-v1';
  } });
  await assert.rejects(loadPreservedLinkedSamplingQualification(metadata), /accessors|hidden fields/);
  assert.equal(invoked, false);
});
