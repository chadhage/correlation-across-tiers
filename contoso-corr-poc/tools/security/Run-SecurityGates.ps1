param([switch]$WorktreeOnly)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$leaf = Join-Path $root 'contoso-corr-poc'
$tests = Get-ChildItem (Join-Path $leaf 'tests\security') -Filter '*.test.mjs' | Select-Object -ExpandProperty FullName
if (-not $tests) { throw 'Security tests missing' }
& node --test $tests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$args = @((Join-Path $PSScriptRoot 'repository.mjs'), '--root', $root)
if ($WorktreeOnly) { $args += '--worktree-only' }
& node $args
exit $LASTEXITCODE
