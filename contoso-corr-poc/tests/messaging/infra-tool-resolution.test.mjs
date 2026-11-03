import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBicepCompiler } from '../../tools/messaging/bicep-tool.mjs';

const version = { status: 0, stdout: 'Bicep CLI version 0.48.1 (unit-probe)\n', stderr: '' };
const absent = { error: Object.assign(new Error('compiler not found'), { code: 'ENOENT' }), status: null };
function probe(env, result = version) {
  const calls = [];
  const resolved = resolveBicepCompiler({
    env,
    run: (...args) => { calls.push(args); return result; }
  });
  return { ...resolved, calls };
}

test('resolver unit: CONTOSO_BICEP_PATH takes precedence over the existing EXE alias', () => {
  const result = probe({ CONTOSO_BICEP_PATH: '  primary-bicep.exe  ', CONTOSO_BICEP_EXE: 'alias-bicep.exe' });
  assert.equal(result.executable, 'primary-bicep.exe');
  assert.equal(result.source, 'CONTOSO_BICEP_PATH');
  assert.equal(result.skipReason, false);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].slice(0, 2), ['primary-bicep.exe', ['--version']]);
  assert.equal(result.calls[0][2].timeout, 10_000);
  assert.equal(result.calls[0][2].windowsHide, true);
});

test('resolver unit: the EXE alias and whitespace-only primary setting are supported', () => {
  const result = probe({ CONTOSO_BICEP_PATH: ' ', CONTOSO_BICEP_EXE: 'alias-bicep.exe' });
  assert.equal(result.executable, 'alias-bicep.exe');
  assert.equal(result.source, 'CONTOSO_BICEP_EXE');
  assert.equal(result.skipReason, false);
});

test('resolver unit: an unconfigured compiler is resolved from PATH', () => {
  const result = probe({});
  assert.equal(result.executable, 'bicep');
  assert.equal(result.source, 'PATH');
  assert.equal(result.skipReason, false);
});

test('resolver unit: only an absent unconfigured compiler becomes explicitly NOT VERIFIED', () => {
  const result = probe({}, absent);
  assert.match(result.skipReason, /NOT VERIFIED: Bicep is absent from PATH/);
  assert.match(result.skipReason, /required compilation assertions were not executed/);
});

test('resolver negative: an explicitly configured missing compiler fails without fallback', () => {
  for (const env of [
    { CONTOSO_BICEP_PATH: 'missing-bicep.exe', CONTOSO_BICEP_EXE: 'available-alias.exe' },
    { CONTOSO_BICEP_EXE: 'missing-bicep.exe' }
  ]) {
    let attempts = 0;
    assert.throws(() => resolveBicepCompiler({
      env, run: () => { attempts++; return absent; }
    }), /could not run: compiler not found/);
    assert.equal(attempts, 1);
  }
});

test('resolver negative: permissions and timed-out probes cannot be reported as a missing prerequisite', () => {
  for (const code of ['EACCES', 'EPERM', 'ETIMEDOUT']) {
    const error = Object.assign(new Error(code), { code });
    assert.throws(() => probe({}, { error, status: null }), new RegExp(`could not run: ${code}`));
  }
});

test('resolver negative: a broken compiler or non-Bicep executable fails instead of skipping', () => {
  assert.throws(() => probe({}, { status: 1, stderr: 'broken installation' }), /failed its version probe: broken installation/);
  assert.throws(() => probe({}, { ...version, stdout: 'another tool 0.48.1' }), /unrecognized version response/);
  assert.throws(() => probe({}, { ...version, status: null }), /failed its version probe/);
});

test('missing-prerequisite subprocess counts all three required compilation tests as skipped, never passed', () => {
  const env = { ...process.env, PATH: '', Path: '' };
  delete env.CONTOSO_BICEP_PATH;
  delete env.CONTOSO_BICEP_EXE;
  // The subprocess must report its own TAP, not inherit the parent's worker protocol.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--test', '--test-reporter=tap', fileURLToPath(new URL('./infra.test.mjs', import.meta.url))
  ], { encoding: 'utf8', env, timeout: 30_000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /# tests 3\b/);
  assert.match(result.stdout, /# pass 0\b/);
  assert.match(result.stdout, /# fail 0\b/);
  assert.match(result.stdout, /# skipped 3\b/);
  assert.equal((result.stdout.match(/# SKIP NOT VERIFIED:/g) ?? []).length, 3);
});

test('source portability guard rejects absolute user-profile and operator-session defaults', () => {
  const forbidden = /(?:[a-z]:[\\/]+users[\\/]+|\/(?:home|Users)\/|\.copilot[\\/]+session-state[\\/]+)/i;
  const portable = source => assert.doesNotMatch(source, forbidden, 'machine-specific compiler source');
  for (const path of ['../../tests/messaging/infra.test.mjs', '../../tools/messaging/bicep-tool.mjs']) {
    portable(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  assert.throws(() => portable(['C:', 'Users', 'another-operator', 'bicep.exe'].join('\\')),
    /machine-specific compiler source/);
  assert.throws(() => portable(['.copilot', 'session-state', 'another-session', 'bicep.exe'].join('\\')),
    /machine-specific compiler source/);
  assert.throws(() => portable(['', 'home', 'another-operator', 'bicep'].join('/')),
    /machine-specific compiler source/);
});
