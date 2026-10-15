[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $projectDirectory
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "TypeScript verification failed with exit code $LASTEXITCODE."
    }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Production build verification failed with exit code $LASTEXITCODE."
    }

    Write-Host 'Night Street verification passed.'
}
finally {
    Pop-Location
}
