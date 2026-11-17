function Get-ContosoAzureSubscriptions {
    $json = & az account list --all --refresh --only-show-errors --output json `
        --query '[].{id:id,name:name,tenantId:tenantId,state:state}'
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_SUBSCRIPTION_DISCOVERY_FAILED: Run az login, then retry.' }
    $subscriptions = @($json -join "`n" | ConvertFrom-Json)
    $guid = '^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $enabled = @(
        foreach ($subscription in $subscriptions) {
            if ($subscription.state -ne 'Enabled') { continue }
            if ($subscription.id -notmatch $guid -or $subscription.tenantId -notmatch $guid -or
                [string]::IsNullOrWhiteSpace($subscription.name)) {
                throw 'AZURE_SUBSCRIPTION_RESPONSE_INVALID'
            }
            [pscustomobject]@{
                id = $subscription.id.ToLowerInvariant()
                name = $subscription.name
                tenantId = $subscription.tenantId.ToLowerInvariant()
            }
        }
    )
    if ($enabled.Count -eq 0) { throw 'AZURE_NO_ENABLED_SUBSCRIPTIONS: Run az login with an authorized account or tenant.' }
    if (@($enabled | Group-Object id | Where-Object Count -gt 1).Count) { throw 'AZURE_SUBSCRIPTION_RESPONSE_AMBIGUOUS' }
    $enabled | Sort-Object name, id
}

function Assert-ContosoAzureSubscription {
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [string] $TenantId
    )
    $subscription = @(Get-ContosoAzureSubscriptions | Where-Object id -eq $SubscriptionId)
    if ($subscription.Count -ne 1) { throw 'AZURE_SELECTED_SUBSCRIPTION_NOT_ACCESSIBLE' }
    if ($TenantId -and $subscription[0].tenantId -ne $TenantId) { throw 'AZURE_SELECTED_SUBSCRIPTION_TENANT_MISMATCH' }
}

function Get-ContosoAzureComputeCapacity {
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [ValidateSet('centralus')] [string] $Location,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $PlanName,
        [string] $ComputeSku
    )
    $catalogue = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\infra\compute-skus.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($ComputeSku -and -not $catalogue.ContainsKey($ComputeSku)) { throw 'AZURE_COMPUTE_SKU_UNSUPPORTED' }
    $usageJson = & az rest --method get --url `
        "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Web/locations/$Location/usages?api-version=2024-11-01" `
        --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_COMPUTE_QUOTA_READ_FAILED' }
    $usage = ($usageJson -join "`n") | ConvertFrom-Json
    if ($usage.value -isnot [array]) { throw 'AZURE_COMPUTE_QUOTA_RESPONSE_INVALID' }
    $plansJson = & az appservice plan list --subscription $SubscriptionId --only-show-errors --output json `
        --query '[].{name:name,resourceGroup:resourceGroup,location:location,sku:sku,reserved:reserved}'
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_COMPUTE_PLAN_READ_FAILED' }
    $plans = ($plansJson -join "`n") | ConvertFrom-Json -NoEnumerate
    if ($plans -isnot [array]) { throw 'AZURE_COMPUTE_PLAN_RESPONSE_INVALID' }
    $existing = @($plans | Where-Object { $_.name -eq $PlanName -and $_.resourceGroup -eq $ResourceGroup })
    if ($existing.Count -gt 1) { throw 'AZURE_COMPUTE_PLAN_RESPONSE_INVALID' }
    if ($existing.Count -eq 1 -and ($existing[0].reserved -isnot [bool] -or -not $existing[0].reserved -or
            $existing[0].sku.capacity -is [bool] -or
            ($existing[0].location -replace ' ', '') -ne $Location -or $existing[0].sku.capacity -ne 1)) {
        throw 'AZURE_COMPUTE_EXISTING_PLAN_MISMATCH'
    }
    $keys = if ($ComputeSku) { @($ComputeSku) } else { @($catalogue.Keys | Sort-Object) }
    foreach ($sku in $keys) {
        $entries = @($usage.value | Where-Object { $_.name.value -eq $sku })
        $remaining = $null
        $status = 'QUOTA_UNKNOWN'
        if ($entries.Count -gt 1) { throw 'AZURE_COMPUTE_QUOTA_RESPONSE_INVALID' }
        if ($entries.Count -eq 1) {
            $entry = $entries[0]
            if ($entry.unit -ne 'Instances' -or $null -eq $entry.currentValue -or $null -eq $entry.limit -or
                $entry.currentValue -is [string] -or $entry.limit -is [string] -or
                $entry.currentValue -is [bool] -or $entry.limit -is [bool] -or
                $entry.currentValue -lt 0 -or $entry.limit -lt 0 -or
                [decimal]$entry.currentValue % 1 -ne 0 -or [decimal]$entry.limit % 1 -ne 0) {
                throw 'AZURE_COMPUTE_QUOTA_RESPONSE_INVALID'
            }
            $remaining = [decimal]$entry.limit - [decimal]$entry.currentValue
            $status = 'NO_QUOTA'
        }
        $reusesInstance = $existing.Count -eq 1 -and $existing[0].sku.name -eq $sku
        if (($null -ne $remaining -and $remaining -ge 1) -or $reusesInstance) {
            $locationsJson = & az appservice list-locations --sku $sku --linux-workers-enabled `
                --subscription $SubscriptionId --only-show-errors --output json
            if ($LASTEXITCODE -ne 0) { throw "AZURE_COMPUTE_REGION_READ_FAILED: $sku" }
            $locations = @(($locationsJson -join "`n") | ConvertFrom-Json)
            $status = if (@($locations | Where-Object { ($_.name -replace ' ', '') -eq $Location }).Count) {
                'ELIGIBLE'
            } else { 'REGION_UNAVAILABLE' }
        }
        [pscustomobject]@{
            sku = $sku; vcpus = $catalogue[$sku].vcpus; memoryGb = $catalogue[$sku].memoryGb
            remainingInstances = $remaining; reusesInstance = $reusesInstance; status = $status
        }
    }
}

