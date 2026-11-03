$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$gate = Join-Path $root 'tools\java\Assert-JavaTestResults.ps1'
$guardHash = (Get-FileHash -LiteralPath $gate -Algorithm SHA256).Hash.ToLowerInvariant()
$run = Join-Path $PSScriptRoot 'cancelled-only-manual'
if (Test-Path -LiteralPath $run) { throw 'Manual run directory already exists' }
$fixture = Join-Path $run 'fixture'
$reports = Join-Path $fixture 'sample\target\surefire-reports'
New-Item -ItemType Directory -Path $reports -Force | Out-Null
$classes = @(
    'com.contoso.correlation.SingleAgentExportTest',
    'com.contoso.inventory.data.DataAgentQualificationTest',
    'com.contoso.orders.NativeApiIntegrationTest',
    'com.contoso.messaging.AsyncNativeAgentTest',
    'com.contoso.messaging.LinkedRootSamplingTest'
)
Set-Content -LiteralPath (Join-Path $fixture 'pom.xml') -Value '<project><modules><module>sample</module></modules></project>' -Encoding utf8NoBOM
foreach ($class in $classes) {
    $parts = $class.Split('.')
    $name = $parts[-1]
    $package = $parts[0..($parts.Length - 2)] -join '.'
    $source = Join-Path $fixture ('sample\src\test\java\' + ($package.Replace('.', '\')))
    New-Item -ItemType Directory -Path $source -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $source "$name.java") -Encoding utf8NoBOM -Value @"
package $package;
class $name {
 @Test @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
 void gate() {}
}
"@
    $cancelled = if ($class -eq $classes[0]) { ' cancelled="true"' } else { '' }
    Set-Content -LiteralPath (Join-Path $reports "TEST-$class.xml") -Encoding utf8NoBOM -Value (
        '<testsuite name="' + $class + '" tests="1" failures="0" errors="0" skipped="0">' +
        '<testcase classname="' + $class + '" name="gate"' + $cancelled + '/></testsuite>')
}
@(Get-ChildItem -LiteralPath $fixture -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($fixture.Length + 1)
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}) | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $run 'fixture-hashes.json') -Encoding utf8NoBOM
$summaryPath = Join-Path $run 'summary.json'
& pwsh -NoProfile -NonInteractive -File $gate -ProjectRoot $fixture -StartedAtUtc ([DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('O')) -SummaryPath $summaryPath 2>&1 |
    Tee-Object -FilePath (Join-Path $run 'actual-output.log')
$exit = $LASTEXITCODE
$summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
if ($exit -ne 1 -or $summary.result -ne 'FAIL' -or
    $summary.totals.tests -ne 5 -or $summary.totals.executed -ne 5 -or
    $summary.totals.passed -ne 4 -or $summary.totals.cancelled -ne 1 -or
    $summary.totals.failures -ne 0 -or $summary.totals.errors -ne 0 -or $summary.totals.skipped -ne 0) {
    throw 'Cancelled-only manual fixture did not fail with exact expected totals'
}
if ((Get-FileHash -LiteralPath $gate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $guardHash) {
    throw 'CI guard changed during manual execution'
}
Remove-Item -LiteralPath $fixture -Recurse
[ordered]@{
    schema = 'contoso.r6-ci-manual-negative.v1'
    reviewerAgent = 'b06c8a34-b521-4a9c-8325-dc58c0119fe1'
    scope = 'SOURCE_UNIT_MANUAL_SYNTHETIC_XML_ONLY'
    guardSha256 = $guardHash
    result = 'EXPECTED_FAILURE_VERIFIED'
    exitCode = $exit
    totals = $summary.totals
    fixtureRemoved = -not (Test-Path -LiteralPath $fixture)
    javaExecuted = $false
    hostedPrExecuted = $false
    nativeAuthority = $false
} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $run 'witness.json') -Encoding utf8NoBOM
'PASS: five synthetic cases -> passed4/cancelled1, exit1/FAIL, no Java/hosted execution.'
