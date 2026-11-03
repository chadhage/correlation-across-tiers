targetScope = 'resourceGroup'

@description('Frozen R1 physical names: law and appi. No service-specific Application Insights resources.')
param names object
@allowed(['centralus'])
param location string = 'centralus'
param tags object = {}
@minValue(30)
@maxValue(730)
param retentionDays int = 30
@minValue(1)
param dailyCapGb int = 1
@minValue(1)
@description('Root-approved telemetry-resource monthly envelope. Default is 1000 USD/day times the intended 720h (30d) lifetime, not a billing/spend guarantee.')
param telemetryBudgetAmount int = 30000
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')
@description('R8/root supplied action-group ARM IDs. Empty leaves rules disabled and governance unresolved.')
param notificationActionGroupIds array = []
@description('Optional R7 Notebook/1.0 JSON string. Root supplies the generated workbook content.')
param workbookSerializedData string = ''

var routesConfigured = !empty(notificationActionGroupIds)

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.law
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionDays
    workspaceCapping: { dailyQuotaGb: dailyCapGb }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
      disableLocalAuth: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: names.appi
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    RetentionInDays: retentionDays
    SamplingPercentage: 100
    DisableIpMasking: false
    // Shared browser ingestion is public; an Entra-only component would break the approved JS path.
    DisableLocalAuth: false
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${names.appi}-telemetry-budget'
  properties: {
    category: 'Cost'
    amount: telemetryBudgetAmount
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    filter: {
      dimensions: {
        name: 'ResourceId'
        operator: 'In'
        values: [law.id, appi.id]
      }
    }
    notifications: {
      Actual50: {
        enabled: routesConfigured
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: notificationActionGroupIds
      }
      Actual80: {
        enabled: routesConfigured
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: notificationActionGroupIds
      }
      Actual100: {
        enabled: routesConfigured
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: notificationActionGroupIds
      }
      Forecast100: {
        enabled: routesConfigured
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: []
        contactGroups: notificationActionGroupIds
      }
    }
  }
}

var definitions = [
  {
    name: 'ingestion-health'
    severity: 1
    query: '_LogOperation | where Level == "Error" | project TimeGenerated, Category, Operation, Level'
    window: 'PT5M'
    range: 'PT5M'
  }
  {
    name: 'cap-reached'
    severity: 1
    query: '_LogOperation | where Category =~ "Ingestion" | where Detail contains "OverQuota" | project TimeGenerated, Category, Operation, Level'
    window: 'PT5M'
    range: 'PT5M'
  }
  {
    name: 'rolling-volume-warning'
    severity: 2
    query: 'Usage | where StartTime > ago(24h) | where IsBillable | summarize BillableGB=sum(Quantity)/1000.0 | where BillableGB >= ${dailyCapGb}.0 * 0.7'
    window: 'PT5M'
    range: 'PT24H'
  }
]

resource alerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for rule in definitions: {
  name: '${names.appi}-${rule.name}'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Contoso ${rule.name}'
    enabled: routesConfigured
    severity: rule.severity
    scopes: [law.id]
    evaluationFrequency: 'PT5M'
    windowSize: rule.window
    overrideQueryTimeRange: rule.range
    autoMitigate: true
    skipQueryValidation: false
    actions: { actionGroups: notificationActionGroupIds }
    criteria: {
      allOf: [{
        query: rule.query
        timeAggregation: 'Count'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
  }
}]

resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = if (!empty(workbookSerializedData)) {
  name: guid(appi.id, 'contoso-correlation')
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: 'Contoso Correlation'
    category: 'workbook'
    sourceId: appi.id
    version: 'Notebook/1.0'
    serializedData: workbookSerializedData
  }
}

output applicationInsightsResourceId string = appi.id
output logAnalyticsWorkspaceResourceId string = law.id
output workspaceId string = law.properties.customerId
output applicationId string = appi.properties.AppId
output telemetryBudgetResourceId string = budget.id
output alertResourceIds array = [for index in range(0, length(definitions)): alerts[index].id]
output notificationRoutesConfigured bool = routesConfigured
output workspaceDailyCapGb int = dailyCapGb
output configuredRetentionDays int = retentionDays
output workbookResourceId string = !empty(workbookSerializedData) ? workbook!.id : ''
