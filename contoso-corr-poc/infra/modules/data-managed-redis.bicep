targetScope = 'resourceGroup'

@allowed(['centralus'])
param location string = 'centralus'
param tags object = {}
param clusterName string = 'contoso-corr-poc-amr'
@allowed(['Balanced_B0'])
param skuName string = 'Balanced_B0'
@allowed(['Disabled'])
param highAvailability string = 'Disabled'
@allowed(['default'])
param databaseName string = 'default'
@allowed(['EnterpriseCluster'])
param clusteringPolicy string = 'EnterpriseCluster'
@allowed(['AllKeysLRU'])
param evictionPolicy string = 'AllKeysLRU'
@allowed([10000])
param port int = 10000
@allowed(['NotDeferred'])
param deferUpgrade string = 'NotDeferred'
@description('Nondelegated private-endpoint subnet, separate from App integration and PostgreSQL delegation.')
param privateEndpointSubnetResourceId string
@description('Existing privatelink.redis.azure.net zone; not legacy redisenterprise.cache.azure.net.')
param redisPrivateDnsZoneResourceId string
@description('VNet already linked to that DNS zone by the network owner.')
param linkedVnetResourceId string
param inventoryPrincipalObjectId string
param accessAssignmentName string = 'contosoInventory'

resource cluster 'Microsoft.Cache/redisEnterprise@2026-09-01' = {
  name: clusterName
  location: location
  tags: union(tags, {
    workload: 'contoso-corr'
    environment: 'poc'
  })
  sku: {
    name: skuName
  }
  properties: {
    highAvailability: highAvailability
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource database 'Microsoft.Cache/redisEnterprise/databases@2026-09-01' = {
  parent: cluster
  name: databaseName
  properties: {
    clientProtocol: 'Encrypted'
    accessKeysAuthentication: 'Disabled'
    clusteringPolicy: clusteringPolicy
    evictionPolicy: evictionPolicy
    port: port
    deferUpgrade: deferUpgrade
    modules: []
    persistence: {
      aofEnabled: false
      rdbEnabled: false
    }
  }
}

resource access 'Microsoft.Cache/redisEnterprise/databases/accessPolicyAssignments@2026-09-01' = {
  parent: database
  name: accessAssignmentName
  properties: {
    accessPolicyName: 'default'
    user: {
      objectId: inventoryPrincipalObjectId
    }
  }
}

resource endpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${clusterName}-pe'
  location: location
  tags: union(tags, {
    workload: 'contoso-corr'
    environment: 'poc'
  })
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'redis'
        properties: {
          privateLinkServiceId: cluster.id
          groupIds: [
            'redisEnterprise'
          ]
        }
      }
    ]
  }
}

resource zoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'managedRedis'
        properties: {
          privateDnsZoneId: redisPrivateDnsZoneResourceId
        }
      }
    ]
  }
}

output managedRedis object = {
  clusterResourceId: cluster.id
  databaseResourceId: database.id
  accessAssignmentResourceId: access.id
  host: cluster.properties.hostName
  port: port
  clusteringPolicy: clusteringPolicy
  tls: true
  authentication: 'entra'
  tokenScope: 'https://redis.azure.com/.default'
  identityPrincipalObjectId: inventoryPrincipalObjectId
  privateEndpointId: endpoint.id
  privateDnsZoneResourceId: redisPrivateDnsZoneResourceId
  dnsZoneGroupResourceId: zoneGroup.id
  dnsLinkedVnetResourceId: linkedVnetResourceId
}
