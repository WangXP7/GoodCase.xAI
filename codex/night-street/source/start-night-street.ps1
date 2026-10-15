[CmdletBinding()]
param(
    [switch]$Development
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $projectDirectory
try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js is required. Install Node.js 20.9 or newer, then run this launcher again.'
    }

    if (-not (Test-Path -LiteralPath 'node_modules')) {
        Write-Host 'Installing the locked dependency set...'
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE."
        }
    }

    if ($Development) {
        Write-Host 'Night Street development server: http://127.0.0.1:3000'
        & npm.cmd run dev
    }
    else {
        $pagesBuild = $false
        if (Test-Path -LiteralPath '.next\routes-manifest.json') {
            $routes = Get-Content -LiteralPath '.next\routes-manifest.json' -Raw | ConvertFrom-Json
            $pagesBuild = [bool]$routes.basePath
        }
        if ($pagesBuild -or -not (Test-Path -LiteralPath '.next\BUILD_ID')) {
            Write-Host 'Creating the production build...'
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) {
                throw "npm run build failed with exit code $LASTEXITCODE."
            }
        }

        Write-Host 'Night Street is starting at http://127.0.0.1:3000'
        Write-Host 'Leave this window open while playing. Press Ctrl+C to stop the server.'
        & npm.cmd run start
    }

    if ($LASTEXITCODE -ne 0) {
        throw "The Night Street server exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
