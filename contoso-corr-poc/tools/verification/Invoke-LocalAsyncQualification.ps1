$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location $root
. .\tools\java\Use-Portable.ps1
$env:CONTOSO_AGENT_JAR = & .\tools\java\Get-Agent.ps1
$inventory = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
$entries = @($inventory.extensions | Where-Object module -EQ 'extensions/parent-safe-sampler')
$extension = $entries | Select-Object -First 1
if ($entries.Count -ne 1 -or $extension.version -notmatch '^\d+\.\d+\.\d+$' -or $extension.sha256 -notmatch '^[0-9a-f]{64}$' -or
    $extension.file -ne "target/$($extension.artifactId)-$($extension.version).jar" -or $extension.sdkAbi -ne $inventory.agent.api) {
    throw 'Current immutable sampler identity is not frozen.'
}
$env:CONTOSO_PARENT_SAFE_JAR = Join-Path $root ($extension.module.Replace('/', '\') + '\' + $extension.file.Replace('/', '\'))
if (-not (Test-Path -LiteralPath $env:CONTOSO_PARENT_SAFE_JAR)) { throw 'Actual pinned extension artifact is missing.' }
if ((Get-FileHash -LiteralPath $env:CONTOSO_PARENT_SAFE_JAR -Algorithm SHA256).Hash.ToLowerInvariant() -ne $extension.sha256) {
    throw 'Actual current sampler artifact differs from the frozen identity.'
}
& mvn -o -q -B -ntp -f .\workers\messaging-core\pom.xml '-Dtest=AsyncNativeAgentTest' test
exit $LASTEXITCODE
