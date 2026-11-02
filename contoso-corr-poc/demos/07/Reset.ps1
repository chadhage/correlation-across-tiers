$ErrorActionPreference = 'Stop'
& node "$PSScriptRoot\..\..\tools\verification\demo.mjs" --reset --demo 07 @args
exit $LASTEXITCODE
