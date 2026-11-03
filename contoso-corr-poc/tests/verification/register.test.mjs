import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegister, officialSource, serializeRegister, validateRegister } from '../../tools/verification/register.mjs';

const claim = () => ({
  id: 'config\\versions.lock.json#json:/agent/version', file: 'config\\versions.lock.json',
  selector: { kind: 'json-pointer', pointer: '/agent/version' }, value: '3.7.10',
  source: 'https://github.com/microsoft/ApplicationInsights-Java/releases/tag/3.7.10', owner: 'R4', category: 'pin'
});

test('VERIFY exact official source/owner/test entry is explicit and not live verified', () => {
  const inventory = [claim()];
  const register = createRegister(inventory);
  const result = validateRegister(register, inventory);
  assert.equal(result.open.length, 1);
  assert.equal(register.claims[0].deployedValueVerified, false);
  assert.match(register.claims[0].verification, /^VERIFY:/);
  assert.throws(() => validateRegister(register, inventory, { certify: true }), /Open VERIFY/);
});

test('missing source and arbitrary unofficial GitHub repo fail closed', () => {
  const inventory = [claim()];
  const register = createRegister(inventory);
  register.claims[0].source = '';
  assert.throws(() => validateRegister(register, inventory), /official source/);
  assert.equal(officialSource('https://github.com/unknown/correlation'), false);
  assert.equal(officialSource('https://learn.microsoft.com.attacker.invalid/source'), false);
  assert.equal(officialSource('http://learn.microsoft.com/source'), false);
});

test('locked and deployed drift, new or removed numeric claims fail closed', () => {
  const inventory = [claim()];
  const register = createRegister(inventory);
  assert.throws(() => validateRegister(register, [{ ...claim(), value: '3.7.11' }]), /value drift/);
  assert.throws(() => validateRegister(register, [...inventory, { ...claim(), id: 'new-version' }]), /Unregistered/);
  assert.throws(() => validateRegister(register, []), /Removed\/stale/);
  assert.throws(() => validateRegister(register, inventory, { deployed: [{ ...claim(), value: '3.7.11' }] }), /Deployed value/);
  assert.throws(() => validateRegister(register, inventory, { deployed: [{ ...claim(), sourceKind: 'fixture-check', observed: true, evidenceSha256: '1'.repeat(64) }] }), /unverified observation/);
});

test('refresh construction preserves historical and prerelease metadata without inheriting verification', () => {
  const previous = {
    boundedLocalEvidence: { historical: true, sourceAcceptanceIsCertification: false },
    portalNodePrereleaseClassification: { scope: 'PUBLIC_OFFICIAL_SOURCE_CLASSIFICATION_ONLY', packages: [{ supportStatus: 'UNVERIFIED' }] }
  };
  const register = createRegister([claim()], previous);
  assert.deepEqual(register.boundedLocalEvidence, previous.boundedLocalEvidence);
  assert.deepEqual(register.portalNodePrereleaseClassification, previous.portalNodePrereleaseClassification);
  register.portalNodePrereleaseClassification.packages[0].supportStatus = 'changed-copy';
  assert.equal(previous.portalNodePrereleaseClassification.packages[0].supportStatus, 'UNVERIFIED');
  assert.equal(register.claims[0].officialSourceContentVerified, false);
  assert.equal(register.claims[0].deployedValueVerified, false);
  assert.throws(() => validateRegister(register, [claim()], { certify: true }), /Open VERIFY/);
});

test('refresh retains removed generated-tool claims as invalidated history, not current verification', () => {
  const tool = { ...claim(), id: '.tools\\java\\tool.json#json:/version', file: '.tools\\java\\tool.json' };
  const previous = createRegister([claim(), tool]);
  const removed = structuredClone(previous.claims[1]);
  const refreshed = createRegister([claim()], previous);
  assert.equal(refreshed.claims.length, 1);
  assert.equal(refreshed.invalidatedPreviousClaims.length, 1);
  assert.deepEqual(refreshed.invalidatedPreviousClaims[0].originalClaim, removed);
  assert.equal(refreshed.invalidatedPreviousClaims[0].result, 'INVALIDATED');
  assert.match(refreshed.invalidatedPreviousClaims[0].reason, /removed from current source inventory/i);
  assert.equal(validateRegister(refreshed, [claim()]).open.length, 1);
  assert.throws(() => validateRegister(refreshed, [claim()], { certify: true }), /Open VERIFY/);
  assert.equal(createRegister([claim()], refreshed).invalidatedPreviousClaims.length, 1);
  assert.equal(previous.claims.length, 2);
});

test('refresh preserves unchanged owner/test actions without inheriting verification or changed-source annotations', () => {
  const previous = createRegister([claim()]);
  Object.assign(previous.claims[0], {
    owner: 'R8', test: 'node --test tests\\security\\repository.test.mjs',
    nextAction: 'Run the owning-role source control before a native window.',
    label: 'Verified', deployedValueVerified: true, officialSourceContentVerified: true
  });
  const refreshed = createRegister([claim()], previous);
  assert.equal(refreshed.claims[0].owner, 'R8');
  assert.equal(refreshed.claims[0].test, previous.claims[0].test);
  assert.equal(refreshed.claims[0].nextAction, previous.claims[0].nextAction);
  assert.equal(refreshed.claims[0].deployedValueVerified, false);
  assert.equal(refreshed.claims[0].officialSourceContentVerified, false);
  assert.notEqual(refreshed.claims[0].label, 'Verified');
  const changed = createRegister([{ ...claim(), value: '3.7.11' }], previous);
  assert.equal(changed.claims[0].owner, claim().owner);
  assert.notEqual(changed.claims[0].test, previous.claims[0].test);
  assert.notEqual(changed.claims[0].nextAction, previous.claims[0].nextAction);
  assert.equal(changed.invalidatedPreviousClaims.length, 1);
});

test('unchanged refresh preserves raw byte pins and claim order but cannot retain stale verification', () => {
  const inventory = [claim(), { ...claim(), id: 'another-claim' }];
  for (const eol of ['\n', '\r\n']) {
    const previous = createRegister([...inventory].reverse());
    const original = Buffer.from((JSON.stringify(previous, null, 4) + '\n').replaceAll('\n', eol));
    assert.deepEqual(serializeRegister(createRegister(inventory, previous), original), original);
    previous.claims[0].label = 'Verified';
    previous.claims[0].deployedValueVerified = true;
    const stale = Buffer.from(JSON.stringify(previous));
    const refreshed = serializeRegister(createRegister(inventory, previous), stale);
    assert.notDeepEqual(refreshed, stale);
    assert.ok(JSON.parse(refreshed).claims.every(item => item.label !== 'Verified' && item.deployedValueVerified === false));
  }
});
