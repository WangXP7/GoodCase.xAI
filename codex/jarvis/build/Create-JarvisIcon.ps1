param(
    [string]$OutputDirectory = "D:\68.AIGC\JARVIS\src\Jarvis.VisualPrototype\Assets"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}

$bitmap = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$background = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 4, 13, 23))
$cyan = [System.Drawing.Color]::FromArgb(255, 56, 231, 255)
$blue = [System.Drawing.Color]::FromArgb(255, 40, 124, 255)
$graphics.FillEllipse($background, 8, 8, 240, 240)

$outerPen = New-Object System.Drawing.Pen ($cyan, 8)
$outerPen.DashPattern = [single[]](5, 3)
$graphics.DrawArc($outerPen, 25, 25, 206, 206, -74, 292)

$innerPen = New-Object System.Drawing.Pen ($blue, 5)
$innerPen.DashPattern = [single[]](10, 5)
$graphics.DrawArc($innerPen, 54, 54, 148, 148, 22, 276)

$coreBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(215, 28, 117, 178))
$graphics.FillEllipse($coreBrush, 91, 91, 74, 74)
$corePen = New-Object System.Drawing.Pen ($cyan, 4)
$graphics.DrawEllipse($corePen, 91, 91, 74, 74)

$font = New-Object System.Drawing.Font "Consolas", 54, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 235, 251, 255))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("J", $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 0, 256, 256), $format)

$previewPath = Join-Path $OutputDirectory "AppIconPreview.png"
$iconPath = Join-Path $OutputDirectory "AppIcon.ico"
$bitmap.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)

$iconHandle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
try {
    $icon.Save($stream)
}
finally {
    $stream.Dispose()
    $icon.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $background.Dispose()
    $outerPen.Dispose()
    $innerPen.Dispose()
    $coreBrush.Dispose()
    $corePen.Dispose()
    $font.Dispose()
    $textBrush.Dispose()
    $format.Dispose()
}

Get-Item -LiteralPath $iconPath, $previewPath | Select-Object FullName, Length, LastWriteTime
