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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ps = value => `'${value.replaceAll("'", "''")}'`;
function run(command, { azure = "throw 'UNEXPECTED_AZURE_CALL'", prompt = '' } = {}) {
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; function az { ${azure} }; ${prompt}; ${command}`],
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
      azure: discovery(subscriptions), prompt: "function Read-Host { '1' }"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /A sandbox/);
    assert.match(result.stdout, new RegExp(tenantId));
    assert.doesNotMatch(result.stdout, /Disabled subscription/);
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(summary.subscriptionId, selectedSubscription);
    assert.equal(summary.azureCalls, 1);
    assert.equal(summary.deployed, false);
    const input = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(input.names, frozenNames(selectedSubscription, 'centralus'));
    assert.equal(input.subscriptionId, selectedSubscription);
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
    const result = run(`${selector(output)} -SubscriptionId ${selectedSubscription.toUpperCase()}`, {
      azure: discovery(subscriptions), prompt: "function Read-Host { throw 'UNEXPECTED_PROMPT' }"
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
    const input = foundation();
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
      if (($args[0..2] -join ' ') -notin @('deployment group validate','deployment group what-if')) { throw 'UNEXPECTED_AZURE_CALL' }
    `;
    const command = `& .\\demos\\01\\Deploy-Azure.ps1 -InputPath ${ps(inputFile)} -BicepPath ${ps(process.env.CONTOSO_BICEP_PATH)} ` +
      '-Action WhatIf -AllowAzureRead -ApprovalReference UNIT_ONLY_NOT_AUTHORITY';
    const result = run(`${command} -OutputDirectory ${ps(path.join(directory, 'plan'))}`, { azure });
    assert.equal(result.status, 0, result.stderr);
    const calls = (await readFile(callsFile, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(calls.length, 3);
    for (const call of calls.slice(1)) {
      assert.equal(call[call.indexOf('--subscription') + 1], selectedSubscription);
      assert.equal(call[call.indexOf('--resource-group') + 1], input.resourceGroup);
    }
    const refused = run(`${command} -OutputDirectory ${ps(path.join(directory, 'inaccessible'))}`, { azure: discovery([]) });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /AZURE_NO_ENABLED_SUBSCRIPTIONS/);
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
