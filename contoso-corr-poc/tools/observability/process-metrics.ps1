param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$ProcessId)
$ErrorActionPreference = 'Stop'
$process = Get-Process -Id $ProcessId
[pscustomobject]@{
    processId = $ProcessId
    observedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    cpuSeconds = $process.CPU
    workingSetBytes = $process.WorkingSet64
    privateMemoryBytes = $process.PrivateMemorySize64
    sourceKind = 'actual-local-process'
} | ConvertTo-Json -Compress
