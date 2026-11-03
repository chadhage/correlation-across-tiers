import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
test('telemetry source declares one shared GA backbone, delayed limits and no credentials/RBAC', async () => {
  const source = await readFile(join(root, 'infra', 'modules', 'telemetry.bicep'), 'utf8');
  assert.equal((source.match(/resource law /g) ?? []).length, 1);
  assert.equal((source.match(/resource appi /g) ?? []).length, 1);
  assert(source.includes('WorkspaceResourceId: law.id'));
  assert(source.includes('SamplingPercentage: 100'));
  assert(source.includes('DisableLocalAuth: false'));
  assert(source.includes('dailyQuotaGb: dailyCapGb'));
  assert(source.includes('skipQueryValidation: false'));
  assert(source.includes('enabled: routesConfigured'));
  assert(!source.includes('Microsoft.Authorization/roleAssignments'));
  assert(!/^output.*(?:ConnectionString|InstrumentationKey)/im.test(source));
});
test('actual portable Bicep compiler builds telemetry', { skip: !process.env.CONTOSO_BICEP_EXE }, async () => {
  await mkdir(join(root, '.cache', 'r7'), { recursive: true });
  execFileSync(process.env.CONTOSO_BICEP_EXE, ['build', join(root, 'infra', 'modules', 'telemetry.bicep'),
    '--outfile', join(root, '.cache', 'r7', 'telemetry.arm.json')], { encoding: 'utf8' });
  const arm = JSON.parse(await readFile(join(root, '.cache', 'r7', 'telemetry.arm.json'), 'utf8'));
  assert(arm.resources.some(resource => resource.type === 'Microsoft.Insights/components'));
  assert(arm.resources.some(resource => resource.type === 'Microsoft.OperationalInsights/workspaces'));
});
