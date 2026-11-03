targetScope = 'resourceGroup'

@allowed(['centralus'])
param location string = 'centralus'
param tags object = {}
@minLength(3)
@maxLength(63)
param serverName string = 'contoso-corr-poc-pg'
param databaseName string = 'contoso_orders'
@allowed(['18'])
param postgresMajorVersion string = '18'
@allowed(['Standard_B1ms'])
param skuName string = 'Standard_B1ms'
@allowed(['Burstable'])
param skuTier string = 'Burstable'
@minValue(32)
@maxValue(32)
param storageSizeGB int = 32
@minValue(7)
@maxValue(7)
param backupRetentionDays int = 7
@allowed(['Disabled'])
param highAvailabilityMode string = 'Disabled'
@allowed(['Disabled'])
param geoRedundantBackup string = 'Disabled'
@description('Dedicated Microsoft.DBforPostgreSQL/flexibleServers delegated subnet; not an App integration or PE subnet.')
param delegatedSubnetResourceId string
@description('Existing linked private DNS zone ending .postgres.database.azure.com for delegated private access.')
param privateDnsZoneArmResourceId string
param tenantId string
param entraAdminObjectId string
@allowed(['Group', 'ServicePrincipal', 'User'])
param entraAdminPrincipalType string
param entraAdminPrincipalName string = ''

type ApplicationPrincipal = {
  principalObjectId: string
  roleName: string
  owner: 'inventory' | 'workflow'
}
@description('Inputs for the separately authorized SQL bootstrap, not ARM SQL grants or directory mutations.')
param applicationPrincipals ApplicationPrincipal[] = []

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01' = {
  name: serverName
  location: location
  tags: union(tags, {
    workload: 'contoso-corr'
    environment: 'poc'
  })
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresMajorVersion
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenantId
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetResourceId
      privateDnsZoneArmResourceId: privateDnsZoneArmResourceId
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    highAvailability: {
      mode: highAvailabilityMode
    }
  }
}

resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2026-10-01' = {
  parent: server
  name: entraAdminObjectId
  properties: {
    tenantId: tenantId
    principalType: entraAdminPrincipalType
    ...(!empty(entraAdminPrincipalName) ? { principalName: entraAdminPrincipalName } : {})
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2026-10-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [
    administrator
  ]
}

output postgres object = {
  resourceId: server.id
  databaseResourceId: database.id
  host: server.properties.fullyQualifiedDomainName
  port: 5432
  databaseName: databaseName
  authentication: 'entra'
  sslMode: 'verify-full'
  tokenScope: 'https://ossrdbms-aad${environment().suffixes.sqlServerHostname}/.default'
  delegatedSubnetResourceId: delegatedSubnetResourceId
  privateDnsZoneResourceId: privateDnsZoneArmResourceId
  applicationPrincipals: applicationPrincipals
}
