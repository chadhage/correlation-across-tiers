import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, link, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const pause = delay => new Promise(done => setTimeout(done, delay));
const transient = new Set(['EBUSY', 'EPERM', 'EACCES']);
const alive = pid => {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const busy = () => Object.assign(new Error('Controller journal is owned by another operation'), { code: 'EEXIST' });

export async function retryFileOperation(operation, { deadline = Date.now() + 1000 } = {}) {
  for (;;) {
    try { return await operation(); }
    catch (failure) {
      if (!transient.has(failure.code) || Date.now() >= deadline) throw failure;
      await pause(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
}

export async function readStateJson(path, options) {
  return JSON.parse(await retryFileOperation(() => readFile(path, 'utf8'), options));
}

export async function writeStateJson(path, object, options) {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.${randomUUID()}.pending`;
  try {
    await writeFile(staging, JSON.stringify(object, null, 2) + '\n', { mode: 0o600 });
    await retryFileOperation(() => rename(staging, path), options);
  } finally { await rm(staging, { force: true }); }
}

async function lockOwner(path) {
  const info = await stat(path);
  const owner = await readStateJson(info.isDirectory() ? join(path, 'owner.json') : path);
  if (!Number.isInteger(owner.pid) || owner.pid < 1 || !/^[a-f0-9-]{36}$/.test(owner.token ?? '')) {
    throw new TypeError('Unverifiable controller-lock ownership; never delete an unowned lock');
  }
  return owner;
}

// Immutable, exclusive election records fence concurrent dead-owner recovery.
async function electRecovery(directory, token, manifest, depth = 0) {
  if (depth > 64) throw new TypeError('Interrupted controller-lock recovery requires operator review');
  const election = join(directory, `.controller-recovery-${token}`);
  try { await link(manifest, election); }
  catch (failure) {
    if (failure.code !== 'EEXIST') throw failure;
    const owner = await lockOwner(election);
    if (alive(owner.pid)) throw busy();
    await electRecovery(directory, owner.token, manifest, depth + 1);
  }
}

export async function acquireControllerLock(directory) {
  const lock = join(directory, '.controller-lock');
  const token = randomUUID();
  const manifest = join(directory, `.controller-owner-${token}.json`);
  await writeStateJson(manifest, { pid: process.pid, token, acquiredAtUtc: new Date().toISOString() });
  try {
    for (;;) {
      try { await link(manifest, lock); break; }
      catch (failure) {
        if (failure.code !== 'EEXIST') throw failure;
        let owner;
        try { owner = await lockOwner(lock); }
        catch (readFailure) { if (readFailure.code === 'ENOENT') continue; throw readFailure; }
        if (alive(owner.pid)) throw busy();
        await electRecovery(directory, owner.token, manifest);
        let current;
        try { current = await lockOwner(lock); }
        catch (readFailure) { if (readFailure.code === 'ENOENT') continue; throw readFailure; }
        if (current.token !== owner.token || alive(current.pid)) throw busy();
        await rm(lock);
      }
    }
  } finally { await rm(manifest, { force: true }); }
  let released = false;
  return async () => {
    if (released) return;
    const current = await lockOwner(lock);
    if (current.token !== token || current.pid !== process.pid) throw new TypeError('Controller-lock fencing conflict');
    await rm(lock);
    released = true;
  };
}
