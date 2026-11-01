import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbook, validateWorkbook } from '../../tools/observability/workbook.mjs';
import { loadRootMap } from '../../tools/observability/kql.mjs';
test('workbook binds actual renderer and root map without credentials or invented live status', async () => {
  const book = validateWorkbook(await buildWorkbook());
  const { mapSha256 } = await loadRootMap();
  assert.equal(book.metadata.sourceBoundaryMapSha256, mapSha256);
  assert.equal(book.metadata.certificationEligible, false);
  const queries = book.items.filter(item => item.type === 3);
  assert(queries.some(item => item.name === 'trace-reconstruct'));
  assert(queries.some(item => item.name === 'business-lookup'));
  assert(queries.some(item => item.name === 'orphan-candidates'));
  assert(queries.some(item => item.name === 'physical-volume'));
  assert(queries.every(item => item.content.crossComponentResources[0] === '{Workspace}'));
  const text = JSON.stringify(book);
  assert(!text.includes('{{'));
  assert(!text.includes('render-sentinel'));
  assert(!text.includes('InstrumentationKey='));
  assert(text.toLowerCase().includes('actual observed'));
});
test('unresolved workbook bindings or credential literals cannot be accepted', async () => {
  const book = await buildWorkbook();
  book.items[0].content.json += ' InstrumentationKey=unsafe';
  assert.throws(() => validateWorkbook(book));
});
