import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { calculateFixedCost } from '../tools/cost.mjs';
import { projectRoot } from '../tools/kanban.mjs';

const model = JSON.parse(await readFile(path.join(projectRoot, 'config', 'cost-model.json'), 'utf8'));

test('calculates exact listed fixed meters without double-counting service equivalents', () => {
  const result = calculateFixedCost(model);
  assert.ok(Math.abs(result.monthlyUsd - 257.6573) < 0.000001);
  assert.equal(model.fixedMeters.filter((meter) => meter.component.startsWith('Service Bus')).length, 1);
  assert.equal(result.provisioningApproval, 'NOT APPROVED');
  assert.ok(result.openEstimateItems.length > 0);
  assert.ok(result.variableMetersExcluded > 0);
});

test('fails closed on an unknown/zero meter or removed spend warning', () => {
  const invalid = structuredClone(model);
  invalid.fixedMeters[0].rate = 0;
  assert.throws(() => calculateFixedCost(invalid), /unknown prices are not zero/);
  const unsafe = structuredClone(model);
  unsafe.limits.budgetsNotifyButDoNotEnforceHardSpendCaps = false;
  assert.throws(() => calculateFixedCost(unsafe), /approval safeguards/);
});
