import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedConfigurationHash } from '../observability/telemetry-contract.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HASH = /^(?!0{64}$)[a-f0-9]{64}$/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const nativeEvidenceHash = value => ownedConfigurationHash(value);

export function relativeFile(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) ||
      /^[a-z]:|^[\\/]|[\u0000-\u001f]/i.test(value) ||
      value.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe relative evidence path');
  return value.split(/[\\/]/).join(path.sep);
}

export async function readBoundFile(relative, root = projectRoot) {
  const name = relativeFile(relative);
  const absolute = await realpath(path.join(root, name));
  const canonicalRoot = await realpath(root);
  const resolved = path.relative(canonicalRoot, absolute);
  if (resolved.startsWith(`..${path.sep}`) || resolved === '..' || path.isAbsolute(resolved) ||
      !(await lstat(absolute)).isFile()) throw new Error('Evidence path escapes its source scope');
  return readFile(absolute);
}

export async function createBoundDirectory(directory) {
  const relative = path.relative(projectRoot, path.resolve(directory));
  const name = relativeFile(relative);
  const canonicalRoot = await realpath(projectRoot);
  let current = projectRoot;
  for (const part of name.split(path.sep)) {
    current = path.join(current, part);
    try { await mkdir(current); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const status = await lstat(current);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error('Evidence directory cannot follow a symlink/junction or overwrite a file');
    const resolved = path.relative(canonicalRoot, await realpath(current));
    if (resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) throw new Error('Evidence directory escapes the project');
  }
  return current;
}

export async function inventoryFiles(root, prefix = '') {
  const list = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink in evidence pack');
    if (entry.isDirectory()) list.push(...await inventoryFiles(root, relative));
    else if (entry.isFile()) list.push(relative);
  }
  return list.sort();
}

export async function writeManifest(directory, metadata) {
  const files = (await inventoryFiles(directory)).filter(file => file !== 'manifest.json');
  if (!files.length) throw new Error('Empty evidence pack');
  const entries = await Promise.all(files.map(async file => ({
    path: file, sha256: sha256(await readBoundFile(file, directory))
  })));
  const manifest = { schema: 'contoso.evidence-manifest.v1', ...metadata, files: entries };
  await writeFile(path.join(directory, 'manifest.json'), jsonBytes(manifest), { flag: 'wx' });
  return manifest;
}

export async function verifyManifest(directory) {
  const manifest = JSON.parse((await readBoundFile('manifest.json', directory)).toString('utf8'));
  if (manifest.schema !== 'contoso.evidence-manifest.v1' || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid evidence manifest');
  const paths = new Set();
  for (const entry of manifest.files) {
    const file = relativeFile(entry.path);
    if (file === 'manifest.json' || paths.has(file) || !HASH.test(entry.sha256 ?? '')) throw new Error('Duplicate/invalid manifest entry');
    paths.add(file);
    if (sha256(await readBoundFile(file, directory)) !== entry.sha256) throw new Error(`Evidence tampered: ${file}`);
  }
  const actual = (await inventoryFiles(directory)).filter(file => file !== 'manifest.json');
  if (actual.length !== paths.size || actual.some(file => !paths.has(file))) throw new Error('Unmanifested/missing evidence file');
  return manifest;
}
