param(
  [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [switch]$RequireArtifacts,
  [switch]$RequireExtensionEvidence
)
$ErrorActionPreference = 'Stop'
$failures = @()
$lockPath = Join-Path $ProjectRoot 'config\versions.lock.json'
$extension = $null
if (Test-Path -LiteralPath $lockPath) {
  $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
  if (@($lock.extensions).Count -gt 1) { throw 'Only one approved same-provider extension is permitted' }
  if ($lock.extensions) { $extension = $lock.extensions[0] }
}
$extensionPom = if ($extension) { [IO.Path]::GetFullPath((Join-Path $ProjectRoot "$($extension.module)\pom.xml")) } else { '' }
$sdkArtifacts = @('opentelemetry-sdk-trace','opentelemetry-sdk-common','opentelemetry-sdk-extension-autoconfigure-spi')
$requireExtension = $RequireArtifacts -or $RequireExtensionEvidence
if ($RequireArtifacts) {
  [xml]$reactor = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'pom.xml')
  foreach ($entry in $reactor.SelectNodes("/*[local-name()='project']/*[local-name()='modules']/*[local-name()='module']")) {
    $module = Join-Path $ProjectRoot $entry.InnerText.Replace('/', '\')
    $pomPath = Join-Path $module 'pom.xml'
    if (-not (Test-Path -LiteralPath $pomPath)) { $failures += "Declared reactor module is missing: $module"; continue }
    [xml]$modulePom = Get-Content -Raw -LiteralPath $pomPath
    $artifactId = $modulePom.SelectSingleNode("/*[local-name()='project']/*[local-name()='artifactId']").InnerText
    $versionNode = $modulePom.SelectSingleNode("/*[local-name()='project']/*[local-name()='version']")
    $moduleVersion = if ($versionNode) { $versionNode.InnerText } else { '1.0.0' }
    if (-not (Test-Path -LiteralPath (Join-Path $module "target\$artifactId-$moduleVersion.jar"))) {
      $failures += "Declared module has no real packaged artifact: $module"
    }
  }
}
function Test-ApplicationArchive([IO.Compression.ZipArchive]$Zip, [string]$Artifact, [int]$Depth = 0) {
  $errors = @()
  if ($Depth -gt 4 -or $Zip.Entries.Count -gt 20000) { return "Uninspectable application archive: $Artifact" }
  foreach ($entry in $Zip.Entries) {
    $name = $entry.FullName
    if ($name.EndsWith('/')) { continue }
    if ($name -match '(^|/)(io/opentelemetry/sdk/|io/opentelemetry/exporter/|com/microsoft/applicationinsights/TelemetryClient\.class|com/contoso/correlation/sampling/ParentSafeSampler)' -or
        $name -match '(^|/)(opentelemetry-sdk[^/]*|opentelemetry-exporter[^/]*|applicationinsights[^/]*|azure-monitor-opentelemetry[^/]*|azure-core-tracing-opentelemetry[^/]*|azure-functions-java-opentelemetry[^/]*|micrometer-tracing[^/]*|contoso-parent-safe-sampler[^/]*)\.jar$') {
      $errors += "Forbidden application classpath entry $name in $Artifact"
    }
    if ($name.EndsWith('.jar')) {
      if ($entry.Length -gt 67108864) { $errors += "Oversized nested archive cannot be admitted: $Artifact/$name"; continue }
      $memory = [IO.MemoryStream]::new()
      $input = $entry.Open()
      try {
        $input.CopyTo($memory)
        $memory.Position = 0
        $nested = [IO.Compression.ZipArchive]::new($memory, [IO.Compression.ZipArchiveMode]::Read, $true)
        try { $errors += @(Test-ApplicationArchive $nested "$Artifact/$name" ($Depth + 1)) }
        finally { $nested.Dispose() }
      } catch { $errors += "Unreadable nested archive: $Artifact/$name" }
      finally { $input.Dispose(); $memory.Dispose() }
    }
    if ($name.EndsWith('.class')) {
      if ($entry.Length -gt 2097152) { $errors += "Uninspectable class: $Artifact/$name"; continue }
      $input = $entry.Open()
      $memory = [IO.MemoryStream]::new()
      try {
        $input.CopyTo($memory)
        if ([Text.Encoding]::UTF8.GetString($memory.ToArray()).Contains('CONSTRUCTION_ONLY')) {
          $errors += "Throw-only construction implementation in real artifact: $Artifact/$name"
        }
      } finally { $input.Dispose(); $memory.Dispose() }
    }
  }
  return $errors
}
$javaFiles = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -Filter '*.java' |
  Where-Object { $_.FullName -notmatch '\\target\\|\\src\\test\\' }
foreach ($file in $javaFiles) {
  if (Select-String -LiteralPath $file.FullName -Pattern 'OpenTelemetrySdk\s*\.\s*builder|SdkTracerProvider\s*\.\s*builder|GlobalOpenTelemetry\s*\.\s*set\s*\(|\.setSampler\s*\(|buildAndRegisterGlobal\s*\(' -Quiet) {
    $failures += "Application provider construction: $($file.FullName)"
  }
}
$poms = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -Filter 'pom.xml' |
  Where-Object { $_.FullName -notmatch '\\target\\' }
foreach ($file in $poms) {
  [xml]$pom = Get-Content -Raw -LiteralPath $file.FullName
  $isExtension = $file.FullName -eq $extensionPom
  if ($isExtension) {
    $artifactId = $pom.SelectSingleNode("/*[local-name()='project']/*[local-name()='artifactId']").InnerText
    $group = $pom.SelectSingleNode("/*[local-name()='project']/*[local-name()='groupId']")
    $version = $pom.SelectSingleNode("/*[local-name()='project']/*[local-name()='version']")
    $parent = $pom.SelectSingleNode("/*[local-name()='project']/*[local-name()='parent']")
    $groupValue = if ($group) { $group.InnerText } else { $parent.SelectSingleNode("*[local-name()='groupId']").InnerText }
    $versionValue = if ($version) { $version.InnerText } else { $parent.SelectSingleNode("*[local-name()='version']").InnerText }
    if ($artifactId -ne $extension.artifactId -or $groupValue -ne $extension.groupId -or $versionValue -ne $extension.version) {
      $failures += 'Unapproved extension GAV'
    }
  }
  foreach ($property in $pom.SelectNodes("/*[local-name()='project']/*[local-name()='properties']/*")) {
    if ($property.LocalName -match '^contoso\.sdk\..*\.compiler\.include$' -and
        $property.InnerText -ne 'com.contoso:compiler-sdk-disabled') {
      if (-not $isExtension -or $property.InnerText -notmatch '^io\.opentelemetry:opentelemetry-sdk-(trace|common|extension-autoconfigure-spi):\[1\.65\.0\]:jar:provided$') {
        $failures += "Unapproved compiler exception in $($file.FullName)"
      }
    }
  }
  foreach ($dependency in $pom.SelectNodes("//*[local-name()='dependency']")) {
    $artifact = $dependency.SelectSingleNode("*[local-name()='artifactId']").InnerText
    $dependencyGroup = $dependency.SelectSingleNode("*[local-name()='groupId']").InnerText
    $scopeNode = $dependency.SelectSingleNode("*[local-name()='scope']")
    $versionNode = $dependency.SelectSingleNode("*[local-name()='version']")
    $scope = if ($scopeNode) { $scopeNode.InnerText } else { 'compile' }
    $version = if ($versionNode) { $versionNode.InnerText } else { '' }
    $sdkAllowed = $isExtension -and $dependencyGroup -eq 'io.opentelemetry' -and $artifact -in $sdkArtifacts -and $scope -eq 'provided' -and
      $version -in @('1.65.0','${opentelemetry.version}')
    if ($artifact -match '^(opentelemetry-sdk|opentelemetry-exporter|applicationinsights-(core|web)|azure-core-tracing-opentelemetry|azure-functions-java-opentelemetry|micrometer-tracing)') {
      if (-not $sdkAllowed) { $failures += "Forbidden dependency $artifact ($scope) in $($file.FullName)" }
    }
    if ($isExtension -and $artifact -in @('opentelemetry-api','opentelemetry-context') -and $scope -ne 'provided') {
      $failures += "Extension API must also be PROVIDED: $artifact"
    }
    if ($artifact -eq 'contoso-parent-safe-sampler' -and
        $dependency.ParentNode.LocalName -eq 'dependencies' -and
        $dependency.ParentNode.ParentNode.LocalName -ne 'dependencyManagement') {
      $failures += "Extension must not enter the application dependency classpath: $($file.FullName)"
    }
  }
}
foreach ($directory in @('services','workers')) {
  $path = Join-Path $ProjectRoot $directory
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $artifacts = Get-ChildItem -LiteralPath $path -Recurse -Filter '*.jar' |
    Where-Object { $_.FullName -match '\\target\\[^\\]+\.jar$|\\target\\azure-functions\\[^\\]+\\lib\\[^\\]+\.jar$' }
  foreach ($artifact in $artifacts) {
    if ($artifact.Name -match '^(opentelemetry-sdk|opentelemetry-exporter|applicationinsights|azure-monitor-opentelemetry|azure-core-tracing-opentelemetry|azure-functions-java-opentelemetry|micrometer-tracing|contoso-parent-safe-sampler)') {
      $failures += "Forbidden packaged runtime dependency: $($artifact.FullName)"
    }
    try {
      $zip = [IO.Compression.ZipFile]::OpenRead($artifact.FullName)
      try { $failures += @(Test-ApplicationArchive $zip $artifact.FullName) }
      finally { $zip.Dispose() }
    } catch { $failures += "Unreadable application archive: $($artifact.FullName)" }
  }
}
if ($extension) {
  $jar = Join-Path $ProjectRoot "$($extension.module)\$($extension.file)"
  if (Test-Path -LiteralPath $jar) {
    if ($extension.sha256) {
      if ((Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $extension.sha256) {
        $failures += 'Extension hash mismatch'
      }
    } elseif ($requireExtension) { $failures += 'Extension is not hash-frozen' }
    $zip = [IO.Compression.ZipFile]::OpenRead($jar)
    try {
      foreach ($entry in $zip.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        if ($entry.FullName -match '^(io/opentelemetry/|BOOT-INF/lib/|lib/)' -or $entry.FullName.EndsWith('.jar')) {
          $failures += "Bundled runtime dependency in extension: $($entry.FullName)"
        }
        if ($entry.FullName.EndsWith('.class') -and -not $entry.FullName.StartsWith('com/contoso/')) {
          $failures += "Unapproved extension class: $($entry.FullName)"
        }
        if ($entry.FullName.StartsWith('META-INF/services/') -and $entry.FullName -ne $extension.providerService) {
          $failures += "Unapproved extension service: $($entry.FullName)"
        }
      }
      $service = $zip.GetEntry($extension.providerService)
      if (-not $service) { $failures += 'Missing AutoConfigurationCustomizerProvider service' }
      else {
        $reader = [IO.StreamReader]::new($service.Open())
        try { $providers = @($reader.ReadToEnd() -split '\r?\n' | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') }) }
        finally { $reader.Dispose() }
        if ($providers.Count -ne 1 -or $providers[0].Trim() -notmatch '^com\.contoso\.') { $failures += 'Exactly one Contoso provider is required' }
        elseif ($extension.providerClass -and $providers[0].Trim() -ne $extension.providerClass) { $failures += 'Extension provider ABI mismatch' }
      }
    } finally { $zip.Dispose() }
    if ($requireExtension -and (-not $extension.runtimeLoaderArgument -or -not $extension.providerClass)) {
      $failures += 'Extension loader/classloader ABI evidence remains unfrozen'
    }
    if ($requireExtension) {
      $probePath = Join-Path $ProjectRoot $extension.probeReport
      if (-not (Test-Path -LiteralPath $probePath)) { $failures += 'Actual extension loader probe evidence missing' }
      else {
        $probe = Get-Content -Raw -LiteralPath $probePath | ConvertFrom-Json
        if ($probe.result -ne 'PASS' -or $probe.agentSha256 -ne $lock.agent.sha256 -or
            $probe.extensionSha256 -ne $extension.sha256 -or $probe.sdkAbi -ne $extension.sdkAbi -or
            $probe.providerClass -ne $extension.providerClass) { $failures += 'Extension probe inventory mismatch' }
        $counts = @($probe.phases | ForEach-Object { $_.nativeSpanCount })
        if (($counts -join ',') -ne '2,0,2') { $failures += 'Delegate on/off/on native evidence mismatch' }
        foreach ($phase in $probe.phases) {
          if ($phase.sourceKind -ne 'real-local-agent-loopback' -or $phase.certificationEligible -ne $false -or
              @($phase.spiLoads).Count -ne 1) { $failures += 'Invalid runtime source/SPI evidence' }
          $spi = $phase.spiLoads[0]
          if (-not $spi.Contains("extensionLoader=$($extension.extensionLoader)") -or
              -not $spi.Contains("delegate=$($extension.delegateClass)") -or
              -not $spi.Contains("delegateLoader=$($extension.delegateLoader)")) { $failures += 'Classloader/delegate evidence mismatch' }
          foreach ($classpath in $phase.runtimeClasspath) {
            if ($classpath -match 'opentelemetry-sdk|contoso-parent-safe-sampler.*\.jar$') {
              $failures += 'Provided SDK/extension leaked into application runtime classpath'
            }
          }
          foreach ($observation in $phase.observations) {
            if ($observation.inputTraceparent.EndsWith('-00') -and
                ($observation.serverSampled -ne $false -or $observation.serverRecording -ne $false -or
                 -not $observation.wire.traceparent.EndsWith('-00'))) {
              $failures += 'Unsampled parent safety evidence failed'
            }
          }
        }
      }
    }
  } elseif ($requireExtension) { $failures += 'Required extension JAR missing' }
}
if ($requireExtension -and -not $extension) { $failures += 'Required frozen extension inventory missing' }
if ($failures.Count) { $failures | Write-Error; throw 'GATE-02 FAIL' }
if ($RequireArtifacts) {
  Write-Output 'GATE-02 pinned artifact/all-scope/SPI/local-classloader evidence PASS; deployed startup and vendor support remain To Do.'
} else {
  Write-Output 'GATE-02 source/all-scope/JAR construction checks PASS; full artifact/deployed acceptance requires separate evidence.'
}
