param([Parameter(Mandatory)] [string]$LogPath)
$ErrorActionPreference = 'Stop'
$log = Get-Content -Raw -LiteralPath $LogPath
$loads = @([regex]::Matches($log, 'CONTOSO_PARENT_SAFE_SAMPLER_LOADED abi=1\.65\.0'))
if ($loads.Count -ne 1) { throw 'GATE-02 startup must show exactly one actual sampler SPI load' }
if ($log -match '(?i)GATE_(?:02|05)_|duplicate.{0,80}(agent|provider|exporter)|(?:agent|provider|exporter).{0,80}duplicate|UnsupportedClassVersionError|IllegalClassFormatException|ClassFormatError|(?:bytecode|transform).{0,100}(?:error|fail)|failed to export|exporter.{0,100}(?:reject|fail|error)|failed to send telemetry') {
  throw 'GATE-02 startup/export/transformation failure observed'
}
'GATE-02 startup-log local check PASS; successful native ingestion still requires its own oracle.'
