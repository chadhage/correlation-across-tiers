import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { canonicalScmCidr, ROOT_SUBSCRIPTION_ID } from '../../tools/root-preflight.mjs';
import { createRuntimeLease } from '../../tools/observability/runtime-lease.mjs';
import { GUARD_POLICY, ownedConfigurationHash, requireUtc, UUID } from '../../tools/observability/telemetry-contract.mjs';
import { jsonBytes, readBoundFile } from '../../tools/verification/files.mjs';
import { parseBoundedObservationJson } from '../../tools/security/native-payload.mjs';

const fail = code => { throw new Error(code); };
const exact = (object, fields) => {
  if (!object || Object.getPrototypeOf(object) !== Object.prototype ||
      Object.keys(object).length !== fields.length || fields.some(field => !Object.hasOwn(object, field))) fail('EXAMPLE_PREPARATION_SCHEMA');
};

export function prepareOperatorParameters(input) {
  exact(input, ['schema', 'subscriptionId', 'appServicePlanResourceId', 'integrationSubnetResourceId',
    'names', 'runnerCidrs', 'operatorSettings', 'watchdogSettings', 'inventoryFixtureSettings', 'location']);
  if (input.schema !== 'contoso.azure-operator-infra.v1' || input.subscriptionId !== ROOT_SUBSCRIPTION_ID ||
      input.location !== 'centralus') fail('EXAMPLE_PREPARATION_TARGET');
  exact(input.names, ['operator', 'watchdog', 'inventoryFixture']);
  if (Object.values(input.names).some(name => !/^contoso-[a-z0-9-]{1,51}$/.test(name ?? '')) ||
      new Set(Object.values(input.names)).size !== 3) fail('EXAMPLE_PREPARATION_NAMES');
  const prefix = `/subscriptions/${ROOT_SUBSCRIPTION_ID}/resourceGroups/`;
  if (typeof input.appServicePlanResourceId !== 'string' || !input.appServicePlanResourceId.startsWith(prefix) ||
      !/\/providers\/Microsoft\.Web\/serverfarms\/contoso-[A-Za-z0-9-]+$/.test(input.appServicePlanResourceId) ||
      typeof input.integrationSubnetResourceId !== 'string' || !input.integrationSubnetResourceId.startsWith(prefix) ||
      !/\/providers\/Microsoft\.Network\/virtualNetworks\/contoso-[A-Za-z0-9-]+\/subnets\/[A-Za-z0-9-]+$/.test(input.integrationSubnetResourceId)) {
    fail('EXAMPLE_PREPARATION_EXISTING_RESOURCES_REQUIRED');
  }
  if (!Array.isArray(input.runnerCidrs) || !input.runnerCidrs.length ||
      input.runnerCidrs.some(cidr => canonicalScmCidr(cidr) === null)) fail('EXAMPLE_PREPARATION_RUNNER_CIDRS');
  for (const settings of [input.operatorSettings, input.watchdogSettings, input.inventoryFixtureSettings]) {
    if (!settings || Object.getPrototypeOf(settings) !== Object.prototype) fail('EXAMPLE_PREPARATION_SETTINGS');
    for (const [key, value] of Object.entries(settings)) {
      if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(key) || typeof value !== 'string' ||
          /Bearer\s|InstrumentationKey=|AccountKey=|SharedAccessSignature=|-----BEGIN .*PRIVATE KEY/i.test(value) ||
          /PASSWORD|SECRET|TOKEN|CREDENTIAL|ACCOUNT_KEY|IDENTITY_HEADER/.test(key) ||
          key === 'APPLICATIONINSIGHTS_CONNECTION_STRING' && !/^@Microsoft\.KeyVault\(SecretUri=https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[A-Za-z0-9-]+(?:\/[a-f0-9]{32})?\)$/.test(value)) {
        fail('EXAMPLE_PREPARATION_NON_SECRET_REFERENCES_ONLY');
      }
    }
  }
  const { schema, subscriptionId, ...parameters } = input;
  parameters.runnerCidrs = input.runnerCidrs.map(canonicalScmCidr);
  return { $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0', parameters: Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, { value }])) };
}

