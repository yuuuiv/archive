<#
切一个视频为 HLS 分段 + 封面，校验分段大小不超过 Telegram Bot 20MB 下载上限。
用法: .\process.ps1 -InputFile "E:\xxx.ts" -Slug "250530-hasunosora-4th-hyogo-day0"
#>
param(
    [Parameter(Mandatory)][string]$InputFile,
    [Parameter(Mandatory)][string]$Slug,
    [string]$OutputRoot = "E:\hls",
    [int]$SegmentSeconds = 4,
    [string]$AudioBitrate = "192k",
    [int]$PosterOffsetSeconds = 0,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw "ffmpeg not found on PATH"
}
if (-not (Test-Path -LiteralPath $InputFile)) {
    throw "InputFile not found: $InputFile"
}

$outDir = Join-Path $OutputRoot $Slug
if (Test-Path -LiteralPath $outDir) {
    if ($Force) {
        Remove-Item $outDir -Recurse -Force
    } else {
        throw "$outDir already exists (use -Force to reprocess)"
    }
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Write-Host "[1/3] Slicing HLS segments -> $outDir"
& ffmpeg -y -i $InputFile `
    -c:v copy -c:a aac -b:a $AudioBitrate `
    -f hls -hls_time $SegmentSeconds -hls_playlist_type vod `
    -hls_segment_filename (Join-Path $outDir "seg_%05d.ts") `
    (Join-Path $outDir "master.m3u8")
if ($LASTEXITCODE -ne 0) { throw "ffmpeg HLS slicing failed (exit $LASTEXITCODE)" }

Write-Host "[2/3] Extracting poster frame"
& ffmpeg -y -ss $PosterOffsetSeconds -i $InputFile -frames:v 1 (Join-Path $outDir "poster.jpg") 2>$null
if ($LASTEXITCODE -ne 0) { throw "ffmpeg poster extraction failed (exit $LASTEXITCODE)" }

Write-Host "[3/3] Validating segment sizes (Telegram bot download limit: 20MB)"
$segments = Get-ChildItem $outDir -Filter "seg_*.ts"
$limitBytes = 19MB
$oversized = $segments | Where-Object { $_.Length -gt $limitBytes }
$totalGB = ($segments | Measure-Object -Sum Length).Sum / 1GB

Write-Host ""
Write-Host "Slug:      $Slug"
Write-Host "Segments:  $($segments.Count)"
Write-Host "Total:     $('{0:N2}' -f $totalGB) GB"

if ($oversized) {
    Write-Warning "$($oversized.Count) segment(s) exceed 19MB - Telegram bot cannot download files >20MB:"
    $oversized | ForEach-Object { Write-Warning "  $($_.Name): $('{0:N2}' -f ($_.Length/1MB)) MB" }
    throw "Oversized segments found; lower -SegmentSeconds and retry with -Force"
}

Write-Host "OK - all segments within limit."
