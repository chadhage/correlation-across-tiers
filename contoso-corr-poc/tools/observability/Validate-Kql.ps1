param([string]$ParserPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $ParserPath) { $ParserPath = Join-Path $root '.cache\r7\kusto\Kusto.Language.dll' }
if (-not (Test-Path -LiteralPath $ParserPath)) { throw 'Missing local Kusto.Language compiler; restore its pinned package into project .cache, not a global install.' }
Add-Type -Path $ParserPath
$common = 'TimeGenerated:datetime,Id:string,ParentId:string,OperationId:string,AppRoleName:string,Properties:dynamic,DurationMs:real,ItemCount:int,_ResourceId:string'
$legacy = 'timestamp:datetime,id:string,operation_ParentId:string,operation_Id:string,cloud_RoleName:string,customDimensions:dynamic,duration:timespan,itemCount:int'
$tables = [Collections.Generic.List[Kusto.Language.Symbols.TableSymbol]]::new()
foreach ($name in @('AppRequests','AppDependencies','AppTraces','AppExceptions','AppPageViews','AppEvents')) {
    $schema = if ($name -in @('AppRequests','AppDependencies','AppPageViews')) { $common } else {
        [regex]::Replace($common, '(^|,)Id:string,', '$1').Replace('DurationMs:real,','')
    }
    $tables.Add([Kusto.Language.Symbols.TableSymbol]::new($name, "($schema)"))
}
foreach ($name in @('requests','dependencies','traces','exceptions','pageViews','customEvents')) {
    $schema = if ($name -in @('requests','dependencies','pageViews')) { $legacy } else {
        [regex]::Replace($legacy, '(^|,)id:string,', '$1').Replace('duration:timespan,','')
    }
    $tables.Add([Kusto.Language.Symbols.TableSymbol]::new($name, "($schema)"))
}
$database = [Kusto.Language.Symbols.DatabaseSymbol]::new('ContosoSchemaFixture', $tables)
$globals = [Kusto.Language.GlobalState]::Default.WithDatabase($database)
$failed = $false
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root '.cache\r7\rendered-kql') -Filter '*.kql') {
    $code = [Kusto.Language.KustoCode]::ParseAndAnalyze((Get-Content -LiteralPath $file.FullName -Raw), $globals)
    $errors = @($code.GetDiagnostics() | Where-Object Severity -EQ 'Error')
    if ($errors.Count) {
        $failed = $true
        $errors | ForEach-Object { "$($file.Name): $($_.Code) $($_.Message) at $($_.Start)" }
    } else { "PASS local KQL syntax/declared-schema analysis: $($file.Name)" }
}
if ($failed) { throw 'Local KQL compiler errors; no Azure query was executed.' }
