param(
  [Parameter(Mandatory)] [string]$ModulePath,
  [Parameter(Mandatory)] [string]$JarName,
  [Parameter(Mandatory)] [string]$ServiceName
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($ModulePath.Replace('/', '\') -notin @('services\orders-api','services\inventory-api') -or
    $ServiceName -notin @('contoso-orders-api','contoso-inventory-api') -or
    $JarName -notmatch '^[a-z][a-z0-9.-]+\.jar$') { throw 'Unknown Java API packaging contract' }
$artifact = Split-Path $ModulePath -Leaf
if ($JarName -ne "$artifact-1.0.0.jar" -or $ServiceName -ne "contoso-$artifact") { throw 'Mismatched API module/role/artifact' }
$module = Join-Path $root $ModulePath
$package = Join-Path $module 'target\deployment'
& (Join-Path $PSScriptRoot 'Gate-02.ps1') -ProjectRoot $root -RequireArtifacts | Out-Null
if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
New-Item -ItemType Directory -Path "$package\agent" -Force | Out-Null
$agent = & (Join-Path $PSScriptRoot 'Get-Agent.ps1')
Copy-Item -LiteralPath $agent -Destination "$package\agent\applicationinsights-agent-3.7.10.jar"
$extension = & (Join-Path $PSScriptRoot 'Get-Extension.ps1')
New-Item -ItemType Directory -Path "$package\agent\extensions" -Force | Out-Null
Copy-Item -LiteralPath $extension -Destination "$package\agent\extensions\$(Split-Path $extension -Leaf)"
Copy-Item -LiteralPath "$root\config\java-agent.json" -Destination "$package\agent\applicationinsights.json"
Copy-Item -LiteralPath "$module\target\$JarName" -Destination "$package\app.jar"
Copy-Item -LiteralPath "$root\tools\java\startup.sh" -Destination "$package\startup.sh"
$receipt = [ordered]@{
  schema='contoso.java-deployment-manifest.v1'; certified=$false; serviceName=$ServiceName
  applicationSha256=(Get-FileHash "$package\app.jar" -Algorithm SHA256).Hash.ToLowerInvariant()
  agentSha256=(Get-FileHash "$package\agent\applicationinsights-agent-3.7.10.jar" -Algorithm SHA256).Hash.ToLowerInvariant()
  extensionSha256=(Get-FileHash "$package\agent\extensions\$(Split-Path $extension -Leaf)" -Algorithm SHA256).Hash.ToLowerInvariant()
  configurationSha256=(Get-FileHash "$package\agent\applicationinsights.json" -Algorithm SHA256).Hash.ToLowerInvariant()
}
[IO.File]::WriteAllText("$package\manifest.json", ($receipt | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot 'Write-DeploymentZip.ps1') -SourceDirectory $package -Destination "$module\target\$ServiceName.zip"
