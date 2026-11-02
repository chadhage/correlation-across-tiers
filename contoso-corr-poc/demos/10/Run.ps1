$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --demo 10 @args
exit $LASTEXITCODE
