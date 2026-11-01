param(
  [string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4',
  [switch]$RequireLive
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Portable.ps1') -ToolsRoot $ToolsRoot
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$env:CONTOSO_AGENT_JAR = & (Join-Path $PSScriptRoot 'Get-Agent.ps1')
$env:CONTOSO_PARENT_SAFE_JAR = & (Join-Path $PSScriptRoot 'Get-Extension.ps1')
& mvn -B -q -f "$root\services\correlation-core\pom.xml" test '-Dtest=CorrelationTest,RuntimeGuardTest,SingleAgentExportTest'
if ($LASTEXITCODE -ne 0) { throw 'GATE-05 local span oracle failed' }
Write-Output 'Local one-agent/native-span/parent/link/shutdown qualification PASS; no live certification claimed.'
if ($RequireLive) {
  throw 'VERIFY: deployed hash-pinned parent-safe policy/classloader and vendor support, HTTP/JDBC/Redis/four SDKs, authenticated ingestion, restart and approved SLO remain To Do'
}
