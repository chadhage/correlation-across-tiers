param([string]$ApiReceiptPath, [string]$PackagedLaunchReportPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$paths = @('pom.xml','config\java-agent.json','config\versions.lock.json','VERSIONS.md',
  'infra\modules\compute.bicep','docs\JAVA_VALIDATION.md')
$paths += @('tools\security\native-identity-client.mjs', 'tools\security\values.mjs',
  'tools\security\native-payload.mjs', 'tools\security\Scan-NativePayloads.mjs',
  'tools\observability\telemetry-contract.mjs')
foreach ($directory in @('services\correlation-core','services\orders-api','services\inventory-api',
    'extensions\parent-safe-sampler','tools\java','tests\java')) {
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root $directory) -Recurse -File) {
    $relative = [IO.Path]::GetRelativePath($root, $file.FullName)
    if ($relative -match '\\target\\|\\generated-fixtures\\|\\construction\\|correlation-core\\src\\main\\java\\com\\contoso\\correlation\\data\\') { continue }
    $paths += $relative
  }
}
$sources = @($paths | Sort-Object -Unique | ForEach-Object {
  $file = Join-Path $root $_
  [ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$manifest = [ordered]@{
  schema='contoso.r4-review-source-manifest.v1'; ownerRole='R4'; reviewKind='code'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o'); sourceAcceptanceIsCertification=$false
  sources=$sources
  historicalEvidence=@('evidence\java-local\reactor-verify.log','evidence\java-local\validation.json')
  evidence=@('target\sbom\bom.json')
  limitations=@('R5 corrected targeted-replay acceptance requires its independent review and fresh reactor/packages',
    'No Azure participant/image/identity/broker/native-binding qualification',
    'Global provider/exporter counts remain unknown; preview business inheritance is excluded',
    'Direct automatic HTTP CLIENT business attribute gap is observed, not backfilled')
}
if ($ApiReceiptPath) {
  $receipt = (Resolve-Path -LiteralPath $ApiReceiptPath).Path
  $manifest.evidence += [IO.Path]::GetRelativePath($root, $receipt)
}
if ($PackagedLaunchReportPath) {
  $receipt = (Resolve-Path -LiteralPath $PackagedLaunchReportPath).Path
  $manifest.evidence += [IO.Path]::GetRelativePath($root, $receipt)
}
$directory = Join-Path $root 'evidence\java-local\r4-review-sources'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$output = Join-Path $directory "$([Guid]::NewGuid().ToString('D')).json"
$stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 6))
  $stream.Write($bytes)
} finally { $stream.Dispose() }
"Frozen R4 review sources: $($sources.Count)"
"Source manifest: $output"
