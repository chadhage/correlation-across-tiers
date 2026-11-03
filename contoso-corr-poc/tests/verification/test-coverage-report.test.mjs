import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { coverageReportReferences, validateTestCoverageReport, testCoverageReportMain } from '../../tools/verification/test-coverage-report.mjs';
import { projectRoot, readBoundFile, sha256 } from '../../tools/verification/files.mjs';

const text = await readFile(path.join(projectRoot, 'docs', 'TEST_COVERAGE_REPORT.md'), 'utf8');
const files = coverageReportReferences(text);
const evidence = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await readBoundFile(file)])));

test('whole historical coverage report binds its source commit and exact cited suite counts', async () => {
  const result = await testCoverageReportMain(['--check']);
  assert.equal(result.status, 'HISTORICAL');
  assert.equal(result.sourceCommit, '63a2a5d58cd041b9893270bc9f4e2d2294e0476d');
  assert.equal(result.nodePassed, 419);
  assert.equal(result.javaPassed, 182);
  assert.equal(result.nodeSkipped + result.javaSkipped, 0);
  assert.equal(result.currentSourceEquivalenceClaimed, false);
  assert.equal(result.codeCoverageMeasured, false);
});

test('coverage report rejects each seeded quoted count drift and missing source commit', () => {
  for (const [before, after] of [
    ['601 of 601 tests', '602 of 602 tests'],
    ['Root Node tests | 419 passed', 'Root Node tests | 420 passed'],
    ['Java tests | 182 passed', 'Java tests | 183 passed'],
    ['baseline | 601 passed', 'baseline | 602 passed'],
    ['### Java: 182 passing', '### Java: 183 passing'],
    ['### Root Node: 419 passing', '### Root Node: 420 passing'],
    ['historical 601-test root', 'historical 602-test root']
  ]) {
    assert.ok(text.includes(before));
    assert.throws(() => validateTestCoverageReport(text.replace(before, after), evidence), /reported total differs/);
  }
  assert.throws(() => validateTestCoverageReport(text.replace(/^\*\*Source commit:.*$/m, ''), evidence), /source commit is required/);
});

test('source commit or same-commit source closure drift requires the historical label', () => {
  const unlabelled = text.replace(/^\*\*Status:.*$/m, '');
  assert.throws(() => validateTestCoverageReport(unlabelled, evidence, { currentCommit: 'a'.repeat(40) }), /HISTORICAL label required/);
  const originalSources = [...JSON.parse(evidence['node-sources']), ...JSON.parse(evidence['java-build']).afterSources];
  const changed = originalSources.map(source => ({ ...source, sha256: 'b'.repeat(64) }));
  assert.throws(() => validateTestCoverageReport(unlabelled, evidence, {
    currentCommit: '63a2a5d58cd041b9893270bc9f4e2d2294e0476d', currentSources: changed
  }), /HISTORICAL label required/);
  assert.equal(validateTestCoverageReport(text, evidence, { currentCommit: 'a'.repeat(40), currentSources: changed }).status, 'HISTORICAL');
});

test('changed receipt bytes and skipped tests cannot be counted as passes', () => {
  const node = JSON.parse(evidence['node-result']);
  node.counts.pass--;
  node.counts.skipped++;
  const changedBytes = Buffer.from(JSON.stringify(node));
  assert.throws(() => validateTestCoverageReport(text, { ...evidence, 'node-result': changedBytes }), /receipt bytes changed/);
  const fixtureText = text.replace(sha256(evidence['node-result']), sha256(changedBytes));
  assert.throws(() => validateTestCoverageReport(fixtureText, { ...evidence, 'node-result': changedBytes }), /reported total differs/);
});

test('coverage checker accepts no rewrite or qualification argument and evidence links cannot escape', async () => {
  await assert.rejects(testCoverageReportMain(['--write']), /Usage:/);
  assert.throws(() => coverageReportReferences(text.replace('[node-result]: ../evidence/', '[node-result]: ../../other/')), /missing evidence reference/);
});
