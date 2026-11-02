import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegister, officialSource, validateRegister } from '../../tools/verification/register.mjs';

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
