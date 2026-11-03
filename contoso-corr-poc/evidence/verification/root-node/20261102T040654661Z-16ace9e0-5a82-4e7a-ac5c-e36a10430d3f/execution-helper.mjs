import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = String.raw`C:\Users\chhage\repos\correlation-across-tiers\contoso-corr-poc`;
const prior = String.raw`evidence\verification\root-node\20261102T025729612Z-77451c76-5b42-49ba-a3e4-5f6975931356\before-sources.json`;
const conditional = String.raw`tools\verification\conditional-source-freeze.v6.json`;
const conditionalSha256 = '0d1b24bb57cf1259a7de289cee6bbd3449163555b7824df7280f265763b8ec09';
const bicep = String.raw`C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4\bicep.exe`;
const bicepSha256 = '398af294cf16ac4becdbd008a77d148d0e8e91492309a6b60ec911b7e1cab082';
const digest = value => createHash('sha256').update(value).digest('hex');
assert.equal(digest(await readFile(bicep)), bicepSha256);
const freezeBytes = await readFile(path.join(root, conditional));
assert.equal(digest(freezeBytes), conditionalSha256);
const freeze = JSON.parse(freezeBytes);
const old = JSON.parse(await readFile(path.join(root, prior)));
const files = [...new Set([...old.map(row => row.path), ...freeze.ownedSources.map(row => row.path),
  String.raw`tools\verification\conditional-source-freeze.v5.json`, conditional])].sort();
const pack = path.join(root, 'evidence', 'verification', 'root-node',
  `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`);
await mkdir(pack, { recursive: true });
const save = async (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path.join(pack, name), bytes, { flag: 'wx' });
  return digest(bytes);
};
async function snapshot() {
  const rows = [];
  for (const file of files) rows.push({ path: file, sha256: digest(await readFile(path.join(root, file))) });
  return rows;
}
async function validateFrozenInputs() {
  assert.equal(digest(await readFile(path.join(root, conditional))), conditionalSha256);
  for (const row of [...freeze.ownedSources, ...freeze.importedSources])
    assert.equal(digest(await readFile(path.join(root, row.path))), row.sha256, row.path);
}
await validateFrozenInputs();
const before = await snapshot();
await save('before-sources.json', before);
const startedAtUtc = new Date().toISOString();
const runner = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', 'npm test -- --test-reporter=tap'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 240000,
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, CONTOSO_BICEP_PATH: bicep, CONTOSO_BICEP_EXE: bicep }
});
const finishedAtUtc = new Date().toISOString();
await writeFile(path.join(pack, 'npm.stdout.tap'), runner.stdout ?? '', { flag: 'wx' });
await writeFile(path.join(pack, 'npm.stderr.log'), runner.stderr ?? '', { flag: 'wx' });
const count = name => {
  const match = new RegExp(`^# ${name} (\\d+)\\r?$`, 'm').exec(runner.stdout ?? '');
  return match ? Number(match[1]) : null;
};
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped']
  .map(name => [name, count(name)]));
const after = await snapshot();
await save('after-sources.json', after);
const sourcesStable = JSON.stringify(before) === JSON.stringify(after);
await validateFrozenInputs();
assert.equal(digest(await readFile(bicep)), bicepSha256);
const passed = !runner.error && runner.status === 0 && runner.signal === null && sourcesStable &&
  counts.tests > 0 && counts.pass === counts.tests && counts.fail === 0 &&
  counts.cancelled === 0 && counts.skipped === 0;
const result = {
  schema: 'contoso.parent-full-node-run.v1', result: passed ? 'PASS' : 'FAIL',
  startedAtUtc, finishedAtUtc, launcherPid: process.pid,
  commandLauncherPid: runner.pid ?? null, command: 'npm test -- --test-reporter=tap',
  exitCode: runner.status, signal: runner.signal,
  executionError: runner.error ? runner.error.code ?? 'RUNNER_ERROR' : null,
  counts, sourceFiles: files.length, sourcesStable,
  sourceSelection: 'Prior199 explicit Node/source inputs plus current owned bindings and v5/v6 freezes',
  all74ConditionalInputsBeforeAfterMatched: true,
  pinnedBicepSha256: bicepSha256,
  compilerEnvironment: ['CONTOSO_BICEP_PATH', 'CONTOSO_BICEP_EXE'],
  conditionalSourceFreeze: conditional, conditionalSourceFreezeSha256: conditionalSha256,
  stdoutSha256: digest(runner.stdout ?? ''), stderrSha256: digest(runner.stderr ?? ''),
  certified: false,
  scope: 'Actual full configured Node/source suite and pinned compiler checks; not Java/native enrollment or Azure qualification.'
};
const resultSha256 = await save('result.json', result);
console.log(JSON.stringify({ result: path.join(pack, 'result.json'), sha256: resultSha256,
  outcome: result.result, counts, sourceFiles: files.length, sourcesStable }));
if (!passed) process.exitCode = 1;
