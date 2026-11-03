metadata description = 'Contoso Gateway: GA classic Developer external-VNet service. Network/RBAC are owned by root.'

@description('Root-frozen legal physical APIM name; never derived independently by this module.')
@minLength(1)
@maxLength(50)
param serviceName string

@allowed([
  'centralus'
])
param location string = 'centralus'

@description('Approved publisher organization.')
@minLength(1)
param publisherName string

@description('Approved publisher contact; no placeholder is supplied.')
@minLength(1)
param publisherEmail string

@description('Root-owned, nondelegated classic APIM subnet in the same subscription and region.')
@minLength(1)
param subnetResourceId string

@description('Optional existing root-owned Standard IPv4 address; Azure manages the address when omitted.')
param ownedPublicIpResourceId string = ''

param tags object = {}

resource gateway 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: serviceName
  location: location
  tags: union(tags, {
    workload: 'contoso-corr'
    environment: 'poc'
    logicalResource: 'contoso-corr-poc-apim'
  })
  sku: {
    name: 'Developer'
    capacity: 1
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherName: publisherName
    publisherEmail: publisherEmail
    publicNetworkAccess: 'Enabled'
    virtualNetworkType: 'External'
    virtualNetworkConfiguration: {
      subnetResourceId: subnetResourceId
    }
    customProperties: {
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls10': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls11': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Ssl30': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls10': 'false'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls11': 'false'
    }
    ...(empty(ownedPublicIpResourceId) ? {} : {
      publicIpAddressId: ownedPublicIpResourceId
    })
  }
}

output serviceResourceId string = gateway.id
output serviceName string = gateway.name
output gatewayUrl string = gateway.properties.gatewayUrl
output gatewayHost string = split(replace(gateway.properties.gatewayUrl, 'https://', ''), '/')[0]
output principalId string = gateway.identity!.principalId
output tenantId string = gateway.identity!.tenantId
output managementApiVersion string = '2024-05-01'
output logicalResourceName string = 'contoso-corr-poc-apim'
