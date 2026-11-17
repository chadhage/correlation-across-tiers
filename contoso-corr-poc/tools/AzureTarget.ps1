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
