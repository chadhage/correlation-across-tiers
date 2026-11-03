import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoundDirectory, jsonBytes, projectRoot, readBoundFile, sha256, writeManifest } from './files.mjs';

const directory = path.join(projectRoot, 'tests', 'verification');
const excluded = new Set(['node_modules', 'target', 'dist', 'bin', 'obj', '.cache', '.tools', '.java-work', 'evidence']);

async function sourceTree(prefix) {
  const files = [];
  for (const entry of await readdir(path.join(projectRoot, prefix), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Focused source scope cannot follow a symlink');
    if (entry.isDirectory()) files.push(...await sourceTree(file));
    else if (entry.isFile() && /\.(?:mjs|js|ps1|json|xml)$/.test(entry.name)) files.push(file);
  }
  return files;
}

export async function focusedSourceSnapshot() {
  const files = [
    ...await sourceTree(path.join('tests', 'verification')),
    ...await sourceTree('tools'), ...await sourceTree('contracts'), ...await sourceTree('demos'),
    path.join('tests', 'kanban.test.mjs'), path.join('config', 'acceptance-scopes.json'),
    path.join('config', 'versions.lock.json')
  ];
  return Promise.all([...new Set(files)].sort().map(async file => ({ path: file, sha256: sha256(await readBoundFile(file)) })));
}

export function evaluateFocusedRun(run, before, after) {
  const count = name => Number(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm').exec(run.stdout ?? '')?.[1] ?? -1);
  const counts = { tests: count('tests'), passed: count('pass'), failed: count('fail'),
    cancelled: count('cancelled'), skipped: count('skipped') };
  const prior = new Map(before.map(source => [source.path, source.sha256]));
  const current = new Map(after.map(source => [source.path, source.sha256]));
  const sourceDrift = [...new Set([...prior.keys(), ...current.keys()])].sort()
    .filter(file => prior.get(file) !== current.get(file));
  const sourcesVerified = before.length > 0 && before.length === prior.size &&
    after.length === current.size && !sourceDrift.length;
  return {
    ...counts, sourceDrift, sourcesVerified,
    result: run.status === 0 && !run.error && !run.signal && counts.tests > 0 &&
      counts.passed === counts.tests && counts.failed === 0 && counts.cancelled === 0 &&
      counts.skipped === 0 && sourcesVerified ? 'PASS' : 'FAIL'
  };
}

export function validateFocusedReceipt(receipt, currentSources) {
  if (!Array.isArray(currentSources) || !currentSources.length ||
      new Set(currentSources.map(source => source.path)).size !== currentSources.length) {
    throw new Error('Authoritative focused source closure is missing or duplicated');
  }
  const actualSha256 = sha256(jsonBytes(currentSources));
  if (receipt?.schema !== 'contoso.local-check.v1' || receipt.scope !== 'unit' ||
      receipt.sourceKind !== 'actual-local-node-test-run' || receipt.result !== 'PASS' ||
      receipt.sourceAcceptanceIsCertification !== false || receipt.certificationStatus !== 'NOT CERTIFIED' ||
      !Number.isInteger(receipt.tests) || receipt.tests < 1 || receipt.passed !== receipt.tests ||
      receipt.failed !== 0 || receipt.cancelled !== 0 || receipt.skipped !== 0 || receipt.sourcesVerified !== true ||
      !Array.isArray(receipt.sourceDrift) || receipt.sourceDrift.length || !Array.isArray(receipt.sources) ||
      receipt.beforeSourcesSha256 !== actualSha256 || receipt.afterSourcesSha256 !== actualSha256 ||
      sha256(jsonBytes(receipt.sources)) !== actualSha256) {
    throw new Error('Focused receipt lacks exact executed/current-source scope; local evidence is not certification');
  }
  return true;
}

export async function focusedMain() {
  const files = (await readdir(directory)).filter(file => file.endsWith('.test.mjs'))
    .map(file => path.join(directory, file));
  files.push(path.join(projectRoot, 'tests', 'kanban.test.mjs'));
  const before = await focusedSourceSnapshot();
  const startedAtUtc = new Date().toISOString();
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files.sort()], {
    cwd: projectRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000
  });
  const after = await focusedSourceSnapshot();
  const outcome = evaluateFocusedRun(run, before, after);
  const result = {
    schema: 'contoso.local-check.v1', scope: 'unit', sourceKind: 'actual-local-node-test-run',
    sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED',
    command: 'node tools\\verification\\run-focused.mjs', nodeVersion: process.version,
    startedAtUtc, finishedAtUtc: new Date().toISOString(), ...outcome,
    beforeSourcesSha256: sha256(jsonBytes(before)), afterSourcesSha256: sha256(jsonBytes(after)), sources: after,
    limitations: ['Fixture positives test checkers only', 'No Azure/tool-auth/privacy/performance/accountable-owner certification']
  };
  const pack = path.join(projectRoot, 'evidence', 'verification', 'focused',
    `${startedAtUtc.replaceAll(/[-:.]/g, '')}-${randomUUID()}`);
  await createBoundDirectory(pack);
  const bytes = jsonBytes(result);
  await writeFile(path.join(pack, 'preparation-tests.json'), bytes, { flag: 'wx' });
  await writeManifest(pack, { sourceKind: result.sourceKind, sourceAcceptanceIsCertification: false,
    startedAtUtc, finishedAtUtc: result.finishedAtUtc });
  await writeFile(path.join(projectRoot, 'evidence', 'verification', 'preparation-tests.json'), bytes);
  console.log(JSON.stringify({ result: result.result, tests: result.tests, passed: result.passed,
    failed: result.failed, cancelled: result.cancelled, skipped: result.skipped, sourcesVerified: result.sourcesVerified,
    certificationStatus: 'NOT CERTIFIED', artifact: path.relative(projectRoot, path.join(pack, 'preparation-tests.json')),
    sha256: sha256(bytes) }));
  if (result.result !== 'PASS') {
    console.error('Focused verifier tests/source window failed; use the named Node test file for safe diagnostics.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await focusedMain();
}
