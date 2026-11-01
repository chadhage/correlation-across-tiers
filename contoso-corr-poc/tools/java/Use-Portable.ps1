param([string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4')
$ErrorActionPreference = 'Stop'
$jdk = Get-ChildItem -LiteralPath $ToolsRoot -Directory | Where-Object Name -Like 'jdk-*' | Select-Object -First 1
if (-not $jdk) { throw 'Portable JDK not installed' }
$scratch = Join-Path $ToolsRoot 'scratch'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$env:JAVA_HOME = $jdk.FullName
$env:PATH = "$($jdk.FullName)\bin;$ToolsRoot\apache-maven-3.10.0\bin;$env:PATH"
$env:TEMP = $scratch
$env:TMP = $scratch
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$scratch"
$env:MAVEN_OPTS = "-Dmaven.repo.local=$ToolsRoot\m2 -Djava.io.tmpdir=$scratch"
