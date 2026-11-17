[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)] [ValidateSet('Inventory', 'Orders', 'Portal')] [string] $Role,
    [Parameter(Mandatory)] [string] $ZipPath,
    [Parameter(Mandatory)] [ValidatePattern('^[0-9a-f]{64}$')] [string] $ExpectedSha256,
    [string] $InputPath,
    [switch] $Execute,
    [string] $ApprovalReference
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$lock = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
$zipFile = (Resolve-Path -LiteralPath $ZipPath).Path
if ((Get-FileHash -LiteralPath $zipFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256) {
    throw 'AZURE_REVIEWED_PACKAGE_HASH_MISMATCH'
}
$archive = [IO.Compression.ZipFile]::OpenRead($zipFile)
try {
    $entries = @($archive.Entries)
    $paths = @($entries | ForEach-Object FullName)
    if ($entries.Count -eq 0 -or $entries.Count -gt 30000 -or
        @($paths | Select-Object -Unique).Count -ne $paths.Count -or
        @($paths | Where-Object { $_ -match '(^[/\\]|^[A-Za-z]:|\\|(^|/)\.\.(/|$)|^(src|tests?|\.cache|\.git)/|^dist/.*\.map$)' }).Count) {
        throw 'AZURE_PACKAGE_LAYOUT_REJECTED'
    }
    $required = if ($Role -eq 'Portal') {
        @('dist/bootstrap.js', 'dist/storefront/index.html', 'package.json', 'package-lock.json',
            'node_modules/@microsoft/opentelemetry/package.json')
    } else {
        @('app.jar', 'startup.sh', 'manifest.json', 'agent/applicationinsights.json', "agent/$($lock.agent.file)",
            "agent/extensions/$([IO.Path]::GetFileName($lock.extensions[0].file))")
    }
    foreach ($entry in $required) {
        if ($entry -notin $paths) { throw 'AZURE_RUNNABLE_PACKAGE_CONTENT_MISSING' }
    }
    if ($Role -ne 'Portal') {
        $reader = [IO.StreamReader]::new($archive.GetEntry('manifest.json').Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($manifest.serviceName -ne "contoso-$($Role.ToLowerInvariant())-api") { throw 'AZURE_PACKAGE_ROLE_MISMATCH' }
        $checks = @{
            'app.jar' = $manifest.applicationSha256
            'agent/applicationinsights.json' = $manifest.configurationSha256
            "agent/$($lock.agent.file)" = $lock.agent.sha256
            "agent/extensions/$([IO.Path]::GetFileName($lock.extensions[0].file))" = $lock.extensions[0].sha256
        }
        foreach ($entry in $checks.Keys) {
            $stream = $archive.GetEntry($entry).Open()
            try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
            finally { $stream.Dispose() }
            if ($actual -ne $checks[$entry]) { throw 'AZURE_PACKAGE_MEMBER_HASH_MISMATCH' }
        }
    }
} finally { $archive.Dispose() }
if ([string]::IsNullOrWhiteSpace($InputPath)) { throw 'AZURE_DEPLOYMENT_INPUT_REQUIRED' }
$inputFile = (Resolve-Path -LiteralPath $InputPath).Path
& node (Join-Path $root 'tools\root-preflight.mjs') --input $inputFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'AZURE_ROOT_INPUTS_INVALID' }
$inputValue = Get-Content -LiteralPath $inputFile -Raw | ConvertFrom-Json
$names = $inputValue.names
$site = $names.($Role.ToLowerInvariant())
if (-not $Execute) {
    [pscustomobject]@{
        subscriptionId = $inputValue.subscriptionId; resourceGroup = $names.resourceGroup
        site = $site; sha256 = $ExpectedSha256; azureCalls = 0; deployed = $false; certification = 'NOT_CERTIFIED'
    }
    return
}
if ([string]::IsNullOrWhiteSpace($ApprovalReference)) { throw 'AZURE_CODE_DEPLOYMENT_APPROVAL_REQUIRED' }
Push-Location $root
try {
    & node .\tools\certification-path.mjs
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_DEPENDENCY_GATE_UNMET' }
    . (Join-Path $root 'tools\AzureTarget.ps1')
    Assert-ContosoAzureSubscription -SubscriptionId $inputValue.subscriptionId -TenantId $inputValue.applicationConfiguration.tenantId
    $common = @('--subscription', $inputValue.subscriptionId, '--resource-group', $names.resourceGroup, '--name', $site, '--only-show-errors')
    if (-not $PSCmdlet.ShouldProcess(
            "$($inputValue.subscriptionId)/$($names.resourceGroup)/$site",
            'Deploy reviewed ZIP with Entra-authenticated SCM; restart and verify readiness')) { return }
    & az webapp deploy @common --src-path $zipFile --type zip --restart true --async false --track-status true --timeout 600000 --output none
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_CODE_DEPLOYMENT_FAILED' }
    $hostname = & az webapp show @common --query defaultHostName --output tsv
    if ($LASTEXITCODE -ne 0 -or $hostname -notmatch '^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.azurewebsites\.net$') {
        throw 'AZURE_ACTUAL_HOSTNAME_REQUIRED'
    }
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(120)
        $ready = $false
        do {
            $response = $client.GetAsync("https://$hostname/health/ready").GetAwaiter().GetResult()
            try {
                if ([int]$response.StatusCode -in @(401, 403)) { throw 'AZURE_MAIN_SITE_RUNNER_ROUTE_DENIED' }
                $ready = [int]$response.StatusCode -eq 200
            } finally { $response.Dispose() }
            if (-not $ready) { Start-Sleep -Seconds 2 }
        } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
        if (-not $ready) { throw 'AZURE_DEPLOYED_BUT_READINESS_FAILED' }
    } finally { $client.Dispose() }
    [pscustomobject]@{ site = $site; readiness = 'HTTP_200'; sha256 = $ExpectedSha256; certification = 'NOT_CERTIFIED' }
} finally { Pop-Location }
