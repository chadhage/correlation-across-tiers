param(
    [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [Parameter(Mandatory)][datetimeoffset]$StartedAtUtc,
    [string]$SummaryPath
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$requiredClasses = @(
    'com.contoso.correlation.SingleAgentExportTest',
    'com.contoso.inventory.data.DataAgentQualificationTest',
    'com.contoso.orders.NativeApiIntegrationTest',
    'com.contoso.messaging.AsyncNativeAgentTest',
    'com.contoso.messaging.LinkedRootSamplingTest'
)
$issues = [Collections.Generic.List[string]]::new()
$executed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$required = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$foundClasses = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$totals = [ordered]@{ tests = 0; executed = 0; passed = 0; failures = 0; errors = 0; skipped = 0; cancelled = 0; reports = 0 }

function Read-SafeXml([string]$File) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($File, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose() }
}
function Count-Attribute($Suite, [string]$Name) {
    $count = 0
    if (-not [int]::TryParse($Suite.GetAttribute($Name), [ref]$count) -or $count -lt 0) {
        throw "JAVA_TEST_COUNT_INVALID:$Name"
    }
    return $count
}

$reactor = Read-SafeXml (Join-Path $ProjectRoot 'pom.xml')
$modules = @($reactor.SelectNodes("/*[local-name()='project']/*[local-name()='modules']/*[local-name()='module']"))
if (-not $modules.Count) { throw 'JAVA_REACTOR_MODULES_MISSING' }
foreach ($module in $modules) {
    $directory = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $module.InnerText.Replace('/', '\')))
    if (-not $directory.StartsWith("$ProjectRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'JAVA_REACTOR_MODULE_ESCAPES_ROOT'
    }
    $testSources = Join-Path $directory 'src\test\java'
    if (Test-Path -LiteralPath $testSources) {
        foreach ($file in Get-ChildItem -LiteralPath $testSources -Recurse -Filter *.java -File) {
            $source = Get-Content -LiteralPath $file.FullName -Raw
            if ($source -notmatch 'EnabledIfEnvironmentVariable\s*\(\s*named\s*=\s*"CONTOSO_(AGENT_JAR|PARENT_SAFE_JAR)"') { continue }
            $package = [regex]::Match($source, '(?m)^\s*package\s+([\w.]+)\s*;').Groups[1].Value
            $class = "$package.$($file.BaseName)"
            [void]$foundClasses.Add($class)
            $methods = [regex]::Matches($source, '(?s)@Test\b(?:(?!@Test).)*?\bvoid\s+(\w+)\s*\(')
            if (-not $methods.Count) { $issues.Add("JAVA_AGENT_SOURCE_HAS_NO_TESTS:$class") }
            foreach ($method in $methods) {
                [void]$required.Add("$class#$($method.Groups[1].Value)")
            }
        }
    }
    $reports = Join-Path $directory 'target\surefire-reports'
    if (-not (Test-Path -LiteralPath $reports)) {
        $issues.Add("JAVA_MODULE_REPORTS_MISSING:$($module.InnerText)")
        continue
    }
    $files = @(Get-ChildItem -LiteralPath $reports -Filter TEST-*.xml -File)
    if (-not $files.Count) { $issues.Add("JAVA_MODULE_REPORTS_MISSING:$($module.InnerText)") }
    foreach ($file in $files) {
        if ($file.LastWriteTimeUtc -lt $StartedAtUtc.UtcDateTime) { $issues.Add("JAVA_TEST_REPORT_STALE:$($file.Name)") }
        $document = Read-SafeXml $file.FullName
        $suite = $document.DocumentElement
        if ($suite.get_Name() -ne 'testsuite') { throw 'JAVA_TEST_SUITE_INVALID' }
        $cases = @($suite.SelectNodes('testcase'))
        $tests = Count-Attribute $suite 'tests'
        $failures = Count-Attribute $suite 'failures'
        $errors = Count-Attribute $suite 'errors'
        $skipped = Count-Attribute $suite 'skipped'
        if ($cases.Count -ne $tests -or $suite.SelectNodes('testcase/failure').Count -ne $failures -or
            $suite.SelectNodes('testcase/error').Count -ne $errors -or $suite.SelectNodes('testcase/skipped').Count -ne $skipped) {
            $issues.Add("JAVA_TEST_COUNTS_INCOMPLETE:$($file.Name)")
        }
        $totals.tests += $tests
        $totals.failures += $failures
        $totals.errors += $errors
        $totals.skipped += $skipped
        $totals.passed += $tests - $failures - $errors - $skipped
        $totals.reports++
        foreach ($case in $cases) {
            $identity = "$($case.GetAttribute('classname'))#$($case.GetAttribute('name'))"
            if (-not $executed.Add($identity)) { $issues.Add('JAVA_TEST_IDENTITY_DUPLICATED') }
            if ($case.GetAttribute('cancelled') -eq 'true' -or
                @($case.SelectNodes('error|skipped') | Where-Object { $_.GetAttribute('type') -match 'Abort|Cancel' }).Count) {
                $totals.cancelled++
                if (-not $case.SelectNodes('failure|error|skipped').Count) { $totals.passed-- }
            }
        }
    }
}
foreach ($class in $requiredClasses) {
    if (-not $foundClasses.Contains($class)) { $issues.Add("JAVA_REQUIRED_AGENT_SOURCE_MISSING:$class") }
}
if (-not $required.Count) { $issues.Add('JAVA_REQUIRED_AGENT_TESTS_MISSING') }
foreach ($identity in $required) {
    if (-not $executed.Contains($identity)) { $issues.Add("JAVA_REQUIRED_AGENT_TEST_NOT_EXECUTED:$identity") }
}
if ($totals.tests -lt 1 -or $totals.failures -or $totals.errors -or $totals.skipped -or $totals.cancelled) {
    $issues.Add('JAVA_TESTS_FAILED_SKIPPED_OR_CANCELLED')
}
$totals.executed = $totals.tests - $totals.skipped
$summary = [ordered]@{
    schema = 'contoso.java-ci-results.v1'; sourceAcceptanceIsCertification = $false
    startedAtUtc = $StartedAtUtc.ToUniversalTime().ToString('o')
    totals = $totals; requiredAgentTests = $required.Count
    result = $(if ($issues.Count) { 'FAIL' } else { 'PASS_SOURCE_UNIT_ONLY' })
    issues = $issues.ToArray()
}
Write-Output ("JAVA_TEST_TOTALS " + ($totals | ConvertTo-Json -Compress))
Write-Output "JAVA_REQUIRED_AGENT_TESTS $($required.Count)"
if ($SummaryPath) {
    $destination = [IO.Path]::GetFullPath($SummaryPath)
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $destination
}
if ($issues.Count) { throw ($issues -join "`n") }
