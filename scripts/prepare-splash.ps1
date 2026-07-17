param(
  [Parameter(Mandatory = $true)][string]$SourcePng,
  [Parameter(Mandatory = $true)][string]$OutputBmp
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$width = 640
$height = 360
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$backgroundRect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
$background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $backgroundRect,
  [System.Drawing.Color]::FromArgb(8, 17, 31),
  [System.Drawing.Color]::FromArgb(18, 35, 62),
  18
)
$graphics.FillRectangle($background, $backgroundRect)

$cyanGlow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 103, 215, 220))
$blueGlow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 53, 104, 207))
$graphics.FillEllipse($cyanGlow, -70, -115, 370, 370)
$graphics.FillEllipse($blueGlow, 430, 170, 300, 300)

$panelBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(178, 10, 22, 40))
$panelPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 103, 215, 220), 1)
$graphics.FillRectangle($panelBrush, 26, 26, 588, 308)
$graphics.DrawRectangle($panelPen, 26, 26, 588, 308)

$icon = [System.Drawing.Image]::FromFile($SourcePng)
$graphics.DrawImage($icon, 62, 91, 166, 166)

$titleFont = New-Object System.Drawing.Font 'Segoe UI', 34, ([System.Drawing.FontStyle]::Bold)
$subtitleFont = New-Object System.Drawing.Font 'Segoe UI', 16, ([System.Drawing.FontStyle]::Regular)
$detailFont = New-Object System.Drawing.Font 'Segoe UI', 10.5, ([System.Drawing.FontStyle]::Regular)
$creditFont = New-Object System.Drawing.Font 'Segoe UI', 8.5, ([System.Drawing.FontStyle]::Regular)
$creditBoldFont = New-Object System.Drawing.Font 'Segoe UI', 8.5, ([System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(236, 252, 255))
$cyanBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(103, 215, 220))
$mutedBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(169, 188, 215))

$graphics.DrawString('TurboWhats', $titleFont, $titleBrush, 252, 100)
$graphics.DrawString('Preparando seu atendimento...', $subtitleFont, $cyanBrush, 255, 164)
$resourcesText = 'Estamos abrindo os recursos necess' + [char]0x00E1 + 'rios.'
$graphics.DrawString($resourcesText, $detailFont, $mutedBrush, 257, 208)
$graphics.DrawString('Na primeira abertura, isso pode levar alguns segundos.', $detailFont, $mutedBrush, 257, 231)

$dotBrush1 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(53, 104, 207))
$dotBrush2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(82, 160, 213))
$dotBrush3 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(103, 215, 220))
$graphics.FillEllipse($dotBrush1, 257, 277, 8, 8)
$graphics.FillEllipse($dotBrush2, 273, 277, 8, 8)
$graphics.FillEllipse($dotBrush3, 289, 277, 8, 8)

$creditText = 'Desenvolvido por Henrique Louro  ' + [char]0x2022 + '  Contato: 21981682922'
$graphics.DrawString($creditText, $creditBoldFont, $cyanBrush, 257, 295)
$graphics.DrawString([char]0x00A9 + ' 2026 Henrique Louro. Todos os direitos reservados.', $creditFont, $mutedBrush, 257, 313)

$outputDirectory = Split-Path -Parent $OutputBmp
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }
$bitmap.Save($OutputBmp, [System.Drawing.Imaging.ImageFormat]::Bmp)

$dotBrush3.Dispose()
$dotBrush2.Dispose()
$dotBrush1.Dispose()
$mutedBrush.Dispose()
$cyanBrush.Dispose()
$titleBrush.Dispose()
$detailFont.Dispose()
$creditBoldFont.Dispose()
$creditFont.Dispose()
$subtitleFont.Dispose()
$titleFont.Dispose()
$icon.Dispose()
$panelPen.Dispose()
$panelBrush.Dispose()
$blueGlow.Dispose()
$cyanGlow.Dispose()
$background.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Splash preparado: $OutputBmp"
