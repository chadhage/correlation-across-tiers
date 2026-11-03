param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Portable.ps1')
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$java = Join-Path $env:JAVA_HOME 'bin\java.exe'
$repository = [regex]::Match($env:MAVEN_OPTS, '-Dmaven.repo.local=([^\s]+)').Groups[1].Value
$functionsLibrary = Join-Path $repository 'com\microsoft\azure\functions\azure-functions-java-library\3.3.0\azure-functions-java-library-3.3.0.jar'
$functionsCore = Join-Path $repository 'com\microsoft\azure\functions\azure-functions-java-core-library\1.3.0\azure-functions-java-core-library-1.3.0.jar'
if (-not (Test-Path -LiteralPath $functionsLibrary)) { throw 'Declared Functions SDK API (normally supplied by the host) is missing' }
if (-not (Test-Path -LiteralPath $functionsCore)) { throw 'Declared Functions core API (normally supplied by the host) is missing' }
$probes = @(
  @{role='contoso-orders-api'; jar='services\orders-api\target\deployment\app.jar'},
  @{role='contoso-inventory-api'; jar='services\inventory-api\target\deployment\app.jar'},
  @{role='replay'; jar='workers\replay\target\deployment\app.jar'}
)
$results = @()
function Check-Launch([string]$Role, [string[]]$Arguments) {
  $start = [Diagnostics.ProcessStartInfo]::new($java)
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($key in @('JAVA_TOOL_OPTIONS','JAVA_OPTS','JDK_JAVA_OPTIONS','_JAVA_OPTIONS')) { $start.Environment.Remove($key) | Out-Null }
  foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
  $start.ArgumentList.Insert(0, "-Djava.io.tmpdir=$root\.java-work")
  $process = [Diagnostics.Process]::Start($start)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(20000)) { $process.Kill($true); throw "Packaged launch stalled: $Role" }
  $output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
  if ($process.ExitCode -eq 0 -or -not $output.Contains('GATE_02_SINGLE_PINNED_AGENT')) {
    throw "Packaged production guard did not fail before dependencies: $Role`n$output"
  }
  return [ordered]@{role=$Role; exitCode=$process.ExitCode; missingAgentRejected=$true; actualPid=$process.Id; certified=$false}
}
foreach ($probe in $probes) {
  $arguments = @('-jar', (Join-Path $root $probe.jar))
  if ($probe.role -eq 'replay') { $arguments += @('--source','ORDERS_DLQ') }
  $results += Check-Launch $probe.role $arguments
}
foreach ($worker in @(
  @{module='fulfillment'; app='contoso-corr-poc-fulfillment'; type='com.contoso.fulfillment.FulfillmentFunctions'},
  @{module='notify'; app='contoso-corr-poc-notify'; type='com.contoso.notify.NotificationFunctions'},
  @{module='aggregator'; app='contoso-corr-poc-aggregator'; type='com.contoso.aggregator.AggregatorFunctions'}
)) {
  $directory = Join-Path $root "workers\$($worker.module)\target\azure-functions\$($worker.app)"
  $classpath = "$directory\$($worker.module)-1.0.0.jar;$directory\lib\*;$functionsLibrary;$functionsCore"
  $results += Check-Launch $worker.module @('--source','25','-cp',$classpath,(Join-Path $PSScriptRoot 'PackagedFunctionProbe.java'),$worker.type)
}
$directory = Join-Path $root 'evidence\java-local\packaged-launch-guards'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$destination = Join-Path $directory "$stamp-$([Guid]::NewGuid().ToString('D')).json"
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($results | ConvertTo-Json -Depth 4))
  $stream.Write($bytes)
} finally { $stream.Dispose() }
'Actual packaged launch guards PASS for two APIs, three SDK-managed Functions entries and replay. No Azure hosting qualification.'
"Packaged launch guard report: $destination"
