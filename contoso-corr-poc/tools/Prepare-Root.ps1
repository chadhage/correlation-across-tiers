[CmdletBinding()]
param(
    [string] $BicepPath = $env:CONTOSO_BICEP_PATH,
    [string] $InputsPath
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $BicepPath) { throw 'Set CONTOSO_BICEP_PATH to the existing frozen Bicep executable; no install is performed.' }
$lock = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
$expected = $lock.portableTools.bicep
if ((Get-FileHash -LiteralPath $BicepPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.sha256) {
    throw 'Bicep binary does not match the frozen version lock.'
}
$version = & $BicepPath --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch [regex]::Escape("Bicep CLI version $($expected.version) ")) { throw 'Pinned Bicep version required.' }
$output = Join-Path $root '.cache\acting-r1'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$compiled = & $BicepPath build (Join-Path $root 'infra\main.bicep') --stdout
if ($LASTEXITCODE -ne 0) { throw 'Root Bicep compilation failed.' }
($compiled -join "`n") | Set-Content -LiteralPath (Join-Path $output 'main.json') -Encoding utf8
$parameters = & $BicepPath build-params (Join-Path $root 'infra\params\poc.bicepparam') --stdout
if ($LASTEXITCODE -ne 0) { throw 'Root parameter compilation failed.' }
($parameters -join "`n") | Set-Content -LiteralPath (Join-Path $output 'foundation-parameters.json') -Encoding utf8
if ($InputsPath) {
    & node (Join-Path $root 'tools\root-preflight.mjs') --input ([IO.Path]::GetFullPath($InputsPath))
    if ($LASTEXITCODE -ne 0) { throw 'Root input preflight failed closed.' }
    $approved = & node (Join-Path $root 'tools\root-preflight.mjs') --input ([IO.Path]::GetFullPath($InputsPath)) --parameters
    if ($LASTEXITCODE -ne 0) { throw 'Approved input parameter rendering failed.' }
    ($approved -join "`n") | Set-Content -LiteralPath (Join-Path $output 'approved-parameters.json') -Encoding utf8
}
'Root templates compiled locally. No Azure command, grant, secret operation or deployment was executed.'
