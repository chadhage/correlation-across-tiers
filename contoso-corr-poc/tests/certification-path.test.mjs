import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { checkCertificationSource, validateCertificationManifest, validatePortalNodeClassification } from '../tools/certification-path.mjs';
import { projectRoot } from '../tools/verification/files.mjs';

const manifest = JSON.parse(await readFile(path.join(projectRoot, 'config', 'certification-dependencies.json'), 'utf8'));
const portalLock = await readFile(path.join(projectRoot, 'web', 'portal-ssr', 'package-lock.json'));
const register = JSON.parse(await readFile(path.join(projectRoot, 'config', 'verification-register.v1.json'), 'utf8'));

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
  assert.throws(() => validateCertificationManifest(manifest), /Preview\/unknown dependency: node-azure-exporter/);
  const verifiedFixture = structuredClone(manifest);
  verifiedFixture.components = verifiedFixture.components.filter(item => item.status !== 'UNVERIFIED');
  validateCertificationManifest(verifiedFixture);
  const preview = structuredClone(verifiedFixture);
  preview.components[0].status = 'Preview';
  assert.throws(() => validateCertificationManifest(preview), /Preview\/unknown/);
  const missing = structuredClone(verifiedFixture);
  delete missing.components[0].source;
  assert.throws(() => validateCertificationManifest(missing), /Missing dependency source/);
});

test('Contoso-owned customization is not presented as a Microsoft GA announcement', () => {
  const custom = manifest.components.find((component) => component.id === 'contoso-application-and-sampler');
  assert.equal(custom.status, 'Contoso-owned');
  assert.match(custom.vendorSamplerSupportClaim, /^VERIFY:/);
});

test('both exact resolved Portal beta packages have public source classifications, not support clearance', () => {
  const result = validatePortalNodeClassification(manifest, portalLock, register.portalNodePrereleaseClassification);
  assert.equal(result.classifiedPrereleases, 2);
  assert.equal(result.certificationDependenciesVerified, false);
  assert.equal(result.sourceAcceptanceIsCertification, false);
});

test('a different stable instrumentation release cannot promote the resolved beta', () => {
  const changed = structuredClone(manifest);
  const component = changed.components.find(item => item.id === 'node-azure-sdk-instrumentation');
  component.status = 'GA';
  changed.components = [component];
  assert.throws(() => validateCertificationManifest(changed), /Prerelease cannot be GA/);
  assert.throws(() => validatePortalNodeClassification(changed, portalLock, register.portalNodePrereleaseClassification), /Missing\/duplicate|cannot inherit/);
});

test('Portal classification rejects lock drift, missing beta and caller GA/support labels', () => {
  const classification = register.portalNodePrereleaseClassification;
  assert.throws(() => validatePortalNodeClassification(manifest, Buffer.concat([portalLock, Buffer.from('\n')]), classification), /drift/);
  assert.throws(() => validatePortalNodeClassification(manifest, portalLock, { ...classification, packages: classification.packages.slice(1) }), /drift/);
  for (const mutation of [
    item => { item.supportStatus = 'GA'; },
    item => { item.vendorGaVerified = true; },
    item => { item.deployedValueVerified = true; },
    item => { item.runtimeCompatibilityVerified = true; },
    item => { item.officialReleaseSource = 'https://github.com/untrusted/repo/blob/main/CHANGELOG.md'; },
    item => { item.version = '1.0.0'; }
  ]) {
    const changed = structuredClone(classification);
    mutation(changed.packages[1]);
    assert.throws(() => validatePortalNodeClassification(manifest, portalLock, changed), /cannot inherit/);
  }
});

test('removing the instrumentation gap from the manifest cannot hide a resolved prerelease', () => {
  const changed = structuredClone(manifest);
  changed.components = changed.components.filter(item => item.id !== 'node-azure-sdk-instrumentation');
  assert.throws(() => validatePortalNodeClassification(changed, portalLock, register.portalNodePrereleaseClassification), /Missing\/duplicate/);
});
