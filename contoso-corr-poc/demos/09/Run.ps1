$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --demo 09 @args
exit $LASTEXITCODE
