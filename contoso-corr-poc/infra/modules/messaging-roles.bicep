targetScope = 'resourceGroup'

@description('The same frozen physical map passed to messaging.bicep.')
param names object
@description('Compute principalIds with orders, fulfillment, notify, aggregator; never producer fields.')
param principalIds object

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = { name: names.serviceBus }
resource orders 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' existing = { parent: serviceBus, name: 'contoso-orders' }
resource results 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' existing = { parent: serviceBus, name: 'contoso-order-results' }
resource relay 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' existing = { parent: serviceBus, name: 'contoso-eventgrid-relay' }
resource topic 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' existing = { parent: serviceBus, name: 'contoso-order-events' }
resource fulfillment 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' existing = { parent: topic, name: 'fulfillment' }
resource notify 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' existing = { parent: topic, name: 'notify' }
resource eventHubs 'Microsoft.EventHub/namespaces@2024-01-01' existing = { name: names.eventHubs }
resource hub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' existing = { parent: eventHubs, name: 'contoso-telemetry-batch' }
resource grid 'Microsoft.EventGrid/topics@2022-06-15' existing = { name: names.eventGrid }
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: names.storage }
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' existing = { parent: storage, name: 'default' }
resource jobs 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' existing = { parent: queueService, name: 'contoso-legacy-jobs' }
resource poison 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' existing = { parent: queueService, name: 'contoso-legacy-poison' }

var busSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
var busReceiver = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4f6dd033-fbaf-4b7e-9921-036a8517e973')
var eventHubSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2b629674-e913-4c01-ae53-ef4638d8f975')
var eventHubReceiver = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a638d3c7-ab3a-418d-83e6-5f17a39d4fde')
var eventGridSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'd5a91429-5739-47e2-a06b-3470a27159e7')
var queueSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a')
var queueProcessor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8a0f0c08-91a1-4084-bc3d-661d67233fed')

resource orderSenders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in [principalIds.orders, principalIds.fulfillment]: {
  name: guid(orders.id, principal, busSender)
  scope: orders
  properties: { roleDefinitionId: busSender, principalId: principal, principalType: 'ServicePrincipal' }
}]
resource orderReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(orders.id, principalIds.fulfillment, busReceiver)
  scope: orders
  properties: { roleDefinitionId: busReceiver, principalId: principalIds.fulfillment, principalType: 'ServicePrincipal' }
}
resource topicSenders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in [principalIds.orders, principalIds.fulfillment, principalIds.notify]: {
  name: guid(topic.id, principal, busSender)
  scope: topic
  properties: { roleDefinitionId: busSender, principalId: principal, principalType: 'ServicePrincipal' }
}]
resource fulfillmentReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(fulfillment.id, principalIds.fulfillment, busReceiver)
  scope: fulfillment
  properties: { roleDefinitionId: busReceiver, principalId: principalIds.fulfillment, principalType: 'ServicePrincipal' }
}
resource notifyReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(notify.id, principalIds.notify, busReceiver)
  scope: notify
  properties: { roleDefinitionId: busReceiver, principalId: principalIds.notify, principalType: 'ServicePrincipal' }
}
resource resultSenders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in [principalIds.fulfillment, principalIds.notify]: {
  name: guid(results.id, principal, busSender)
  scope: results
  properties: { roleDefinitionId: busSender, principalId: principal, principalType: 'ServicePrincipal' }
}]
resource resultReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(results.id, principalIds.aggregator, busReceiver)
  scope: results
  properties: { roleDefinitionId: busReceiver, principalId: principalIds.aggregator, principalType: 'ServicePrincipal' }
}
resource relayReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(relay.id, principalIds.fulfillment, busReceiver)
  scope: relay
  properties: { roleDefinitionId: busReceiver, principalId: principalIds.fulfillment, principalType: 'ServicePrincipal' }
}
resource hubSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(hub.id, principalIds.orders, eventHubSender)
  scope: hub
  properties: { roleDefinitionId: eventHubSender, principalId: principalIds.orders, principalType: 'ServicePrincipal' }
}
resource hubReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(hub.id, principalIds.aggregator, eventHubReceiver)
  scope: hub
  properties: { roleDefinitionId: eventHubReceiver, principalId: principalIds.aggregator, principalType: 'ServicePrincipal' }
}
resource gridSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(grid.id, principalIds.orders, eventGridSender)
  scope: grid
  properties: { roleDefinitionId: eventGridSender, principalId: principalIds.orders, principalType: 'ServicePrincipal' }
}
resource queueSenders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in [principalIds.orders, principalIds.fulfillment]: {
  name: guid(jobs.id, principal, queueSender)
  scope: jobs
  properties: { roleDefinitionId: queueSender, principalId: principal, principalType: 'ServicePrincipal' }
}]
resource queueReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(jobs.id, principalIds.fulfillment, queueProcessor)
  scope: jobs
  properties: { roleDefinitionId: queueProcessor, principalId: principalIds.fulfillment, principalType: 'ServicePrincipal' }
}
resource poisonSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(poison.id, principalIds.fulfillment, queueSender)
  scope: poison
  properties: { roleDefinitionId: queueSender, principalId: principalIds.fulfillment, principalType: 'ServicePrincipal' }
}
resource poisonReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(poison.id, principalIds.fulfillment, queueProcessor)
  scope: poison
  properties: { roleDefinitionId: queueProcessor, principalId: principalIds.fulfillment, principalType: 'ServicePrincipal' }
}

output permissionBoundary string = 'Fixed entity scopes and protected PostgreSQL publication rows; authorized-writer compromise remains a residual limitation.'
