metadata description = 'Contoso public /contoso/v1 API to private /api. Preserves caller auth and adds independent MI gateway proof.'

@minLength(1)
param serviceName string

@description('R8-frozen tenant identifier; identity resources are never created by this module.')
@minLength(1)
param tenantId string

@description('Bare nonzero R8-frozen Orders application GUID for v2 caller aud. Not an api:// token resource URI.')
@minLength(36)
@maxLength(36)
param publicAudience string

@description('Registered Orders resource used to obtain the separate gateway MI proof token.')
@minLength(1)
param ordersTokenResource string

@description('Root-frozen private Orders HTTPS URL, ending /api. Host/SNI uses the approved App name.')
@minLength(1)
param ordersBackendBaseUrl string

@description('Approved Storefront/Portal/test application client IDs; no wildcard caller acceptance.')
@minLength(1)
param allowedCallerClientIds string[]

@description('Approved Portal app-only client IDs allowed to issue invocation UUID candidates.')
@minLength(1)
param portalClientIds string[]

@description('Exact short token scp value. Frontend OAuth request scope is separately resource-qualified.')
@allowed([
  'Orders.Invoke'
])
param delegatedScope string = 'Orders.Invoke'

@description('Exact browser-facing Storefront origins. No wildcard or backend CORS.')
@minLength(1)
param frontendOrigins string[]

param exposeBusinessInvocationId bool = true
param enableBusinessObservation bool = false

@minValue(1)
@maxValue(120)
param backendTimeoutSeconds int = 30

func xml(value string) string => replace(replace(replace(replace(value, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')

var callerIdsXml = join(map(allowedCallerClientIds, id => '<application-id>${xml(id)}</application-id>'), '')
var originsXml = join(map(frontendOrigins, origin => '<origin>${xml(origin)}</origin>'), '')
var servicePolicyXml = replace(replace(loadTextContent('../../apim/policies/service-policy.xml'), '__FRONTEND_ORIGINS__', originsXml), '__EXPOSED_HEADERS__', exposeBusinessInvocationId ? '<header>x-business-invocation-id</header>' : '')
var configuration = [
  { name: 'contoso-tenant-id', value: tenantId }
  { name: 'contoso-public-audience', value: publicAudience }
  { name: 'contoso-orders-token-resource', value: ordersTokenResource }
  { name: 'contoso-portal-client-ids', value: join(portalClientIds, ',') }
  { name: 'contoso-delegated-scope', value: delegatedScope }
  { name: 'contoso-backend-timeout', value: string(backendTimeoutSeconds) }
  { name: 'contoso-business-observation-enabled', value: enableBusinessObservation ? 'true' : 'false' }
  { name: 'contoso-expose-business-id', value: exposeBusinessInvocationId ? 'true' : 'false' }
]
var fragments = [
  { name: 'contoso-authn-v1', value: replace(loadTextContent('../../apim/policies/fragments/contoso-authn-v1.xml'), '__CLIENT_APPLICATION_IDS__', callerIdsXml) }
  { name: 'contoso-authz-v1', value: loadTextContent('../../apim/policies/fragments/contoso-authz-v1.xml') }
  { name: 'contoso-request-guard-v1', value: loadTextContent('../../apim/policies/fragments/contoso-request-guard-v1.xml') }
  { name: 'contoso-context-v1', value: loadTextContent('../../apim/policies/fragments/contoso-context-v1.xml') }
  { name: 'contoso-header-hygiene-v1', value: loadTextContent('../../apim/policies/fragments/contoso-header-hygiene-v1.xml') }
  { name: 'contoso-business-id-v1', value: loadTextContent('../../apim/policies/fragments/contoso-business-id-v1.xml') }
  { name: 'contoso-business-observe-v1', value: loadTextContent('../../apim/policies/fragments/contoso-business-observe-v1.xml') }
  { name: 'contoso-backend-proof-v1', value: loadTextContent('../../apim/policies/fragments/contoso-backend-proof-v1.xml') }
  { name: 'contoso-response-id-v1', value: loadTextContent('../../apim/policies/fragments/contoso-response-id-v1.xml') }
]

resource service 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: serviceName
}

resource policyConfiguration 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = [for item in configuration: {
  name: item.name
  parent: service
  properties: {
    displayName: item.name
    value: item.value
    secret: false
    tags: [
      'contoso-corr'
      'policy-configuration'
    ]
  }
}]

resource policyFragments 'Microsoft.ApiManagement/service/policyFragments@2024-05-01' = [for item in fragments: {
  name: item.name
  parent: service
  properties: {
    description: 'Contoso API policy fragment ${item.name}. Runtime expressions and live trace behavior require verification.'
    format: 'rawxml'
    value: item.value
  }
}]

resource backend 'Microsoft.ApiManagement/service/backends@2024-05-01' = {
  name: 'contoso-orders-backend'
  parent: service
  properties: {
    protocol: 'http'
    url: ordersBackendBaseUrl
    tls: {
      validateCertificateChain: true
      validateCertificateName: true
    }
  }
}

resource servicePolicy 'Microsoft.ApiManagement/service/policies@2024-05-01' = {
  name: 'policy'
  parent: service
  properties: {
    format: 'rawxml'
    value: servicePolicyXml
  }
  dependsOn: [
    policyConfiguration
  ]
}

resource api 'Microsoft.ApiManagement/service/apis@2024-05-01' = {
  name: 'contoso-orders'
  parent: service
  properties: {
    displayName: 'Contoso Orders API'
    path: 'contoso/v1'
    protocols: [
      'https'
    ]
    apiType: 'http'
    subscriptionRequired: false
    format: 'openapi+json'
    value: loadTextContent('../../apim/openapi/contoso-orders.v1.json')
    serviceUrl: ordersBackendBaseUrl
  }
}

resource apiPolicy 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = {
  name: 'policy'
  parent: api
  properties: {
    format: 'rawxml'
    value: loadTextContent('../../apim/policies/api-policy.xml')
  }
  dependsOn: [
    policyConfiguration
    policyFragments
    servicePolicy
    backend
  ]
}

output apiResourceId string = api.id
output backendResourceId string = backend.id
output servicePolicyResourceId string = servicePolicy.id
output apiPolicyResourceId string = apiPolicy.id
output publicApiPath string = '/contoso/v1'
output backendBasePath string = '/api'
output gatewayProofHeader string = 'X-Contoso-Gateway-Authorization'
output requiredDelegatedScope string = delegatedScope
output requiredGatewayRole string = 'Gateway.Invoke'
output requiredPortalRole string = 'Portal.Invoke'
output managementApiVersion string = '2024-05-01'
output fragmentResourceIds array = [for (item, index) in fragments: policyFragments[index].id]
