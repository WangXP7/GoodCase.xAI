param(
    [string]$InputDir = "D:\68.AIGC\JARVIS\design\demo-pack-v0.2.0",
    [string]$OutputPath = "D:\68.AIGC\JARVIS\design\contact-sheets\JARVIS_DEMO_CONTACT_SHEET_v0.2.0.png"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$items = @(
    [PSCustomObject]@{ Label = "A  ORBITAL CORE"; File = "JARVIS_DEMO_A_ORBITAL_CORE.png" },
    [PSCustomObject]@{ Label = "B  GLASS COMMAND DECK"; File = "JARVIS_DEMO_B_GLASS_COMMAND_DECK.png" },
    [PSCustomObject]@{ Label = "C  GHOST OVERLAY"; File = "JARVIS_DEMO_C_GHOST_OVERLAY.png" },
    [PSCustomObject]@{ Label = "D  TACTICAL FOCUS"; File = "JARVIS_DEMO_D_TACTICAL_FOCUS.png" }
)

foreach ($item in $items) {
    $candidate = Join-Path $InputDir $item.File
    if (-not (Test-Path -LiteralPath $candidate)) {
        throw "Missing image: $candidate"
    }
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$canvasWidth = 2560
$canvasHeight = 1640
$outerMargin = 40
$columnGap = 40
$rowGap = 30
$titleHeight = 90
$labelHeight = 48
$panelWidth = [int](($canvasWidth - ($outerMargin * 2) - $columnGap) / 2)
$panelHeight = [int](($canvasHeight - $titleHeight - ($outerMargin * 2) - $rowGap) / 2)
$imageHeight = $panelHeight - $labelHeight

$bitmap = New-Object System.Drawing.Bitmap($canvasWidth, $canvasHeight)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$background = [System.Drawing.Color]::FromArgb(255, 5, 10, 16)
$panelBackground = [System.Drawing.Color]::FromArgb(255, 8, 18, 28)
$cyan = [System.Drawing.Color]::FromArgb(255, 66, 217, 255)
$muted = [System.Drawing.Color]::FromArgb(255, 157, 183, 204)
$border = [System.Drawing.Color]::FromArgb(255, 31, 77, 105)

$graphics.Clear($background)

$titleFont = New-Object System.Drawing.Font("Segoe UI Semibold", 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$subtitleFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$labelFont = New-Object System.Drawing.Font("Segoe UI Semibold", 22, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$titleBrush = New-Object System.Drawing.SolidBrush($cyan)
$mutedBrush = New-Object System.Drawing.SolidBrush($muted)
$panelBrush = New-Object System.Drawing.SolidBrush($panelBackground)
$borderPen = New-Object System.Drawing.Pen($border, 2)

try {
    $graphics.DrawString("JARVIS VISUAL DEMO PACK", $titleFont, $titleBrush, $outerMargin, 20)
    $graphics.DrawString("v0.2.0  |  ORIGINAL WINDOWS AI ASSISTANT UI DIRECTIONS", $subtitleFont, $mutedBrush, $outerMargin, 57)

    for ($index = 0; $index -lt $items.Count; $index++) {
        $row = [math]::Floor($index / 2)
        $column = $index % 2
        $x = $outerMargin + ($column * ($panelWidth + $columnGap))
        $y = $outerMargin + $titleHeight + ($row * ($panelHeight + $rowGap))

        $panelRect = New-Object System.Drawing.Rectangle($x, $y, $panelWidth, $panelHeight)
        $graphics.FillRectangle($panelBrush, $panelRect)
        $graphics.DrawRectangle($borderPen, $panelRect)
        $graphics.DrawString($items[$index].Label, $labelFont, $titleBrush, $x + 16, $y + 10)

        $sourcePath = Join-Path $InputDir $items[$index].File
        $source = [System.Drawing.Image]::FromFile($sourcePath)
        try {
            $availableWidth = $panelWidth
            $availableHeight = $imageHeight
            $scale = [math]::Min($availableWidth / $source.Width, $availableHeight / $source.Height)
            $drawWidth = [int]($source.Width * $scale)
            $drawHeight = [int]($source.Height * $scale)
            $drawX = $x + [int](($availableWidth - $drawWidth) / 2)
            $drawY = $y + $labelHeight + [int](($availableHeight - $drawHeight) / 2)
            $destination = New-Object System.Drawing.Rectangle($drawX, $drawY, $drawWidth, $drawHeight)
            $graphics.DrawImage($source, $destination)
        }
        finally {
            $source.Dispose()
        }
    }

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $borderPen.Dispose()
    $panelBrush.Dispose()
    $mutedBrush.Dispose()
    $titleBrush.Dispose()
    $labelFont.Dispose()
    $subtitleFont.Dispose()
    $titleFont.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Get-Item -LiteralPath $OutputPath | Select-Object FullName, Length, LastWriteTime