function Get-ContosoAzureComputePrices {
    param([Parameter(Mandatory)] [ValidateSet('centralus')] [string] $Location)
    $filter = "serviceName eq 'Azure App Service' and armRegionName eq '$Location' and priceType eq 'Consumption'"
    $next = 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=' + [uri]::EscapeDataString($filter)
    $pageCount = 0
    while ($next) {
        $uri = [uri]$next
        if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'prices.azure.com' -or $uri.Port -ne 443 -or
            $uri.AbsolutePath -ne '/api/retail/prices' -or $uri.UserInfo -or ++$pageCount -gt 20) {
            throw 'AZURE_COMPUTE_PRICE_PAGE_INVALID'
        }
        $page = Invoke-RestMethod -Uri $uri -TimeoutSec 60
        if ($null -eq $page.Items) { throw 'AZURE_COMPUTE_PRICE_RESPONSE_INVALID' }
        $page.Items
        $next = $page.NextPageLink
    }
}

function Get-ContosoAzureComputeRecommendations {
    param([Parameter(Mandatory)] [object[]] $Capacity)
    $eligible = @($Capacity | Where-Object status -eq 'ELIGIBLE')
    if (-not $eligible.Count) { return }
    $prices = @(Get-ContosoAzureComputePrices -Location centralus)
    foreach ($candidate in $eligible) {
        $matches = @($prices | Where-Object {
            ($_.skuName -replace ' ', '') -eq $candidate.sku -and
            $_.productName -in @('Azure App Service Premium v3 Plan - Linux', 'Azure App Service Premium v4 Plan - Linux') -and
            $_.serviceName -eq 'Azure App Service' -and $_.armRegionName -eq 'centralus' -and
            $_.currencyCode -eq 'USD' -and $_.type -eq 'Consumption' -and
            $_.unitOfMeasure -eq '1 Hour' -and $_.isPrimaryMeterRegion -eq $true -and
            $null -ne $_.tierMinimumUnits -and $_.tierMinimumUnits -eq 0 -and
            $_.effectiveStartDate -and [DateTimeOffset]$_.effectiveStartDate -le [DateTimeOffset]::UtcNow -and
            (-not $_.effectiveEndDate -or [DateTimeOffset]$_.effectiveEndDate -gt [DateTimeOffset]::UtcNow)
        } | Sort-Object { [DateTimeOffset]$_.effectiveStartDate } -Descending)
        if (-not $matches.Count) { throw "AZURE_COMPUTE_PRICE_UNAVAILABLE: $($candidate.sku)" }
        $latest = @($matches | Where-Object { $_.effectiveStartDate -eq $matches[0].effectiveStartDate })
        if (@($latest | Select-Object -ExpandProperty retailPrice -Unique).Count -ne 1 -or
            $null -eq $latest[0].retailPrice -or $latest[0].retailPrice -is [string] -or $latest[0].retailPrice -le 0) {
            throw "AZURE_COMPUTE_PRICE_AMBIGUOUS: $($candidate.sku)"
        }
        $rate = [decimal]$latest[0].retailPrice
        [pscustomobject]@{
            sku = $candidate.sku; vcpus = $candidate.vcpus; memoryGb = $candidate.memoryGb
            remainingInstances = $candidate.remainingInstances; reusesInstance = $candidate.reusesInstance
            usdPerHour = $rate; estimatedUsdPerMonth = $rate * 730; meterId = $latest[0].meterId
        }
    }
}

function Assert-ContosoAzureComputeQuota {
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $PlanName,
        [Parameter(Mandatory)] [string] $ComputeSku
    )
    $capacity = @(Get-ContosoAzureComputeCapacity -SubscriptionId $SubscriptionId -Location centralus `
        -ResourceGroup $ResourceGroup -PlanName $PlanName -ComputeSku $ComputeSku)
    if ($capacity.Count -ne 1 -or $capacity[0].status -ne 'ELIGIBLE') {
        throw "AZURE_COMPUTE_QUOTA_OR_REGION_UNAVAILABLE: $ComputeSku. Run Select-AzureTarget.ps1 and provide a subscription ID with quota; save a new input and review a new plan."
    }
}
