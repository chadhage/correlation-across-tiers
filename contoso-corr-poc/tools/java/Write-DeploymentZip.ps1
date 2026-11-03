param(
  [Parameter(Mandatory)] [string]$SourceDirectory,
  [Parameter(Mandatory)] [string]$Destination,
  [string[]]$Exclude = @()
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\')
$destinationPath = [IO.Path]::GetFullPath($Destination)
if ($destinationPath.StartsWith("$source\", [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP must not be inside its source directory' }
$files = @(Get-ChildItem -LiteralPath $source -Recurse -File | Sort-Object FullName)
if ($files.Count -gt 2000 -or (@($files | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count)) {
  throw 'Uninspectable deployment directory'
}
if (Test-Path -LiteralPath $destinationPath) { Remove-Item -LiteralPath $destinationPath }
$stream = [IO.File]::Open($destinationPath, [IO.FileMode]::CreateNew)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($source, $file.FullName).Replace('\', '/')
    if ($relative -in $Exclude) { continue }
    $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [DateTimeOffset]::Parse('2026-10-31T00:00:00Z')
    $input = [IO.File]::OpenRead($file.FullName)
    $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
  }
} finally { $zip.Dispose(); $stream.Dispose() }
Write-Output $destinationPath
