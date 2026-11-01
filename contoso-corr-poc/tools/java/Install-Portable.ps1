param([string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4')
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -Raw (Join-Path $root 'config\versions.lock.json') | ConvertFrom-Json
New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
foreach ($tool in @($lock.portableTools.jdk, $lock.portableTools.maven)) {
    $archive = Join-Path $ToolsRoot $tool.file
    if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $tool.url -OutFile $archive }
    $algorithm = if ($tool.sha256) { 'SHA256' } else { 'SHA512' }
    $expected = if ($tool.sha256) { $tool.sha256 } else { $tool.sha512 }
    if ((Get-FileHash -LiteralPath $archive -Algorithm $algorithm).Hash.ToLowerInvariant() -ne $expected) {
        Remove-Item -LiteralPath $archive
        throw 'Portable tool archive integrity failure'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $ToolsRoot -Force
}
. (Join-Path $PSScriptRoot 'Use-Portable.ps1') -ToolsRoot $ToolsRoot
java --version
mvn --version
