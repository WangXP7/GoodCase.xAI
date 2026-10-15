param(
    [string]$Version = "v0.3.0",
    [switch]$SkipBuild,
    [switch]$CreateZip
)

$ErrorActionPreference = "Stop"
$projectRoot = "D:\68.AIGC\JARVIS"
$projectFile = Join-Path $projectRoot "src\Jarvis.VisualPrototype\Jarvis.VisualPrototype.csproj"
$dotnet = Join-Path $projectRoot ".tools\dotnet\dotnet.exe"
$source = Join-Path $projectRoot "src\Jarvis.VisualPrototype\bin\x64\Release\net10.0-windows10.0.19041.0\win-x64"
$destination = Join-Path $projectRoot "releases\$Version"

if (-not $SkipBuild) {
    $env:DOTNET_CLI_HOME = Join-Path $projectRoot ".tools\dotnet-home"
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
    $env:DOTNET_NOLOGO = "1"
    & $dotnet build $projectFile -c Release -p:Platform=x64 --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "Release build failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path -LiteralPath $source)) {
    throw "Verified build output does not exist: $source"
}
if (Test-Path -LiteralPath $destination) {
    throw "Versioned release destination already exists: $destination"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
& robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XF jarvis-startup.log /XD publish /NFL /NDL /NP
$robocopyExitCode = $LASTEXITCODE
if ($robocopyExitCode -gt 7) {
    throw "Release assembly copy failed with robocopy exit code $robocopyExitCode."
}

$requiredFiles = @(
    "Jarvis.VisualPrototype.exe",
    "Jarvis.VisualPrototype.dll",
    "Jarvis.VisualPrototype.pri",
    "App.xbf",
    "MainWindow.xbf",
    "MainPage.xbf",
    "OverlayWindow.xbf",
    "Assets\AppIcon.ico"
)
foreach ($requiredFile in $requiredFiles) {
    $requiredPath = Join-Path $destination $requiredFile
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required WinUI runtime resource is missing: $requiredFile"
    }
}

$exePath = Join-Path $destination "Jarvis.VisualPrototype.exe"
$allFiles = Get-ChildItem -LiteralPath $destination -Recurse -File
$manifest = [ordered]@{
    version = $Version
    assembled_at = (Get-Date).ToString("o")
    target = "win-x64"
    minimum_windows = "10.0.19041.0"
    framework = "net10.0-windows10.0.19041.0"
    self_contained = $true
    folder_based = $true
    executable = "Jarvis.VisualPrototype.exe"
    executable_bytes = (Get-Item -LiteralPath $exePath).Length
    executable_sha256 = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
    payload_measurement_scope = "release payload excluding release-manifest.json"
    payload_file_count = $allFiles.Count
    payload_total_bytes = ($allFiles | Measure-Object Length -Sum).Sum
    verified_runtime_resources = $requiredFiles
}
$manifestPath = Join-Path $destination "release-manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8

if ($CreateZip) {
    $zipPath = Join-Path (Split-Path $destination -Parent) "JARVIS.VisualPrototype-$Version-win-x64.zip"
    if (Test-Path -LiteralPath $zipPath) {
        throw "Versioned ZIP destination already exists: $zipPath"
    }
    Compress-Archive -Path (Join-Path $destination "*") -DestinationPath $zipPath -CompressionLevel Optimal

    $checksumPath = Join-Path (Split-Path $destination -Parent) "SHA256SUMS-$Version.txt"
    @(
        "$((Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash)  $Version/Jarvis.VisualPrototype.exe",
        "$((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)  JARVIS.VisualPrototype-$Version-win-x64.zip"
    ) | Set-Content -LiteralPath $checksumPath -Encoding ascii
}

Get-Content -LiteralPath $manifestPath -Encoding utf8
if ($CreateZip) {
    Get-Item -LiteralPath $zipPath | Select-Object FullName, Length, LastWriteTime
    Get-Content -LiteralPath $checksumPath -Encoding ascii
}
