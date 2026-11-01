$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$directory = Join-Path $root '.cache\r7\kusto'
$package = Join-Path $directory 'microsoft.azure.kusto.language.12.4.1.nupkg'
$uri = 'https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-public/nuget/v3/flat2/microsoft.azure.kusto.language/12.4.1/microsoft.azure.kusto.language.12.4.1.nupkg'
$expected = '154c176ac9c1c4ae9cf0bc53b74354c9d35798ff587f81fe6e0005028a0a1961'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (-not (Test-Path -LiteralPath $package)) { Invoke-WebRequest -Uri $uri -OutFile $package }
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Kusto compiler package checksum mismatch'
}
$archive = [IO.Compression.ZipFile]::OpenRead($package)
try {
    $entry = $archive.GetEntry('lib/netstandard2.0/Kusto.Language.dll')
    if (-not $entry) { throw 'Pinned compiler assembly is missing' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $directory 'Kusto.Language.dll'), $true)
} finally { $archive.Dispose() }
Write-Output "Pinned local compiler restored under project cache: $directory"
