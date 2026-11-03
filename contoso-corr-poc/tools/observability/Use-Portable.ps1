param(
    [Parameter(Mandatory = $true)][string]$ToolsRoot
)
$ErrorActionPreference = 'Stop'
$project = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$cache = Join-Path $project '.cache\r7'
$jdk = Join-Path $ToolsRoot 'jdk-25.0.5+8'
$maven = Join-Path $ToolsRoot 'apache-maven-3.10.0\bin\mvn.cmd'
$sharedRepo = Join-Path $ToolsRoot 'm2'
foreach ($required in @("$jdk\bin\java.exe", "$jdk\bin\javac.exe", $maven, $sharedRepo)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing portable tool/cache: $required" }
}
New-Item -ItemType Directory -Path "$cache\runtime", "$cache\m2" -Force | Out-Null
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$(Split-Path $maven -Parent);$env:PATH"
$env:TEMP = "$cache\runtime"
$env:TMP = "$cache\runtime"
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$cache\runtime"
$env:MAVEN_OPTS = "-Dmaven.repo.local=$cache\m2 -Djava.io.tmpdir=$cache\runtime"
$env:CONTOSO_JAVA_EXE = "$jdk\bin\java.exe"
$env:CONTOSO_JAVAC_EXE = "$jdk\bin\javac.exe"
$env:CONTOSO_JAR_EXE = "$jdk\bin\jar.exe"
$env:CONTOSO_R4_SHARED_M2 = $sharedRepo
$env:CONTOSO_MAVEN_EXE = $maven
$env:CONTOSO_MAVEN_SETTINGS = "$cache\settings.xml"
$repoUri = ([Uri]::new($sharedRepo + '\')).AbsoluteUri
$safeRepo = [Security.SecurityElement]::Escape($repoUri)
$safeLocal = [Security.SecurityElement]::Escape("$cache\m2")
$settings = @"
<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0">
  <localRepository>$safeLocal</localRepository>
  <profiles><profile><id>contoso-r4-read-cache</id>
    <repositories><repository><id>contoso-r4-cache</id><url>$safeRepo</url></repository></repositories>
    <pluginRepositories><pluginRepository><id>contoso-r4-plugins</id><url>$safeRepo</url></pluginRepository></pluginRepositories>
  </profile></profiles>
  <activeProfiles><activeProfile>contoso-r4-read-cache</activeProfile></activeProfiles>
</settings>
"@
Set-Content -LiteralPath $env:CONTOSO_MAVEN_SETTINGS -Value $settings -Encoding utf8
