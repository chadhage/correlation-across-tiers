import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFocusedRun, validateFocusedReceipt } from '../../tools/verification/run-focused.mjs';
import { jsonBytes, sha256 } from '../../tools/verification/files.mjs';

const sources = [{ path: 'tools\\verification\\invariants.mjs', sha256: 'a'.repeat(64) }];
const run = { status: 0, stdout: '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n' };

test('focused receipts require exact executed/pass counts and zero skips/cancellations', () => {
  assert.equal(evaluateFocusedRun(run, sources, sources).result, 'PASS');
  for (const stdout of [run.stdout.replace('# pass 2', '# pass 1'),
    run.stdout.replace('# cancelled 0', '# cancelled 1'), run.stdout.replace('# skipped 0', '# skipped 1'), '']) {
    assert.equal(evaluateFocusedRun({ ...run, stdout }, sources, sources).result, 'FAIL');
  }
  assert.equal(evaluateFocusedRun({ ...run, error: new Error('timeout') }, sources, sources).result, 'FAIL');
});

test('focused source snapshots reject changed, missing, added and duplicate source bindings', () => {
  for (const after of [[{ ...sources[0], sha256: 'b'.repeat(64) }], [],
    [...sources, { path: 'tools\\verification\\new.mjs', sha256: 'c'.repeat(64) }], [...sources, ...sources]]) {
    assert.equal(evaluateFocusedRun(run, sources, after).result, 'FAIL');
  }
  assert.equal(evaluateFocusedRun(run, [], []).result, 'FAIL');
  assert.deepEqual(evaluateFocusedRun(run, sources, []).sourceDrift, [sources[0].path]);
});

test('persisted focused receipts must match the authoritative full current source snapshot', () => {
  const digest = sha256(jsonBytes(sources));
  const receipt = { schema: 'contoso.local-check.v1', scope: 'unit', sourceKind: 'actual-local-node-test-run',
    sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED',
    ...evaluateFocusedRun(run, sources, sources), sources, beforeSourcesSha256: digest, afterSourcesSha256: digest };
  assert.equal(validateFocusedReceipt(receipt, sources), true);
  assert.throws(() => validateFocusedReceipt(receipt, [{ ...sources[0], sha256: 'b'.repeat(64) }]), /current-source/);
  assert.throws(() => validateFocusedReceipt(receipt, [...sources, { path: 'added.mjs', sha256: 'c'.repeat(64) }]), /current-source/);
  for (const override of [{ sources: [] }, { tests: 0 }, { certificationStatus: 'CERTIFIED' }, { skipped: 1 },
    { sourcesVerified: false }, { beforeSourcesSha256: 'f'.repeat(64) }]) {
    assert.throws(() => validateFocusedReceipt({ ...receipt, ...override }, sources), /current-source/);
  }
});
