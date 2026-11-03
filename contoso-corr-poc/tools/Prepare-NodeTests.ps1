param([string]$ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'java\Use-Portable.ps1') -ToolsRoot $ToolsRoot

Push-Location $root
try {
    mvn -B -ntp -pl :contoso-parent-safe-sampler -am -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw 'NODE_TEST_SAMPLER_BUILD_FAILED' }
    & (Join-Path $PSScriptRoot 'java\Get-Extension.ps1') | Out-Null

    $portal = Join-Path $root 'web\portal-ssr'
    $lock = Join-Path $portal 'package-lock.json'
    $before = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
    npm --prefix $portal ci --workspaces=false --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'NODE_TEST_PORTAL_DEPENDENCIES_FAILED' }
    if ((Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash -ne $before) {
        throw 'NODE_TEST_PORTAL_LOCKFILE_CHANGED'
    }
    npm --prefix $portal run compile --workspaces=false
    if ($LASTEXITCODE -ne 0) { throw 'NODE_TEST_PORTAL_COMPILE_FAILED' }
    Write-Output 'NODE_TEST_BUILD_INPUTS_READY_NOT_CERTIFIED; Java tests were not executed.'
}
finally {
    Pop-Location
}
