targetScope = 'resourceGroup'

@description('Frozen physical names: serviceBus (legal alias, never -sb), eventGrid, eventHubs, storage.')
param names object
param location string = 'centralus'
param tags object
@minValue(1)
@maxValue(10)
param maxDeliveryCount int = 3
@allowed(['PT30S', 'PT1M', 'PT2M', 'PT5M'])
param lockDuration string = 'PT1M'
@allowed(['PT1H', 'P1D', 'P7D'])
param messageTtl string = 'P1D'

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: names.serviceBus
  location: location
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

var queueNames = ['contoso-orders', 'contoso-order-results', 'contoso-eventgrid-relay']
resource busQueues 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = [for queueName in queueNames: {
  parent: serviceBus
  name: queueName
  properties: {
    lockDuration: lockDuration
    maxDeliveryCount: maxDeliveryCount
    defaultMessageTimeToLive: messageTtl
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    enablePartitioning: false
    maxSizeInMegabytes: 1024
  }
}]

resource topic 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' = {
  parent: serviceBus
  name: 'contoso-order-events'
  properties: {
    defaultMessageTimeToLive: messageTtl
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    enablePartitioning: false
    maxSizeInMegabytes: 1024
  }
}
resource subscriptions 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = [for subscriptionName in ['fulfillment', 'notify']: {
  parent: topic
  name: subscriptionName
  properties: {
    lockDuration: lockDuration
    maxDeliveryCount: maxDeliveryCount
    defaultMessageTimeToLive: messageTtl
    deadLetteringOnMessageExpiration: true
    deadLetteringOnFilterEvaluationExceptions: true
  }
}]

resource eventHubs 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: names.eventHubs
  location: location
  tags: tags
  sku: { name: 'Standard', tier: 'Standard', capacity: 1 }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    isAutoInflateEnabled: false
  }
}
resource hub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: eventHubs
  name: 'contoso-telemetry-batch'
  properties: {
    partitionCount: 1
    messageRetentionInDays: 1
    status: 'Active'
  }
}
resource group 'Microsoft.EventHub/namespaces/eventhubs/consumergroups@2024-01-01' = {
  parent: hub
  name: 'contoso-workers'
  properties: { userMetadata: 'Contoso SDK-managed bounded batch receiver; PostgreSQL checkpoint ownership.' }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: names.storage
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    defaultToOAuthAuthentication: true
  }
}
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource storageQueues 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = [for queueName in ['contoso-legacy-jobs', 'contoso-legacy-poison']: {
  parent: queueService
  name: queueName
  properties: { metadata: { workload: 'contoso-corr', environment: 'poc' } }
}]
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource eventGridDeadLetters 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'contoso-eventgrid-deadletter'
  properties: { publicAccess: 'None' }
}

resource eventGrid 'Microsoft.EventGrid/topics@2022-06-15' = {
  name: names.eventGrid
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    inputSchema: 'CloudEventSchemaV1_0'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}
var serviceBusSenderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
resource relaySender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(busQueues[2].id, eventGrid.id, serviceBusSenderRole)
  scope: busQueues[2]
  properties: {
    roleDefinitionId: serviceBusSenderRole
    principalId: eventGrid.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
resource eventGridDeadLetterWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(eventGridDeadLetters.id, eventGrid.id, blobContributorRole)
  scope: eventGridDeadLetters
  properties: {
    roleDefinitionId: blobContributorRole
    principalId: eventGrid.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
resource relaySubscription 'Microsoft.EventGrid/topics/eventSubscriptions@2022-06-15' = {
  parent: eventGrid
  name: 'contoso-eventgrid-relay'
  properties: {
    eventDeliverySchema: 'CloudEventSchemaV1_0'
    deliveryWithResourceIdentity: {
      identity: { type: 'SystemAssigned' }
      destination: {
        endpointType: 'ServiceBusQueue'
        properties: { resourceId: busQueues[2].id }
      }
    }
    deadLetterWithResourceIdentity: {
      identity: { type: 'SystemAssigned' }
      deadLetterDestination: {
        endpointType: 'StorageBlob'
        properties: { resourceId: storage.id, blobContainerName: eventGridDeadLetters.name }
      }
    }
    retryPolicy: { maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: 1440 }
    filter: { includedEventTypes: ['com.contoso.order.work.v1'] }
  }
  dependsOn: [relaySender, eventGridDeadLetterWriter]
}

output hostStorageAccountName string = storage.name
output storageAccountId string = storage.id
output serviceBusNamespace string = '${serviceBus.name}.servicebus.windows.net'
output eventHubsNamespace string = '${eventHubs.name}.servicebus.windows.net'
output eventGridEndpoint string = eventGrid.properties.endpoint
output storageQueueEndpoint string = 'https://${storage.name}.queue.${environment().suffixes.storage}'
output eventGridPrincipalId string = eventGrid.identity.principalId
output entityIds object = {
  orders: busQueues[0].id
  results: busQueues[1].id
  eventGridRelay: busQueues[2].id
  topic: topic.id
  fulfillmentSubscription: subscriptions[0].id
  notifySubscription: subscriptions[1].id
  eventHub: hub.id
  legacyJobs: storageQueues[0].id
  legacyPoison: storageQueues[1].id
  eventGrid: eventGrid.id
  eventGridDeadLetters: eventGridDeadLetters.id
}
