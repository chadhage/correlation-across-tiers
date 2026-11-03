import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, readBoundFile, relativeFile, sha256 } from './files.mjs';

const fail = detail => { throw new Error(`COVERAGE_REPORT_DRIFT: ${detail}`); };
const historical = text => /^\*\*Status:\*\* HISTORICAL\b/m.test(text);
const references = ['node-result', 'node-sources', 'java-build'];

export function coverageReportReferences(text) {
  return Object.fromEntries(references.map(reference => {
    const file = new RegExp(`^\\[${reference}\\]: \\.\\./([^\\r\\n]+)\\r?$`, 'm').exec(text)?.[1];
    if (!file || !file.startsWith('evidence/')) fail(`missing evidence reference ${reference}`);
    return [reference, relativeFile(file)];
  }));
}

function receipt(text, reference, bytes) {
  const expected = new RegExp(`\\[[^\\]\\r\\n]+\\]\\[${reference}\\] \\| \`([a-f0-9]{64})\` \\|`).exec(text)?.[1];
  if (!expected || sha256(bytes) !== expected) fail(`cited ${reference} receipt bytes changed`);
  return JSON.parse(bytes.toString('utf8'));
}

export function validateTestCoverageReport(text, evidence, { currentCommit, currentSources } = {}) {
  const sourceCommit = /^\*\*Source commit:\*\* `([a-f0-9]{40})`/m.exec(text)?.[1];
  if (!sourceCommit) fail('source commit is required');
  const node = receipt(text, 'node-result', evidence['node-result']);
  const nodeSources = receipt(text, 'node-sources', evidence['node-sources']);
  const java = receipt(text, 'java-build', evidence['java-build']);
  if (node.schema !== 'contoso.parent-full-node-run.v1' || java.schema !== 'contoso.parent-java-reactor-build.v1' ||
      node.result !== 'PASS' || java.result !== 'PASS' || node.exitCode !== 0 || java.exitCode !== 0 ||
      node.certified !== false || java.certified !== false || node.sourcesStable !== true || java.sourcesStable !== true ||
      !Array.isArray(nodeSources) || nodeSources.length !== node.sourceFiles ||
      !Array.isArray(java.afterSources) || !Array.isArray(java.suites) || !Array.isArray(java.moduleOutputs)) {
    fail('actual source-bound historical execution receipts required');
  }
  const counts = node.counts;
  if (!counts || ['tests', 'pass', 'fail', 'cancelled', 'skipped'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0) ||
      counts.pass + counts.fail + counts.cancelled + counts.skipped !== counts.tests ||
      ['tests', 'failures', 'errors', 'skipped'].some(key => !Number.isSafeInteger(java[key]) || java[key] < 0) ||
      java.suites.reduce((sum, suite) => sum + suite.tests, 0) !== java.tests ||
      java.moduleOutputs.reduce((sum, module) => sum + module.tests, 0) !== java.tests) fail('receipt count accounting is inconsistent');
  const nodePassed = counts.pass;
  const javaPassed = java.tests - java.failures - java.errors - java.skipped;
  const totalPassed = nodePassed + javaPassed;
  const totalTests = counts.tests + java.tests;
  const checks = [
    [/passed \*\*(\d+) of (\d+) tests\*\*/, [totalPassed, totalTests]],
    [/\| Root Node tests \| (\d+) passed; (\d+) failed; (\d+) cancelled; (\d+) skipped \|/, [nodePassed, counts.fail, counts.cancelled, counts.skipped]],
    [/\| Java tests \| (\d+) passed across (\d+) modules; (\d+) failures; (\d+) errors; (\d+) skips \|/, [javaPassed, java.moduleOutputs.length, java.failures, java.errors, java.skipped]],
    [/\| Combined root Node and Java baseline \| (\d+) passed \|/, [totalPassed]],
    [/### Java: (\d+) passing tests/, [javaPassed]],
    [/### Root Node: (\d+) passing tests in (\d+) historical discovered test files/, [nodePassed, nodeSources.filter(source => /\.test\.(?:mjs|js)$/.test(source.path)).length]],
    [/\| \*\*Total\*\* \| \*\*(\d+)\*\* \|/, [javaPassed]],
    [/\| \*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+) executed tests in the cited root run\*\* \|/, [nodeSources.filter(source => /\.test\.(?:mjs|js)$/.test(source.path)).length, counts.tests]],
    [/\*\*Conclusion:\*\* the cited historical (\d+)-test root Node\/Java baseline passed/, [totalPassed]]
  ];
  for (const [pattern, expected] of checks) {
    const observed = pattern.exec(text);
    if (!observed || expected.some((value, index) => Number(observed[index + 1]) !== value)) fail('reported total differs from its cited receipt');
  }
  const recordedSources = [...nodeSources, ...java.afterSources];
  if (!historical(text) && (sourceCommit !== currentCommit || !Array.isArray(currentSources) ||
      recordedSources.some(source => currentSources.find(item => item.path === source.path)?.sha256 !== source.sha256))) {
    fail('HISTORICAL label required after source commit or closure changes');
  }
  return { result: 'PASS', status: historical(text) ? 'HISTORICAL' : 'CURRENT_SOURCE_CONSISTENCY_ONLY',
    sourceCommit, nodePassed, nodeSkipped: counts.skipped, javaPassed, javaSkipped: java.skipped,
    currentSourceEquivalenceClaimed: false, codeCoverageMeasured: false, sourceAcceptanceIsCertification: false,
    certificationStatus: 'NOT CERTIFIED' };
}

export async function testCoverageReportMain(args) {
  if (args.length !== 1 || args[0] !== '--check') throw new Error('Usage: test-coverage-report.mjs --check');
  const text = await readFile(path.join(projectRoot, 'docs', 'TEST_COVERAGE_REPORT.md'), 'utf8');
  const files = coverageReportReferences(text);
  const evidence = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await readBoundFile(file)])));
  if (historical(text)) return validateTestCoverageReport(text, evidence);
  const git = spawnSync('git', ['--no-pager', 'rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
  if (git.status !== 0) fail('source commit unavailable; retain HISTORICAL label');
  return validateTestCoverageReport(text, evidence, { currentCommit: git.stdout.trim() });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await testCoverageReportMain(process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
