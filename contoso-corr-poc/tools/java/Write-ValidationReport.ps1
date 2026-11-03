param(
  [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [Parameter(Mandatory)] [string]$BuildStartedAtUtc,
  [Parameter(Mandatory)] [string]$ApiReceiptPath
)
$ErrorActionPreference = 'Stop'
if ($BuildStartedAtUtc -notmatch 'T.*(?:Z|[+-]\d\d:\d\d)$') { throw 'Build start must preserve its explicit ISO UTC/offset timezone' }
$started = [DateTimeOffset]::Parse($BuildStartedAtUtc).UtcDateTime
[xml]$reactor = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'pom.xml')
$modules = @()
foreach ($entry in $reactor.SelectNodes("/*[local-name()='project']/*[local-name()='modules']/*[local-name()='module']")) {
  $path = Join-Path $ProjectRoot $entry.InnerText.Replace('/', '\')
  [xml]$pom = Get-Content -Raw -LiteralPath (Join-Path $path 'pom.xml')
  $artifact = $pom.SelectSingleNode("/*[local-name()='project']/*[local-name()='artifactId']").InnerText
  $versionNode = $pom.SelectSingleNode("/*[local-name()='project']/*[local-name()='version']")
  $version = if ($versionNode) { $versionNode.InnerText } else { '1.0.0' }
  $jar = Join-Path $path "target\$artifact-$version.jar"
  if (-not (Test-Path -LiteralPath $jar)) { throw "Missing real reactor artifact: $artifact" }
  $directory = Join-Path $path 'target\surefire-reports'
  $reports = @(Get-ChildItem -LiteralPath $directory -Filter 'TEST-*.xml')
  if (-not $reports.Count) { throw "No current tests for declared module: $artifact" }
  $tests = 0; $failed = 0; $skipped = 0
  foreach ($file in $reports) {
    if ($file.LastWriteTimeUtc -lt $started.AddSeconds(-2)) { throw "Stale test output: $($file.FullName)" }
    [xml]$result = Get-Content -Raw -LiteralPath $file.FullName
    $tests += [int]$result.testsuite.tests
    $failed += [int]$result.testsuite.failures + [int]$result.testsuite.errors
    $skipped += [int]$result.testsuite.skipped
  }
  if ($failed -or $skipped) { throw "Incomplete current qualification: $artifact ($failed failures, $skipped skipped)" }
  $modules += [ordered]@{
    module=$entry.InnerText; artifactId=$artifact; tests=$tests; failed=$failed; skipped=$skipped
    artifactSha256=(Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant()
    pomSha256=(Get-FileHash -LiteralPath (Join-Path $path 'pom.xml') -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$lock = Join-Path $ProjectRoot 'config\versions.lock.json'
$inventory = Get-Content -Raw -LiteralPath $lock | ConvertFrom-Json
$directory = Join-Path $ProjectRoot 'evidence\java-local'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$report = [ordered]@{
  schema='contoso.java-module-observations.v2'; generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  observationCutoffUtc=$BuildStartedAtUtc; result='OBSERVED_PASSING_TEST_OUTPUTS'; certified=$false
  sourceKind='local-module-files-with-separate-selected-native-receipts'; deployedQualification=$false
  fullReactorExecutionVerified=$false; commonSourceBuildEpochVerified=$false
  scope='Passing module files since the supplied cutoff; files can come from different executions. This reader does not establish a fresh full-reactor run or a shared source/test/artifact epoch.'
  lockSha256=(Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLowerInvariant()
  moduleCount=$modules.Count; modules=$modules
  expectedLiveRequirements=@(
    'Actual App Service/Functions vendor, JDK patch, image, host/worker version and per-instance native roster',
    'Azure Entra/Key Vault/managed identity/RBAC/private ingress and PostgreSQL/Managed Redis access',
    'Four deployed SDK transports, settlement/replay/fan-in/batch and independently observed business effects',
    'Authenticated Azure ingestion, exact one-provider/export ownership and native links for every participant',
    'Finite sampling restart/watchdog/restore, overhead/SLO and governance owner approvals',
    'Direct business attribute on automatic HTTP client spans; preview inheritance remains excluded'
  )
}
$probePath = Join-Path $ProjectRoot $inventory.extensions[0].probeReport
if (-not (Test-Path -LiteralPath $probePath)) { throw 'Current native sampler qualification missing' }
$probe = Get-Content -Raw -LiteralPath $probePath | ConvertFrom-Json
if ($probe.result -ne 'PASS' -or $probe.extensionSha256 -ne $inventory.extensions[0].sha256) {
  throw 'Stale or failed native sampler qualification'
}
$report.parentSafeExtension = [ordered]@{
  result=$probe.result; sha256=$probe.extensionSha256; sdkAbi=$probe.sdkAbi
  nativeSpanCounts=@($probe.phases | ForEach-Object { $_.nativeSpanCount })
  scope='Contoso-owned local pinned-agent qualification only; not Azure or vendor support certification'
}
$api = (Resolve-Path -LiteralPath $ApiReceiptPath).Path
$apiRoot = [IO.Path]::GetFullPath((Join-Path $directory 'native-api')) + [IO.Path]::DirectorySeparatorChar
if (-not $api.StartsWith($apiRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path $api -Leaf) -ne 'receipts.json' -or
    (Get-Item -LiteralPath $api).LastWriteTimeUtc -lt $started.AddSeconds(-2)) {
  throw 'Current execution-specific API receipt required; historical fixed paths are not accepted'
}
$apiReceipt = Get-Content -LiteralPath $api -Raw | ConvertFrom-Json -Depth 100
$epoch = Split-Path (Split-Path $api -Parent) -Leaf
if ($apiReceipt.schema -ne 'contoso.real-api-native-receipts.v1' -or
    $apiReceipt.executionId -ne $epoch -or
    $apiReceipt.certificationEligible -ne $false -or
    $apiReceipt.originalPrivacyCapture.schema -ne 'contoso.native-api-safe-capture.v1' -or
    $apiReceipt.originalPrivacyCapture.validatorPid -le 0 -or
    @($apiReceipt.originalPrivacyCapture.payloadReceipts).Count -eq 0) {
  throw 'Current native API capture identity/privacy binding missing'
}
foreach ($payload in $apiReceipt.originalPrivacyCapture.payloadReceipts) {
  if ($payload.scannedAllOriginalValues -ne $true -or $payload.projectedAfterScan -ne $true -or
      $payload.strictDuplicateKeysVerified -ne $true -or
      $payload.originalPayloadRetained -ne $false -or $payload.originalEnvelopeCount -le 0 -or
      $payload.originalPayloadSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'Original-before-projection API privacy receipt missing'
  }
}
$capture = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $apiReceipt.capturePath))
if ($capture -ne (Join-Path (Split-Path $api -Parent) 'capture.json') -or
    (Get-FileHash -LiteralPath $capture -Algorithm SHA256).Hash.ToLowerInvariant() -ne $apiReceipt.captureSha256) {
  throw 'Actual native API capture file/hash does not match the selected execution'
}
$captureRecord = Get-Content -LiteralPath $capture -Raw | ConvertFrom-Json -Depth 100
if ($captureRecord.executionId -ne $epoch -or $captureRecord.schema -ne 'contoso.native-api-capture.v1') {
  throw 'Actual native API capture execution identity mismatch'
}
$report.apiReceiptPath = [IO.Path]::GetRelativePath($ProjectRoot, $api)
$report.apiReceiptSha256=(Get-FileHash -LiteralPath $api -Algorithm SHA256).Hash.ToLowerInvariant()
$report.apiCaptureSha256=$apiReceipt.captureSha256
$total = 0
foreach ($module in $modules) { $total += [int]$module.tests }
$report.totalTests = $total
$output = Join-Path (Split-Path $api -Parent) 'validation.json'
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 10))
$stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $stream.Write($bytes) } finally { $stream.Dispose() }
"Observed module files since cutoff: $($modules.Count) modules, $total tests, no skips. No full-reactor execution or shared build epoch verified. NOT CERTIFIED."
"Validation report: $output"
