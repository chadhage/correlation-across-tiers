function Resolve-ContosoToolsRoot {
    param([string]$ToolsRoot = $env:CONTOSO_PORTABLE_TOOLS_ROOT)
    if ([string]::IsNullOrWhiteSpace($ToolsRoot)) {
        $ToolsRoot = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.tools\java'
    }
    return [IO.Path]::GetFullPath($ToolsRoot)
}

function Assert-ContosoToolHash {
    param([string]$Path, [string]$Algorithm, [string]$Expected)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Portable tool missing: $Path. Set CONTOSO_PORTABLE_TOOLS_ROOT or run tools\java\Install-Portable.ps1."
    }
    if ([string]::IsNullOrWhiteSpace($Expected) -or
        (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToLowerInvariant() -ne $Expected.ToLowerInvariant()) {
        throw "Portable tool integrity failure: $([IO.Path]::GetFileName($Path))"
    }
}
