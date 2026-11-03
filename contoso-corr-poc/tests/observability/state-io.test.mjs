import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireControllerLock, readStateJson, retryFileOperation, writeStateJson } from '../../tools/observability/state-io.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
async function folder() {
  const path = join(root, '.cache', 'r7', 'controller', randomUUID());
  await mkdir(path, { recursive: true });
  return path;
}
async function ready(child, marker) {
  let output = '';
  for await (const part of child.stdout) {
    output += part;
    if (output.includes(marker)) return;
  }
  throw new Error(`Scoped helper exited before ${marker}`);
}

test('exclusive journal ownership is fully published and survives actual owner interruption', async () => {
  const directory = await folder();
  const moduleUrl = pathToFileURL(join(root, 'tools', 'observability', 'state-io.mjs')).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `const {acquireControllerLock}=await import(${JSON.stringify(moduleUrl)});await acquireControllerLock(process.argv[1]);console.log("LOCK_READY");process.stdin.resume();`,
    directory], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const ended = once(child, 'exit');
  child.stderr.resume();
  try {
    await ready(child, 'LOCK_READY');
    const oldOwner = await readStateJson(join(directory, '.controller-lock'));
    assert.equal(oldOwner.pid, child.pid);
    assert.match(oldOwner.token, /^[a-f0-9-]{36}$/);
    child.kill();
    await ended;
    const candidates = await Promise.allSettled([acquireControllerLock(directory), acquireControllerLock(directory)]);
    assert.equal(candidates.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(candidates.find(value => value.status === 'rejected').reason.code, 'EEXIST');
    const owner = await readStateJson(join(directory, '.controller-lock'));
    assert.equal(owner.pid, process.pid);
    assert.notEqual(owner.token, oldOwner.token);
    await candidates.find(value => value.status === 'fulfilled').value();
    assert(!(await readdir(directory)).includes('.controller-lock'));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
});

test('real Windows file-sharing contention is retried without swallowing permanent/schema faults', { skip: process.platform !== 'win32' }, async () => {
  const directory = await folder();
  const path = join(directory, 'state.json');
  await writeStateJson(path, { actual: 'fixture-state-not-telemetry' });
  const escaped = path.replaceAll("'", "''");
  const script = `$s=[IO.File]::Open('${escaped}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);try{[Console]::WriteLine('FILE_READY');[Console]::Out.Flush();[Console]::In.ReadLine()|Out-Null}finally{$s.Dispose()}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const ended = once(child, 'exit');
  child.stderr.resume();
  try {
    await ready(child, 'FILE_READY');
    await assert.rejects(readFile(path), failure => ['EBUSY', 'EPERM', 'EACCES'].includes(failure.code));
    const release = setTimeout(() => child.stdin.end('release\n'), 75);
    try { assert.deepEqual(await readStateJson(path), { actual: 'fixture-state-not-telemetry' }); }
    finally { clearTimeout(release); child.stdin.end(); }
    await ended;
    await assert.rejects(retryFileOperation(() => { throw Object.assign(new Error('permanent'), { code: 'EINVAL' }); }), /permanent/);
    await writeStateJson(path, 'not-an-object');
    await assert.rejects(retryFileOperation(() => { throw new SyntaxError('malformed state'); }), SyntaxError);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
});
