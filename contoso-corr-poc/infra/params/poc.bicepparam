using '../main.bicep'

param location = 'centralus'
param deploymentPhase = 'foundation'
param names = loadJsonContent('./frozen-names.v1.json')
param publisherName = 'Contoso'
param publisherEmail = ''
param applicationConfiguration = {}
param postgresAdministrator = {}
param scmRunnerCidrs = []
param notificationActionGroupIds = []
param deploymentApprovalReference = ''

// Unset contact/approval inputs intentionally fail root preflight. No client IDs or secrets are invented.
