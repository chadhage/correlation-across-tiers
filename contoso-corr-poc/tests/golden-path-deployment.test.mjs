import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frozenNames } from '../tools/names.mjs';
import { ROOT_SUBSCRIPTION_ID } from '../tools/root-preflight.mjs';
import computeSkus from '../infra/compute-skus.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ps = value => `'${value.replaceAll("'", "''")}'`;
function run(command, { azure = "throw 'UNEXPECTED_AZURE_CALL'", prompt = '', retail = "throw 'UNEXPECTED_PRICE_CALL'" } = {}) {
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; function az { ${azure} }; function Invoke-RestMethod { param($Uri,$TimeoutSec); ${retail} }; ${prompt}; ${command}`],
  { cwd: root, encoding: 'utf8', timeout: 120000 });
}
const selectedSubscription = '11111111-2222-4333-8444-555555555555';
const tenantId = '22222222-2222-4222-8222-222222222222';
const subscriptions = [
  { id: ROOT_SUBSCRIPTION_ID, name: 'Disabled subscription', tenantId, state: 'Disabled' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'B sandbox', tenantId, state: 'Enabled' },
  { id: selectedSubscription, name: 'A sandbox', tenantId, state: 'Enabled' }
];
const discovery = value => `
  if (($args[0..1] -join ' ') -ne 'account list') { throw 'UNEXPECTED_AZURE_CALL' };
  $global:LASTEXITCODE=0; ${ps(JSON.stringify(value))}
`;
const quotas = [
  { name: { value: 'P1v3' }, currentValue: 0, limit: 1, unit: 'Instances' },
  { name: { value: 'P1v4' }, currentValue: 0, limit: 1, unit: 'Instances' }
];
const price = (skuName, retailPrice, changes = {}) => ({
  skuName, retailPrice, productName: `Azure App Service Premium ${skuName.endsWith('v4') ? 'v4' : 'v3'} Plan - Linux`,
  serviceName: 'Azure App Service', armRegionName: 'centralus', currencyCode: 'USD',
  type: 'Consumption', unitOfMeasure: '1 Hour', isPrimaryMeterRegion: true, tierMinimumUnits: 0,
  effectiveStartDate: '2026-01-01T00:00:00Z', meterId: `meter-${skuName}`, ...changes
});
const prices = [price('P1 v3', 0.17), price('P1v4', 0.15)];
const retailResponse = items => `${ps(JSON.stringify({ Items: items, NextPageLink: null }))} | ConvertFrom-Json`;
function targetAzure({ usage = quotas, plans = [], regions = [{ name: 'Central US' }] } = {}) {
  return `
    $global:LASTEXITCODE=0;
    if (($args[0..1] -join ' ') -eq 'account list') { ${ps(JSON.stringify(subscriptions))}; return };
    if ($args[0] -eq 'rest') { ${ps(JSON.stringify({ value: usage }))}; return };
    if (($args[0..2] -join ' ') -eq 'appservice plan list') { ${ps(JSON.stringify(plans))}; return };
    if (($args[0..1] -join ' ') -eq 'appservice list-locations') { ${ps(JSON.stringify(regions))}; return };
    throw 'UNEXPECTED_AZURE_CALL'
  `;
}
function foundation(subscriptionId = ROOT_SUBSCRIPTION_ID) {
  const names = frozenNames(subscriptionId, 'centralus');
  return { schema: 'contoso.root-inputs.v1', subscriptionId, location: 'centralus',
    resourceGroup: names.resourceGroup, deploymentPhase: 'foundation', names, publisherName: 'Contoso',
    publisherEmail: 'operator@example.invalid', applicationConfiguration: {}, postgresAdministrator: {},
    scmRunnerCidrs: [], notificationActionGroupIds: [], deploymentApprovalReference: 'UNIT_ONLY_NOT_AUTHORITY' };
}
const selector = output => `& .\\demos\\01\\Select-AzureTarget.ps1 -OutputPath ${ps(output)} ` +
  '-PublisherEmail operator@example.invalid -AllowAzureRead -ApprovalReference UNIT_ONLY_NOT_AUTHORITY';

test('authenticated subscription selection lists only enabled targets, derives names and never changes the default',
  async () => temporary(async directory => {
    const output = path.join(directory, 'selected.json');
    const result = run(`${selector(output)} | ConvertTo-Json -Compress`, {
      azure: targetAzure(), retail: retailResponse(prices),
      prompt: "function Read-Host { param($text); if ($text -like 'Provide a subscription*') { '1' } else { '' } }"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /A sandbox/);
    assert.match(result.stdout, new RegExp(tenantId));
    assert.doesNotMatch(result.stdout, /Disabled subscription/);
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(summary.subscriptionId, selectedSubscription);
    assert.equal(summary.azureReadOnly, true);
    assert.equal(summary.computeSku, 'P1v4');
    assert.equal(summary.estimatedComputeUsdPerMonth, 109.5);
    assert.equal(summary.deployed, false);
    const input = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(input.names, frozenNames(selectedSubscription, 'centralus'));
    assert.equal(input.subscriptionId, selectedSubscription);
    assert.equal(input.computeSku, 'P1v4');
    assert.equal(input.deploymentApprovalReference, '');
    assert.deepEqual(input.applicationConfiguration, {});
    const repeated = run(`${selector(output)} -SubscriptionId ${selectedSubscription}`);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /AZURE_NEW_TARGET_INPUT_REQUIRED/);
    assert.doesNotMatch(repeated.stderr, /UNEXPECTED_AZURE_CALL/);
  }));

test('explicit subscription selection supports noninteractive users but refuses inaccessible and disabled targets',
  async () => temporary(async directory => {
    const output = path.join(directory, 'selected.json');
    const result = run(`${selector(output)} -SubscriptionId ${selectedSubscription.toUpperCase()} -ComputeSku P1v3 -NonInteractive`, {
      azure: targetAzure(), retail: retailResponse(prices), prompt: "function Read-Host { throw 'UNEXPECTED_PROMPT' }"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).subscriptionId, selectedSubscription);
    for (const id of [ROOT_SUBSCRIPTION_ID, '55555555-5555-4555-8555-555555555555']) {
      const refusedOutput = path.join(directory, `${id}.json`);
      const refused = run(`${selector(refusedOutput)} -SubscriptionId ${id}`, { azure: discovery(subscriptions) });
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /AZURE_SELECTED_SUBSCRIPTION_NOT_ACCESSIBLE/);
      await assert.rejects(readFile(refusedOutput), { code: 'ENOENT' });
    }
  }));

test('selection fails closed on missing approval, login failure, no enabled subscriptions or invalid choice',
  async () => temporary(async directory => {
    const output = path.join(directory, 'not-created.json');
    const noApproval = run(`& .\\demos\\01\\Select-AzureTarget.ps1 -OutputPath ${ps(output)} -PublisherEmail operator@example.invalid`);
    assert.match(noApproval.stderr, /AZURE_EXPLICIT_READ_APPROVAL_REQUIRED/);
    assert.doesNotMatch(noApproval.stderr, /UNEXPECTED_AZURE_CALL/);
    for (const [azure, prompt, error] of [
      ["$global:LASTEXITCODE=1; ''", '', /AZURE_SUBSCRIPTION_DISCOVERY_FAILED/],
      [discovery([]), '', /AZURE_NO_ENABLED_SUBSCRIPTIONS/],
      [discovery([{ ...subscriptions[2], id: 'invalid' }]), '', /AZURE_SUBSCRIPTION_RESPONSE_INVALID/],
      [discovery(subscriptions), "function Read-Host { '99' }", /AZURE_SUBSCRIPTION_SELECTION_INVALID/],
      [discovery(subscriptions), "function Read-Host { 'q' }", /AZURE_SUBSCRIPTION_SELECTION_CANCELLED/]
    ]) {
      const result = run(selector(output), { azure, prompt });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, error);
      await assert.rejects(readFile(output), { code: 'ENOENT' });
    }
  }));

test('quota-exhausted selection asks for another subscription ID before writing a target',
  async () => temporary(async directory => {
    const output = path.join(directory, 'selected.json');
    const exhaustedSubscription = subscriptions[1].id;
    const azure = `
      if ($args[0] -eq 'rest' -and ($args -join ' ').Contains('${exhaustedSubscription}')) {
        $global:LASTEXITCODE=0; ${ps(JSON.stringify({ value: quotas.map(q => ({ ...q, limit: 0 })) }))}; return
      };
      ${targetAzure()}
    `;
    const result = run(`${selector(output)} -SubscriptionId ${exhaustedSubscription} | ConvertTo-Json -Compress`, {
      azure, retail: retailResponse(prices),
      prompt: `function Read-Host { param($text); if ($text -like 'Provide a subscription*') { '${selectedSubscription}' } else { '' } }`
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No eligible Linux compute SKU/);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).subscriptionId, selectedSubscription);
  }));

test('noninteractive selection refuses absent quota, unavailable Linux region and incomplete explicit inputs',
  async () => temporary(async directory => {
    const output = path.join(directory, 'not-created.json');
    const command = `${selector(output)} -SubscriptionId ${selectedSubscription} -ComputeSku P1v3 -NonInteractive`;
    for (const azure of [
      targetAzure({ usage: quotas.map(q => ({ ...q, currentValue: q.limit })) }),
      targetAzure({ usage: [] }),
      targetAzure({ regions: [{ name: 'West Europe' }] })
    ]) {
      const result = run(command, { azure, prompt: "function Read-Host { throw 'UNEXPECTED_PROMPT' }" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /AZURE_COMPUTE_QUOTA_OR_REGION_UNAVAILABLE/);
      assert.doesNotMatch(result.stderr, /UNEXPECTED_PRICE_CALL|UNEXPECTED_PROMPT/);
      await assert.rejects(readFile(output), { code: 'ENOENT' });
    }
    const incomplete = run(`${selector(output)} -SubscriptionId ${selectedSubscription} -NonInteractive`);
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /AZURE_NONINTERACTIVE_SUBSCRIPTION_AND_SKU_REQUIRED/);
    assert.doesNotMatch(incomplete.stderr, /UNEXPECTED_AZURE_CALL/);
  }));

test('recommendation uses only current primary Linux USD hourly PAYG meters across every price page', () => {
  const capacity = quotas.map(q => ({ sku: q.name.value, status: 'ELIGIBLE', vcpus: 2, memoryGb: 8 }));
  const ignored = [
    price('P1v4', 0.01, { productName: 'Azure App Service Premium v4 Plan - Windows' }),
    price('P1v4', 0.01, { type: 'Reservation' }),
    price('P1v4', 0.01, { currencyCode: 'EUR' }),
    price('P1v4', 0.01, { effectiveStartDate: '2099-01-01T00:00:00Z' }),
    price('P1v4', 0.01, { effectiveEndDate: '2020-01-01T00:00:00Z' }),
    price('P1v4', 0.01, { isPrimaryMeterRegion: false }),
    price('P1v4', 0.01, { unitOfMeasure: '1 Month' }),
    price('P1v4', 0.01, { armRegionName: 'westus' }),
    price('P1 v3', 0.01, { effectiveStartDate: '2020-01-01T00:00:00Z' })
  ];
  const page1 = { Items: [prices[0], ...ignored], NextPageLink: 'https://prices.azure.com/api/retail/prices?$skip=1000' };
  const page2 = { Items: [prices[1]], NextPageLink: null };
  const result = run(`
    . .\\tools\\AzureTarget.ps1;
    $capacity=${ps(JSON.stringify(capacity))} | ConvertFrom-Json;
    @(Get-ContosoAzureComputeRecommendations -Capacity $capacity | Sort-Object usdPerHour) | ConvertTo-Json -Compress
  `, { retail: `if ($Uri.Query -like '*skip=1000*') { ${retailResponse(page2.Items)} } else { ${ps(JSON.stringify(page1))} | ConvertFrom-Json }` });
  assert.equal(result.status, 0, result.stderr);
  const offers = JSON.parse(result.stdout);
  assert.deepEqual(offers.map(o => o.sku), ['P1v4', 'P1v3']);
  assert.equal(offers[0].usdPerHour, 0.15);
});

test('unknown or conflicting prices and failed quota reads cannot produce a recommendation or target',
  async () => temporary(async directory => {
    const output = path.join(directory, 'not-created.json');
    const command = `${selector(output)} -SubscriptionId ${selectedSubscription} -ComputeSku P1v3 -NonInteractive`;
    for (const [retail, expected] of [
      [retailResponse([]), /AZURE_COMPUTE_PRICE_UNAVAILABLE/],
      [retailResponse([...prices, price('P1v4', 0.16)]), /AZURE_COMPUTE_PRICE_AMBIGUOUS/],
      ["throw 'PRICE_SERVICE_DOWN'", /PRICE_SERVICE_DOWN/]
    ]) {
      const result = run(command, { azure: targetAzure(), retail });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
      await assert.rejects(readFile(output), { code: 'ENOENT' });
    }
    const failedQuota = run(command, {
      azure: `if ($args[0] -eq 'rest') { $global:LASTEXITCODE=1; return }; ${targetAzure()}`
    });
    assert.notEqual(failedQuota.status, 0);
    assert.match(failedQuota.stderr, /AZURE_COMPUTE_QUOTA_READ_FAILED/);
  }));

test('an unchanged existing one-instance Linux plan does not require unused additional quota', () => {
  const input = foundation(selectedSubscription);
  const result = run(`. .\\tools\\AzureTarget.ps1; Assert-ContosoAzureComputeQuota ` +
    `-SubscriptionId ${selectedSubscription} -ResourceGroup ${input.resourceGroup} -PlanName ${input.names.plan} -ComputeSku P1v3`, {
    azure: targetAzure({ usage: quotas.map(q => ({ ...q, currentValue: q.limit })),
      plans: [{ name: input.names.plan, resourceGroup: input.resourceGroup, reserved: true, location: 'Central US',
        sku: { name: 'P1v3', capacity: 1 } }] })
  });
  assert.equal(result.status, 0, result.stderr);
});

test('malformed capacity responses and incompatible existing plans fail closed', () => {
  const input = foundation(selectedSubscription);
  const existing = { name: input.names.plan, resourceGroup: input.resourceGroup, reserved: true,
    location: 'centralus', sku: { name: 'P1v3', capacity: 1 } };
  for (const [options, expected] of [
    [{ usage: null }, /AZURE_COMPUTE_QUOTA_RESPONSE_INVALID/],
    [{ usage: [{ ...quotas[0], limit: true }] }, /AZURE_COMPUTE_QUOTA_RESPONSE_INVALID/],
    [{ plans: null }, /AZURE_COMPUTE_PLAN_RESPONSE_INVALID/],
    [{ plans: [{ ...existing, reserved: 'false' }] }, /AZURE_COMPUTE_EXISTING_PLAN_MISMATCH/],
    [{ plans: [{ ...existing, sku: { name: 'P1v3', capacity: 2 } }] }, /AZURE_COMPUTE_EXISTING_PLAN_MISMATCH/]
  ]) {
    const result = run(`. .\\tools\\AzureTarget.ps1; Assert-ContosoAzureComputeQuota ` +
      `-SubscriptionId ${selectedSubscription} -ResourceGroup ${input.resourceGroup} -PlanName ${input.names.plan} -ComputeSku P1v3`,
    { azure: targetAzure(options) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_AZURE_CALL/);
  }
});

test('cloud target recheck rejects a different signed-in tenant before deployment', () => {
  const result = run(`. .\\tools\\AzureTarget.ps1; Assert-ContosoAzureSubscription ` +
    `-SubscriptionId ${selectedSubscription} -TenantId 33333333-3333-4333-8333-333333333333`,
  { azure: discovery(subscriptions) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AZURE_SELECTED_SUBSCRIPTION_TENANT_MISMATCH/);
});
async function temporary(action) {
  const directory = await mkdtemp(path.join(tmpdir(), 'contoso-golden-path-'));
  try { await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('Azure plan compiles real infrastructure without cloud calls; provision rejects an unreviewed digest',
  { skip: !process.env.CONTOSO_BICEP_PATH }, async () => temporary(async directory => {
    const input = { ...foundation(), computeSku: 'P1v4' };
    const inputFile = path.join(directory, 'input.json');
    const output = path.join(directory, 'plan');
    await writeFile(inputFile, JSON.stringify(input));
    const command = `& .\\demos\\01\\Deploy-Azure.ps1 -InputPath ${ps(inputFile)} -BicepPath ${ps(process.env.CONTOSO_BICEP_PATH)}`;
    const planned = run(`${command} -OutputDirectory ${ps(output)} | ConvertTo-Json -Compress`);
    assert.equal(planned.status, 0, planned.stderr);
    const result = JSON.parse(planned.stdout);
    assert.equal(result.azureCalls, 0);
    assert.equal(result.deployed, false);
    const plan = JSON.parse(await readFile(path.join(output, 'plan.json'), 'utf8'));
    assert.match(plan.planSha256, /^[0-9a-f]{64}$/);
    assert.equal(plan.schema, 'contoso.golden-path-deployment-plan.v2');
    const digest = [input.subscriptionId, input.resourceGroup, input.location, plan.templateSha256, plan.parametersSha256].join('\n');
    assert.equal(plan.planSha256, createHash('sha256').update(digest).digest('hex'));
    const parameters = JSON.parse(await readFile(path.join(output, 'parameters.json'), 'utf8'));
    assert.deepEqual(parameters.parameters.applicationConfiguration.value, {});
    assert.equal(parameters.parameters.computeSku.value, 'P1v4');
    const compiled = JSON.parse(await readFile(path.join(output, 'main.json'), 'utf8'));
    const compute = compiled.resources.compute.properties;
    assert.equal(compute.parameters.computeSku.value, "[parameters('computeSku')]");
    assert.equal(compute.template.resources.find(resource => resource.type === 'Microsoft.Web/serverfarms').sku.name,
      "[parameters('computeSku')]");
    assert.deepEqual(compute.template.parameters.computeSku.allowedValues.toSorted(), Object.keys(computeSkus).toSorted());
    assert.deepEqual(compiled.parameters.computeSku.allowedValues.toSorted(), Object.keys(computeSkus).toSorted());
    assert.equal(plan.authorizationVerified, false);
    const refused = run(`${command} -OutputDirectory ${ps(path.join(directory, 'refused'))} -Action Provision ` +
      `-AllowAzureRead -AllowAzureWrite -ApprovalReference UNIT_ONLY_NOT_AUTHORITY -ReviewedPlanSha256 ${'0'.repeat(64)} -Confirm:$false`);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /AZURE_REVIEWED_PLAN_AND_WRITE_APPROVAL_REQUIRED/);
    assert.doesNotMatch(refused.stderr, /UNEXPECTED_AZURE_CALL/);
  }));

test('dynamic target what-if rechecks auth and passes its explicit subscription to every deployment call',
  { skip: !process.env.CONTOSO_BICEP_PATH }, async () => temporary(async directory => {
    const input = foundation(selectedSubscription);
    const inputFile = path.join(directory, 'input.json');
    const callsFile = path.join(directory, 'calls.jsonl');
    await writeFile(inputFile, JSON.stringify(input));
    const azure = `
      [IO.File]::AppendAllText(${ps(callsFile)}, (ConvertTo-Json -Compress -InputObject @($args)) + "\`n");
      $global:LASTEXITCODE=0;
      if (($args[0..1] -join ' ') -eq 'account list') { ${ps(JSON.stringify(subscriptions))}; return };
      if ($args[0] -eq 'rest') { ${ps(JSON.stringify({ value: quotas }))}; return };
      if (($args[0..2] -join ' ') -eq 'appservice plan list') { '[]'; return };
      if (($args[0..1] -join ' ') -eq 'appservice list-locations') { '[{"name":"Central US"}]'; return };
      if (($args[0..2] -join ' ') -notin @('deployment group validate','deployment group what-if')) { throw 'UNEXPECTED_AZURE_CALL' }
    `;
    const command = `& .\\demos\\01\\Deploy-Azure.ps1 -InputPath ${ps(inputFile)} -BicepPath ${ps(process.env.CONTOSO_BICEP_PATH)} ` +
      '-Action WhatIf -AllowAzureRead -ApprovalReference UNIT_ONLY_NOT_AUTHORITY';
    const result = run(`${command} -OutputDirectory ${ps(path.join(directory, 'plan'))}`, { azure });
    assert.equal(result.status, 0, result.stderr);
    const calls = (await readFile(callsFile, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(calls.length, 6);
    for (const call of calls.filter(call => call[0] === 'deployment')) {
      assert.equal(call[call.indexOf('--subscription') + 1], selectedSubscription);
      assert.equal(call[call.indexOf('--resource-group') + 1], input.resourceGroup);
    }
    const refused = run(`${command} -OutputDirectory ${ps(path.join(directory, 'inaccessible'))}`, { azure: discovery([]) });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /AZURE_NO_ENABLED_SUBSCRIPTIONS/);
    const quotaRefused = run(`${command} -OutputDirectory ${ps(path.join(directory, 'no-quota'))}`, {
      azure: targetAzure({ usage: quotas.map(q => ({ ...q, limit: 0 })) })
    });
    assert.notEqual(quotaRefused.status, 0);
    assert.match(quotaRefused.stderr, /AZURE_COMPUTE_QUOTA_OR_REGION_UNAVAILABLE/);
    assert.doesNotMatch(quotaRefused.stderr, /UNEXPECTED_AZURE_CALL/);
  }));

test('publishing inspection uses the selected target without Azure calls and requires an explicit input',
  async () => temporary(async directory => {
    const input = foundation(selectedSubscription);
    const inputFile = path.join(directory, 'input.json');
    const zip = path.join(directory, 'portal.zip');
    await writeFile(inputFile, JSON.stringify(input));
    const packageCommand = `
      $stream=[IO.File]::Create(${ps(zip)});
      $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create);
      foreach($name in @('dist/bootstrap.js','dist/storefront/index.html','package.json','package-lock.json',
        'node_modules/@microsoft/opentelemetry/package.json')) { $archive.CreateEntry($name) | Out-Null };
      $archive.Dispose(); $stream.Dispose();
    `;
    const publish = `$hash=(Get-FileHash -LiteralPath ${ps(zip)} -Algorithm SHA256).Hash.ToLowerInvariant(); ` +
      `& .\\demos\\01\\Publish-App.ps1 -Role Portal -ZipPath ${ps(zip)} -ExpectedSha256 $hash`;
    const result = run(`${packageCommand} ${publish} -InputPath ${ps(inputFile)} | ConvertTo-Json -Compress`);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.subscriptionId, selectedSubscription);
    assert.equal(plan.resourceGroup, input.resourceGroup);
    assert.equal(plan.site, input.names.portal);
    assert.equal(plan.azureCalls, 0);
    const refused = run(publish);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /AZURE_DEPLOYMENT_INPUT_REQUIRED/);
  }));

test('code publishing refuses a changed package before archive reads or Azure calls', async () => temporary(async directory => {
  const zip = path.join(directory, 'changed.zip');
  await writeFile(zip, 'not a deployment archive');
  const result = run(`& .\\demos\\01\\Publish-App.ps1 -Role Orders -ZipPath ${ps(zip)} -ExpectedSha256 ${'0'.repeat(64)}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AZURE_REVIEWED_PACKAGE_HASH_MISMATCH/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_AZURE_CALL/);
}));

