import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function calculateFixedCost(model) {
  if (model.schema !== 'contoso.cost-model.v1' || model.currency !== 'USD' || model.location !== 'centralus' || model.hoursPerMonth !== 730) throw new Error('Unapproved cost-model scope');
  const rows = model.fixedMeters.map((meter) => {
    if (!meter.meterId || !Number.isFinite(meter.rate) || meter.rate <= 0 || !Number.isFinite(meter.quantity) || meter.quantity <= 0 || !['hour', 'month'].includes(meter.unit)) throw new Error('Invalid fixed meter; unknown prices are not zero');
    return { component: meter.component, monthlyUsd: meter.rate * meter.quantity * (meter.unit === 'hour' ? model.hoursPerMonth : 1) };
  });
  if (!rows.length || model.limits?.provisioningRequiresSeparateApproval !== true || model.limits?.budgetsNotifyButDoNotEnforceHardSpendCaps !== true) throw new Error('Missing cost-approval safeguards');
  const monthlyUsd = rows.reduce((sum, row) => sum + row.monthlyUsd, 0);
  return {
    scope: 'fixed-listed-meters-only',
    monthlyUsd,
    hourlyEquivalentUsd: monthlyUsd / model.hoursPerMonth,
    dailyEquivalentUsd: monthlyUsd / model.hoursPerMonth * 24,
    variableMetersExcluded: model.variableMeters.length,
    openEstimateItems: model.openEstimateItems,
    provisioningApproval: 'NOT APPROVED'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools\\cost.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(calculateFixedCost(JSON.parse(await readFile(path.join(root, 'config', 'cost-model.json'), 'utf8'))), null, 2));
}
