import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadCatalog, runDemo, invalidateChangedSources } from '../../tools/verification/demo.mjs';
import { projectRoot, verifyManifest } from '../../tools/verification/files.mjs';

test('exact fifteen runnable Windows demo wrappers use native scenarios and the one expected map', async () => {
  const { catalog } = await loadCatalog();
  assert.equal(catalog.demos.length, 15);
  for (const demo of catalog.demos) {
    const run = await readFile(path.join(projectRoot, 'demos', demo.id, 'Run.ps1'), 'utf8');
    const reset = await readFile(path.join(projectRoot, 'demos', demo.id, 'Reset.ps1'), 'utf8');
    assert.match(run, new RegExp(`--demo ${demo.id}`));
    assert.match(reset, /--reset/);
    assert.ok(demo.requiredBoundaries.length);
  }
});

test('all fifteen missing native adapters fail explicitly, not mock PASS or certification', async () => {
  for (let index = 1; index <= 15; index++) {
    const result = await runDemo({ demoId: String(index).padStart(2, '0'), recordEvidence: false });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.failure.code, 'D_MISSING_ADAPTER');
    assert.equal(result.reset.result, 'NOT RUN');
    assert.equal(result.certificationStatus, 'NOT CERTIFIED');
    assert.equal(result.sourceAcceptanceIsCertification, false);
  }
});

test('bootstrap fails missing effects but is always explicitly NOT CERTIFIED', async () => {
  const result = await runDemo({ demoId: '01', mode: 'BootstrapValidate', recordEvidence: false });
  assert.equal(result.result, 'FAIL');
  assert.equal(result.certificationStatus, 'NOT CERTIFIED — BOOTSTRAP');
});

function fixtureAdapter(execute, calls) {
  const baselineHashes = [{ component: 'fixture-only-baseline', sha256: 'f'.repeat(64) }];
  return {
    schema: 'contoso.demo-adapter.v1',
    prepare: async () => ({ baselineHashes }),
    execute,
    drain: async () => { calls.push('drain'); },
    collect: async () => { calls.push('collect'); },
    scanPrivacy: async () => { calls.push('scan'); },
    observeSampling: async () => { calls.push('observe'); },
    stopTraffic: async () => { calls.push('stop'); },
    reset: async () => {
      calls.push('reset');
      return { schema: 'contoso.demo-reset.v1', scope: 'run-only', unownedStateTouched: false,
        trafficStopped: true, samplingRestored: true, flagsRestored: true, seedRestored: true,
        ownedMessagesDrained: true, evidenceSha256: 'e'.repeat(64), baselineHashes };
    }
  };
}

test('exception and deadline abort always stop/reset captured own pre-state', async () => {
  const calls = [];
  const adapter = fixtureAdapter(async () => { throw new Error('fixture-only failure; do not persist any raw message'); }, calls);
  const result = await runDemo({ demoId: '01', adapter, recordEvidence: false });
  assert.equal(result.result, 'FAIL');
  assert.equal(result.failure.code, 'D_ADAPTER_FAILURE');
  assert.deepEqual(calls, ['stop', 'reset']);
  const timedCalls = [];
  const timed = fixtureAdapter(async () => new Promise(() => {}), timedCalls);
  const timedResult = await runDemo({ demoId: '01', adapter: timed, recordEvidence: false, timeoutSeconds: 0.05 });
  assert.equal(timedResult.failure.code, 'D_TIMEOUT');
  assert.deepEqual(timedCalls, ['stop', 'reset']);
});

test('failed native reset cannot leave a passing demo result', async () => {
  const calls = [];
  const adapter = fixtureAdapter(async () => { throw new Error('fixture failure'); }, calls);
  adapter.reset = async () => ({ result: 'PASS', samplingRestored: false });
  const result = await runDemo({ demoId: '01', adapter, recordEvidence: false });
  assert.equal(result.result, 'FAIL');
  assert.equal(result.reset.result, 'FAIL');
});

test('missing-adapter failure packs are immutable, safe and tamper checked', async () => {
  const scratch = path.join(projectRoot, '.cache', `r9-demo-test-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  try {
    const result = await runDemo({ demoId: '01', outputRoot: scratch });
    const directory = path.join(projectRoot, result.evidencePath);
    const manifest = await verifyManifest(directory);
    assert.equal(manifest.sourceKind, 'not-observed');
    assert.equal(manifest.sourceAcceptanceIsCertification, false);
    const stored = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'));
    assert.equal(stored.failure.code, 'D_MISSING_ADAPTER');
    assert.equal(manifest.files.some(item => item.path === 'native-safe-rows.json'), false);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(directory, 'result.json'), '{}');
    await assert.rejects(verifyManifest(directory), /tampered/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('seeded agent bump and newly added runtime dependency invalidate affected claims', () => {
  const before = [{ path: 'config\\versions.lock.json', sha256: 'a'.repeat(64) }, { path: 'apim\\policy.xml', sha256: 'b'.repeat(64) }];
  const after = [{ path: 'config\\versions.lock.json', sha256: 'c'.repeat(64) }, before[1]];
  const claims = [
    { criterion: 'Trace identity', result: 'PASS', sources: ['config\\versions.lock.json'] },
    { criterion: 'No falsification', result: 'PASS', sources: ['apim\\policy.xml'] }
  ];
  const changed = invalidateChangedSources(before, after, claims);
  assert.equal(changed[0].result, 'INVALIDATED');
  assert.equal(changed[1].result, 'PASS');
  const added = invalidateChangedSources(before, [...before, { path: 'services\\new-sdk\\pom.xml', sha256: 'd'.repeat(64) }], claims);
  assert.equal(added.every(item => item.result === 'INVALIDATED'), true);
});
