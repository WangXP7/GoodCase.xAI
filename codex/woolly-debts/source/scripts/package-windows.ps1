[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Join-Path $projectRoot 'release'
$package = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$electronSource = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'node_modules\electron\dist')).Path
$stagingRoot = Join-Path $releaseRoot "WoollyDebts-$version-win32-x64"
$portableExe = Join-Path $releaseRoot "WoollyDebts-$version-portable.exe"
$zipFile = Join-Path $releaseRoot "WoollyDebts-$version-win-x64.zip"
$hashManifest = Join-Path $releaseRoot "SHA256SUMS-$version.md"
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$tscCli = Join-Path $projectRoot 'node_modules\typescript\bin\tsc'
$viteCli = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$builderCli = Join-Path $projectRoot 'node_modules\electron-builder\cli.js'

if ($electronSource -ne (Join-Path $projectRoot 'node_modules\electron\dist')) {
    throw "Unexpected Electron source: $electronSource"
}

Push-Location $projectRoot
try {
    & $nodeExe $tscCli --noEmit
    if ($LASTEXITCODE -ne 0) { throw "TypeScript validation failed with exit code $LASTEXITCODE" }
    & $nodeExe $viteCli build
    if ($LASTEXITCODE -ne 0) { throw "Vite build failed with exit code $LASTEXITCODE" }

    foreach ($generatedPath in @($stagingRoot, $portableExe, $zipFile)) {
        if (Test-Path -LiteralPath $generatedPath) {
            $resolved = (Resolve-Path -LiteralPath $generatedPath).Path
            if (-not $resolved.StartsWith("$releaseRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Unsafe generated-output cleanup target: $resolved"
            }
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }

    New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
    Copy-Item -Path "$electronSource\*" -Destination $stagingRoot -Recurse -Force

    $appRoot = Join-Path $stagingRoot 'resources\app'
    New-Item -ItemType Directory -Force -Path $appRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination (Join-Path $appRoot 'dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'electron') -Destination (Join-Path $appRoot 'electron') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination (Join-Path $appRoot 'package.json') -Force
    Move-Item -LiteralPath (Join-Path $stagingRoot 'electron.exe') -Destination (Join-Path $stagingRoot 'WoollyDebts.exe')

    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    & $nodeExe $builderCli --prepackaged $stagingRoot --win portable
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }
    Compress-Archive -LiteralPath $stagingRoot -DestinationPath $zipFile -CompressionLevel Optimal

    $hashes = @($portableExe, $zipFile) | ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
        "- ``$([System.IO.Path]::GetFileName($_))``: ``$($hash.Hash.ToLowerInvariant())``"
    }
    $manifest = @(
        '# Windows Release SHA-256',
        '',
        "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
        '',
        $hashes
    )
    Set-Content -LiteralPath $hashManifest -Value $manifest -Encoding UTF8
}
finally {
    Pop-Location
}
