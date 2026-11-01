import assert from 'node:assert/strict';
import test from 'node:test';
import { frozenNames, validateFrozenNames } from '../tools/names.mjs';

const subscription = '00000000-0000-4000-8000-000000000001';

test('reproduces the same legal physical map for teardown/redeploy', () => {
  const first = frozenNames(subscription, 'centralus');
  const second = frozenNames(subscription, 'centralus');
  assert.deepEqual(first, second);
  validateFrozenNames(first);
  assert.notEqual(first.discriminator, frozenNames(subscription, 'eastus2').discriminator);
});

test('normalizes storage, respects vault length and avoids reserved namespace/host IDs', () => {
  const names = frozenNames(subscription, 'centralus');
  assert.equal(names.keyVault.length, 24);
  assert.ok(!names.storage.includes('-'));
  assert.ok(!names.serviceBus.endsWith('-sb'));
  for (const key of ['orders', 'inventory', 'fulfillment', 'notify', 'aggregator', 'portal']) assert.ok(names[key].length <= 32);
  names.serviceBus = 'contoso-corr-poc-sb';
  assert.throws(() => validateFrozenNames(names), /Reserved Service Bus/);
});

test('never uses a discriminator/instance ID as the logical role', () => {
  const names = frozenNames(subscription, 'centralus');
  names.roles.orders = `${names.roles.orders}-${names.discriminator}`;
  assert.throws(() => validateFrozenNames(names), /Canonical roles/);
  assert.throws(() => frozenNames('invalid', 'centralus'), /Invalid Contoso naming scope/);
});

test('rejects the former overlength inventory alias while retaining its canonical role', () => {
  const names = frozenNames(subscription, 'centralus');
  assert.equal(names.roles.inventory, 'contoso-inventory-api');
  names.inventory = `contoso-corr-poc-inventory-${names.discriminator}`;
  assert.equal(names.inventory.length, 33);
  assert.throws(() => validateFrozenNames(names), /host-name length exceeded/);
});
