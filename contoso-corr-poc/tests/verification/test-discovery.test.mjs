import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { discoverTestFiles } from '../../tools/run-tests.mjs';
import { projectRoot } from '../../tools/verification/files.mjs';

test('root runner discovers all ordinary tests and the source-frozen Data tool test without executing them', async () => {
  const files = await discoverTestFiles();
  assert.ok(files.includes(path.join(projectRoot, 'tests', 'kanban.test.mjs')));
  assert.ok(files.includes(path.join(projectRoot, 'services', 'inventory-data', 'tools', 'data-source-contract.test.mjs')));
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.every(file => /\.test\.(?:mjs|js)$/.test(file)));
});
