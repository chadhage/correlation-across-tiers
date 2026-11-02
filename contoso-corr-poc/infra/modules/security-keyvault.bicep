targetScope = 'resourceGroup'

@sealed()
type FoundationHmacReference = {
  phase: 'foundation'
}

@sealed()
type ApplicationHmacReference = {
  phase: 'application'
  @minLength(32)
  @maxLength(32)
  secretVersion: string
}

@discriminator('phase')
type HmacReference = FoundationHmacReference | ApplicationHmacReference

@minLength(3)
@maxLength(24)
param keyVaultName string
param location string = 'centralus'
param tags object
param tenantId string = tenant().tenantId
@description('Subnets with the Microsoft.KeyVault service endpoint. APIM also uses its managed identity with AzureServices bypass.')
param allowedSubnetIds string[]
@description('Named secret reference only. Its value is created separately after explicit bootstrap approval.')
param appInsightsSecretName string = 'contoso-appinsights-connection'
param hmacSecretName string = 'contoso-identity-hmac'
@description('Explicit foundation-only phase without a secret version, or application reference after separately approved bootstrap. This input does not prove secret existence, approval or reader readiness.')
param hmacReference HmacReference
@minValue(7)
@maxValue(90)
param softDeleteRetentionDays int = 90

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    accessPolicies: []
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionDays
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: [for subnetId in allowedSubnetIds: {
        id: subnetId
        ignoreMissingVnetServiceEndpoint: false
      }]
    }
  }
}

var appInsightsSecretIdentifier = '${vault.properties.vaultUri}secrets/${appInsightsSecretName}'
var hmacSecretUri = hmacReference.phase == 'application'
  ? '${vault.properties.vaultUri}secrets/${hmacSecretName}/${hmacReference.secretVersion}'
  : ''

output vaultId string = vault.id
output vaultUri string = vault.properties.vaultUri
output appInsightsSecretIdentifier string = appInsightsSecretIdentifier
output appInsightsConnectionStringReference string = '@Microsoft.KeyVault(SecretUri=${appInsightsSecretIdentifier})'
output hmacSecretUri string = hmacSecretUri
output hmacReferenceConfigured bool = hmacReference.phase == 'application'
output hmacReferencePhase string = hmacReference.phase
output secretNames object = {
  applicationInsights: appInsightsSecretName
  identityHmac: hmacSecretName
}
