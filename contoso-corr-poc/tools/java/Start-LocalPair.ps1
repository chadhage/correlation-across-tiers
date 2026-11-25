[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [ValidateRange(180, 1800)] [int] $DurationSeconds = 600,
    [switch] $DebugJava,
    [switch] $RunBrowser,
    [switch] $Present,
    [switch] $RestoreDependencies,
    [string] $MavenRepository,
    [string] $ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT
)
$ErrorActionPreference = 'Stop'
if ($Present -and -not $RunBrowser) { throw 'LOCAL_PAIR_PRESENT_REQUIRES_BROWSER' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'Use-Portable.ps1') -ToolsRoot $ToolsRoot
$output = if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) }
    else { [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory)) }
$relative = [IO.Path]::GetRelativePath($root, $output)
if ($relative -eq '.' -or $relative -eq '..' -or $relative.StartsWith('..\') -or [IO.Path]::IsPathRooted($relative)) {
    throw 'LOCAL_PAIR_NEW_REPOSITORY_DIRECTORY_REQUIRED'
}
if (Test-Path -LiteralPath $output) { throw 'LOCAL_PAIR_OUTPUT_ALREADY_EXISTS' }
$lock = Get-Content -Raw -LiteralPath (Join-Path $root 'config\versions.lock.json') | ConvertFrom-Json
$agent = Join-Path $env:CONTOSO_PORTABLE_TOOLS_ROOT "agent\$($lock.agent.file)"
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) {
    throw 'LOCAL_PAIR_AGENT_MISSING: run tools\java\Get-Agent.ps1 after approving the missing dependency restore.'
}
Push-Location $root
try {
    $buildStart = [DateTime]::UtcNow
    if ($MavenRepository) {
        $repository = [IO.Path]::GetFullPath($MavenRepository)
        $env:MAVEN_OPTS = "-Dmaven.repo.local=`"$repository`" -Djava.io.tmpdir=`"$env:TEMP`""
    }
    $mavenArguments = @('-B', '-ntp', '-pl', 'services\inventory-api,services\orders-api,extensions\parent-safe-sampler',
        '-am', 'package', '-Dtest=OrdersApiTest,InventoryApiTest,InventoryHttpClientTest,LocalPairIngressFilterTest',
        '-Dsurefire.failIfNoSpecifiedTests=false')
    if (-not $RestoreDependencies) { $mavenArguments = @('-o') + $mavenArguments }
    & mvn @mavenArguments
    if ($LASTEXITCODE -ne 0) { throw 'LOCAL_PAIR_BUILD_FAILED' }
    $report = Join-Path $root 'services\orders-api\target\surefire-reports\TEST-com.contoso.orders.LocalPairIngressFilterTest.xml'
    if (-not (Test-Path -LiteralPath $report) -or (Get-Item -LiteralPath $report).LastWriteTimeUtc -lt $buildStart) {
        throw 'LOCAL_PAIR_FRESH_CLASSPATH_REQUIRED'
    }
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($report, $settings)
    try { $xml = [Xml.XmlDocument]::new(); $xml.Load($reader) } finally { $reader.Dispose() }
    if ($xml.testsuite.failures -ne '0' -or $xml.testsuite.errors -ne '0' -or $xml.testsuite.skipped -ne '0') {
        throw 'LOCAL_PAIR_BUILD_TESTS_FAILED'
    }
    $property = @($xml.testsuite.properties.property | Where-Object name -EQ 'surefire.test.class.path')
    if ($property.Count -ne 1 -or [string]::IsNullOrWhiteSpace($property[0].value)) {
        throw 'LOCAL_PAIR_FRESH_CLASSPATH_REQUIRED'
    }
    $env:CONTOSO_LOCAL_PAIR_CLASSPATH = $property[0].value
    $env:CONTOSO_AGENT_JAR = $agent
    $arguments = @((Join-Path $PSScriptRoot 'local-pair.mjs'), '--out', $output, '--duration', "$DurationSeconds")
    if ($DebugJava) { $arguments += '--debug-java' }
    if ($RunBrowser) { $arguments += '--run-browser' }
    if ($Present) { $arguments += '--present' }
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw 'LOCAL_PAIR_FAILED' }
} finally {
    Remove-Item Env:\CONTOSO_LOCAL_PAIR_CLASSPATH -ErrorAction SilentlyContinue
    Pop-Location
}
