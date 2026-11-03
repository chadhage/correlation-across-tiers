param([string]$ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'PortableTools.ps1')
$ToolsRoot = Resolve-ContosoToolsRoot $ToolsRoot
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -Raw (Join-Path $root 'config\versions.lock.json') | ConvertFrom-Json
New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
foreach ($tool in @($lock.portableTools.jdk, $lock.portableTools.maven)) {
    $archive = Join-Path $ToolsRoot $tool.file
    if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $tool.url -OutFile $archive }
    $algorithm = if ($tool.sha256) { 'SHA256' } else { 'SHA512' }
    $expected = if ($tool.sha256) { $tool.sha256 } else { $tool.sha512 }
    Assert-ContosoToolHash $archive $algorithm $expected
    Expand-Archive -LiteralPath $archive -DestinationPath $ToolsRoot -Force
}
. (Join-Path $PSScriptRoot 'Use-Portable.ps1') -ToolsRoot $ToolsRoot
java --version
if ($LASTEXITCODE -ne 0) { throw 'Portable JDK version command failed' }
mvn --version
if ($LASTEXITCODE -ne 0) { throw 'Portable Maven version command failed' }
