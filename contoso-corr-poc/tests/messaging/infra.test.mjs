import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bicep = process.env.CONTOSO_BICEP_EXE ??
  'C:\\Users\\chhage\\.copilot\\session-state\\a2820816-7000-4e63-9cf2-cd2c8da2162f\\files\\tools\\r4\\bicep.exe';
function compile(name) {
  const path = fileURLToPath(new URL(`../../infra/modules/${name}.bicep`, import.meta.url));
  const result = spawnSync(bicep, ['build', path, '--stdout'], { encoding: 'utf8', maxBuffer: 2_000_000 });
  assert.equal(result.error, undefined, 'the frozen local Bicep compiler is required');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), '', 'messaging module must compile without warning');
  return JSON.parse(result.stdout);
}

test('real messaging ARM compiles all carriers with identity-only local auth disabled', () => {
  const template = compile('messaging');
  const resources = template.resources;
  for (const type of ['Microsoft.ServiceBus/namespaces', 'Microsoft.EventHub/namespaces',
    'Microsoft.EventGrid/topics', 'Microsoft.Storage/storageAccounts']) {
    assert.ok(resources.some(resource => resource.type === type), type);
  }
  for (const type of ['Microsoft.ServiceBus/namespaces', 'Microsoft.EventHub/namespaces', 'Microsoft.EventGrid/topics']) {
    assert.equal(resources.find(resource => resource.type === type).properties.disableLocalAuth, true);
  }
  assert.equal(resources.find(resource => resource.type === 'Microsoft.Storage/storageAccounts').properties.allowSharedKeyAccess, false);
  assert.equal(template.parameters.maxDeliveryCount.defaultValue, 3);
  assert.equal(template.parameters.lockDuration.defaultValue, 'PT1M');
  assert.equal(template.outputs.hostStorageAccountName.type, 'string');
  assert.equal(resources.find(resource => resource.type === 'Microsoft.EventHub/namespaces/eventhubs').properties.partitionCount, 1);
});

test('CloudEvents relay uses topic identity and declares durable dead-letter destination', () => {
  const template = compile('messaging');
  const topic = template.resources.find(resource => resource.type === 'Microsoft.EventGrid/topics');
  assert.equal(topic.identity.type, 'SystemAssigned');
  assert.equal(topic.properties.inputSchema, 'CloudEventSchemaV1_0');
  const relay = template.resources.find(resource => resource.type === 'Microsoft.EventGrid/topics/eventSubscriptions');
  assert.equal(relay.properties.deliveryWithResourceIdentity.destination.endpointType, 'ServiceBusQueue');
  assert.equal(relay.properties.eventDeliverySchema, 'CloudEventSchemaV1_0');
  assert.equal(relay.properties.deadLetterWithResourceIdentity.deadLetterDestination.endpointType, 'StorageBlob');
});

test('runtime messaging permissions are fixed entity scopes, never namespace data owners', () => {
  const template = compile('messaging-roles');
  assert.ok(template.resources.length > 10);
  for (const resource of template.resources) {
    assert.equal(resource.type, 'Microsoft.Authorization/roleAssignments');
    assert.ok(resource.scope && /queues|topics|eventhubs|Microsoft.EventGrid/.test(resource.scope),
      `unbounded permission scope: ${resource.name}`);
    assert.equal(resource.properties.principalType, 'ServicePrincipal');
  }
  assert.ok(!JSON.stringify(template).includes('090c5cfd-751d-490a-894a-3ce6f1109419'));
  assert.ok(!JSON.stringify(template).includes('RootManageSharedAccessKey'));
});
