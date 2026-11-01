import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderKql, PROCEDURES } from './kql.mjs';
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
console.log('Rendered six queries for local syntax/source-schema checks only; no Azure rows or resource writes.');
