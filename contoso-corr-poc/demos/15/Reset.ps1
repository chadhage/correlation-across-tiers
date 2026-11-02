$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --reset --demo 15 @args
exit $LASTEXITCODE
