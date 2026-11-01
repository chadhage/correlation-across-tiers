param([string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4')
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -Raw "$root\config\versions.lock.json" | ConvertFrom-Json
$compiler = Join-Path $ToolsRoot $lock.portableTools.bicep.file
New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $compiler)) { Invoke-WebRequest -Uri $lock.portableTools.bicep.url -OutFile $compiler }
if ((Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.portableTools.bicep.sha256) {
  Remove-Item -LiteralPath $compiler
  throw 'Bicep compiler integrity failure'
}
& $compiler --version
if ($LASTEXITCODE -ne 0) { throw 'Portable Bicep compiler failed' }
