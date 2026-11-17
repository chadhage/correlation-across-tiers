targetScope = 'resourceGroup'

@description('Actual existing POC App Service plan. Capacity and cost approval are separate prerequisites.')
param appServicePlanResourceId string
@description('Actual existing delegated compute integration subnet.')
param integrationSubnetResourceId string
@description('New legal globally available names; never reuse an application host.')
param names {
  operator: string
  watchdog: string
  inventoryFixture: string
}
@minLength(1)
@description('Reviewed canonical IPv4 CIDRs; validate with prepare.mjs before deployment.')
param runnerCidrs string[]
@description('Non-secret application settings or Key Vault references; empty is foundation only, never readiness.')
@secure()
param operatorSettings object = {}
@secure()
param watchdogSettings object = {}
@secure()
param inventoryFixtureSettings object = {}
param location string = 'centralus'

var runnerRules = [for (cidr, index) in runnerCidrs: {
  name: 'contoso-operator-runner-${index}'
  priority: 200 + index
  action: 'Allow'
  ipAddress: cidr
}]
var fixtureRule = {
  name: 'contoso-orders-subnet'
  priority: 200
  action: 'Allow'
  vnetSubnetResourceId: integrationSubnetResourceId
}
var hosts = [
  { name: names.operator, mode: 'operator' }
  { name: names.watchdog, mode: 'watchdog' }
  { name: names.inventoryFixture, mode: 'inventory-fixture' }
]
var hostSettings = [operatorSettings, watchdogSettings, inventoryFixtureSettings]

resource sites 'Microsoft.Web/sites@2025-03-01' = [for (host, index) in hosts: {
  name: host.name
  location: location
  kind: 'app,linux'
  tags: { workload: 'contoso-corr', environment: 'poc', purpose: 'isolated-azure-examples' }
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlanResourceId
    virtualNetworkSubnetId: integrationSubnetResourceId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'JAVA|25-java25'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      scmIpSecurityRestrictionsUseMain: false
      scmIpSecurityRestrictions: runnerRules
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: host.mode == 'inventory-fixture' ? [fixtureRule] : runnerRules
      ipSecurityRestrictionsDefaultAction: 'Deny'
      healthCheckPath: '/health/ready'
      appCommandLine: 'sh /home/site/wwwroot/startup.sh'
      appSettings: [for setting in items(union(hostSettings[index], {
        CONTOSO_OPERATOR_MODE: host.mode
        CONTOSO_ISOLATED_DEMO_OPERATOR: host.mode == 'inventory-fixture' ? 'false' : 'true'
        CONTOSO_ISOLATED_INVENTORY_FIXTURE: host.mode == 'inventory-fixture' ? 'true' : 'false'
        CONTOSO_SERVICE_NAME: host.mode == 'inventory-fixture' ? 'contoso-inventory-api' : 'contoso-demo-operator'
        APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED: 'false'
        APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED: 'false'
        APPLICATIONINSIGHTS_INSTRUMENTATION_AZURE_SDK_ENABLED: 'false'
        ApplicationInsightsAgent_EXTENSION_VERSION: 'disabled'
        APPLICATIONINSIGHTS_ENABLE_AGENT: 'false'
        JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'false'
        INITIALIZED_FROM_PLACEHOLDER: 'false'
        CONTOSO_CERTIFICATION_MODE: 'false'
        SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
        JAVA_TOOL_OPTIONS: ''
        JAVA_OPTS: ''
        JDK_JAVA_OPTIONS: ''
        _JAVA_OPTIONS: ''
      })): { name: setting.key, value: string(setting.value) }]
    }
  }
}]

resource scmCredentials 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = [for (host, index) in hosts: {
  parent: sites[index]
  name: 'scm'
  properties: { allow: false }
}]
resource ftpCredentials 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = [for (host, index) in hosts: {
  parent: sites[index]
  name: 'ftp'
  properties: { allow: false }
}]

output hosts array = [for (host, index) in hosts: {
  mode: host.mode
  resourceId: sites[index].id
  principalObjectId: sites[index].identity.principalId
  origin: 'https://${sites[index].properties.defaultHostName}'
}]
