param(
  [Parameter(Mandatory)] [long]$ProcessId,
  [string]$ExpectedServiceName
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Portable.ps1')
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$jar = Join-Path $root 'services\correlation-core\target\contoso-correlation-core-1.0.0.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw 'Actual correlation-core JAR has not been built' }
$output = & java -cp $jar com.contoso.correlation.NativeSamplingObservation ([string]$ProcessId)
if ($LASTEXITCODE -ne 0) { throw 'Actual JVM observation failed' }
$observed = $output | ConvertFrom-Json
if ($observed.schema -ne 'contoso.sampling-runtime-observation.v1' -or
    $observed.runtimeInstanceId -ne [string]$ProcessId -or
    ($ExpectedServiceName -and $observed.serviceName -ne $ExpectedServiceName)) {
  throw 'Actual process/service observation does not match the requested participant'
}
$output
