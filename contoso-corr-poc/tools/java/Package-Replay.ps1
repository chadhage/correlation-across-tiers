param()
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$module = Join-Path $root 'workers\replay'
& (Join-Path $PSScriptRoot 'Gate-02.ps1') -ProjectRoot $root -RequireArtifacts | Out-Null
$package = Join-Path $module 'target\deployment'
if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
New-Item -ItemType Directory -Path "$package\agent\extensions" -Force | Out-Null
Copy-Item -LiteralPath "$module\target\replay-1.0.0.jar" -Destination "$package\app.jar"
Copy-Item -LiteralPath "$module\target\lib" -Destination "$package\lib" -Recurse
$agent = & (Join-Path $PSScriptRoot 'Get-Agent.ps1')
$extension = & (Join-Path $PSScriptRoot 'Get-Extension.ps1')
Copy-Item -LiteralPath $agent -Destination "$package\agent\applicationinsights-agent-3.7.10.jar"
Copy-Item -LiteralPath $extension -Destination "$package\agent\extensions\$(Split-Path $extension -Leaf)"
Copy-Item -LiteralPath "$root\config\java-agent.json" -Destination "$package\agent\applicationinsights.json"
Copy-Item -LiteralPath "$PSScriptRoot\replay.sh" -Destination "$package\replay.sh"
& (Join-Path $PSScriptRoot 'Write-DeploymentZip.ps1') -SourceDirectory $package -Destination "$module\target\contoso-replay.zip"
