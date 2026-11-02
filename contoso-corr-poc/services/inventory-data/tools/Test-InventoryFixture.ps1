param(
    [string]$ToolsRoot = 'C:\Users\chhage\.copilot\session-state\a2820816-7000-4e63-9cf2-cd2c8da2162f\files\tools\r4',
    [switch]$RetryReproductionOnly
)
$ErrorActionPreference = 'Stop'
$module = Split-Path $PSScriptRoot -Parent
$project = Split-Path (Split-Path $module -Parent) -Parent
$jdk = Get-ChildItem -LiteralPath $ToolsRoot -Directory | Where-Object Name -Like 'jdk-*' | Select-Object -First 1
$maven = Join-Path $ToolsRoot 'apache-maven-3.10.0\bin\mvn.cmd'
$repository = Join-Path $ToolsRoot 'm2'
if (-not $jdk -or -not (Test-Path -LiteralPath $maven) -or -not (Test-Path -LiteralPath $repository)) {
    throw 'Existing portable JDK25, Maven3.10 and populated offline repository required; this runner installs nothing.'
}
$run = Join-Path $PSScriptRoot ('.java-work\dat-01.1-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run | Out-Null

function Get-Inputs {
    $files = @('src','tools') | ForEach-Object {
        Get-ChildItem -LiteralPath (Join-Path $module $_) -Recurse -File |
            Where-Object { $_.FullName -notlike '*\.java-work\*' }
    }
    $rows = @($files | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($module.Length + 1)
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    $lines = @($rows | ForEach-Object { '{0}  {1}' -f $_.sha256,$_.path })
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n") + "`n")
    [ordered]@{
        count = $rows.Count
        sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
        files = $rows
    }
}

function Get-BuildInputs {
    $paths = [ordered]@{
        modulePom = (Join-Path $module 'pom.xml')
        parentPom = (Join-Path $project 'pom.xml')
        installedCore = (Join-Path $repository 'com\contoso\contoso-correlation-core\1.0.0\contoso-correlation-core-1.0.0.jar')
        installedSecurity = (Join-Path $repository 'com\contoso\security-core\1.0.0\security-core-1.0.0.jar')
        java = (Join-Path $jdk.FullName 'bin\java.exe')
        javac = (Join-Path $jdk.FullName 'bin\javac.exe')
        maven = $maven
    }
    $result = [ordered]@{}
    foreach ($entry in $paths.GetEnumerator()) {
        $result[$entry.Key] = (Get-FileHash -LiteralPath $entry.Value -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $result
}

$before = Get-Inputs
$buildBefore = Get-BuildInputs
[xml]$pom = Get-Content -LiteralPath (Join-Path $module 'pom.xml') -Raw
$ns = $pom.DocumentElement.NamespaceURI
$pom.project.parent.relativePath = [IO.Path]::GetRelativePath($run, (Join-Path $project 'pom.xml'))
$build = $pom.CreateElement('build', $ns)
foreach ($entry in @{
    directory = (Join-Path $run 'build')
    sourceDirectory = (Join-Path $module 'src\main\java')
    testSourceDirectory = (Join-Path $module 'src\test\java')
}.GetEnumerator()) {
    $node = $pom.CreateElement($entry.Key, $ns)
    $node.InnerText = $entry.Value
    [void]$build.AppendChild($node)
}
foreach ($resource in @(
    @{ group = 'resources'; element = 'resource'; path = 'src\main\resources' },
    @{ group = 'testResources'; element = 'testResource'; path = 'src\test\resources' }
)) {
    $group = $pom.CreateElement($resource.group, $ns)
    $element = $pom.CreateElement($resource.element, $ns)
    $directory = $pom.CreateElement('directory', $ns)
    $directory.InnerText = Join-Path $module $resource.path
    [void]$element.AppendChild($directory)
    [void]$group.AppendChild($element)
    [void]$build.AppendChild($group)
}
[void]$pom.DocumentElement.AppendChild($build)
$pomPath = Join-Path $run 'pom.xml'
$pom.Save($pomPath)

$env:JAVA_HOME = $jdk.FullName
$env:PATH = "$($jdk.FullName)\bin;$env:PATH"
$env:TEMP = $run
$env:TMP = $run
$env:JAVA_TOOL_OPTIONS = "-Djava.io.tmpdir=$run"
$env:MAVEN_OPTS = "-Dmaven.repo.local=$repository -Djava.io.tmpdir=$run"
$env:CONTOSO_AGENT_JAR = ''
$env:CONTOSO_PARENT_SAFE_JAR = ''
$selectors = 'InventoryFixtureRunTest,InventoryFixtureStdioTest,InventoryDataTest,RedisDataTest,DataSafetyTest,InventoryGrantMarkerTest,RedisCredentialsLifecycleTest'
$expectedSuites = 7
if ($RetryReproductionOnly) {
    $selectors = 'InventoryFixtureRunTest#cacheRestoreFailureBeforeMutationRetainsReservationDerivedStateForRetry'
    $expectedSuites = 1
}
$started = [DateTime]::UtcNow.ToString('O')
& $maven -o -B -ntp -f $pomPath test "-Dtest=$selectors" 2>&1 |
    Tee-Object -FilePath (Join-Path $run 'maven.log')
$exit = $LASTEXITCODE
$after = Get-Inputs
$buildAfter = Get-BuildInputs
$counts = [ordered]@{ tests = 0; failures = 0; errors = 0; skipped = 0 }
$suites = @()
$reports = Join-Path $run 'build\surefire-reports'
if (Test-Path -LiteralPath $reports) {
    $suites = @(Get-ChildItem -LiteralPath $reports -Filter 'TEST-*.xml' | ForEach-Object {
        [xml]$report = Get-Content -LiteralPath $_.FullName -Raw
        foreach ($key in @('tests','failures','errors','skipped')) { $counts[$key] += [int]$report.testsuite.GetAttribute($key) }
        $report.testsuite.GetAttribute('name')
    })
}
$result = [ordered]@{
    schema = 'contoso.inventory-fixture-local-validation.v1'
    startedAtUtc = $started
    completedAtUtc = [DateTime]::UtcNow.ToString('O')
    scope = 'construction-only-offline-module'
    nativeExecution = $false
    azureExecution = $false
    reactorOrSharedTargetWritten = $false
    command = "mvn -o -B -ntp -f <unique-module-local-pom> test -Dtest=$selectors"
    exitCode = $exit
    counts = $counts
    suites = $suites
    inputsBefore = $before
    inputsAfter = $after
    buildInputsBefore = $buildBefore
    buildInputsAfter = $buildAfter
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'validation.json') -Encoding utf8
'Validation: ' + (Join-Path $run 'validation.json')
if ($exit -ne 0 -or $before.sha256 -ne $after.sha256 -or
    ($buildBefore | ConvertTo-Json -Compress) -ne ($buildAfter | ConvertTo-Json -Compress) -or $suites.Count -ne $expectedSuites -or
    $counts.tests -eq 0 -or $counts.failures -ne 0 -or $counts.errors -ne 0 -or $counts.skipped -ne 0) {
    throw 'Offline fixture validation failed or source inputs changed; inspect this run only.'
}
