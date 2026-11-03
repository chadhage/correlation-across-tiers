import assert from 'node:assert/strict';
import test from 'node:test';
import { ciNodeMain, ciSourceSnapshot, evaluateNodeCiRun } from '../../tools/verification/ci-node.mjs';

const sources = [{ path: 'tools\\protocol.mjs', sha256: 'a'.repeat(64) }];
const run = (counts = {}) => ({ status: 0, stdout: Object.entries({
  tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, ...counts
}).map(([name, count]) => `# ${name} ${count}`).join('\n') });

test('Node CI summary reports actual successful tests without granting native certification', () => {
  const result = evaluateNodeCiRun(run(), sources, sources);
  assert.equal(result.result, 'PASS');
  assert.equal(result.tests, 3);
  assert.equal(result.passed, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.sourceAcceptanceIsCertification, false);
  assert.equal(result.certificationStatus, 'NOT CERTIFIED');
});

test('Node CI cannot count skipped or cancelled tests as passes even on runner exit zero', () => {
  for (const counts of [{ pass: 2, skipped: 1 }, { pass: 2, cancelled: 1 }, { pass: 2, fail: 1 }]) {
    const result = evaluateNodeCiRun(run(counts), sources, sources);
    assert.equal(result.result, 'FAIL');
    assert.equal(result.passed, 2);
    assert.equal(result.skipped, counts.skipped ?? 0);
    assert.equal(result.cancelled, counts.cancelled ?? 0);
    assert.equal(result.skippedTestsArePasses, false);
  }
});

test('Node CI missing TAP, source drift, failed or signalled execution cannot pass', () => {
  for (const result of [
    evaluateNodeCiRun({ status: 0, stdout: '' }, sources, sources),
    evaluateNodeCiRun(run(), sources, [{ ...sources[0], sha256: 'b'.repeat(64) }]),
    evaluateNodeCiRun({ ...run(), status: 1 }, sources, sources),
    evaluateNodeCiRun({ ...run(), status: null, signal: 'SIGTERM' }, sources, sources),
    evaluateNodeCiRun({ ...run(), error: { code: 'ETIMEDOUT' } }, sources, sources)
  ]) assert.equal(result.result, 'FAIL');
});

test('Node CI runner rejects selective or skip-waiver arguments before starting the full suite', async () => {
  await assert.rejects(ciNodeMain(['--allow-skips']), /no selective or skip waiver/);
});

test('configured Node source snapshot includes tooling tests once without executing their suites', async () => {
  const snapshot = await ciSourceSnapshot();
  assert.equal(new Set(snapshot.map(source => source.path)).size, snapshot.length);
  assert.ok(snapshot.some(source => source.path === 'tests\\verification\\ci-node.test.mjs'));
  assert.ok(snapshot.some(source => source.path.startsWith('services\\inventory-data\\tools\\') && source.path.endsWith('.test.mjs')));
});
