param([string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$ErrorActionPreference = 'Stop'
function Tests([string]$Directory) {
  $count = 0; $failed = 0; $skipped = 0
  foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter 'TEST-*.xml') {
    [xml]$report = Get-Content -Raw -LiteralPath $file.FullName
    $count += [int]$report.testsuite.tests
    $failed += [int]$report.testsuite.failures + [int]$report.testsuite.errors
    $skipped += [int]$report.testsuite.skipped
  }
  return @{ tests=$count; failed=$failed; skipped=$skipped }
}
$core = Tests "$ProjectRoot\services\correlation-core\target\surefire-reports"
$http = Tests "$ProjectRoot\tests\java\construction\target\surefire-reports"
$data = Tests "$ProjectRoot\services\inventory-data\target\surefire-reports"
$lock = Join-Path $ProjectRoot 'config\versions.lock.json'
$directory = Join-Path $ProjectRoot 'evidence\java-local'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$report = @{
  schemaVersion=1; generatedAt=[DateTime]::UtcNow.ToString('o'); certified=$false
  lockSha256=(Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLowerInvariant()
  coreQualification=$core
  httpConstructionOnly=$http
  actualDataQualification=$data
  httpConstructionScope='Real R6 inventory-data library. Frozen R8/R5 API headers only for unavailable identity/workflow modules; no production implementation is supplied by those headers. Never install/deploy the construction fixture.'
  integratedApplications=@{status='To Do';reason='Requires actual R8 security-core/R5 messaging-core libraries, full reactor/package tests and cross-reviews; construction checks are not their replacement.'}
  liveAcceptance=@(
    'To Do: deployed hash-pinned parent-safe policy/classloader; vendor support open (Contoso local probe passed)',
    'To Do: exact App Service/Functions image, one attach and effective suppression',
    'To Do: actual JWT/gateway/Portal policy and SDK-managed delivery/settlement',
    'To Do: PostgreSQL/Redis CLIENT execution, token renewal and privacy',
    'To Do: authenticated Azure ingestion/native links, graceful restart/redeploy/SLO',
    'To Do: directory/RBAC/region/SKU/cost/quota/provisioning approval'
  )
}
$extensionEvidence = Join-Path $ProjectRoot 'extensions\parent-safe-sampler\target\agent-probe\result.json'
if (Test-Path -LiteralPath $extensionEvidence) {
  $probe = Get-Content -Raw -LiteralPath $extensionEvidence | ConvertFrom-Json
  $report.parentSafeExtension = @{
    result=$probe.result; sha256=$probe.extensionSha256; sdkAbi=$probe.sdkAbi
    nativeSpanCounts=@($probe.phases | ForEach-Object { $_.nativeSpanCount })
    scope='Contoso-owned local pinned-agent qualification; not vendor guarantee or live Azure certification'
  }
}
[IO.File]::WriteAllText((Join-Path $directory 'validation.json'), ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
if ($core.failed -ne 0 -or $http.failed -ne 0 -or $data.failed -ne 0) { throw 'Local qualification tests failed' }
Write-Output "Persisted local qualification report: core $($core.tests) tests; construction HTTP $($http.tests) tests; no certification."
