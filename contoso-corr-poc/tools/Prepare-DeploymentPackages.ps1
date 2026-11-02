[CmdletBinding()]
param(
    [string] $OutputPath,
    [string] $JavaValidationPath
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputPath) { $OutputPath = Join-Path $root '.cache\acting-r1\root-packages.json' }
if (-not $JavaValidationPath) { $JavaValidationPath = Join-Path $root 'evidence\java-local\validation.json' }
$lockPath = Join-Path $root 'config\versions.lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$lockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
$guards = @($lock.extensions | Where-Object artifactId -EQ 'contoso-parent-safe-sampler')
if ($guards.Count -ne 1) { throw 'A single current sampler artifact is required.' }
$guard = $guards[0]
$guardFile = [IO.Path]::GetFileName($guard.file.Replace('/', '\'))
$blockers = [Collections.Generic.List[string]]::new()
$packages = [Collections.Generic.List[object]]::new()
$definitions = @(
    @{ role = 'contoso-orders-api'; path = 'services\orders-api\target\contoso-orders-api.zip'; deployment = 'orders' },
    @{ role = 'contoso-inventory-api'; path = 'services\inventory-api\target\contoso-inventory-api.zip'; deployment = 'inventory' },
    @{ role = 'contoso-fulfillment-worker'; path = 'workers\fulfillment\target\contoso-fulfillment-worker.zip'; deployment = 'fulfillment' },
    @{ role = 'contoso-notify-worker'; path = 'workers\notify\target\contoso-notify-worker.zip'; deployment = 'notify' },
    @{ role = 'contoso-order-aggregator'; path = 'workers\aggregator\target\contoso-order-aggregator.zip'; deployment = 'aggregator' },
    @{ role = 'owning-fulfillment-or-notify-replay-tool'; path = 'workers\replay\target\contoso-replay.zip'; deployment = 'operator-tool-not-an-extra-app' }
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($definition in $definitions) {
    $path = Join-Path $root $definition.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $blockers.Add("PACKAGE_MISSING:$($definition.role)"); continue }
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $entries = @($archive.Entries)
        if ($entries.Count -eq 0 -or $entries.Count -gt 20000) { $blockers.Add("PACKAGE_ENTRY_BOUND:$($definition.role)") }
        $unsafe = @($entries | Where-Object {
            $_.FullName -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$)|(^|/)(?:\.cache|src|tests?|fixtures?|node_modules|\.git)(/|$)|\.map$)'
        })
        if ($unsafe.Count -ne 0) { $blockers.Add("PACKAGE_UNSAFE_PATH:$($definition.role)") }
        $extensions = @($entries | Where-Object { $_.Name -like 'contoso-parent-safe-sampler-*.jar' })
        $currentGuard = $false
        if ($extensions.Count -eq 1 -and $extensions[0].Name -eq $guardFile) {
            $stream = $extensions[0].Open()
            try {
                $algorithm = [Security.Cryptography.SHA256]::Create()
                try { $currentGuard = [Convert]::ToHexString($algorithm.ComputeHash($stream)).ToLowerInvariant() -eq $guard.sha256 }
                finally { $algorithm.Dispose() }
            } finally { $stream.Dispose() }
        }
        if (-not $currentGuard) { $blockers.Add("PACKAGE_CURRENT_GUARD_MISMATCH:$($definition.role)") }
        foreach ($entry in $entries | Where-Object { $_.Name -match '\.(sh|ps1|json)$' -and $_.Length -lt 1048576 }) {
            $reader = [IO.StreamReader]::new($entry.Open())
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            if ($text -match 'InstrumentationKey=[0-9a-f-]{36}|Bearer\s+eyJ') { $blockers.Add("PACKAGE_STATIC_CREDENTIAL:$($definition.role)") }
            if ($text -match 'otel\.instrumentation\.okhttp[^ \r\n"]*\.enabled=false') { $blockers.Add("PACKAGE_OBSOLETE_OKHTTP_DISABLE:$($definition.role)") }
        }
        $packages.Add([ordered]@{
            role = $definition.role
            deployment = $definition.deployment
            path = $definition.path
            sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            entries = $entries.Count
            currentGuardBytesMatched = $currentGuard
            sourceBuildLoadedLineageVerified = $false
        })
    } finally { $archive.Dispose() }
}

$javaReportHash = $null
if (Test-Path -LiteralPath $JavaValidationPath -PathType Leaf) {
    $javaReport = Get-Content -LiteralPath $JavaValidationPath -Raw | ConvertFrom-Json
    $javaReportHash = (Get-FileHash -LiteralPath $JavaValidationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($javaReport.lockSha256 -ne $lockHash) { $blockers.Add('JAVA_VALIDATION_REPORT_LOCK_STALE') }
} else { $blockers.Add('CURRENT_PARENT_JAVA_ARTIFACT_MANIFEST_REQUIRED') }

$nodeRoot = Join-Path $root 'web\portal-ssr\deployment-artifact'
if (Test-Path -LiteralPath $nodeRoot -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $nodeRoot -File -Recurse | Sort-Object FullName)
    $items = @($files | ForEach-Object {
        [ordered]@{ path = [IO.Path]::GetRelativePath($nodeRoot, $_.FullName).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $json = ConvertTo-Json -InputObject $items -Compress
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $treeHash = [Convert]::ToHexString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($json))).ToLowerInvariant() }
    finally { $algorithm.Dispose() }
    if ($files | Where-Object { $_.FullName -match '[\\/](?:node_modules|tests?|src|\.cache)[\\/]|\.map$' }) { $blockers.Add('NODE_PACKAGE_UNSAFE_PATH') }
    $packages.Add([ordered]@{
        role = 'contoso-portal-ssr-and-contoso-storefront-spa'
        deployment = 'portal-cohost'
        path = 'web\portal-ssr\deployment-artifact'
        files = $files.Count
        treeSha256 = $treeHash
        requiresProductionOnlyRestore = $true
        sourceBuildLoadedLineageVerified = $false
    })
} else { $blockers.Add('CORRECTED_PORTAL_COHOST_ARTIFACT_REQUIRED') }
$blockers.Add('CURRENT_PARENT_SOURCE_BUILD_PACKAGE_LINEAGE_AND_NODE_GA_ADJUDICATION_REQUIRED')
$report = [ordered]@{
    schema = 'contoso.root-package-inventory.v1'
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    scope = 'read-only-archive-and-file-hash-inspection-not-build-or-native-authority'
    versionLockSha256 = $lockHash
    javaValidationReportSha256 = $javaReportHash
    packages = @($packages)
    blockers = @($blockers)
    deploymentReady = $false
    certification = 'NOT_CERTIFIED'
}
$parent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
[pscustomobject]@{ packages = $packages.Count; blockers = $blockers.Count; deploymentReady = $false; output = $OutputPath } | ConvertTo-Json -Compress
