targetScope = 'resourceGroup'

@sealed()
type SecretReaderBinding = {
  principalId: string
  secretName: string
}

param vaultName string
@description('Approved service-principal readers at named-secret scope. This template is preparation-only until deployment and grants are approved.')
param bindings SecretReaderBinding[]

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: vaultName
}
resource secrets 'Microsoft.KeyVault/vaults/secrets@2025-05-01' existing = [for binding in bindings: {
  parent: vault
  name: binding.secretName
}]

var secretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource readers 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (binding, index) in bindings: {
  name: guid(secrets[index].id, binding.principalId, secretsUserRoleId)
  scope: secrets[index]
  properties: {
    principalId: binding.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: secretsUserRoleId
  }
}]

output readerScopes array = [for (_, index) in bindings: secrets[index].id]
output assignmentIds array = [for (_, index) in bindings: readers[index].id]
output permittedDataOperation string = 'named-secret-read'
