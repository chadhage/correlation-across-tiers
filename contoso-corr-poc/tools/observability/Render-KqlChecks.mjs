import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderKql, PROCEDURES } from './kql.mjs';
import { RAW_TABLES, renderRawQuery } from './raw-query.mjs';
import { buildWorkbook } from './workbook.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const folder = join(root, '.cache', 'r7', 'rendered-kql');
await mkdir(folder, { recursive: true });
for (const schema of ['workspace', 'legacy']) for (const procedure of PROCEDURES) {
  const rendered = await renderKql(procedure, {
    schema, fromUtc: '2026-10-31T21:00:00Z', toUtc: '2026-10-31T21:30:00Z',
    traceId: '11111111111111111111111111111111', invocationId: 'd7e820dc-44b0-4730-b70e-bbedfd97eb5b',
    appResourceId: '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-local-schema-check/providers/Microsoft.Insights/components/contoso-local-schema-check'
  });
  await writeFile(join(folder, `${schema}-${procedure}.kql`), rendered.query);
}
const parameters = {
  workspaceId: '12345678-1234-4234-8234-123456789abc',
  fromUtc: '2026-10-31T21:00:00Z', toUtc: '2026-10-31T21:30:00Z', ingestionWatermarkUtc: '2026-10-31T21:31:00Z',
  resourceId: '/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/contoso-local-schema-check/providers/Microsoft.Insights/components/contoso-local-schema-check',
  stablePhysicalKey: '_ItemId'
};
for (const table of RAW_TABLES) for (const phase of ['schema', 'count', 'key-count', 'page']) {
  await writeFile(join(folder, `raw-${table}-${phase}.kql`), renderRawQuery(table, phase, parameters));
}
const book = await buildWorkbook();
for (const item of book.items.filter(item => item.type === 3)) {
  const query = item.content.query.replaceAll('{TimeRange:start}', parameters.fromUtc)
    .replaceAll('{TimeRange:end}', parameters.toUtc)
    .replaceAll('{TimeRange}', `between (datetime(${parameters.fromUtc}) .. datetime(${parameters.toUtc}))`)
    .replaceAll('{ApplicationInsights:escapejson}', parameters.resourceId)
    .replaceAll('{TraceId:escapejson}', '1'.repeat(32))
    .replaceAll('{InvocationId:escapejson}', 'd7e820dc-44b0-4730-b70e-bbedfd97eb5b');
  if (/\{(?:TimeRange|ApplicationInsights|TraceId|InvocationId)/.test(query)) throw new Error('Unexpanded workbook query');
  await writeFile(join(folder, `workbook-${item.name}.kql`), query);
}
console.log('Rendered current/legacy, RAW schema/count/page and all workbook queries for local declared-schema analysis only.');
