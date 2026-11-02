targetScope = 'resourceGroup'

metadata description = 'Contoso staged root composition. Preparation-only; deployment requires separate approval and strict root preflight.'

@allowed(['centralus'])
param location string = 'centralus'
@allowed(['foundation', 'application'])
param deploymentPhase string = 'foundation'
param names object
param publisherName string = 'Contoso'
@description('Approved APIM publisher contact. Empty is an explicit unmet preflight prerequisite, not a deployment default.')
param publisherEmail string = ''
@description('Actual approved Entra client/object pairs, database roles, frontend origins and existing HMAC version. Empty is permitted only for foundation.')
param applicationConfiguration object = {}
@description('Actual separately approved PostgreSQL Entra administrator object/type/name. Required in application phase.')
param postgresAdministrator object = {}
@description('Approved authenticated SCM deployment runner CIDRs; the integration subnet is separately permitted. Empty does not imply public SCM access.')
param scmRunnerCidrs string[] = []
param notificationActionGroupIds array = []
@description('Separate resource provisioning approval reference; preparation never supplies one.')
param deploymentApprovalReference string = ''
@minValue(30)
@maxValue(730)
param retentionDays int = 30
@minValue(1)
param dailyCapGb int = 1
@minValue(1)
param telemetryBudgetAmount int = 30000
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')
param tags object = {}

var applicationPhase = deploymentPhase == 'application'
var rootTags = union(tags, { workload: 'contoso-corr', environment: 'poc', preparationScope: 'approval-required' })
var tenantId = applicationConfiguration.?tenantId ?? tenant().tenantId
var ordersClientId = applicationConfiguration.?ordersApiClientId ?? ''
var inventoryClientId = applicationConfiguration.?inventoryApiClientId ?? ''
var storefrontClientId = applicationConfiguration.?storefrontClientId ?? ''
var principals = applicationConfiguration.?principals ?? {}
var databaseRoles = applicationConfiguration.?databaseRoles ?? {}
var configuredPortalOrigin = applicationConfiguration.?portalOrigin ?? ''
var configuredInventoryBaseUrl = applicationConfiguration.?inventoryBaseUrl ?? ''
var hmacReference = applicationPhase
  ? { phase: 'application', secretVersion: applicationConfiguration.?hmacSecretVersion ?? '' }
  : { phase: 'foundation' }

module network './modules/network.bicep' = {
  name: 'contoso-network'
  params: {
    name: names.network
    location: location
    tags: rootTags
    deploymentDiscriminator: names.discriminator
  }
}

module telemetry './modules/telemetry.bicep' = {
  name: 'contoso-telemetry'
  params: {
    names: { law: names.workspace, appi: names.appInsights }
    location: location
    tags: rootTags
    retentionDays: retentionDays
    dailyCapGb: dailyCapGb
    telemetryBudgetAmount: telemetryBudgetAmount
    budgetStartDate: budgetStartDate
    notificationActionGroupIds: notificationActionGroupIds
    workbookSerializedData: loadTextContent('../workbooks/contoso-correlation.workbook.json')
  }
}

module messaging './modules/messaging.bicep' = {
  name: 'contoso-messaging'
  params: {
    names: {
      serviceBus: names.serviceBus
      eventGrid: names.eventGrid
      eventHubs: names.eventHubs
      storage: names.storage
    }
    location: location
    tags: rootTags
  }
}

module keyVault './modules/security-keyvault.bicep' = {
  name: 'contoso-keyvault'
  params: {
    keyVaultName: names.keyVault
    location: location
    tags: rootTags
    tenantId: tenantId
    allowedSubnetIds: [network.outputs.appSubnetResourceId, network.outputs.apimSubnetResourceId]
    hmacReference: hmacReference
  }
}

