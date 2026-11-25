[CmdletBinding()]
param(
    [string] $OutputDirectory = ".cache\local-demo\run-$([Guid]::NewGuid())",
    [ValidateRange(180, 1800)] [int] $DurationSeconds = 900,
    [switch] $Present,
    [switch] $DebugJava,
    [switch] $RestoreDependencies,
    [string] $MavenRepository,
    [string] $ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) }
    else { [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory)) }

Write-Output 'DEMO 01 LOCAL: real Storefront SDK -> Orders JVM -> Inventory JVM -> logical cache/database CLIENT spans.'
Write-Output 'Synthetic JWTs, H2 and a RESP peer; no APIM, Entra, Azure ingestion or broker delivery. NOT CERTIFIED.'
Write-Output '1. Build current sources and run focused Java tests.'
Write-Output '2. Start two checked agent JVMs on owned ephemeral loopback ports; require both readiness probes.'
if ($Present) {
    Write-Output '3. Open Chromium with source maps; pause for debugger setup, then drive one real browser click.'
} else {
    Write-Output '3. Drive one real browser click headlessly. Use -Present -DebugJava for the guided walkthrough.'
}
Write-Output '4. Verify authenticated order read-back, capture real SDK/agent records, and stop owned processes.'
Write-Output '5. Require LOCAL_REHEARSAL A/B/C PASS and the expected FULL_CHAIN missing-Gateway failure.'

$arguments = @{
    OutputDirectory = $output
    DurationSeconds = $DurationSeconds
    RunBrowser = $true
    Present = $Present
    DebugJava = $DebugJava
    RestoreDependencies = $RestoreDependencies
    ToolsRoot = $ToolsRoot
}
if ($MavenRepository) { $arguments.MavenRepository = $MavenRepository }
& (Join-Path $root 'tools\java\Start-LocalPair.ps1') @arguments

$treeFile = Join-Path $output 'browser\local-trace-tree.json'
$tree = Get-Content -Raw -LiteralPath $treeFile | ConvertFrom-Json
$browserFile = Join-Path $output 'browser\local-browser-rehearsal.json'
$browser = Get-Content -Raw -LiteralPath $browserFile | ConvertFrom-Json
if ($tree.result -ne 'PASS' -or $tree.profile -ne 'LOCAL_REHEARSAL' -or
    $tree.fullChain.result -ne 'FAIL' -or $tree.fullChain.code -ne 'C_MISSING_HOP' -or
    $tree.pairProcessesStopped -ne $true -or $tree.certificationEligible -ne $false -or
    $browser.status -ne 'PASS' -or $browser.workflowReadback.status -ne 200) {
    throw 'LOCAL_DEMO_VERIFICATION_INCOMPLETE'
}
Write-Output "LOCAL_DEMO_VERIFIED trace=$($tree.traceId) business=$($tree.businessInvocationId) spans=$($tree.counts.spans)"
Write-Output "Durable GET read-back: workflow=$($browser.workflowReadback.workflowBusinessInvocationId) action=$($browser.workflowReadback.actionBusinessInvocationId)"
Write-Output "Trace tree: $treeFile"
Write-Output "Readable tree: $(Join-Path $output 'browser\local-trace-tree.txt')"
Write-Output "Browser/received-carrier join and read-back: $browserFile"
Write-Output "Original-payload scan scope: $(Join-Path $output 'capture-summary.json')"
Write-Output 'Owned helpers stopped; run-owned in-memory data discarded. Keep these local results for review, not Azure certification.'
