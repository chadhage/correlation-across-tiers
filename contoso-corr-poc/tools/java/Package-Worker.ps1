param(
  [Parameter(Mandatory)] [string]$ModulePath,
  [Parameter(Mandatory)] [string]$FunctionsAppName,
  [Parameter(Mandatory)] [string]$ServiceName
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$module = Join-Path $root $ModulePath
$package = Join-Path $module "target\azure-functions\$FunctionsAppName"
if (-not (Test-Path -LiteralPath "$package\host.json")) { throw 'Functions Maven package is missing' }
$agent = & (Join-Path $PSScriptRoot 'Get-Agent.ps1')
New-Item -ItemType Directory -Path "$package\agent" -Force | Out-Null
Copy-Item -LiteralPath $agent -Destination "$package\agent\applicationinsights-agent-3.7.10.jar"
$extension = & (Join-Path $PSScriptRoot 'Get-Extension.ps1')
New-Item -ItemType Directory -Path "$package\agent\extensions" -Force | Out-Null
Copy-Item -LiteralPath $extension -Destination "$package\agent\extensions\contoso-parent-safe-sampler-1.0.0.jar"
Copy-Item -LiteralPath "$root\config\java-agent.json" -Destination "$package\agent\applicationinsights.json"
Compress-Archive -Path "$package\*" -DestinationPath "$module\target\$ServiceName.zip" -Force
