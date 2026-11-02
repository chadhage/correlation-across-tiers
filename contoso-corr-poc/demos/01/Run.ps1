$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --demo 01 @args
exit $LASTEXITCODE
