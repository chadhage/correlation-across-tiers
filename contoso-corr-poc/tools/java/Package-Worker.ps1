param(
  [Parameter(Mandatory)] [string]$ModulePath,
  [Parameter(Mandatory)] [string]$FunctionsAppName,
  [Parameter(Mandatory)] [string]$ServiceName
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($ModulePath.Replace('/', '\') -notin @('workers\fulfillment','workers\notify','workers\aggregator') -or
    $FunctionsAppName -notmatch '^[a-z][a-z0-9-]{1,59}$' -or
    $ServiceName -notin @('contoso-fulfillment-worker','contoso-notify-worker','contoso-order-aggregator')) {
  throw 'Unknown selected SDK-managed Functions packaging contract'
}
$module = Join-Path $root $ModulePath
$expectedRole = switch (Split-Path $ModulePath -Leaf) {
  'fulfillment' { 'contoso-fulfillment-worker' }
  'notify' { 'contoso-notify-worker' }
  'aggregator' { 'contoso-order-aggregator' }
}
if ($ServiceName -ne $expectedRole) { throw 'Mismatched worker module/role' }
$package = Join-Path $module "target\azure-functions\$FunctionsAppName"
if (-not (Test-Path -LiteralPath "$package\host.json")) { throw 'Functions Maven package is missing' }
& (Join-Path $PSScriptRoot 'Gate-02.ps1') -ProjectRoot $root -RequireArtifacts | Out-Null
$agent = & (Join-Path $PSScriptRoot 'Get-Agent.ps1')
New-Item -ItemType Directory -Path "$package\agent" -Force | Out-Null
Copy-Item -LiteralPath $agent -Destination "$package\agent\applicationinsights-agent-3.7.10.jar"
$extension = & (Join-Path $PSScriptRoot 'Get-Extension.ps1')
New-Item -ItemType Directory -Path "$package\agent\extensions" -Force | Out-Null
Copy-Item -LiteralPath $extension -Destination "$package\agent\extensions\$(Split-Path $extension -Leaf)"
Copy-Item -LiteralPath "$root\config\java-agent.json" -Destination "$package\agent\applicationinsights.json"
& (Join-Path $PSScriptRoot 'Write-DeploymentZip.ps1') -SourceDirectory $package -Destination "$module\target\$ServiceName.zip" -Exclude @('local.settings.json')
