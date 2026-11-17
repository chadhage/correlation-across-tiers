[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)] [string] $InputPath,
    [ValidateSet('Plan', 'WhatIf', 'Provision')] [string] $Action = 'Plan',
    [string] $OutputDirectory,
    [string] $BicepPath = $env:CONTOSO_BICEP_PATH,
    [switch] $AllowAzureRead,
    [switch] $AllowAzureWrite,
    [string] $ApprovalReference,
    [ValidatePattern('^[0-9a-f]{64}$')] [string] $ReviewedPlanSha256
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$inputFile = (Resolve-Path -LiteralPath $InputPath).Path
$inputValue = Get-Content -LiteralPath $inputFile -Raw | ConvertFrom-Json
. (Join-Path $root 'tools\java\PortableTools.ps1')
if ([string]::IsNullOrWhiteSpace($BicepPath)) { throw 'AZURE_FROZEN_BICEP_PATH_REQUIRED' }
$lock = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
Assert-ContosoToolHash $BicepPath SHA256 $lock.portableTools.bicep.sha256
Push-Location $root
try {
    $preflightJson = & node .\tools\root-preflight.mjs --input $inputFile
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_ROOT_INPUTS_INVALID' }
    $preflight = ($preflightJson -join "`n") | ConvertFrom-Json
    $parametersJson = & node .\tools\root-preflight.mjs --input $inputFile --parameters
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_PARAMETERS_INVALID' }
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root ".cache\golden-path\plan-$([Guid]::NewGuid())" }
    $directory = [IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $directory) { throw 'AZURE_NEW_PLAN_DIRECTORY_REQUIRED' }
    New-Item -ItemType Directory -Path $directory | Out-Null
    $template = Join-Path $directory 'main.json'
    $parameters = Join-Path $directory 'parameters.json'
    & $BicepPath build .\infra\main.bicep --outfile $template --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_BICEP_BUILD_FAILED' }
    [IO.File]::WriteAllText($parameters, ($parametersJson -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    $templateHash = (Get-FileHash -LiteralPath $template -Algorithm SHA256).Hash.ToLowerInvariant()
    $parametersHash = (Get-FileHash -LiteralPath $parameters -Algorithm SHA256).Hash.ToLowerInvariant()
    $planHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes("$($inputValue.subscriptionId)`n$($inputValue.resourceGroup)`n$($inputValue.location)`n$templateHash`n$parametersHash"))).ToLowerInvariant()
    $plan = [ordered]@{
        schema = 'contoso.golden-path-deployment-plan.v2'
        subscriptionId = $inputValue.subscriptionId
        resourceGroup = $inputValue.resourceGroup
        location = $inputValue.location
        phase = $inputValue.deploymentPhase
        templateSha256 = $templateHash
        parametersSha256 = $parametersHash
        planSha256 = $planHash
        certificationDependenciesVerified = $preflight.certificationDependenciesVerified
        authorizationVerified = $false
        deployed = $false
        certification = 'NOT_CERTIFIED'
    }
    $plan | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'plan.json') -Encoding utf8
    if ($Action -eq 'Plan') {
        [pscustomobject]@{ planDirectory = $directory; planSha256 = $planHash; azureCalls = 0; deployed = $false }
        return
    }
    if (-not $AllowAzureRead -or [string]::IsNullOrWhiteSpace($ApprovalReference)) {
        throw 'AZURE_EXPLICIT_READ_APPROVAL_REQUIRED'
    }
    if ($Action -eq 'Provision') {
        if (-not $AllowAzureWrite -or $ReviewedPlanSha256 -ne $planHash -or
            $inputValue.deploymentApprovalReference -ne $ApprovalReference) {
            throw 'AZURE_REVIEWED_PLAN_AND_WRITE_APPROVAL_REQUIRED'
        }
        if (-not $preflight.certificationDependenciesVerified) { throw 'AZURE_DEPENDENCY_GATE_UNMET' }
    }
    . (Join-Path $root 'tools\AzureTarget.ps1')
    Assert-ContosoAzureSubscription -SubscriptionId $inputValue.subscriptionId -TenantId $inputValue.applicationConfiguration.tenantId
    $common = @('--subscription', $inputValue.subscriptionId, '--resource-group', $inputValue.resourceGroup,
        '--template-file', $template, '--parameters', "@$parameters", '--only-show-errors')
    & az deployment group validate @common --output none
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_VALIDATION_FAILED' }
    & az deployment group what-if @common
    if ($LASTEXITCODE -ne 0) { throw 'AZURE_WHAT_IF_FAILED' }
    if ($Action -eq 'Provision' -and $PSCmdlet.ShouldProcess(
            "$($inputValue.subscriptionId)/$($inputValue.resourceGroup)",
            "Provision $($inputValue.deploymentPhase); review the displayed what-if, cost and external approval")) {
        $name = "golden-path-$($inputValue.deploymentPhase)-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
        $outputs = & az deployment group create @common --name $name --query properties.outputs --output json
        if ($LASTEXITCODE -ne 0) { throw 'AZURE_PROVISIONING_FAILED' }
        [IO.File]::WriteAllText((Join-Path $directory 'outputs.json'), ($outputs -join "`n"), [Text.UTF8Encoding]::new($false))
        [pscustomobject]@{ deployment = $name; outputsPath = (Join-Path $directory 'outputs.json'); certified = $false }
    }
} finally { Pop-Location }
