$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& (Join-Path $PSScriptRoot 'Gate-02.ps1') -ProjectRoot $root -RequireExtensionEvidence | Out-Null
$lock = Get-Content -Raw "$root\config\versions.lock.json" | ConvertFrom-Json
if (@($lock.extensions).Count -ne 1) { throw 'Exactly one frozen extension is required' }
$extension = $lock.extensions[0]
$jar = Join-Path $root "$($extension.module)\$($extension.file)"
if ((Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $extension.sha256) {
  throw 'GATE-02 extension hash mismatch'
}
Write-Output $jar
