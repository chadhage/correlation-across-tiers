targetScope = 'resourceGroup'

metadata description = 'Root-owned Basic SCM/FTP disabling and scoped timer-host/Application Insights permissions. Compute owns site-creation ingress rules. Preparation is not a grant or reachability proof.'

param names object
param computePrincipalIds object
param apimPrincipalId string

var protectedNames = [names.orders, names.inventory, names.fulfillment, names.notify, names.aggregator]
var allNames = concat(protectedNames, [names.portal])

resource allApps 'Microsoft.Web/sites@2025-03-01' existing = [for name in allNames: {
  name: name
}]

resource disableBasicScm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = [for (_, index) in allNames: {
  parent: allApps[index]
  name: 'scm'
  properties: { allow: false }
}]

resource disableBasicFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = [for (_, index) in allNames: {
  parent: allApps[index]
  name: 'ftp'
  properties: { allow: false }
}]

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: names.storage
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

var hostContainers = ['azure-webjobs-hosts', 'azure-webjobs-secrets']
resource hostBlobs 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for name in hostContainers: {
  parent: blobService
  name: name
  properties: { publicAccess: 'None' }
}]

var workerIds = [computePrincipalIds.fulfillment, computePrincipalIds.notify, computePrincipalIds.aggregator]
var blobDataOwner = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
resource hostReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for index in range(0, length(workerIds) * length(hostContainers)): {
  name: guid(hostBlobs[index % length(hostContainers)].id, workerIds[index / length(hostContainers)], blobDataOwner)
  scope: hostBlobs[index % length(hostContainers)]
  properties: {
    roleDefinitionId: blobDataOwner
    principalId: workerIds[index / length(hostContainers)]
    principalType: 'ServicePrincipal'
  }
}]

resource appi 'Microsoft.Insights/components@2020-02-02' existing = {
  name: names.appInsights
}

var metricsPublisher = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
resource apimPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appi.id, apimPrincipalId, metricsPublisher)
  scope: appi
  properties: {
    roleDefinitionId: metricsPublisher
    principalId: apimPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output protectedAppNames array = protectedNames
output scmAuthentication string = 'Entra-authenticated-deployment-basic-auth-disabled'
output scmReachabilityValidation string = 'NOT_RUN_APPROVED_RUNNER_REQUIRED'
output hostContainerResourceIds array = [for (_, index) in hostContainers: hostBlobs[index].id]
output apimMonitoringPublisherAssignmentId string = apimPublisher.id
