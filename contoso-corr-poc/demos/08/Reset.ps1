$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --reset --demo 08 @args
exit $LASTEXITCODE
