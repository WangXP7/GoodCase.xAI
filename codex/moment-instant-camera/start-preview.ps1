param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$previewUrl = 'http://127.0.0.1:4178/'

function Test-MomentPreview {
    try {
        $result = Invoke-RestMethod -Uri ($previewUrl + '__moment_health') -TimeoutSec 2
        return ($result.app -eq 'moment-instant-camera')
    } catch { return $false }
}

if (-not (Test-MomentPreview)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Write-Output 'Node.js is unavailable. Opening the standalone HTML camera.'
        if (-not $NoOpen) { Start-Process -FilePath (Join-Path $projectDirectory 'index.html') }
        exit 0
    }
    $serverFile = Join-Path $projectDirectory 'server.cjs'
    $serverArguments = '"' + $serverFile + '" 4178'
    $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList $serverArguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        if (Test-MomentPreview) { $ready = $true; break }
        if ($serverProcess.HasExited) { break }
    }
    if (-not $ready) {
        Write-Output 'The preview port is unavailable. The standalone HTML camera is still usable.'
        exit 1
    }
    Write-Output ('MOMENT background server started. PID: ' + $serverProcess.Id)
} else {
    Write-Output 'MOMENT background server is already running; reusing it.'
}
Write-Output ('MOMENT is ready: ' + $previewUrl)
if (-not $NoOpen) { Start-Process -FilePath $previewUrl }
