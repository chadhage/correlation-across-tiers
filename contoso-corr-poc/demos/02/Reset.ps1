$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --reset --demo 02 @args
exit $LASTEXITCODE
