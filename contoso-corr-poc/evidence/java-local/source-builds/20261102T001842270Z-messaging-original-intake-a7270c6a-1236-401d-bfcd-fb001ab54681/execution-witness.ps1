param(
  [Parameter(Mandatory)] [string]$ProjectRoot,
  [Parameter(Mandatory)] [string]$ModulePath,
  [Parameter(Mandatory)] [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$allowed = @('services\security-core', 'services\correlation-core', 'services\inventory-data', 'workers\messaging-core')
$reactor = $ModulePath -eq '.'
if (-not $reactor -and $ModulePath -notin $allowed) { throw 'Build witness requires a named owned library module or the declared reactor.' }
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$module = if ($reactor) { $root } else { Join-Path $root $ModulePath }
$pom = Join-Path $module 'pom.xml'
if (-not (Test-Path -LiteralPath $pom -PathType Leaf)) { throw 'Selected module POM missing.' }
$selectedModules = @($ModulePath)
if ($reactor) {
  [xml]$reactorPom = Get-Content -LiteralPath $pom -Raw
  $selectedModules = @($reactorPom.SelectNodes("/*[local-name()='project']/*[local-name()='modules']/*[local-name()='module']") |
    ForEach-Object { $_.InnerText.Replace('/', '\') })
  $expectedModules = @('services\correlation-core', 'services\security-core', 'services\inventory-data',
    'workers\messaging-core', 'services\orders-api', 'services\inventory-api', 'workers\fulfillment',
    'workers\notify', 'workers\aggregator', 'workers\replay', 'extensions\parent-safe-sampler')
  if ($selectedModules.Count -ne $expectedModules.Count -or
      @($selectedModules | Sort-Object -Unique).Count -ne $expectedModules.Count -or
      @(Compare-Object $selectedModules $expectedModules).Count) {
    throw 'Reactor witness requires exactly the declared eleven owned modules.'
  }
}
$targetModules = @($selectedModules)
if ($reactor) { $targetModules += '.' }
foreach ($entry in $targetModules) {
  $directory = if ($entry -eq '.') { $root } else { Join-Path $root $entry }
  $target = Join-Path $directory 'target'
  if (Test-Path -LiteralPath $target) {
    $targetItem = Get-Item -LiteralPath $target -Force
    if (-not $targetItem.PSIsContainer -or ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        (Resolve-Path -LiteralPath $target).Path -ne $target) {
      throw 'Clean build target must be an ordinary explicitly selected target directory.'
    }
  }
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Build witness output must be a new explicitly named directory.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null

function Get-Hash([string]$File) {
  return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-SourceSnapshot {
  $files = @((Join-Path $root 'pom.xml'), (Join-Path $root 'config\versions.lock.json'),
    (Join-Path $root 'tools\java\Use-Portable.ps1'))
  if ($reactor -or $ModulePath -eq 'workers\messaging-core') {
    foreach ($entry in @('tools\security\values.mjs', 'tools\security\native-payload.mjs',
        'tools\security\Scan-NativePayloads.mjs')) {
      $files += Join-Path $root $entry
    }
  }
  if ($reactor) {
    foreach ($entry in @('config\java-agent.json', 'tools\java\native-api-capture.mjs',
        'tools\security\native-identity-client.mjs', 'tools\security\values.mjs',
        'tools\security\native-payload.mjs', 'tools\security\Scan-NativePayloads.mjs',
        'tools\observability\telemetry-contract.mjs')) {
      $files += Join-Path $root $entry
    }
    foreach ($entry in @('.mvn\maven.config', '.mvn\jvm.config', '.mvn\extensions.xml')) {
      $file = Join-Path $root $entry
      if (Test-Path -LiteralPath $file -PathType Leaf) { $files += $file }
    }
  }
  foreach ($entry in $selectedModules) {
    $directory = Join-Path $root $entry
    $files += Join-Path $directory 'pom.xml'
    $source = Join-Path $directory 'src'
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'Selected source directory missing.' }
    if ((Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Build source scope cannot follow a symlink or junction.'
    }
    $items = @(Get-ChildItem -LiteralPath $source -Recurse -Force)
    if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
      throw 'Build source scope cannot follow a symlink or junction.'
    }
    $files += @($items | Where-Object { -not $_.PSIsContainer } | ForEach-Object FullName)
  }
  return @($files | Sort-Object -Unique | ForEach-Object {
    [ordered]@{ path = [IO.Path]::GetRelativePath($root, $_); sha256 = Get-Hash $_ }
  })
}
function Get-JsonHash($Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 20 -Compress))
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}
function Read-Suite([string]$File) {
  $settings = [Xml.XmlReaderSettings]::new()
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $reader = [Xml.XmlReader]::Create($File, $settings)
  try {
    $xml = [Xml.XmlDocument]::new()
    $xml.XmlResolver = $null
    $xml.Load($reader)
    if ($xml.DocumentElement.LocalName -ne 'testsuite') { throw 'Expected an actual Surefire testsuite.' }
    foreach ($attribute in @('tests', 'failures', 'errors', 'skipped')) {
      if ($xml.DocumentElement.GetAttribute($attribute) -notmatch '^\d+$') {
        throw "Missing or invalid actual Surefire count: $attribute"
      }
    }
    return [pscustomobject][ordered]@{
      path = [IO.Path]::GetRelativePath($root, $File)
      sha256 = Get-Hash $File
      tests = [int]$xml.DocumentElement.GetAttribute('tests')
      failures = [int]$xml.DocumentElement.GetAttribute('failures')
      errors = [int]$xml.DocumentElement.GetAttribute('errors')
      skipped = [int]$xml.DocumentElement.GetAttribute('skipped')
    }
  } finally { $reader.Dispose() }
}
function Get-ModuleOutput([string]$Entry, [DateTime]$Started) {
  $directory = Join-Path $root $Entry
  $reportDirectory = Join-Path $directory 'target\surefire-reports'
  $suites = if (Test-Path -LiteralPath $reportDirectory) {
    @(Get-ChildItem -LiteralPath $reportDirectory -Filter 'TEST-*.xml' -File |
      Sort-Object Name | ForEach-Object { Read-Suite $_.FullName })
  } else { @() }
  $freshReports = @($suites | Where-Object {
    (Get-Item -LiteralPath (Join-Path $root $_.path)).LastWriteTimeUtc -lt $Started.AddSeconds(-2)
  }).Count -eq 0
  [xml]$modulePom = Get-Content -LiteralPath (Join-Path $directory 'pom.xml') -Raw
  $artifact = $modulePom.SelectSingleNode("/*[local-name()='project']/*[local-name()='artifactId']").InnerText
  $versionNode = $modulePom.SelectSingleNode("/*[local-name()='project']/*[local-name()='version']")
  if (-not $versionNode) {
    $versionNode = $modulePom.SelectSingleNode("/*[local-name()='project']/*[local-name()='parent']/*[local-name()='version']")
  }
  $version = $versionNode.InnerText
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Build witness requires a literal artifact version.' }
  $jar = Join-Path $directory "target\$artifact-$version.jar"
  $artifactInfo = if (Test-Path -LiteralPath $jar -PathType Leaf) {
    $item = Get-Item -LiteralPath $jar
    [ordered]@{ path = [IO.Path]::GetRelativePath($root, $jar); sha256 = Get-Hash $jar
      bytes = $item.Length
      createdAtUtc = $item.CreationTimeUtc.ToString('o')
      lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o')
      freshnessBasis = 'new-file-creation-during-actual-clean-build-not-reproducible-modified-timestamp'
      fresh = $item.CreationTimeUtc -ge $Started.AddSeconds(-2) }
  } else { $null }
  return [pscustomobject][ordered]@{
    module = $Entry; suites = $suites; artifact = $artifactInfo; reportsFresh = $freshReports
    tests = [int](($suites | Measure-Object -Property tests -Sum).Sum)
    failures = [int](($suites | Measure-Object -Property failures -Sum).Sum)
    errors = [int](($suites | Measure-Object -Property errors -Sum).Sum)
    skipped = [int](($suites | Measure-Object -Property skipped -Sum).Sum)
  }
}

. (Join-Path $root 'tools\java\Use-Portable.ps1')
$maven = (Get-Command mvn.cmd -CommandType Application).Source
$java = Join-Path $env:JAVA_HOME 'bin\java.exe'
$javac = Join-Path $env:JAVA_HOME 'bin\javac.exe'
$versions = (& $maven -version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Maven tool identity command failed.' }
$tools = [ordered]@{
  mavenCommand = $maven; mavenCommandSha256 = Get-Hash $maven
  java = $java; javaSha256 = Get-Hash $java
  javac = $javac; javacSha256 = Get-Hash $javac
  versions = $versions; witnessScriptSha256 = Get-Hash $PSCommandPath
}
Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $OutputDirectory 'execution-witness.ps1')
if ((Get-Hash (Join-Path $OutputDirectory 'execution-witness.ps1')) -ne $tools.witnessScriptSha256) {
  throw 'Execution witness script byte-copy mismatch.'
}
$nativeInputs = $null
if ($reactor) {
  $inventory = Get-Content -LiteralPath (Join-Path $root 'config\versions.lock.json') -Raw | ConvertFrom-Json
  if (-not $env:CONTOSO_AGENT_JAR -or -not (Test-Path -LiteralPath $env:CONTOSO_AGENT_JAR -PathType Leaf)) {
    throw 'Full reactor witness requires the actual pinned native agent test input.'
  }
  $agentHash = Get-Hash $env:CONTOSO_AGENT_JAR
  $guard = Join-Path $root "$($inventory.extensions[0].module)\$($inventory.extensions[0].file)".Replace('/', '\')
  if ($agentHash -ne $inventory.agent.sha256 -or (Get-Hash $guard) -ne $inventory.extensions[0].sha256) {
    throw 'Reactor native test input does not match the locked agent and extension.'
  }
  $nativeInputs = [ordered]@{
    agentPath = $env:CONTOSO_AGENT_JAR; agentSha256 = $agentHash
    extensionPath = [IO.Path]::GetRelativePath($root, $guard); extensionSha256 = Get-Hash $guard
  }
}
$before = Get-SourceSnapshot
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'before-build.json'),
  ([ordered]@{ observedAtUtc = [DateTime]::UtcNow.ToString('o'); sources = $before
    sourceClosureSha256 = Get-JsonHash $before; toolchain = $tools; nativeInputs = $nativeInputs } | ConvertTo-Json -Depth 20),
  [Text.UTF8Encoding]::new($false))
$stdout = Join-Path $OutputDirectory 'maven.stdout.log'
$stderr = Join-Path $OutputDirectory 'maven.stderr.log'
$command = "call `"$maven`" -B -ntp -f `"$pom`" clean package"
if ($reactor) { $command += ' org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom' }
$started = [DateTime]::UtcNow
$process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', $command) `
  -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$observations = @{}
do {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)")
  foreach ($child in $children) {
    if ($child.Name -ieq 'java.exe' -and $child.CommandLine -match 'classworlds\.launcher\.Launcher') {
      $observations[[string]$child.ProcessId] = [ordered]@{
        pid = [int]$child.ProcessId; parentPid = [int]$child.ParentProcessId
        executable = $child.ExecutablePath
        createdAtUtc = $child.CreationDate.ToUniversalTime().ToString('o')
        observedAtUtc = [DateTime]::UtcNow.ToString('o')
        kind = 'observed-maven-java-child'
      }
    }
  }
} while (-not $process.WaitForExit(200))
$process.WaitForExit()
$finished = [DateTime]::UtcNow
$exitCode = $process.ExitCode
$after = Get-SourceSnapshot
$beforeHash = Get-JsonHash $before
$afterHash = Get-JsonHash $after
$moduleOutputs = @($selectedModules | ForEach-Object { Get-ModuleOutput $_ $started })
$suites = @($moduleOutputs | ForEach-Object { $_.suites })
$artifactInfo = if ($reactor) { $null } else { $moduleOutputs[0].artifact }
$artifacts = @($moduleOutputs | ForEach-Object { $_.artifact } | Where-Object { $null -ne $_ })
$tests = [int](($suites | Measure-Object -Property tests -Sum).Sum)
$failures = [int](($suites | Measure-Object -Property failures -Sum).Sum)
$errors = [int](($suites | Measure-Object -Property errors -Sum).Sum)
$skipped = [int](($suites | Measure-Object -Property skipped -Sum).Sum)
$nativeInputsStable = $true
$sbom = $null
$nativeApi = $null
if ($reactor) {
  $nativeInputsStable = (Get-Hash $nativeInputs.agentPath) -eq $nativeInputs.agentSha256 -and
    (Test-Path -LiteralPath (Join-Path $root $nativeInputs.extensionPath) -PathType Leaf)
  if ($nativeInputsStable) {
    $nativeInputsStable = (Get-Hash (Join-Path $root $nativeInputs.extensionPath)) -eq $nativeInputs.extensionSha256
  }
  $sbomPath = Join-Path $root 'target\sbom\bom.json'
  if (Test-Path -LiteralPath $sbomPath -PathType Leaf) {
    $sbom = [ordered]@{ path = [IO.Path]::GetRelativePath($root, $sbomPath); sha256 = Get-Hash $sbomPath
      fresh = (Get-Item -LiteralPath $sbomPath).LastWriteTimeUtc -ge $started.AddSeconds(-2) }
  }
  $receiptLines = [regex]::Matches([IO.File]::ReadAllText($stdout), '(?m)^CONTOSO_NATIVE_API_RECEIPT ([^\r\n]+)')
  if ($receiptLines.Count -eq 1) {
    $receiptPath = [IO.Path]::GetFullPath($receiptLines[0].Groups[1].Value.Trim())
    $nativeRoot = [IO.Path]::GetFullPath((Join-Path $root 'evidence\java-local\native-api')) + [IO.Path]::DirectorySeparatorChar
    if ($receiptPath.StartsWith($nativeRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $receiptPath -Leaf) -eq 'receipts.json' -and (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
      $nativeApi = [ordered]@{
        path = [IO.Path]::GetRelativePath($root, $receiptPath); sha256 = Get-Hash $receiptPath
        fresh = (Get-Item -LiteralPath $receiptPath).LastWriteTimeUtc -ge $started.AddSeconds(-2)
        observation = 'exact-receipt-path-emitted-by-this-actual-test-execution'
      }
    }
  }
}
$result = [ordered]@{
  schema = if ($reactor) { 'contoso.parent-java-reactor-build.v1' } else { 'contoso.parent-java-source-build.v1' }
  executionId = [Guid]::NewGuid().ToString('D')
  scope = if ($reactor) { 'actual-eleven-module-clean-reactor-build' } else { 'actual-selected-owned-module-clean-build' }
  module = $ModulePath
  certified = $false; command = $command; launcherPid = $process.Id
  mavenJavaObservations = @($observations.Values)
  startedAtUtc = $started.ToString('o'); finishedAtUtc = $finished.ToString('o'); exitCode = $exitCode
  toolchain = $tools; beforeSources = $before; afterSources = $after
  beforeSourcesSha256 = $beforeHash; afterSourcesSha256 = $afterHash
  sourcesStable = ($beforeHash -eq $afterHash)
  tests = $tests; failures = $failures; errors = $errors; skipped = $skipped; suites = $suites
  producedArtifact = $artifactInfo
  moduleOutputs = $moduleOutputs; producedArtifacts = $artifacts; aggregateRuntimeSbom = $sbom
  nativeApiReceipt = $nativeApi
  nativeInputs = $nativeInputs; nativeInputsStable = $nativeInputsStable
  stdoutSha256 = Get-Hash $stdout; stderrSha256 = Get-Hash $stderr
  installedArtifactProof = 'NOT_INSTALLED'
  actualLoadedCodeSourceProof = 'PENDING_SEPARATE_NATIVE_EXECUTION'
  limitations = @('No Azure/native wire/fidelity/privacy/owner certification',
    'Only the explicitly selected source modules; runtime use is not inferred from classpath',
    'This executed build witness does not itself grant verifier authority or API_READY')
}
$qualified = $exitCode -eq 0 -and $beforeHash -eq $afterHash -and $tests -gt 0 -and `
  $failures -eq 0 -and $errors -eq 0 -and $skipped -eq 0 -and $observations.Count -gt 0 -and `
  $artifacts.Count -eq $selectedModules.Count -and `
  @($moduleOutputs | Where-Object { $_.tests -eq 0 -or -not $_.reportsFresh -or -not $_.artifact.fresh }).Count -eq 0
if ($reactor) {
  $qualified = $qualified -and $nativeInputsStable -and $null -ne $sbom -and $sbom.fresh -and
    $null -ne $nativeApi -and $nativeApi.fresh
}
$result.result = if ($qualified) { 'PASS' } else { 'FAIL_OR_UNVERIFIED' }
$output = Join-Path $OutputDirectory 'source-build.json'
[IO.File]::WriteAllText($output, ($result | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
[ordered]@{ result = $result.result; module = $ModulePath; tests = $tests; failures = $failures
  errors = $errors; skipped = $skipped; sourceStable = $result.sourcesStable
  mavenJavaObserved = $observations.Count; artifact = $artifactInfo; artifactCount = $artifacts.Count
  nativeInputsStable = $nativeInputsStable; aggregateRuntimeSbom = $sbom
  nativeApiReceipt = $nativeApi
  witness = $output; sha256 = Get-Hash $output } |
  ConvertTo-Json -Depth 8
if (-not $qualified) { throw 'Actual owned-module clean build did not satisfy the source-window/process/test/output witness.' }
