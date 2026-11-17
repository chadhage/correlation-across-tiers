[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $OutputPath,
    [Parameter(Mandatory)] [string] $PublisherEmail,
    [string] $SubscriptionId,
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
$subscriptions = @(Get-ContosoAzureSubscriptions)
if ($SubscriptionId) {
    $selected = @($subscriptions | Where-Object id -eq $SubscriptionId)
    if ($selected.Count -ne 1) { throw 'AZURE_SELECTED_SUBSCRIPTION_NOT_ACCESSIBLE' }
    $subscription = $selected[0]
} else {
    for ($index = 0; $index -lt $subscriptions.Count; $index++) {
        $item = $subscriptions[$index]
        Write-Host "[$($index + 1)] $($item.name) | subscription $($item.id) | tenant $($item.tenantId)"
    }
    $choice = Read-Host 'Select a subscription number (q to cancel; no default)'
    if ($choice -eq 'q') { throw 'AZURE_SUBSCRIPTION_SELECTION_CANCELLED' }
    $number = 0
    if (-not [int]::TryParse($choice, [ref] $number) -or $number -lt 1 -or $number -gt $subscriptions.Count) {
        throw 'AZURE_SUBSCRIPTION_SELECTION_INVALID'
    }
    $subscription = $subscriptions[$number - 1]
}
Push-Location $root
try {
    $namesJson = & node --input-type=module -e `
        'import { frozenNames } from "./tools/names.mjs"; console.log(JSON.stringify(frozenNames(process.argv[1], "centralus")));' `
        $subscription.id
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_TARGET_NAMES_FAILED' }
    $names = ($namesJson -join "`n") | ConvertFrom-Json
    $inputValue = [ordered]@{
        schema = 'contoso.root-inputs.v1'
        subscriptionId = $subscription.id
        resourceGroup = $names.resourceGroup
        location = 'centralus'
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
        azureCalls = 1
        deployed = $false
        certification = 'NOT_CERTIFIED'
    }
} finally { Pop-Location }
