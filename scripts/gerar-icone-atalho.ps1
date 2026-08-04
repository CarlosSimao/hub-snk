<#
.SYNOPSIS
    Gera public\img\sankhya-hub.ico (e .png) a partir de public\img\logo-sankhya-hub.png,
    pro atalho do Desktop.

.DESCRIPTION
    Roda uma vez (ou sempre que a logo mudar). Fundo branco da logo original vira
    transparente, a imagem eh cortada na caixa do conteudo e centralizada num
    canvas 256x256. O .ico gerado eh versionado no repo, entao quem so cria o
    atalho (criar-atalho.ps1) nao precisa rodar este script.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\gerar-icone-atalho.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$RaizRepo = Split-Path -Parent $PSScriptRoot
$CaminhoOrigem = Join-Path $RaizRepo 'public\img\logo-sankhya-hub.png'
$CaminhoPng = Join-Path $RaizRepo 'public\img\sankhya-hub.png'
$CaminhoIco = Join-Path $RaizRepo 'public\img\sankhya-hub.ico'

if (-not (Test-Path -LiteralPath $CaminhoOrigem)) {
    throw "nao encontrei $CaminhoOrigem"
}

$origem = [System.Drawing.Bitmap]::FromFile($CaminhoOrigem)

<#
    Remove o fundo branco: quanto mais perto de branco puro o pixel, mais
    transparente fica. A faixa 200-250 (em vez de um corte seco) preserva o
    anti-aliasing da borda em vez de deixar um halo branco duro ao redor da logo.
#>
$LimiarOpaco = 200
$LimiarTransparente = 250

$semFundo = New-Object System.Drawing.Bitmap $origem.Width, $origem.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for ($y = 0; $y -lt $origem.Height; $y++) {
    for ($x = 0; $x -lt $origem.Width; $x++) {
        $pixel = $origem.GetPixel($x, $y)
        $distanciaDoBranco = [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))

        if ($distanciaDoBranco -ge $LimiarTransparente) {
            $alfa = 0
        } elseif ($distanciaDoBranco -le $LimiarOpaco) {
            $alfa = $pixel.A
        } else {
            $fracaoBranco = ($distanciaDoBranco - $LimiarOpaco) / ($LimiarTransparente - $LimiarOpaco)
            $alfa = [int]($pixel.A * (1 - $fracaoBranco))
        }

        $semFundo.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alfa, $pixel.R, $pixel.G, $pixel.B))
    }
}
$origem.Dispose()

# Caixa delimitadora do conteudo visivel (alfa > 0), pra cortar a margem branca.
$minX = $semFundo.Width; $maxX = 0; $minY = $semFundo.Height; $maxY = 0
for ($y = 0; $y -lt $semFundo.Height; $y++) {
    for ($x = 0; $x -lt $semFundo.Width; $x++) {
        if ($semFundo.GetPixel($x, $y).A -gt 8) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$caixa = New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
$cortada = $semFundo.Clone($caixa, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$semFundo.Dispose()

# Canvas final 256x256, logo centralizada com uma margem de respiro.
$Tamanho = 256
$Margem = 20
$areaUtil = $Tamanho - 2 * $Margem
$fatorEscala = [Math]::Min($areaUtil / $cortada.Width, $areaUtil / $cortada.Height)
$larguraFinal = [int]($cortada.Width * $fatorEscala)
$alturaFinal = [int]($cortada.Height * $fatorEscala)

$final = New-Object System.Drawing.Bitmap $Tamanho, $Tamanho, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graficos = [System.Drawing.Graphics]::FromImage($final)
$graficos.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graficos.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graficos.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graficos.Clear([System.Drawing.Color]::Transparent)

# Fundo circular branco, ocupando todo canvas — sem ele o icone fica sem contorno
# no Desktop (tema escuro engole a logo transparente).
$pincelBranco = [System.Drawing.Brushes]::White
$graficos.FillEllipse($pincelBranco, 0, 0, $Tamanho, $Tamanho)

$destino = New-Object System.Drawing.Rectangle (($Tamanho - $larguraFinal) / 2), (($Tamanho - $alturaFinal) / 2), $larguraFinal, $alturaFinal
$graficos.DrawImage($cortada, $destino)
$graficos.Dispose()
$cortada.Dispose()

$final.Save($CaminhoPng, [System.Drawing.Imaging.ImageFormat]::Png)

<#
    Icones 256x256 guardam um PNG puro dentro do container ICO (suportado desde o
    Vista) — Icon.FromHandle()/Icon.Save() reduziria pra paleta de poucas cores e
    lavaria as cores da logo, entao monta o ICONDIR na mao.
#>
$streamPng = New-Object System.IO.MemoryStream
$final.Save($streamPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bytesPng = $streamPng.ToArray()
$streamPng.Dispose()
$final.Dispose()

$fs = [System.IO.File]::Create($CaminhoIco)
$escritor = New-Object System.IO.BinaryWriter $fs

$escritor.Write([UInt16]0)      # reservado
$escritor.Write([UInt16]1)      # tipo: 1 = icone
$escritor.Write([UInt16]1)      # 1 imagem no container

$escritor.Write([byte]0)        # largura: 0 = 256px
$escritor.Write([byte]0)        # altura: 0 = 256px
$escritor.Write([byte]0)        # paleta: 0 = sem paleta (true color)
$escritor.Write([byte]0)        # reservado
$escritor.Write([UInt16]1)      # planes de cor
$escritor.Write([UInt16]32)     # bits por pixel
$escritor.Write([UInt32]$bytesPng.Length)
$escritor.Write([UInt32]22)     # offset dos dados: 6 (ICONDIR) + 16 (ICONDIRENTRY)

$escritor.Write($bytesPng)
$escritor.Flush()
$fs.Close()

Write-Host "Gerado: $CaminhoPng" -ForegroundColor Green
Write-Host "Gerado: $CaminhoIco" -ForegroundColor Green
