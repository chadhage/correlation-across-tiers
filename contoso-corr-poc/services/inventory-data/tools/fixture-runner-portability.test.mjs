import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(tools, '..', '..', '..');
const helper = path.join(project, 'tools', 'java', 'PortableTools.ps1');
const runner = path.join(tools, 'Test-InventoryFixture.ps1');
const literal = value => `'${value.replaceAll("'", "''")}'`;
const run = (command, portableRoot = '') => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference = 'Stop'; $PSStyle.OutputRendering = 'PlainText'; try { ${command} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`], {
  cwd: project,
  encoding: 'utf8',
  timeout: 30000,
  env: { ...process.env, CONTOSO_PORTABLE_TOOLS_ROOT: portableRoot }
});
const resolve = (argument = '', portableRoot = '') => {
  const result = run(`. ${literal(helper)}; Resolve-ContosoToolsRoot ${argument ? literal(argument) : ''}`, portableRoot);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('SOURCE ONLY: fixture runner uses the shared portable resolver with environment/explicit override, not an operator session', async () => {
  const source = await readFile(runner, 'utf8');
  assert.match(source, /\[string\]\$ToolsRoot = \$env:CONTOSO_PORTABLE_TOOLS_ROOT/);
  assert.match(source, /Join-Path \$project 'tools\\java\\PortableTools\.ps1'/);
  assert.match(source, /\$ToolsRoot = Resolve-ContosoToolsRoot \$ToolsRoot/);
  assert.doesNotMatch(source, /[A-Za-z]:\\Users\\|\.copilot|session-state|a2820816-/i);
  assert(source.indexOf('portable tools required') < source.indexOf('New-Item'));
});

test('LOCAL POWERSHELL: no override resolves the repository-local portable tool directory', () => {
  assert.equal(resolve(), path.join(project, '.tools', 'java'));
});

test('LOCAL POWERSHELL: environment override and explicit-argument precedence are executable', () => {
  const environment = path.join(project, '.tools', 'dat-01.2-env-witness');
  const explicit = path.join(project, '.tools', 'dat-01.2-explicit-witness');
  assert.equal(resolve('', environment), environment);
  assert.equal(resolve(explicit, environment), explicit);
});

test('CONTROL: missing explicit tools fail before Maven/output creation with actionable guidance', () => {
  const missing = path.join(project, '.tools', 'dat-01.2-never-created-explicit');
  const result = run(`& ${literal(runner)} -ToolsRoot ${literal(missing)}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pass -ToolsRoot or set CONTOSO_PORTABLE_TOOLS_ROOT/);
  assert.doesNotMatch(result.stdout + result.stderr, /BUILD SUCCESS|BUILD FAILURE|Validation:/);
});

test('CONTROL: missing environment-provided tools also fail explicitly without Maven', () => {
  const missing = path.join(project, '.tools', 'dat-01.2-never-created-environment');
  const result = run(`& ${literal(runner)}`, missing);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repository-local default is \.tools\\java/);
  assert.doesNotMatch(result.stdout + result.stderr, /BUILD SUCCESS|BUILD FAILURE|Validation:/);
});
