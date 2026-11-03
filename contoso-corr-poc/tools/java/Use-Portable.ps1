param([string]$ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'PortableTools.ps1')
$ToolsRoot = Resolve-ContosoToolsRoot $ToolsRoot
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
Assert-ContosoToolHash (Join-Path $ToolsRoot $lock.portableTools.jdk.file) SHA256 $lock.portableTools.jdk.sha256
Assert-ContosoToolHash (Join-Path $ToolsRoot $lock.portableTools.maven.file) SHA512 $lock.portableTools.maven.sha512
$jdk = Join-Path $ToolsRoot "jdk-$($lock.portableTools.jdk.version)"
$maven = Join-Path $ToolsRoot "apache-maven-$($lock.portableTools.maven.version)"
if (-not (Test-Path -LiteralPath "$jdk\bin\java.exe") -or -not (Test-Path -LiteralPath "$maven\bin\mvn.cmd")) {
    throw 'Portable JDK/Maven extraction missing. Set CONTOSO_PORTABLE_TOOLS_ROOT or run tools\java\Install-Portable.ps1.'
}
$scratch = Join-Path $root '.java-work'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$env:CONTOSO_PORTABLE_TOOLS_ROOT = $ToolsRoot
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$maven\bin;$env:PATH"
$env:TEMP = $scratch
$env:TMP = $scratch
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=`"$scratch`""
$env:MAVEN_OPTS = "-Dmaven.repo.local=`"$ToolsRoot\m2`" -Djava.io.tmpdir=`"$scratch`""