module postgres './modules/data-postgres.bicep' = if (applicationPhase) {
  name: 'contoso-postgres'
  params: {
    serverName: names.postgres
    location: location
    tags: rootTags
    tenantId: tenantId
    entraAdminObjectId: postgresAdministrator.?objectId ?? ''
    entraAdminPrincipalType: postgresAdministrator.?principalType ?? 'Group'
    entraAdminPrincipalName: postgresAdministrator.?principalName ?? ''
    delegatedSubnetResourceId: network.outputs.postgresSubnetResourceId
    privateDnsZoneArmResourceId: network.outputs.postgresDnsZoneResourceId
  }
}

module redis './modules/data-managed-redis.bicep' = if (applicationPhase) {
  name: 'contoso-managed-redis'
  params: {
    clusterName: names.redis
    location: location
    tags: rootTags
    privateEndpointSubnetResourceId: network.outputs.privateEndpointSubnetResourceId
    redisPrivateDnsZoneResourceId: network.outputs.redisDnsZoneResourceId
    linkedVnetResourceId: network.outputs.virtualNetworkResourceId
    inventoryPrincipalObjectId: principals.?inventory.?objectId ?? ''
  }
}

var javaRuntimeSettings = applicationPhase ? {
  CONTOSO_TENANT_ID: tenantId
  CONTOSO_PUBLIC_AUDIENCE: ordersClientId
  CONTOSO_ORDERS_AUDIENCE: ordersClientId
  CONTOSO_INVENTORY_AUDIENCE: inventoryClientId
  CONTOSO_INVENTORY_TOKEN_RESOURCE: 'api://${inventoryClientId}'
  CONTOSO_DELEGATED_SCOPE: 'Orders.Invoke'
  CONTOSO_STOREFRONT_CLIENT_ID: storefrontClientId
  CONTOSO_GATEWAY_CLIENT_ID: principals.?gateway.?clientId ?? ''
  CONTOSO_GATEWAY_OBJECT_ID: principals.?gateway.?objectId ?? ''
  CONTOSO_PORTAL_CLIENT_ID: principals.?portal.?clientId ?? ''
  CONTOSO_PORTAL_OBJECT_ID: principals.?portal.?objectId ?? ''
  CONTOSO_RUN_CONTROLLER_CLIENT_ID: principals.?portal.?clientId ?? ''
  CONTOSO_RUN_CONTROLLER_OBJECT_ID: principals.?portal.?objectId ?? ''
  CONTOSO_ORDERS_CLIENT_ID: principals.?orders.?clientId ?? ''
  CONTOSO_ORDERS_OBJECT_ID: principals.?orders.?objectId ?? ''
  CONTOSO_HMAC_SECRET_URI: keyVault.outputs.hmacSecretUri
  CONTOSO_SERVICE_BUS_NAMESPACE: messaging.outputs.serviceBusNamespace
  CONTOSO_EVENT_GRID_ENDPOINT: messaging.outputs.eventGridEndpoint
  CONTOSO_EVENT_HUBS_NAMESPACE: messaging.outputs.eventHubsNamespace
  CONTOSO_STORAGE_QUEUE_ENDPOINT: messaging.outputs.storageQueueEndpoint
  CONTOSO_DB_ROLE_ORDERS: databaseRoles.?orders ?? ''
  CONTOSO_DB_ROLE_FULFILLMENT: databaseRoles.?fulfillment ?? ''
  CONTOSO_DB_ROLE_NOTIFY: databaseRoles.?notify ?? ''
  CONTOSO_DB_ROLE_AGGREGATOR: databaseRoles.?aggregator ?? ''
  CONTOSO_PG_HOST: postgres!.outputs.postgres.host
  CONTOSO_PG_DATABASE: postgres!.outputs.postgres.databaseName
  CONTOSO_PG_RESOURCE_ID: postgres!.outputs.postgres.resourceId
  CONTOSO_REDIS_HOST: redis!.outputs.managedRedis.host
  CONTOSO_REDIS_PRINCIPAL_ID: principals.?inventory.?objectId ?? ''
} : {}

