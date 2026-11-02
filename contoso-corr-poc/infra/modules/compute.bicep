targetScope = 'resourceGroup'

@description('Frozen physical names: plan, orders, inventory, portal, fulfillment, notify, aggregator.')
param names object
param location string = 'centralus'
param tags object
param integrationSubnetId string
param hostStorageAccountName string
@secure()
@description('Key Vault reference string only, not a connection-string value.')
param applicationInsightsConnectionStringReference string
@description('Non-secret environment configuration and Key Vault references, supplied by the root.')
param runtimeSettings object = {}
@description('Per canonical service-name settings; fixed telemetry ownership settings always win.')
param serviceSettings object = {}
@description('Approved main-site API rules. An unmatched request is always denied.')
param apiIpSecurityRestrictions array = []
@description('Approved main-site Functions rules. An unmatched request is always denied.')
param workerIpSecurityRestrictions array = []
@description('Approved deployment-runner SCM rules, separate from public Portal/main-site access.')
param scmIpSecurityRestrictions array = []

var commonJava = {
  APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsightsConnectionStringReference
  APPLICATIONINSIGHTS_CONFIGURATION_FILE: '/home/site/wwwroot/agent/applicationinsights.json'
  APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED: 'false'
  APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED: 'false'
  APPLICATIONINSIGHTS_INSTRUMENTATION_AZURE_SDK_ENABLED: 'false'
  APPLICATIONINSIGHTS_SELF_DIAGNOSTICS_LEVEL: 'WARN'
  CONTOSO_CERTIFICATION_MODE: 'false'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  JAVA_TOOL_OPTIONS: ''
  JDK_JAVA_OPTIONS: ''
  _JAVA_OPTIONS: ''
  JAVA_OPTS: ''
  ApplicationInsightsAgent_EXTENSION_VERSION: 'disabled'
  APPLICATIONINSIGHTS_ENABLE_AGENT: 'false'
  JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'false'
  INITIALIZED_FROM_PLACEHOLDER: 'false'
}
var apiDefinitions = [
  { name: names.orders, role: 'contoso-orders-api' }
  { name: names.inventory, role: 'contoso-inventory-api' }
]
var workerDefinitions = [
  { name: names.fulfillment, role: 'contoso-fulfillment-worker' }
  { name: names.notify, role: 'contoso-notify-worker' }
  { name: names.aggregator, role: 'contoso-order-aggregator' }
]

resource plan 'Microsoft.Web/serverfarms@2025-03-01' = {
  name: names.plan
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'P1v3', tier: 'PremiumV3', capacity: 1 }
  properties: {
    reserved: true
    zoneRedundant: false
  }
}

resource apis 'Microsoft.Web/sites@2025-03-01' = [for api in apiDefinitions: {
  name: api.name
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: integrationSubnetId
    siteConfig: {
      linuxFxVersion: 'JAVA|25-java25'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ipSecurityRestrictions: apiIpSecurityRestrictions
      ipSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictions: scmIpSecurityRestrictions
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictionsUseMain: false
      http20Enabled: true
      healthCheckPath: '/health/ready'
      appCommandLine: 'sh /home/site/wwwroot/startup.sh'
      appSettings: [for setting in items(union(
        runtimeSettings,
        serviceSettings[?api.role] ?? {},
        commonJava,
        {
          CONTOSO_SERVICE_NAME: api.role
          APPLICATIONINSIGHTS_ROLE_NAME: api.role
          OTEL_SERVICE_NAME: api.role
          CONTOSO_HEAP_MB: '384'
        }
      )): { name: setting.key, value: string(setting.value) }]
    }
  }
}]

resource workers 'Microsoft.Web/sites@2025-03-01' = [for worker in workerDefinitions: {
  name: worker.name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: integrationSubnetId
    siteConfig: {
      linuxFxVersion: 'Java|25'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ipSecurityRestrictions: workerIpSecurityRestrictions
      ipSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictions: scmIpSecurityRestrictions
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictionsUseMain: false
      appSettings: [for setting in items(union(
        runtimeSettings,
        serviceSettings[?worker.role] ?? {},
        commonJava,
        {
          FUNCTIONS_WORKER_RUNTIME: 'java'
          FUNCTIONS_EXTENSION_VERSION: '~4'
          FUNCTIONS_WORKER_PROCESS_COUNT: '1'
          AzureWebJobsStorage__accountName: hostStorageAccountName
          AzureWebJobsStorage__credential: 'managedidentity'
          JAVA_OPTS: '-Xms32m -Xmx256m -javaagent:/home/site/wwwroot/agent/applicationinsights-agent-3.7.10.jar -Dotel.javaagent.extensions=/home/site/wwwroot/agent/extensions/contoso-parent-safe-sampler-1.1.0.jar -Dotel.instrumentation.jdbc.enabled=false -Dotel.instrumentation.jdbc-datasource.enabled=false -Dotel.instrumentation.lettuce.enabled=false -Dotel.instrumentation.jedis.enabled=false -Dotel.instrumentation.redisson.enabled=false -Dotel.instrumentation.azure-core.enabled=false -Dotel.instrumentation.ai-azure-functions.enabled=false'
          CONTOSO_SERVICE_NAME: worker.role
          APPLICATIONINSIGHTS_ROLE_NAME: worker.role
          OTEL_SERVICE_NAME: worker.role
        }
      )): { name: setting.key, value: string(setting.value) }]
    }
  }
}]

resource portal 'Microsoft.Web/sites@2025-03-01' = {
  name: names.portal
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: integrationSubnetId
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      scmIpSecurityRestrictions: scmIpSecurityRestrictions
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictionsUseMain: false
      appCommandLine: 'node dist/bootstrap.js'
      appSettings: [for setting in items(union(
        runtimeSettings,
        serviceSettings[?'contoso-portal-ssr'] ?? {},
        {
          APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsightsConnectionStringReference
          OTEL_SERVICE_NAME: 'contoso-portal-ssr'
          NODE_OPTIONS: '--max-old-space-size=256'
          SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
        }
      )): { name: setting.key, value: string(setting.value) }]
    }
  }
}

output planId string = plan.id
output apiIds array = [for (_, index) in apiDefinitions: apis[index].id]
output workerIds array = [for (_, index) in workerDefinitions: workers[index].id]
output portalId string = portal.id
output ordersBaseUrl string = 'https://${apis[0].properties.defaultHostName}/api'
output inventoryBaseUrl string = 'https://${apis[1].properties.defaultHostName}/api'
output portalOrigin string = 'https://${portal.properties.defaultHostName}'
output principalIds object = {
  orders: apis[0].identity.principalId
  inventory: apis[1].identity.principalId
  fulfillment: workers[0].identity.principalId
  notify: workers[1].identity.principalId
  aggregator: workers[2].identity.principalId
  portal: portal.identity.principalId
}
