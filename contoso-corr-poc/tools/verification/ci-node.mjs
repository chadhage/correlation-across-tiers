import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTestFiles } from '../run-tests.mjs';
import { sourceSnapshot } from './demo.mjs';
import { evaluateFocusedRun } from './run-focused.mjs';
import { createBoundDirectory, jsonBytes, projectRoot, readBoundFile, sha256, writeManifest } from './files.mjs';

export function evaluateNodeCiRun(run, before, after) {
  const outcome = evaluateFocusedRun(run, before, after);
  return { ...outcome, scope: 'configured-root-node-suite-only', sourceAcceptanceIsCertification: false,
    certificationStatus: 'NOT CERTIFIED', skippedTestsArePasses: false,
    acceptanceRequiresNoSkipsOrCancellations: true };
}

export async function ciSourceSnapshot() {
  const sources = new Map((await sourceSnapshot()).map(source => [source.path, source]));
  for (const file of await discoverTestFiles()) {
    const relative = path.relative(projectRoot, file);
    sources.set(relative, { path: relative, sha256: sha256(await readBoundFile(relative)) });
  }
  return [...sources.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export async function ciNodeMain(args) {
  if (args.length) throw new Error('Usage: ci-node.mjs (configured root Node suite; no selective or skip waiver arguments)');
  const directory = path.join(projectRoot, 'evidence', 'ci-node',
    `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`);
  await createBoundDirectory(directory);
  const before = await ciSourceSnapshot();
  await writeFile(path.join(directory, 'sources-before.json'), jsonBytes(before), { flag: 'wx' });
  const startedAtUtc = new Date().toISOString();
  const command = ['tools\\run-tests.mjs', '--test-reporter=tap'];
  const run = spawnSync(process.execPath, command, {
    cwd: projectRoot, encoding: 'utf8', windowsHide: true, timeout: 1_200_000, maxBuffer: 32 * 1024 * 1024
  });
  await writeFile(path.join(directory, 'tests.tap'), run.stdout ?? '', { flag: 'wx' });
  await writeFile(path.join(directory, 'stderr.txt'), run.stderr ?? '', { flag: 'wx' });
  const after = await ciSourceSnapshot();
  const result = {
    schema: 'contoso.node-ci-run.v1', command: `node ${command.join(' ')}`, nodeVersion: process.version,
    startedAtUtc, finishedAtUtc: new Date().toISOString(), exitCode: run.status, signal: run.signal,
    executionError: run.error?.code ?? null, ...evaluateNodeCiRun(run, before, after),
    beforeSourcesSha256: sha256(jsonBytes(before)), afterSourcesSha256: sha256(jsonBytes(after)),
    sources: after, limitations: ['Configured root Node tests only; frontend/browser and Java suites are not counted',
      'No hosted/runtime/native or accountable-owner certification is granted']
  };
  await writeFile(path.join(directory, 'result.json'), jsonBytes(result), { flag: 'wx' });
  await writeManifest(directory, { sourceKind: 'actual-configured-root-node-test-run',
    sourceAcceptanceIsCertification: false, startedAtUtc, finishedAtUtc: result.finishedAtUtc });
  console.log(JSON.stringify({ result: result.result, tests: result.tests, passed: result.passed,
    failed: result.failed, skipped: result.skipped, cancelled: result.cancelled,
    sourcesVerified: result.sourcesVerified, certificationStatus: 'NOT CERTIFIED',
    artifact: path.relative(projectRoot, path.join(directory, 'result.json')) }));
  if (result.result !== 'PASS') process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await ciNodeMain(process.argv.slice(2)); }
  catch { console.error('Node CI execution failed; no passing suite or certification is inferred'); process.exitCode = 1; }
}
