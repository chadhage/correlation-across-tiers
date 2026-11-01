param(
  [string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$compiler = Join-Path $ToolsRoot 'bicep.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  throw 'Portable Bicep compiler missing; verify/install locked archive in session tools first'
}
$validation = Join-Path $ToolsRoot 'validation'
New-Item -ItemType Directory -Path $validation -Force | Out-Null
& $compiler build "$root\infra\modules\compute.bicep" --outfile "$validation\compute.json"
if ($LASTEXITCODE -ne 0) { throw 'Compute Bicep compile failed' }
$text = Get-Content -Raw "$root\infra\modules\compute.bicep"
foreach ($forbidden in @('Microsoft.Authorization/roleAssignments', 'ApplicationInsightsAgent_EXTENSION_VERSION', 'FUNCTIONS_WORKER_RUNTIME: ''node''')) {
  if ($text.Contains($forbidden)) { throw "Unexpected compute contract: $forbidden" }
}
if ([regex]::Matches($text,"name: 'P1v3'").Count -ne 1) { throw 'Expected exactly one frozen P1v3 plan' }
Write-Output 'Compute local compilation/static topology PASS; SKU quota, runtime image, RBAC, identities and deployment remain To Do.'
