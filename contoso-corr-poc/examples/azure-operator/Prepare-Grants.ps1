param(
    [Parameter(Mandatory)] [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,62}$')] [string]$OperatorRole,
    [Parameter(Mandatory)] [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,62}$')] [string]$WatchdogRole,
    [Parameter(Mandatory)] [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,62}$')] [string]$FixtureRole,
    [Parameter(Mandatory)] [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
foreach ($role in @($OperatorRole, $WatchdogRole, $FixtureRole)) {
    if ($role.StartsWith('pg_', [StringComparison]::OrdinalIgnoreCase) -or
        $role.ToLowerInvariant() -in @('public', 'postgres', 'azure_pg_admin')) {
        throw 'PostgreSQL system roles are not operator principals.'
    }
}
if (@(@($OperatorRole, $WatchdogRole, $FixtureRole) | Select-Object -Unique).Count -ne 3) {
    throw 'Operator, watchdog and fixture must have distinct Entra-bound database roles.'
}
if (Test-Path -LiteralPath $OutputPath) { throw 'Refusing to overwrite an existing grants candidate.' }
$text = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'src\main\resources\db\operator-grants.sql') -Raw
$text = $text.Replace('__OPERATOR_ROLE__', $OperatorRole).Replace('__WATCHDOG_ROLE__', $WatchdogRole).Replace('__FIXTURE_ROLE__', $FixtureRole)
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $text, [Text.UTF8Encoding]::new($false))
Write-Output 'SQL prepared only. No database or Azure command was executed; existing OID-bound roles and owner approval remain required.'
