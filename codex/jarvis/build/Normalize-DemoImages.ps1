param(
    [string]$SourceDir = "D:\68.AIGC\JARVIS\design\archive\v0.1.1-native-output",
    [string]$OutputDir = "D:\68.AIGC\JARVIS\design\demo-pack-v0.2.0",
    [int]$TargetWidth = 2560,
    [int]$TargetHeight = 1440
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$fileNames = @(
    "JARVIS_DEMO_A_ORBITAL_CORE.png",
    "JARVIS_DEMO_B_GLASS_COMMAND_DECK.png",
    "JARVIS_DEMO_C_GHOST_OVERLAY.png",
    "JARVIS_DEMO_D_TACTICAL_FOCUS.png"
)

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

foreach ($fileName in $fileNames) {
    $sourcePath = Join-Path $SourceDir $fileName
    $outputPath = Join-Path $OutputDir $fileName

    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Missing source image: $sourcePath"
    }

    $source = [System.Drawing.Image]::FromFile($sourcePath)
    $target = New-Object System.Drawing.Bitmap($TargetWidth, $TargetHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)

    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $TargetWidth, $TargetHeight)
        $target.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $target.Dispose()
        $source.Dispose()
    }
}

Get-ChildItem -LiteralPath $OutputDir -Filter "*.png" |
    Sort-Object Name |
    Select-Object Name, Length, LastWriteTime
