[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $OutputPath,
    [Parameter(Mandatory)] [string] $PublisherEmail,
    [string] $SubscriptionId,
    [string] $ComputeSku,
    [switch] $NonInteractive,
    [switch] $AllowAzureRead,
    [string] $ApprovalReference
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outputFile = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $outputFile) { throw 'AZURE_NEW_TARGET_INPUT_REQUIRED' }
if (-not $AllowAzureRead -or [string]::IsNullOrWhiteSpace($ApprovalReference)) {
    throw 'AZURE_EXPLICIT_READ_APPROVAL_REQUIRED'
}
. (Join-Path $root 'tools\AzureTarget.ps1')
if ($NonInteractive -and (-not $SubscriptionId -or -not $ComputeSku)) {
    throw 'AZURE_NONINTERACTIVE_SUBSCRIPTION_AND_SKU_REQUIRED'
}
$catalogue = Get-Content -LiteralPath (Join-Path $root 'infra\compute-skus.json') -Raw | ConvertFrom-Json -AsHashtable
if ($ComputeSku -and -not $catalogue.ContainsKey($ComputeSku)) { throw 'AZURE_COMPUTE_SKU_UNSUPPORTED' }
$subscriptions = @(Get-ContosoAzureSubscriptions)
Push-Location $root
try {
    while ($true) {
        if (-not $SubscriptionId) {
            for ($index = 0; $index -lt $subscriptions.Count; $index++) {
                $item = $subscriptions[$index]
                Write-Host "[$($index + 1)] $($item.name) | subscription $($item.id) | tenant $($item.tenantId)"
            }
            $choice = Read-Host 'Provide a subscription ID with App Service quota, or its list number (q to cancel)'
            if ($choice -eq 'q') { throw 'AZURE_SUBSCRIPTION_SELECTION_CANCELLED' }
            $number = 0
            if ([int]::TryParse($choice, [ref] $number)) {
                if ($number -lt 1 -or $number -gt $subscriptions.Count) { throw 'AZURE_SUBSCRIPTION_SELECTION_INVALID' }
                $SubscriptionId = $subscriptions[$number - 1].id
            } else { $SubscriptionId = $choice }
        }
        $selected = @($subscriptions | Where-Object id -eq $SubscriptionId)
        if ($selected.Count -ne 1) { throw 'AZURE_SELECTED_SUBSCRIPTION_NOT_ACCESSIBLE' }
        $subscription = $selected[0]
        $namesJson = & node --input-type=module -e `
            'import { frozenNames } from "./tools/names.mjs"; console.log(JSON.stringify(frozenNames(process.argv[1], "centralus")));' `
            $subscription.id
        if ($LASTEXITCODE -ne 0) { throw 'AZURE_TARGET_NAMES_FAILED' }
        $names = ($namesJson -join "`n") | ConvertFrom-Json
        $capacity = @(Get-ContosoAzureComputeCapacity -SubscriptionId $subscription.id -Location centralus `
            -ResourceGroup $names.resourceGroup -PlanName $names.plan)
        $eligible = @($capacity | Where-Object { $_.status -eq 'ELIGIBLE' -and (-not $ComputeSku -or $_.sku -eq $ComputeSku) })
        if (-not $eligible.Count) {
            Write-Warning 'No eligible Linux compute SKU has reported quota/region availability for this target. Unknown quota is not availability.'
            $capacity | Format-Table sku, remainingInstances, status -AutoSize | Out-String | Write-Host
            if ($NonInteractive) { throw 'AZURE_COMPUTE_QUOTA_OR_REGION_UNAVAILABLE' }
            $SubscriptionId = $null
            continue
        }
        $recommendations = @(Get-ContosoAzureComputeRecommendations -Capacity $capacity |
            Sort-Object usdPerHour, memoryGb, vcpus, sku)
        $recommendation = $recommendations[0]
        Write-Host 'Preserving one Linux plan with at least 2 vCPUs / 8 GB for the six-app root, VNet integration and Always On.'
        $recommendations | Format-Table sku, vcpus, memoryGb, usdPerHour, estimatedUsdPerMonth -AutoSize | Out-String | Write-Host
        Write-Host "Lowest USD PAYG retail price among eligible supported SKUs: $($recommendation.sku), $($recommendation.usdPerHour)/hour; $($recommendation.estimatedUsdPerMonth)/730-hour month."
        Write-Host 'Plan compute only; excludes APIM, data, telemetry, messaging, operator, networking, tax and discounts. Quota is not reserved capacity or deployment approval.'
        if (-not $ComputeSku) {
            $choice = Read-Host "Enter a listed SKU, or press Enter to select $($recommendation.sku) (q to cancel)"
            if ($choice -eq 'q') { throw 'AZURE_SUBSCRIPTION_SELECTION_CANCELLED' }
            $ComputeSku = if ([string]::IsNullOrWhiteSpace($choice)) { $recommendation.sku } else { $choice }
        }
        $offer = @($recommendations | Where-Object sku -eq $ComputeSku)
        if ($offer.Count -ne 1) { throw 'AZURE_COMPUTE_SELECTION_INVALID' }
        $ComputeSku = $offer[0].sku
        break
    }
    $inputValue = [ordered]@{
        schema = 'contoso.root-inputs.v1'
        subscriptionId = $subscription.id
        resourceGroup = $names.resourceGroup
        location = 'centralus'
        computeSku = $ComputeSku
        deploymentPhase = 'foundation'
        names = $names
        publisherName = 'Contoso'
        publisherEmail = $PublisherEmail
        applicationConfiguration = @{}
        postgresAdministrator = @{}
        scmRunnerCidrs = @()
        notificationActionGroupIds = @()
        deploymentApprovalReference = ''
    }
    $json = $inputValue | ConvertTo-Json -Depth 10
    & node --input-type=module -e `
        'import { validateRootInputs } from "./tools/root-preflight.mjs"; const result=validateRootInputs(JSON.parse(process.argv[1])); if (!result.syntaxPassed) { console.error(result.errors.join(",")); process.exitCode=1; }' `
        $json
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_TARGET_INPUTS_INVALID' }
    $stream = [IO.File]::Open($outputFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes("$json`n")
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    [pscustomobject]@{
        inputPath = $outputFile
        subscriptionId = $subscription.id
        tenantId = $subscription.tenantId
        resourceGroup = $names.resourceGroup
        computeSku = $ComputeSku
        estimatedComputeUsdPerMonth = $offer[0].estimatedUsdPerMonth
        azureReadOnly = $true
        deployed = $false
        certification = 'NOT_CERTIFIED'
    }
} finally { Pop-Location }