export async function prepareExampleWindow({ startsAtUtc, expiresAtUtc, runId = randomUUID(), approvalReference }) {
  const start = requireUtc(startsAtUtc, 'window start'), end = requireUtc(expiresAtUtc, 'window end');
  const duration = Date.parse(end) - Date.parse(start);
  if (!UUID.test(runId) || duration < 300000 || duration > 3600000 ||
      typeof approvalReference !== 'string' || !/^[A-Za-z0-9._:/-]{1,256}$/.test(approvalReference)) fail('EXAMPLE_PREPARATION_WINDOW');
  const lock = parseBoundedObservationJson(await readBoundFile('config\\versions.lock.json'));
  if (lock.extensions.length !== 1) fail('EXAMPLE_PREPARATION_GUARD');
  const extension = lock.extensions[0];
  const guard = { sha256: extension.sha256, providerClass: extension.providerClass, sdkAbi: extension.sdkAbi,
    version: extension.version, policy: GUARD_POLICY };
  const state = { runId, revision: `cert-${runId}`, startsAtUtc: start, expiresAtUtc: end,
    drainAtUtc: new Date(Date.parse(end) - 120000).toISOString(), restoreDeadlineSeconds: 120, guard };
  const baseline = { 'sampling.percentage': { $contosoAbsent: true }, 'sampling.requestsPerSecond': 5, 'sampling.overrides': [] };
  const full = { 'sampling.percentage': 100, 'sampling.requestsPerSecond': { $contosoAbsent: true }, 'sampling.overrides': [] };
  const agent = parseBoundedObservationJson(await readBoundFile('config\\java-agent.json'));
  agent.sampling = { percentage: 100, overrides: [] };
  const roles = ['contoso-orders-api', 'contoso-inventory-api', 'contoso-fulfillment-worker',
    'contoso-notify-worker', 'contoso-order-aggregator'];
  return {
    metadata: { schema: 'contoso.azure-example-window-preparation.v1', runId, startsAtUtc: start, expiresAtUtc: end,
      approvalReference, preparationOnly: true, authorityGranted: false, runtimeAcknowledgements: 'NOT OBSERVED',
      sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED' },
    operatorEnvironment: { CONTOSO_OPERATOR_START: start, CONTOSO_OPERATOR_END: end,
      CONTOSO_OPERATOR_APPROVAL_REFERENCE: approvalReference },
    applicationEnvironment: { CONTOSO_CERT_START: start, CONTOSO_CERT_END: end, CONTOSO_CERT_WINDOW_ID: runId,
      CONTOSO_CERTIFICATION_MODE: 'false', CONTOSO_EXECUTION_MODE: 'live', CONTOSO_DEMOS_ENABLED: 'true',
      CONTOSO_PORTAL_DEMO_ENABLED: 'true', CONTOSO_SAMPLING_LEASE_FILE: '/home/site/wwwroot/agent/sampling-lease.json' },
    agent,
    leases: Object.fromEntries(roles.map(role => [role, createRuntimeLease(state, { id: role, layer: 'jvm' },
      { beforeHash: ownedConfigurationHash(baseline) }, full)]))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string' }, 'prepare-window': { type: 'boolean' },
    start: { type: 'string' }, end: { type: 'string' }, 'approval-ref': { type: 'string' }
  } });
  if (!values.output) fail('EXAMPLE_PREPARATION_OUTPUT_REQUIRED');
  if (values['prepare-window']) {
    const prepared = await prepareExampleWindow({ startsAtUtc: values.start, expiresAtUtc: values.end, approvalReference: values['approval-ref'] });
    await mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
    await mkdir(values.output, { recursive: false });
    await writeFile(path.join(values.output, 'window.json'), jsonBytes(prepared), { flag: 'wx' });
    for (const [role, lease] of Object.entries(prepared.leases)) {
      const directory = path.join(values.output, role, 'agent');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'applicationinsights.json'), jsonBytes(prepared.agent), { flag: 'wx' });
      await writeFile(path.join(directory, 'sampling-lease.json'), jsonBytes(lease), { flag: 'wx' });
    }
    console.log(JSON.stringify({ result: 'PREPARED_ONLY', runtimeAcknowledgements: 'NOT OBSERVED', azureCallsExecuted: false }));
  } else {
    if (!values.input) fail('EXAMPLE_PREPARATION_INPUT_REQUIRED');
    const input = parseBoundedObservationJson(await readFile(values.input));
    await writeFile(values.output, jsonBytes(prepareOperatorParameters(input)), { flag: 'wx' });
    console.log(JSON.stringify({ result: 'PARAMETERS_ONLY', azureCallsExecuted: false, certificationStatus: 'NOT CERTIFIED' }));
  }
}
