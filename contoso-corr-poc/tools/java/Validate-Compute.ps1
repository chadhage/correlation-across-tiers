param(
  [string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$compiler = Join-Path $ToolsRoot 'bicep.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  throw 'Portable Bicep compiler missing; verify/install locked archive in session tools first'
}
$lock = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.portableTools.bicep.sha256) {
  throw 'Compute Bicep compiler integrity failure'
}
$validation = Join-Path $root '.java-work\compute'
New-Item -ItemType Directory -Path $validation -Force | Out-Null
& $compiler build "$root\infra\modules\compute.bicep" --outfile "$validation\compute.json"
if ($LASTEXITCODE -ne 0) { throw 'Compute Bicep compile failed' }
$text = Get-Content -Raw "$root\infra\modules\compute.bicep"
foreach ($forbidden in @('Microsoft.Authorization/roleAssignments', 'FUNCTIONS_WORKER_RUNTIME: ''node''')) {
  if ($text.Contains($forbidden)) { throw "Unexpected compute contract: $forbidden" }
}
if (-not $text.Contains("ApplicationInsightsAgent_EXTENSION_VERSION: 'disabled'") -or
    -not $text.Contains("APPLICATIONINSIGHTS_ENABLE_AGENT: 'false'") -or
    -not $text.Contains("JAVA_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'false'")) {
  throw 'Explicit single-agent deployment must suppress the platform attachment mechanisms'
}
if ([regex]::Matches($text,"name: 'P1v3'").Count -ne 1) { throw 'Expected exactly one frozen P1v3 plan' }
$template = Get-Content -LiteralPath "$validation\compute.json" -Raw | ConvertFrom-Json -Depth 100
$sites = @($template.resources | Where-Object type -eq 'Microsoft.Web/sites')
if ($sites.Count -ne 3) { throw 'Expected the two backend loops and public Portal resource' }
foreach ($site in $sites) {
  $configuration = $site.properties.siteConfig
  if ($configuration.scmIpSecurityRestrictionsDefaultAction -ne 'Deny' -or
      $configuration.scmIpSecurityRestrictionsUseMain -ne $false -or
      $configuration.scmIpSecurityRestrictions -ne "[parameters('scmIpSecurityRestrictions')]") {
    throw 'SCM must deny unmatched requests and use only the separate approved runner rules'
  }
}
foreach ($contract in @(
  @{ loop = 'apis'; rules = 'apiIpSecurityRestrictions' },
  @{ loop = 'workers'; rules = 'workerIpSecurityRestrictions' }
)) {
  $site = @($sites | Where-Object { $_.copy.name -eq $contract.loop })
  if ($site.Count -ne 1 -or $site[0].properties.siteConfig.ipSecurityRestrictionsDefaultAction -ne 'Deny' -or
      $site[0].properties.siteConfig.ipSecurityRestrictions -ne "[parameters('$($contract.rules)')]") {
    throw 'Backend main-site ingress must deny unmatched requests and use the approved rules'
  }
}
foreach ($name in @('apiIpSecurityRestrictions', 'workerIpSecurityRestrictions', 'scmIpSecurityRestrictions')) {
  $parameter = $template.parameters.$name
  if ($parameter.type -ne 'array' -or $null -eq $parameter.defaultValue -or $parameter.defaultValue.Count -ne 0) {
    throw 'Compute ingress must default to an empty allow list'
  }
}
foreach ($name in @('ordersBaseUrl', 'inventoryBaseUrl', 'portalOrigin')) {
  $output = $template.outputs.$name
  if ($output.type -ne 'string' -or $output.value -notmatch 'reference\(resourceId\(.+\.defaultHostName' -or
      $output.value.Contains('azurewebsites.net')) {
    throw 'Compute URLs must derive from the actual resource defaultHostName'
  }
}
if ($text.Contains('CONTOSO_INVENTORY_BASE_URL:')) {
  throw 'Orders Inventory URL must come from the root service settings, not an invented hostname'
}
Write-Output 'Compute local compilation/static topology PASS; SKU quota, runtime image, RBAC, identities and deployment remain To Do.'