var serviceSettings = applicationPhase ? {
  'contoso-orders-api': {
    CONTOSO_PG_USERNAME: databaseRoles.?orders ?? ''
    CONTOSO_INVENTORY_BASE_URL: configuredInventoryBaseUrl
  }
  'contoso-inventory-api': { CONTOSO_PG_USERNAME: databaseRoles.?inventory ?? '' }
  'contoso-fulfillment-worker': { CONTOSO_PG_USERNAME: databaseRoles.?fulfillment ?? '' }
  'contoso-notify-worker': { CONTOSO_PG_USERNAME: databaseRoles.?notify ?? '' }
  'contoso-order-aggregator': { CONTOSO_PG_USERNAME: databaseRoles.?aggregator ?? '' }
  'contoso-portal-ssr': {
    CONTOSO_PUBLIC_ORIGIN: configuredPortalOrigin
    CONTOSO_GATEWAY_ORIGIN: gateway.outputs.gatewayUrl
    CONTOSO_TENANT_ID: tenantId
    CONTOSO_SPA_CLIENT_ID: storefrontClientId
    CONTOSO_ORDERS_API_CLIENT_ID: ordersClientId
    CONTOSO_DELEGATED_SCOPE: 'api://${ordersClientId}/Orders.Invoke'
    CONTOSO_EXECUTION_MODE: 'live'
    CONTOSO_DEPLOYMENT_STAMP: names.discriminator
    CONTOSO_SERVER_SAMPLING_PERCENTAGE: '10'
    CONTOSO_BROWSER_SAMPLING_PERCENTAGE: '10'
    CONTOSO_PORTAL_DEMO_ENABLED: 'false'
    CONTOSO_DEMOS_ENABLED: 'false'
    CONTOSO_PORTAL_CONTROL_CLIENT_ID: applicationConfiguration.?controller.?clientId ?? ''
    CONTOSO_PORTAL_CONTROL_PRINCIPAL_ID: applicationConfiguration.?controller.?objectId ?? ''
  }
} : {}

var apiIngressRules = [
  {
    name: 'contoso-gateway'
    action: 'Allow'
    priority: 100
    vnetSubnetResourceId: network.outputs.apimSubnetResourceId
  }
  {
    name: 'contoso-integration'
    action: 'Allow'
    priority: 110
    vnetSubnetResourceId: network.outputs.appSubnetResourceId
  }
]

var workerIngressRules = [
  {
    name: 'contoso-integration'
    action: 'Allow'
    priority: 100
    vnetSubnetResourceId: network.outputs.appSubnetResourceId
  }
]

var approvedScmRules = [for (cidr, index) in scmRunnerCidrs: {
  name: 'contoso-approved-scm-runner-${index}'
  action: 'Allow'
  priority: 200 + index
  ipAddress: cidr
}]

var scmIngressRules = concat([
  {
    name: 'contoso-integration-deployment-path'
    action: 'Allow'
    priority: 100
    vnetSubnetResourceId: network.outputs.appSubnetResourceId
  }
], approvedScmRules)

module compute './modules/compute.bicep' = {
  name: 'contoso-compute'
  params: {
    names: {
      plan: names.plan
      orders: names.orders
      inventory: names.inventory
      portal: names.portal
      fulfillment: names.fulfillment
      notify: names.notify
      aggregator: names.aggregator
    }
    location: location
    tags: rootTags
    integrationSubnetId: network.outputs.appSubnetResourceId
    hostStorageAccountName: messaging.outputs.hostStorageAccountName
    applicationInsightsConnectionStringReference: keyVault.outputs.appInsightsConnectionStringReference
    runtimeSettings: javaRuntimeSettings
    serviceSettings: serviceSettings
    apiIpSecurityRestrictions: apiIngressRules
    workerIpSecurityRestrictions: workerIngressRules
    scmIpSecurityRestrictions: scmIngressRules
  }
}

module gateway './modules/apim-service.bicep' = {
  name: 'contoso-gateway'
  params: {
    serviceName: names.apim
    location: location
    publisherName: publisherName
    publisherEmail: publisherEmail
    subnetResourceId: network.outputs.apimSubnetResourceId
    tags: rootTags
  }
}

