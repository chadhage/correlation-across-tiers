param(
  [string]$Destination,
  [string]$ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'PortableTools.ps1')
$ToolsRoot = Resolve-ContosoToolsRoot $ToolsRoot
if ([string]::IsNullOrWhiteSpace($Destination)) { $Destination = Join-Path $ToolsRoot 'agent' }
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -Raw (Join-Path $root 'config\versions.lock.json') | ConvertFrom-Json
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$jar = Join-Path $Destination $lock.agent.file
if (-not (Test-Path -LiteralPath $jar)) { Invoke-WebRequest -Uri $lock.agent.url -OutFile $jar }
Assert-ContosoToolHash $jar SHA256 $lock.agent.sha256
if ((Get-Item -LiteralPath $jar).Length -ne $lock.agent.bytes) {
    throw 'GATE-02 agent integrity failure'
}
Write-Output $jar
