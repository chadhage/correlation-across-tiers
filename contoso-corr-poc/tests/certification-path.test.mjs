import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { checkCertificationSource, validateCertificationManifest } from '../tools/certification-path.mjs';
import { projectRoot } from '../tools/kanban.mjs';

const manifest = JSON.parse(await readFile(path.join(projectRoot, 'config', 'certification-dependencies.json'), 'utf8'));

test('rejects each removed claim/resource even when hidden in a disabled fragment', () => {
  const fixtures = [
    'Azure.Messaging.ServiceBus version="7.13.0"',
    'Azure.Experimental.EnableActivitySource',
    'classic adaptive sampling',
    "resource cache 'Microsoft.Cache/redis@2024-01-01' = {}",
    "loggerType: 'OTLP'"
  ];
  for (const fixture of fixtures) assert.equal(checkCertificationSource('fixture.bicep', `if (false) { ${fixture} }`).length, 1);
  assert.deepEqual(checkCertificationSource('data.bicep', "resource cache 'Microsoft.Cache/redisEnterprise@2026-09-01' = {}"), []);
});

test('rejects evaluation references on the certification deployment path', () => {
  assert.ok(checkCertificationSource('main.bicep', "module tail '../eval/a/main.bicep' = {}").some((finding) => finding.rule === 'evaluation-on-certification-path'));
});

test('does not confuse a validation-tool rejection predicate with a deployment requirement', () => {
  assert.deepEqual(checkCertificationSource('services\\inventory-data\\tools\\Test-DataModules.ps1', "Require (-not ($type -eq 'Microsoft.Cache/Redis')) 'unowned_legacy_resource'"), []);
  assert.equal(checkCertificationSource('infra\\data.bicep', "resource cache 'Microsoft.Cache/Redis@2024-01-01' = {}").length, 1);
  assert.equal(checkCertificationSource('services\\inventory-data\\tools\\Test-Evil.ps1', "resource cache 'Microsoft.Cache/Redis@2024-01-01' = {}").length, 1);
  assert.equal(checkCertificationSource('infra\\data.json', '{"type":"Microsoft.Cache/Redis","apiVersion":"2024-01-01"}').length, 1);
});

test('fails closed on preview/unknown dependencies and missing official sources', () => {
  validateCertificationManifest(manifest);
  const preview = structuredClone(manifest);
  preview.components[0].status = 'Preview';
  assert.throws(() => validateCertificationManifest(preview), /Preview\/unknown/);
  const missing = structuredClone(manifest);
  delete missing.components[0].source;
  assert.throws(() => validateCertificationManifest(missing), /Missing dependency source/);
});

test('Contoso-owned customization is not presented as a Microsoft GA announcement', () => {
  const custom = manifest.components.find((component) => component.id === 'contoso-application-and-sampler');
  assert.equal(custom.status, 'Contoso-owned');
  assert.match(custom.vendorSamplerSupportClaim, /^VERIFY:/);
});
