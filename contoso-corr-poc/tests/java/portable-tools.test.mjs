import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scripts = ['Use-Portable.ps1', 'Install-Portable.ps1', 'Install-Bicep.ps1',
  'Get-Agent.ps1', 'Gate-05.ps1', 'Validate-Compute.ps1'];
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
function fixture(action) {
  const directory = join(root, 'tests', 'java', 'generated-fixtures', randomUUID());
  const tools = join(directory, 'selected tools');
  mkdirSync(join(directory, 'tools', 'java'), { recursive: true });
  mkdirSync(join(directory, 'config'), { recursive: true });
  mkdirSync(tools, { recursive: true });
  for (const script of [...scripts, 'PortableTools.ps1'])
    copyFileSync(join(root, 'tools', 'java', script), join(directory, 'tools', 'java', script));
  const lock = {
    portableTools: {
      jdk: { version: '25.0.5+8', file: 'jdk.zip', sha256: hash('locked-jdk') },
      maven: { version: '3.10.0', file: 'maven.zip', sha512: hash('locked-maven', 'sha512') },
      bicep: { file: 'bicep.ps1', sha256: hash("Write-Output 'Bicep fixture'; exit 0") }
    },
    agent: { file: 'agent.jar', sha256: hash('locked-agent'), bytes: 12 }
  };
  writeFileSync(join(directory, 'config', 'versions.lock.json'), JSON.stringify(lock));
  writeFileSync(join(tools, 'jdk.zip'), 'locked-jdk');
  writeFileSync(join(tools, 'maven.zip'), 'locked-maven');
  mkdirSync(join(tools, 'jdk-25.0.5+8', 'bin'), { recursive: true });
  mkdirSync(join(tools, 'apache-maven-3.10.0', 'bin'), { recursive: true });
  writeFileSync(join(tools, 'jdk-25.0.5+8', 'bin', 'java.exe'), '');
  writeFileSync(join(tools, 'apache-maven-3.10.0', 'bin', 'mvn.cmd'), '');
  writeFileSync(join(tools, 'bicep.ps1'), "Write-Output 'Bicep fixture'; exit 0");
  mkdirSync(join(tools, 'agent'));
  writeFileSync(join(tools, 'agent', 'agent.jar'), 'locked-agent');
  try { action({ directory, tools, lock }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
function run(directory, command, tools) {
  const env = { ...process.env, FIXTURE_ROOT: directory };
  delete env.CONTOSO_PORTABLE_TOOLS_ROOT;
  if (tools) env.CONTOSO_PORTABLE_TOOLS_ROOT = tools;
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Set-Location $env:FIXTURE_ROOT; " + command],
  { encoding: 'utf8', env, timeout: 30_000 });
}
function accepted(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
function rejected(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, pattern);
}

test('all six portable scripts reject machine/session defaults and use the shared convention', () => {
  for (const script of scripts) {
    const source = readFileSync(join(root, 'tools', 'java', script), 'utf8');
    assert.doesNotMatch(source, /[a-z]:[\\/]+users[\\/]|session-state/iu, script);
    assert.match(source, /CONTOSO_PORTABLE_TOOLS_ROOT/u, script);
  }
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.tools\/$/mu);
});

test('unset root resolves to this repository, and missing tools stop explicitly before Maven', () => {
  fixture(({ directory }) => {
    const resolved = run(directory,
      ". .\\tools\\java\\PortableTools.ps1; Write-Output (Resolve-ContosoToolsRoot)");
    accepted(resolved);
    assert.equal(resolved.stdout.trim(), join(directory, '.tools', 'java'));
    for (const script of ['Use-Portable.ps1', 'Gate-05.ps1', 'Validate-Compute.ps1'])
      rejected(run(directory, `& .\\tools\\java\\${script}`), /CONTOSO_PORTABLE_TOOLS_ROOT/u);
  });
});

test('explicit root beats the environment and preserves spaced paths with locked versions', () => {
  fixture(({ directory, tools }) => {
    const result = run(directory,
      "$selected=$env:CONTOSO_PORTABLE_TOOLS_ROOT; $env:CONTOSO_PORTABLE_TOOLS_ROOT='missing'; " +
      ". .\\tools\\java\\Use-Portable.ps1 -ToolsRoot $selected; " +
      "@{root=$env:CONTOSO_PORTABLE_TOOLS_ROOT;java=$env:JAVA_HOME;maven=$env:MAVEN_OPTS} | ConvertTo-Json", tools);
    accepted(result);
    const value = JSON.parse(result.stdout);
    assert.equal(value.root, tools);
    assert.equal(value.java, join(tools, 'jdk-25.0.5+8'));
    assert.ok(value.maven.includes(`-Dmaven.repo.local="${tools}\\m2"`));
  });
});

test('environment root is honored and both archive hashes are rechecked before reuse', () => {
  fixture(({ directory, tools }) => {
    accepted(run(directory, '. .\\tools\\java\\Use-Portable.ps1', tools));
    for (const [file, original] of [['jdk.zip', 'locked-jdk'], ['maven.zip', 'locked-maven']]) {
      writeFileSync(join(tools, file), 'tampered');
      rejected(run(directory, '. .\\tools\\java\\Use-Portable.ps1', tools), /integrity failure/u);
      writeFileSync(join(tools, file), original);
    }
    rmSync(join(tools, 'jdk-25.0.5+8'), { recursive: true });
    mkdirSync(join(tools, 'jdk-other', 'bin'), { recursive: true });
    rejected(run(directory, '. .\\tools\\java\\Use-Portable.ps1', tools), /CONTOSO_PORTABLE_TOOLS_ROOT/u);
  });
});

test('portable installation rejects a changed archive before extraction or download', () => {
  fixture(({ directory, tools }) => {
    writeFileSync(join(tools, 'jdk.zip'), 'tampered');
    rejected(run(directory,
      "function Invoke-WebRequest { throw 'UNEXPECTED_NETWORK' }; function Expand-Archive { throw 'UNEXPECTED_EXTRACTION' }; " +
      '& .\\tools\\java\\Install-Portable.ps1', tools), /integrity failure/u);
  });
});

test('agent lookup honors the root, checks checksum and size, and never needs network for existing bytes', () => {
  fixture(({ directory, tools, lock }) => {
    const command = "function Invoke-WebRequest { throw 'UNEXPECTED_NETWORK' }; & .\\tools\\java\\Get-Agent.ps1";
    const result = run(directory, command, tools);
    accepted(result);
    assert.equal(result.stdout.trim(), join(tools, 'agent', 'agent.jar'));
    writeFileSync(join(tools, 'agent', 'agent.jar'), 'tampered');
    rejected(run(directory, command, tools), /integrity failure/u);
    writeFileSync(join(tools, 'agent', 'agent.jar'), 'locked-agent');
    lock.agent.bytes = 99;
    writeFileSync(join(directory, 'config', 'versions.lock.json'), JSON.stringify(lock));
    rejected(run(directory, command, tools), /agent integrity failure/u);
  });
});

test('Bicep install honors the root and rejects a changed compiler before executing it', () => {
  fixture(({ directory, tools }) => {
    const command = "function Invoke-WebRequest { throw 'UNEXPECTED_NETWORK' }; & .\\tools\\java\\Install-Bicep.ps1";
    accepted(run(directory, command, tools));
    writeFileSync(join(tools, 'bicep.ps1'), "throw 'UNEXPECTED_EXECUTION'");
    rejected(run(directory, command, tools), /integrity failure/u);
  });
});

test('Gate-05 carries the explicit root to the agent and keeps its extension verification', () => {
  const source = readFileSync(join(root, 'tools', 'java', 'Gate-05.ps1'), 'utf8');
  assert.match(source, /'Get-Agent\.ps1'\) -ToolsRoot \$ToolsRoot/u);
  assert.match(source, /'Get-Extension\.ps1'/u);
  assert.match(readFileSync(join(root, 'tools', 'java', 'Get-Extension.ps1'), 'utf8'),
    /RequireExtensionEvidence/u);
});
