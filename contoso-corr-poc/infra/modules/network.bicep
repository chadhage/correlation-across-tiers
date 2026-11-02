targetScope = 'resourceGroup'

param name string
param location string
param tags object
@minLength(4)
@maxLength(6)
param deploymentDiscriminator string

var prefix = 'contoso-corr-poc-'

resource apimNsg 'Microsoft.Network/networkSecurityGroups@2024-07-01' = {
  name: '${prefix}gateway-nsg-${deploymentDiscriminator}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'contoso-gateway-https'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '443'
        }
      }
      {
        name: 'contoso-gateway-management'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'ApiManagement'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '3443'
        }
      }
      {
        name: 'contoso-gateway-probe'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '6390'
        }
      }
    ]
  }
}

resource network 'Microsoft.Network/virtualNetworks@2024-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.96.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'contoso-compute'
        properties: {
          addressPrefix: '10.96.1.0/24'
          delegations: [
            {
              name: 'contoso-appservice-delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
          serviceEndpoints: [
            {
              service: 'Microsoft.KeyVault'
              locations: [
                location
              ]
            }
            {
              service: 'Microsoft.Web'
              locations: [
                location
              ]
            }
            {
              service: 'Microsoft.Storage'
              locations: [
                location
              ]
            }
          ]
        }
      }
      {
        name: 'contoso-gateway'
        properties: {
          addressPrefix: '10.96.2.0/24'
          networkSecurityGroup: {
            id: apimNsg.id
          }
          serviceEndpoints: [
            {
              service: 'Microsoft.Web'
              locations: [
                location
              ]
            }
            {
              service: 'Microsoft.KeyVault'
              locations: [
                location
              ]
            }
          ]
        }
      }
      {
        name: 'contoso-private-endpoints'
        properties: {
          addressPrefix: '10.96.3.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'contoso-postgres'
        properties: {
          addressPrefix: '10.96.4.0/24'
          delegations: [
            {
              name: 'contoso-postgres-delegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
    ]
  }
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${prefix}${deploymentDiscriminator}.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: 'contoso-postgres-network'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource redisDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.redis.azure.net'
  location: 'global'
  tags: tags
}

resource redisDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: redisDns
  name: 'contoso-redis-network'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

output virtualNetworkResourceId string = network.id
output appSubnetResourceId string = resourceId('Microsoft.Network/virtualNetworks/subnets', network.name, 'contoso-compute')
output apimSubnetResourceId string = resourceId('Microsoft.Network/virtualNetworks/subnets', network.name, 'contoso-gateway')
output postgresSubnetResourceId string = resourceId('Microsoft.Network/virtualNetworks/subnets', network.name, 'contoso-postgres')
output privateEndpointSubnetResourceId string = resourceId('Microsoft.Network/virtualNetworks/subnets', network.name, 'contoso-private-endpoints')
output postgresDnsZoneResourceId string = postgresDns.id
output redisDnsZoneResourceId string = redisDns.id
