import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../../tools/verification/files.mjs';

const scriptPath = path.join(projectRoot, 'tools', 'Prepare-NodeTests.ps1');
const script = await readFile(scriptPath, 'utf8');
const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const workflow = await readFile(path.join(projectRoot, '..', '.github', 'workflows', 'ci-node.yml'), 'utf8');

test('Node test preparation builds the real pinned sampler and Portal output without running Java or native tests', () => {
  assert.equal(manifest.scripts['test:prepare'], 'pwsh -NoProfile -File tools\\Prepare-NodeTests.ps1');
  assert.match(script, /Use-Portable\.ps1/);
  assert.match(script, /mvn -B -ntp -pl :contoso-parent-safe-sampler -am -DskipTests package/);
  assert.match(script, /Get-Extension\.ps1/);
  assert.match(script, /npm --prefix \$portal ci --workspaces=false --ignore-scripts/);
  assert.match(script, /npm --prefix \$portal run compile --workspaces=false/);
  assert.match(script, /NODE_TEST_BUILD_INPUTS_READY_NOT_CERTIFIED; Java tests were not executed/);
  assert.doesNotMatch(script, /\baz(?:d)? (?:up|deploy)|createAdapter|mvn .*\bverify\b/);
});

test('preparation failures and lockfile changes are explicit and CI prepares before executing the root suite', () => {
  for (const code of ['NODE_TEST_SAMPLER_BUILD_FAILED', 'NODE_TEST_PORTAL_DEPENDENCIES_FAILED',
    'NODE_TEST_PORTAL_LOCKFILE_CHANGED', 'NODE_TEST_PORTAL_COMPILE_FAILED']) assert.ok(script.includes(`throw '${code}'`));
  const preparation = workflow.indexOf('npm run test:prepare');
  const execution = workflow.indexOf('node tools\\verification\\ci-node.mjs');
  assert.ok(preparation >= 0 && preparation < execution);
  assert.match(workflow, /throw 'NODE_TEST_BUILD_PREREQUISITE_FAILED'/);
});

test('an unavailable explicit tool root fails before any package installation or success output', () => {
  const missing = path.join(projectRoot, '.cache', `missing-node-test-tools-${randomUUID()}`);
  const result = spawnSync('pwsh', ['-NoProfile', '-File', scriptPath, '-ToolsRoot', missing], {
    cwd: projectRoot, encoding: 'utf8', windowsHide: true, timeout: 10000
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /NODE_TEST_BUILD_INPUTS_READY_NOT_CERTIFIED|BUILD SUCCESS|added \d+ packages/);
  assert.match(result.stderr, /missing|not found|does not exist/i);
});
