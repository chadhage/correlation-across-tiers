param(
    [string]$BicepPath = '',
    [string]$OutputPath = ''
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $BicepPath) { $BicepPath = Join-Path $root '.cache\r6-tools\bicep.exe' }
if (-not (Test-Path -LiteralPath $BicepPath)) { throw 'Provide an existing Bicep CLI; this script never installs or deploys.' }
$output = $OutputPath
if (-not $output) {
    $output = Join-Path $root ('.cache\r6-build\' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N'))
}
if (Test-Path -LiteralPath $output) { throw 'OutputPath must be a new run-owned directory.' }
New-Item -ItemType Directory -Path $output -Force | Out-Null
function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
$compilerVersion = (& $BicepPath --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'compiler_version_failed' }
foreach ($name in @('data-postgres','data-managed-redis')) {
    $diagnostics = & $BicepPath build (Join-Path $root "infra\modules\$name.bicep") --no-restore --diagnostics-format sarif --outfile (Join-Path $output "$name.json") 2>&1
    if ($LASTEXITCODE -ne 0) { throw "compile_failed_$name" }
    ($diagnostics | ForEach-Object { $_.ToString() }) -join "`n" |
        Set-Content -LiteralPath (Join-Path $output "$name.sarif.json") -Encoding utf8NoBOM
}
& node (Join-Path $PSScriptRoot 'data-api-warnings.mjs') --check $compilerVersion $output
if ($LASTEXITCODE -ne 0) { throw 'data_api_warning_contract_failed' }
$pg = Get-Content -LiteralPath (Join-Path $output 'data-postgres.json') -Raw | ConvertFrom-Json
$redis = Get-Content -LiteralPath (Join-Path $output 'data-managed-redis.json') -Raw | ConvertFrom-Json
function Resources($Template) {
    if ($Template.resources -is [array]) { return $Template.resources }
    return @($Template.resources.PSObject.Properties | ForEach-Object Value)
}
$p = @(Resources $pg)
$r = @(Resources $redis)
$server = $p | Where-Object type -eq 'Microsoft.DBforPostgreSQL/flexibleServers'
$cluster = $r | Where-Object type -eq 'Microsoft.Cache/redisEnterprise'
$database = $r | Where-Object type -eq 'Microsoft.Cache/redisEnterprise/databases'
$access = $r | Where-Object type -eq 'Microsoft.Cache/redisEnterprise/databases/accessPolicyAssignments'
Require ($server.apiVersion -eq '2026-10-01') 'wrong_pg_api'
Require ($pg.parameters.postgresMajorVersion.defaultValue -eq '18') 'wrong_pg_major'
Require ($pg.parameters.skuName.defaultValue -eq 'Standard_B1ms') 'wrong_pg_sku'
Require ($server.properties.authConfig.activeDirectoryAuth -eq 'Enabled') 'pg_entra_not_enabled'
Require ($server.properties.authConfig.passwordAuth -eq 'Disabled') 'pg_password_enabled'
Require (-not $server.properties.network.PSObject.Properties['publicNetworkAccess']) 'mixed_pg_network_modes'
Require ($cluster.apiVersion -eq '2026-09-01') 'wrong_redis_api'
Require ($redis.parameters.skuName.defaultValue -eq 'Balanced_B0') 'wrong_redis_sku'
Require ($redis.parameters.highAvailability.defaultValue -eq 'Disabled') 'unapproved_cache_ha'
Require ($cluster.properties.publicNetworkAccess -eq 'Disabled') 'redis_public_access_enabled'
Require ($database.properties.accessKeysAuthentication -eq 'Disabled') 'redis_keys_enabled'
Require ($database.properties.clientProtocol -eq 'Encrypted') 'redis_plaintext_enabled'
Require ($redis.parameters.clusteringPolicy.defaultValue -eq 'EnterpriseCluster') 'unapproved_cluster_policy'
Require ($access.properties.accessPolicyName -eq 'default') 'preview_acl_dependency'
Require (-not (@($p + $r) | Where-Object { $_.type -eq 'Microsoft.Cache/Redis' -or $_.type -eq 'Microsoft.Authorization/roleAssignments' })) 'unowned_legacy_or_rbac_resource'
$json = (Get-Content -LiteralPath (Join-Path $output 'data-postgres.json') -Raw) +
        (Get-Content -LiteralPath (Join-Path $output 'data-managed-redis.json') -Raw)
Require ($json -notmatch 'administratorLoginPassword|listKeys\(|accessString|redisVersion') 'unsafe_or_unsupported_data_contract'
'PASS: local data-module contracts. BCP081 type gaps still require later provider validation; no Azure calls.'
'Output: ' + $output
