import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { scanRepository } from '../../tools/security/repository.mjs';
import { sourceSnapshot } from '../../tools/verification/demo.mjs';
import { projectRoot } from '../../tools/verification/files.mjs';
import { discoverClaims } from '../../tools/verification/register.mjs';

async function fixtureDirectory(parent, name) {
  const directory = path.join(projectRoot, parent, `${name}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

function git(directory, args) {
  const result = spawnSync('git', ['-C', directory, '-c', 'core.longpaths=true', ...args], { windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr?.toString('utf8'));
  return result.stdout;
}

test('raw source, lockfile, board and evidence bytes survive every Git autocrlf checkout mode', async () => {
  const directory = await fixtureDirectory('.cache', 'checkout-byte-policy');
  const samples = new Map([
    [path.join('contoso-corr-poc', 'tools', 'pinned.mjs'), Buffer.from('export const pinned = true;\n')],
    [path.join('contoso-corr-poc', 'services', 'Pinned.java'), Buffer.from('class Pinned {}\r\n')],
    [path.join('contoso-corr-poc', 'web', 'portal-ssr', 'package-lock.json'), Buffer.from('{"packages":{}}\n')],
    [path.join('contoso-corr-poc', 'evidence', 'reviews', 'receipt.json'), Buffer.from('{"result":"NOT RUN"}\r\n')],
    [path.join('.docs', 'wiki', 'Contoso_E2E_Correlation_POC_Backlog.md'), Buffer.from('# Backlog\n')],
    [path.join('.docs', 'wiki', 'Contoso_E2E_Correlation_POC_Kanban.md'), Buffer.from('# Board\r\n')],
    [path.join('.github', 'workflows', 'fixture.yml'), Buffer.from('name: Fixture\n')]
  ]);
  try {
    await copyFile(path.join(projectRoot, '..', '.gitattributes'), path.join(directory, '.gitattributes'));
    for (const [file, bytes] of samples) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), bytes);
    }
    git(directory, ['init', '--quiet']);
    git(directory, ['-c', 'core.autocrlf=true', '-c', 'core.safecrlf=true', 'add', '--all']);
    for (const [file, bytes] of samples) {
      assert.deepEqual(git(directory, ['show', `:${file.replaceAll(path.sep, '/')}`]), bytes, file);
    }
    for (const mode of ['true', 'false', 'input']) {
      const checkout = path.join(directory, `checkout-${mode}`);
      await mkdir(checkout, { recursive: true });
      git(directory, ['-c', `core.autocrlf=${mode}`, 'checkout-index', '--all', `--prefix=${checkout}${path.sep}`]);
      for (const [file, bytes] of samples) {
        assert.deepEqual(await readFile(path.join(checkout, file)), bytes, `${mode}: ${file}`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('certification source snapshots exclude installed portable tools but retain application sources', async () => {
  const directory = await fixtureDirectory('.tools', 'checkout-source-control');
  try {
    await writeFile(path.join(directory, 'tool.json'), '{"version":"99.42.17"}\n');
    const sources = await sourceSnapshot();
    assert.ok(sources.every(source => source.path.split(/[\\/]/)[0] !== '.tools'));
    assert.ok(sources.some(source => source.path === path.join('tools', 'verification', 'demo.mjs')));
    assert.ok(sources.some(source => source.path === path.join('config', 'versions.lock.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('VERIFY inventory excludes installed tool versions without hiding application dependency claims', async () => {
  const directory = await fixtureDirectory('.tools', 'checkout-claim-control');
  try {
    await writeFile(path.join(directory, 'tool.json'), '{"version":"99.42.17"}\n');
    const claims = await discoverClaims();
    assert.ok(claims.every(claim => claim.file.split(/[\\/]/)[0] !== '.tools'));
    assert.ok(claims.some(claim => claim.file === path.join('config', 'versions.lock.json')));
    assert.ok(claims.some(claim => claim.file === path.join('web', 'portal-ssr', 'package-lock.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('repository scans exclude generated portable installations, not ordinary source files', async () => {
  const directory = await fixtureDirectory('.cache', 'checkout-security-control');
  try {
    await mkdir(path.join(directory, '.tools', 'jdk'), { recursive: true });
    await writeFile(path.join(directory, '.tools', 'jdk', 'generated.txt'), '-----BEGIN ' + 'PRIVATE KEY-----');
    await writeFile(path.join(directory, 'source.mjs'), 'export const application = true;\n');
    const result = await scanRepository({ root: directory, history: false });
    assert.equal(result.result, 'PASS');
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.scannedHistoryBlobs, 0);
    assert.deepEqual(result.findings, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
