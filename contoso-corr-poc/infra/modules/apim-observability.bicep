metadata description = 'Contoso APIM GA logger and all-APIs W3C diagnostic. Secret retrieval and publisher RBAC are root-owned.'

@minLength(1)
param serviceName string

@description('Workspace-based Application Insights component resource ID, supplied by observability.')
@minLength(1)
param applicationInsightsResourceId string

@description('Versionless Key Vault secret URI. Only a reference is accepted; never the connection-string value.')
@secure()
@minLength(1)
param connectionSecretIdentifier string

@description('Fixed diagnostic sampling. The root lease controller owns bounded certification at 100.')
@minValue(0)
@maxValue(100)
param samplingPercentage int = 10

@allowed([
  'verbose'
  'information'
  'error'
])
param diagnosticVerbosity string = 'error'

@description('Default false. Frontend input headers are never captured.')
param captureCanonicalBackendBusinessHeader bool = false

@description('Requires a root/verifier-approved live timing observation, not an assumed policy execution order.')
param backendCaptureTimingVerified bool = false

@description('SHA-256 of the approved sanitized timing evidence; root must validate its provenance.')
param backendCaptureEvidenceSha256 string = ''

var connectionNamedValueName = 'contoso-appinsights-connection-string'
var evidenceNonHex = reduce(range(0, 16), backendCaptureEvidenceSha256, (value, index) => replace(value, substring('0123456789abcdef', index, 1), ''))
var captureApplied = captureCanonicalBackendBusinessHeader && backendCaptureTimingVerified && length(backendCaptureEvidenceSha256) == 64 && empty(evidenceNonHex) && backendCaptureEvidenceSha256 != '0000000000000000000000000000000000000000000000000000000000000000'
var sensitiveQueryNames = [
  'access_token'
  'token'
  'code'
  'client_secret'
  'api-key'
  'api_key'
  'sig'
  'authorization'
  'password'
  'email'
  'upn'
  'x-business-invocation-id'
]
var queryMasking = {
  queryParams: map(sensitiveQueryNames, name => {
    mode: 'Hide'
    value: name
  })
}

resource service 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: serviceName
}

resource connectionNamedValue 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = {
  name: connectionNamedValueName
  parent: service
  properties: {
    displayName: connectionNamedValueName
    secret: true
    keyVault: {
      secretIdentifier: connectionSecretIdentifier
    }
    tags: [
      'contoso-corr'
      'connection-reference'
    ]
  }
}

resource logger 'Microsoft.ApiManagement/service/loggers@2024-05-01' = {
  name: 'contoso-appinsights'
  parent: service
  properties: {
    loggerType: 'applicationInsights'
    description: 'Contoso Gateway: Key Vault connection reference and system-assigned publisher identity.'
    resourceId: applicationInsightsResourceId
    isBuffered: true
    credentials: {
      connectionString: '{{contoso-appinsights-connection-string}}'
      identityClientId: 'SystemAssigned'
    }
  }
  dependsOn: [
    connectionNamedValue
  ]
}

resource diagnostic 'Microsoft.ApiManagement/service/diagnostics@2024-05-01' = {
  name: 'applicationinsights'
  parent: service
  properties: {
    loggerId: logger.id
    httpCorrelationProtocol: 'W3C'
    alwaysLog: 'allErrors'
    sampling: {
      samplingType: 'fixed'
      percentage: samplingPercentage
    }
    verbosity: diagnosticVerbosity
    operationNameFormat: 'Name'
    logClientIp: false
    metrics: false
    frontend: {
      request: {
        headers: []
        dataMasking: queryMasking
        body: {
          bytes: 0
        }
      }
      response: {
        headers: []
        dataMasking: queryMasking
        body: {
          bytes: 0
        }
      }
    }
    backend: {
      request: {
        headers: captureApplied ? [
          'x-business-invocation-id'
        ] : []
        dataMasking: queryMasking
        body: {
          bytes: 0
        }
      }
      response: {
        headers: []
        dataMasking: queryMasking
        body: {
          bytes: 0
        }
      }
    }
  }
}

output loggerResourceId string = logger.id
output namedValueResourceId string = connectionNamedValue.id
output diagnosticResourceId string = diagnostic.id
output diagnosticScope string = 'allApis'
output managementApiVersion string = '2024-05-01'
output configuredSamplingPercentage int = samplingPercentage
output configuredDiagnosticVerbosity string = diagnosticVerbosity
output fullSamplingRequiresExternalLeaseController bool = samplingPercentage == 100
output connectionReferenceKind string = 'keyVaultVersionlessSecretUri'
output canonicalBackendHeaderCaptureApplied bool = captureApplied
