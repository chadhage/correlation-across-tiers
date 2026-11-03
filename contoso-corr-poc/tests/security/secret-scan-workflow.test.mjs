import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeJwt } from './fixtures.mjs';

const workflow = (await readFile(new URL('../../../.github/workflows/secret-scan.yml', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const runner = await readFile(new URL('../../tools/security/Run-SecurityGates.ps1', import.meta.url), 'utf8');
const scanner = fileURLToPath(new URL('../../tools/security/repository.mjs', import.meta.url));

function assertWorkflowPolicy(source) {
  assert.match(source, /^on:\r?\n  pull_request:\r?\n  push:\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(source, /^\s*(?:pull_request_target|paths(?:-ignore)?|branches(?:-ignore)?|tags(?:-ignore)?|types):/m);
  assert.match(source, /^permissions:\r?\n  contents: read\s*$/m);
  assert.equal((source.match(/\bpermissions:/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\b(?:write-all|read-all)\b|:\s*write\b|\bsecrets\s*[.[]/);
  assert.match(source, /^    runs-on: windows-latest\s*$/m);
  assert.match(source, /^        uses: actions\/checkout@[0-9a-f]{40}\s*$/m);
  assert.match(source, /^        uses: actions\/setup-node@[0-9a-f]{40}\s*$/m);
  assert.match(source, /^          fetch-depth: 0\s*$/m);
  assert.match(source, /^          fetch-tags: true\s*$/m);
  assert.match(source, /^          persist-credentials: false\s*$/m);
  assert.doesNotMatch(source, /^\s+(?:if|continue-on-error|ref):|--worktree-only|-WorktreeOnly\b/m);
  assert.match(source, /^\s+\$shallow = & git rev-parse --is-shallow-repository\s*$/m);
  assert.match(source, /^\s+if \(\$LASTEXITCODE -ne 0 -or \$shallow -ne 'false'\) \{\r?\n\s+throw 'FULL_HISTORY_CHECKOUT_REQUIRED'\r?\n\s+\}/m);
  assert.match(source, /^        shell: pwsh\r?\n        run: \.\\contoso-corr-poc\\tools\\security\\Run-SecurityGates\.ps1\s*$/m);
}

test('every PR and push scan merged full history with fork-safe read-only permissions', () => {
  assertWorkflowPolicy(workflow);
  assert.match(runner, /& node --test \$tests/);
  assert.match(runner, /if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/);
  assert.match(runner, /'repository\.mjs'\), '--root', \$root/);
  assert.match(runner, /& node \$args\r?\nexit \$LASTEXITCODE/);
});

const mutations = [
  ['missing pull-request trigger', source => source.replace('  pull_request:\n', '')],
  ['missing merged-repository push trigger', source => source.replace('  push:\n', '')],
  ['privileged pull-request trigger', source => source.replace('  pull_request:', '  pull_request_target:')],
  ['path-filtered pull requests', source => source.replace('  pull_request:', '  pull_request:\n    paths: ["src/**"]')],
  ['write permissions', source => source.replace('contents: read', 'contents: write')],
  ['repository secret input', source => source + '\nenv:\n  SCAN_INPUT: ${{ secrets.SCAN_INPUT }}\n'],
  ['shallow checkout', source => source.replace('fetch-depth: 0', 'fetch-depth: 1')],
  ['omitted tags', source => source.replace('fetch-tags: true', 'fetch-tags: false')],
  ['persisted Git credentials', source => source.replace('persist-credentials: false', 'persist-credentials: true')],
  ['unpinned checkout action', source => source.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v4')],
  ['head-only PR checkout', source => source.replace('          fetch-depth:', '          ref: ${{ github.event.pull_request.head.sha }}\n          fetch-depth:')],
  ['conditional scan bypass', source => source.replace('        run: .\\contoso', '        if: github.event_name != \'pull_request\'\n        run: .\\contoso')],
  ['ignored scanner failure', source => source.replace('        run: .\\contoso', '        continue-on-error: true\n        run: .\\contoso')],
  ['worktree-only scan', source => source.replace('Run-SecurityGates.ps1\n', 'Run-SecurityGates.ps1 -WorktreeOnly\n')],
  ['missing configured scanner command', source => source.replace('Run-SecurityGates.ps1', 'No-Scan.ps1')],
  ['missing shallow-history failure', source => source.replace("throw 'FULL_HISTORY_CHECKOUT_REQUIRED'", "Write-Output 'FULL_HISTORY_CHECKOUT_REQUIRED'")]
];
for (const [label, mutate] of mutations) {
  test(`workflow guard rejects ${label}`, () => {
    const changed = mutate(workflow);
    assert.notEqual(changed, workflow);
    assert.throws(() => assertWorkflowPolicy(changed));
  });
}

test('actual scanner CLI passes a clean repository and rejects deleted fake secrets in merged history', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'ci-' + randomUUID());
  const git = (...args) => {
    const result = spawnSync('git', ['--no-pager',
      '-c', 'core.hooksPath=' + path.join(root, '.git', 'no-hooks'),
      '-c', 'commit.gpgsign=false', '-c', 'user.name=Local scanner fixture',
      '-c', 'user.email=scanner-fixture@invalid.example', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, 'local Git fixture setup must succeed');
    return result.stdout.trim();
  };
  const scan = (...args) => {
    const result = spawnSync(process.execPath, [scanner, '--root', root, ...args],
      { encoding: 'utf8', windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    return { exitCode: result.status, stdout: result.stdout, receipt: JSON.parse(result.stdout) };
  };
  const files = ['infra\\params\\poc.bicepparam', 'demos\\canary.ps1', 'evidence\\canary.json'];
  const cleanContents = ["using '../../main.bicep'\n", "# clean local fixture\n", '{"result":"PASS"}\n'];
  const seeds = files.map(() => fakeJwt());
  try {
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    }
    git('init', '--initial-branch=main');
    for (const [index, file] of files.entries()) await writeFile(path.join(root, file), cleanContents[index]);
    git('add', '--all');
    git('commit', '--quiet', '-m', 'Clean local fixture');
    const clean = scan();
    assert.equal(clean.exitCode, 0);
    assert.equal(clean.receipt.result, 'PASS');
    assert.equal(clean.receipt.historyScanned, true);
    assert.equal(clean.receipt.scannedFiles, 3);
    assert.equal(clean.receipt.scannedHistoryBlobs, 3);
    assert.deepEqual(clean.receipt.findings, []);

    git('switch', '--quiet', '-c', 'seeded-history');
    for (const [index, file] of files.entries()) await writeFile(path.join(root, file), seeds[index]);
    git('add', '--all');
    git('commit', '--quiet', '-m', 'Seed forbidden fixture values');
    for (const [index, file] of files.entries()) await writeFile(path.join(root, file), cleanContents[index]);
    git('add', '--all');
    git('commit', '--quiet', '-m', 'Remove forbidden fixture values');
    git('switch', '--quiet', 'main');
    git('merge', '--quiet', '--no-ff', '--no-edit', 'seeded-history');
    git('branch', '--delete', 'seeded-history');
    assert.match(git('rev-parse', '--verify', 'HEAD^2'), /^[0-9a-f]{40}$/);

    const worktree = scan('--worktree-only');
    assert.equal(worktree.exitCode, 0);
    assert.equal(worktree.receipt.historyScanned, false);
    assert.deepEqual(worktree.receipt.findings, []);
    const history = scan();
    assert.equal(history.exitCode, 1);
    assert.equal(history.receipt.result, 'FAIL');
    assert.equal(history.receipt.historyScanned, true);
    assert.equal(history.receipt.scannedFiles, 3);
    assert.equal(history.receipt.scannedHistoryBlobs, 6);
    assert.equal(history.receipt.findings.length, 3);
    for (const file of files) assert(history.receipt.findings.some(finding =>
      finding.file.replaceAll('/', '\\') === file && finding.origin === 'history' && finding.code === 'JWT_VALUE'));
    for (const seed of seeds) assert.equal(history.stdout.includes(seed), false);
    assert(history.receipt.findings.every(finding =>
      Object.keys(finding).every(key => ['file', 'code', 'line', 'origin', 'blobId'].includes(key))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