test('code publishing refuses a source-free Portal archive that still lacks production dependencies', async () => temporary(async directory => {
  const zip = path.join(directory, 'incomplete.zip');
  const result = run(`
    $stream=[IO.File]::Create(${ps(zip)});
    $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create);
    foreach($name in @('dist/bootstrap.js','dist/storefront/index.html','package.json','package-lock.json')) {
      $archive.CreateEntry($name) | Out-Null
    };
    $archive.Dispose(); $stream.Dispose();
    $hash=(Get-FileHash -LiteralPath ${ps(zip)} -Algorithm SHA256).Hash.ToLowerInvariant();
    & .\\demos\\01\\Publish-App.ps1 -Role Portal -ZipPath ${ps(zip)} -ExpectedSha256 $hash`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AZURE_RUNNABLE_PACKAGE_CONTENT_MISSING/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_AZURE_CALL/);
}));

test('code publishing refuses a valid-shaped package for the wrong API role', async () => temporary(async directory => {
  const zip = path.join(directory, 'wrong-role.zip');
  const result = run(`
    $lock=Get-Content -Raw -LiteralPath .\\config\\versions.lock.json | ConvertFrom-Json;
    $stream=[IO.File]::Create(${ps(zip)});
    $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create);
    foreach($name in @('app.jar','startup.sh','agent/applicationinsights.json',"agent/$($lock.agent.file)",
      "agent/extensions/$([IO.Path]::GetFileName($lock.extensions[0].file))")) {
      $archive.CreateEntry($name) | Out-Null
    };
    $writer=[IO.StreamWriter]::new($archive.CreateEntry('manifest.json').Open());
    $writer.Write('{"serviceName":"contoso-orders-api"}'); $writer.Dispose();
    $archive.Dispose(); $stream.Dispose();
    $hash=(Get-FileHash -LiteralPath ${ps(zip)} -Algorithm SHA256).Hash.ToLowerInvariant();
    & .\\demos\\01\\Publish-App.ps1 -Role Inventory -ZipPath ${ps(zip)} -ExpectedSha256 $hash`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AZURE_PACKAGE_ROLE_MISMATCH/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_AZURE_CALL/);
}));
