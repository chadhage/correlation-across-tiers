import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function testFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(full));
    else if (entry.isFile() && /\.test\.(?:mjs|js)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = (await testFiles(path.join(root, 'tests'))).sort();
if (!files.length) throw new Error('No repository-native test files discovered');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status === null) throw new Error(`Test runner terminated by ${result.signal}`);
process.exitCode = result.status;
