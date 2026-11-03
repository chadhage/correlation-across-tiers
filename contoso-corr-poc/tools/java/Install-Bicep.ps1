param([string]$ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'PortableTools.ps1')
$ToolsRoot = Resolve-ContosoToolsRoot $ToolsRoot
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -Raw "$root\config\versions.lock.json" | ConvertFrom-Json
$compiler = Join-Path $ToolsRoot $lock.portableTools.bicep.file
New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $compiler)) { Invoke-WebRequest -Uri $lock.portableTools.bicep.url -OutFile $compiler }
Assert-ContosoToolHash $compiler SHA256 $lock.portableTools.bicep.sha256
& $compiler --version
if ($LASTEXITCODE -ne 0) { throw 'Portable Bicep compiler failed' }
