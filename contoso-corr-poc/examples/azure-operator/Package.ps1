param(
    [Parameter(Mandatory)] [string]$Destination,
    [string]$InventoryRuntimeDirectory
)
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
if ([IO.Path]::GetExtension($Destination) -ne '.zip' -or (Test-Path -LiteralPath $Destination)) {
    throw 'Choose a new .zip destination; existing files are never overwritten.'
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$jar = Join-Path $PSScriptRoot 'target\contoso-azure-demo-operator-1.0.0.jar'
if (-not (Test-Path -LiteralPath $jar -PathType Leaf)) { throw 'Build the azure-examples Maven profile first.' }
$stage = Join-Path $PSScriptRoot "target\operator-package-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path (Join-Path $stage 'agent\extensions') -Force | Out-Null
try {
    Copy-Item -LiteralPath $jar -Destination (Join-Path $stage 'app.jar')
    Copy-Item -LiteralPath (Join-Path (Split-Path $root -Parent) 'LICENSE') -Destination (Join-Path $stage 'LICENSE')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'startup.sh') -Destination (Join-Path $stage 'startup.sh')
    Copy-Item -LiteralPath (Join-Path $root 'tools\java\startup.sh') -Destination (Join-Path $stage 'fixture-startup.sh')
    $agent = & (Join-Path $root 'tools\java\Get-Agent.ps1')
    $extension = Join-Path $root 'extensions\parent-safe-sampler\target\contoso-parent-safe-sampler-1.1.0.jar'
    $lock = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $extension) -or
        (Get-FileHash -LiteralPath $extension).Hash.ToLowerInvariant() -ne $lock.extensions[0].sha256) {
        throw 'Build the actual checksum-locked sampler before packaging.'
    }
    Copy-Item -LiteralPath $agent -Destination (Join-Path $stage 'agent\applicationinsights-agent-3.7.10.jar')
    Copy-Item -LiteralPath $extension -Destination (Join-Path $stage 'agent\extensions\contoso-parent-safe-sampler-1.1.0.jar')
    if ($InventoryRuntimeDirectory) {
        foreach ($name in @('applicationinsights.json', 'sampling-lease.json')) {
            $file = Join-Path $InventoryRuntimeDirectory $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing reviewed runtime input: $name" }
            Copy-Item -LiteralPath $file -Destination (Join-Path $stage "agent\$name")
        }
        $lease = Get-Content -LiteralPath (Join-Path $stage 'agent\sampling-lease.json') -Raw | ConvertFrom-Json
        if ($lease.layerId -ne 'contoso-inventory-api' -or $lease.guard.sha256 -ne $lock.extensions[0].sha256) {
            throw 'Runtime inputs do not bind the actual Inventory guard.'
        }
    } else {
        Copy-Item -LiteralPath (Join-Path $root 'config\java-agent.json') -Destination (Join-Path $stage 'agent\applicationinsights.json')
    }
    & (Join-Path $root 'tools\java\Write-DeploymentZip.ps1') -SourceDirectory $stage -Destination $Destination
    Get-FileHash -LiteralPath $Destination -Algorithm SHA256
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
