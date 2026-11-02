$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --reset --demo 03 @args
exit $LASTEXITCODE
