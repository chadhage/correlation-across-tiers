$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    node .\dist\bootstrap.js
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
