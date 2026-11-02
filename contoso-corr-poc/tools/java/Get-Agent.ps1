param([string]$Destination = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4\agent')
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -Raw (Join-Path $root 'config\versions.lock.json') | ConvertFrom-Json
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$jar = Join-Path $Destination $lock.agent.file
if (-not (Test-Path -LiteralPath $jar)) { Invoke-WebRequest -Uri $lock.agent.url -OutFile $jar }
if ((Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.agent.sha256 -or
    (Get-Item -LiteralPath $jar).Length -ne $lock.agent.bytes) {
    throw 'GATE-02 agent integrity failure'
}
Write-Output $jar
