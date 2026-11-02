$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --demo 06 @args
exit $LASTEXITCODE