module rootAccess './modules/root-access.bicep' = {
  name: 'contoso-root-access'
  params: {
    names: names
    computePrincipalIds: compute.outputs.principalIds
    apimPrincipalId: gateway.outputs.principalId
  }
  dependsOn: [telemetry]
}

module secretReaders './modules/security-secret-readers.bicep' = if (applicationPhase) {
  name: 'contoso-secret-readers'
  params: {
    vaultName: names.keyVault
    bindings: [
      { principalId: compute.outputs.principalIds.orders, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: compute.outputs.principalIds.inventory, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: compute.outputs.principalIds.fulfillment, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: compute.outputs.principalIds.notify, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: compute.outputs.principalIds.aggregator, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: compute.outputs.principalIds.portal, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: gateway.outputs.principalId, secretName: keyVault.outputs.secretNames.applicationInsights }
      { principalId: compute.outputs.principalIds.orders, secretName: keyVault.outputs.secretNames.identityHmac }
    ]
  }
}

module apimObservability './modules/apim-observability.bicep' = if (applicationPhase) {
  name: 'contoso-gateway-observability'
  params: {
    serviceName: names.apim
    applicationInsightsResourceId: telemetry.outputs.applicationInsightsResourceId
    connectionSecretIdentifier: keyVault.outputs.appInsightsSecretIdentifier
    samplingPercentage: 10
  }
  dependsOn: [secretReaders, rootAccess]
}

module apimPolicies './modules/apim-api-policies.bicep' = if (applicationPhase) {
  name: 'contoso-gateway-api'
  params: {
    serviceName: names.apim
    tenantId: tenantId
    publicAudience: ordersClientId
    ordersTokenResource: 'api://${ordersClientId}'
    ordersBackendBaseUrl: compute.outputs.ordersBaseUrl
    allowedCallerClientIds: concat([storefrontClientId, principals.?portal.?clientId ?? ''], applicationConfiguration.?approvedTestCallerClientIds ?? [])
    portalClientIds: [principals.?portal.?clientId ?? '']
    frontendOrigins: [configuredPortalOrigin]
  }
  dependsOn: [apimObservability, rootAccess]
}

module messagingRoles './modules/messaging-roles.bicep' = if (applicationPhase) {
  name: 'contoso-messaging-roles'
  params: {
    names: {
      serviceBus: names.serviceBus
      eventGrid: names.eventGrid
      eventHubs: names.eventHubs
      storage: names.storage
    }
    principalIds: compute.outputs.principalIds
  }
}

output deploymentPhaseApplied string = deploymentPhase
output provisioningApprovalReferenceSupplied bool = !empty(deploymentApprovalReference)
output declaredPhysicalNames object = names
output applicationInsightsResourceId string = telemetry.outputs.applicationInsightsResourceId
output logAnalyticsWorkspaceResourceId string = telemetry.outputs.logAnalyticsWorkspaceResourceId
output workbookResourceId string = telemetry.outputs.workbookResourceId
output keyVaultResourceId string = keyVault.outputs.vaultId
output keyVaultReferenceKind string = 'references-only-no-secret-values'
output hmacReferenceConfigured bool = keyVault.outputs.hmacReferenceConfigured
output hmacReferencePhase string = keyVault.outputs.hmacReferencePhase
output computePrincipalObjectIds object = compute.outputs.principalIds
output gatewayPrincipalObjectId string = gateway.outputs.principalId
output gatewayUrl string = gateway.outputs.gatewayUrl
output ordersBaseUrl string = compute.outputs.ordersBaseUrl
output inventoryBaseUrl string = compute.outputs.inventoryBaseUrl
output portalOrigin string = compute.outputs.portalOrigin
output storageAccountResourceId string = messaging.outputs.storageAccountId
output nativeAndCertificationAcceptance string = 'NOT_RUN_NOT_CERTIFIED'
output requiredSeparateStages array = ['approved-resource-provisioning', 'Entra-client-object-bindings', 'KeyVault-secret-bootstrap', 'SQL-schema-and-principal-grants', 'current-native-and-artifact-qualification', 'approved-code-deployment', 'live-certification']
