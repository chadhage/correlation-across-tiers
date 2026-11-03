import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../../tools/security/values.mjs';

const probe = fileURLToPath(new URL('../../tools/security/Run-JavaAuthPropagationProbe.mjs', import.meta.url));
const source = (await readFile(probe, 'utf8')).replaceAll('\r\n', '\n');
const nettySource = await readFile(new URL('../../tools/java/Run-DefaultNettyWireProbe.mjs', import.meta.url), 'utf8');

function runProbe(overrides = {}) {
  const env = { ...process.env };
  for (const name of ['CONTOSO_PORTABLE_TOOLS_ROOT', 'CONTOSO_AGENT_JAR', 'CONTOSO_PARENT_SAFE_JAR',
    'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
  const result = spawnSync(process.execPath, [probe], {
    env: { ...env, ...overrides }, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 65536
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  return result.stderr;
}

function assertPortableSource(text) {
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+|[\\/]home[\\/]+/i);
  assert.doesNotMatch(text, /\.copilot|session-state|\b(?:USERPROFILE|HOMEDRIVE|HOMEPATH)\b/i);
}

test('AV-23 Java probes have no user-profile or session-folder defaults', () => {
  for (const text of [source, nettySource]) assertPortableSource(text);
  assert.doesNotMatch(source, /CONTOSO_PORTABLE_TOOLS_ROOT\s*\?\?/);
  const prerequisite = source.indexOf('CONTOSO_PORTABLE_TOOLS_ROOT_REQUIRED');
  assert(prerequisite >= 0 && prerequisite < source.indexOf('await readFile(agent)'));
  assert(prerequisite < source.indexOf('await mkdir('));
});

test('source guard rejects seeded Windows profile and session-folder defaults', () => {
  for (const forbidden of [String.raw`C:\\Users\\fixture\\tools`, String.raw`D:\Users\fixture\tools`,
    '/home/fixture/tools', '.copilot/session-state/fixture/tools', 'process.env.USERPROFILE']) {
    assert.throws(() => assertPortableSource(source + '\n' + forbidden));
  }
});

test('missing portable root fails explicitly before artifact reads or shared build writes', () => {
  assert.match(runProbe(), /Error: CONTOSO_PORTABLE_TOOLS_ROOT_REQUIRED/);
});

test('empty or whitespace portable roots cannot select a fallback', () => {
  for (const value of ['', ' ', '\t\r\n']) {
    assert.match(runProbe({ CONTOSO_PORTABLE_TOOLS_ROOT: value }), /Error: CONTOSO_PORTABLE_TOOLS_ROOT_REQUIRED/);
  }
});

test('explicit portable root reaches the unchanged pinned-agent hash rejection', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'portable-' + randomUUID());
  try {
    const agent = path.join(root, 'agent', 'applicationinsights-agent-3.7.10.jar');
    await mkdir(path.dirname(agent), { recursive: true });
    await writeFile(agent, 'synthetic-unpinned-agent');
    const error = runProbe({ CONTOSO_PORTABLE_TOOLS_ROOT: root });
    assert.match(error, /Error: AGENT_HASH_MISMATCH/);
    assert.doesNotMatch(error, /CONTOSO_PORTABLE_TOOLS_ROOT_REQUIRED|EXTENSION_HASH_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('explicit agent override still cannot bypass its pinned hash', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'portable-' + randomUUID());
  try {
    await mkdir(root, { recursive: true });
    const agent = path.join(root, 'override.jar');
    await writeFile(agent, 'synthetic-unpinned-override');
    assert.match(runProbe({
      CONTOSO_PORTABLE_TOOLS_ROOT: path.join(root, 'unpopulated-tools'), CONTOSO_AGENT_JAR: agent
    }), /Error: AGENT_HASH_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent extension and SDK hash preflight segments remain byte-identical after root removal', () => {
  for (const [start, end, expected] of [
    ['const agent =', 'const work =', '94d90a3d642e0e721b232ee08aa68e2a5dc23cd03ece853c042500ac99308707'],
    ['const sdkArtifact =', 'const classpath =', 'e73566988d86a76ff6e542b7705df8ea6eb7724c3c74466f8773c991f2b94b18']
  ]) {
    const first = source.indexOf(start), last = source.indexOf(end);
    assert(first >= 0 && last > first);
    assert.equal(digest(source.slice(first, last)), expected);
  }
});
