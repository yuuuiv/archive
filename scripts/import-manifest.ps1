<#
把 manifests/<slug>.json 导入 D1（videos + segments 两张表）。
用法: .\import-manifest.ps1 -Slug 250530-hasunosora-4th-hyogo-day0
#>
param(
    [Parameter(Mandatory)][string]$Slug,
    [string]$Database = "cerise-archive",
    [string]$HlsDir = $null,
    [int]$BatchSize = 500
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot "manifests\$Slug.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}

function Esc([string]$s) {
    if ($null -eq $s) { return "" }
    return $s.Replace("'", "''")
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

# 从本地 master.m3u8 读每段真实时长，供动态播放列表用；读不到就退回 4 秒默认值
if (-not $HlsDir) { $HlsDir = "E:\hls\$Slug" }
$m3u8Path = Join-Path $HlsDir "master.m3u8"
$durations = @{}
if (Test-Path -LiteralPath $m3u8Path) {
    $pending = $null
    foreach ($line in Get-Content -LiteralPath $m3u8Path -Encoding UTF8) {
        if ($line -match '^#EXTINF:([\d.]+)') {
            $pending = [double]$Matches[1]
        } elseif ($line -and -not $line.StartsWith('#') -and $null -ne $pending) {
            $durations[$line] = $pending
            $pending = $null
        }
    }
} else {
    Write-Warning "$m3u8Path not found, segment durations default to 4.0"
}

$sql = New-Object System.Text.StringBuilder
[void]$sql.AppendLine("DELETE FROM segments WHERE slug = '$(Esc $manifest.slug)';")
# m3u8 列不再写完整播放列表文本：media Worker 已改成从 segments 表动态拼装，
# 存整份文本只会占地方，2000+ 段的视频还会撑爆单条 D1 语句体积 (SQLITE_TOOBIG)。
[void]$sql.AppendLine(@"
INSERT INTO videos (slug, title, date, duration_seconds, segment_count, poster_file_id, m3u8,
                     franchise_slug, franchise_name, live_slug, live_name)
VALUES ('$(Esc $manifest.slug)', '$(Esc $manifest.title)', '$(Esc $manifest.date)', $($manifest.duration_seconds), $($manifest.segment_count), '$(Esc $manifest.poster_file_id)', '',
        '$(Esc $manifest.franchise_slug)', '$(Esc $manifest.franchise_name)', '$(Esc $manifest.live_slug)', '$(Esc $manifest.live_name)')
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  date = excluded.date,
  duration_seconds = excluded.duration_seconds,
  segment_count = excluded.segment_count,
  poster_file_id = excluded.poster_file_id,
  franchise_slug = excluded.franchise_slug,
  franchise_name = excluded.franchise_name,
  live_slug = excluded.live_slug,
  live_name = excluded.live_name;
"@)

$segNames = $manifest.segments.PSObject.Properties.Name
for ($i = 0; $i -lt $segNames.Count; $i += $BatchSize) {
    $batch = $segNames[$i..([Math]::Min($i + $BatchSize, $segNames.Count) - 1)]
    $values = $batch | ForEach-Object {
        $fileId = $manifest.segments.$_
        $duration = $durations["seg_$_.ts"]
        if ($null -eq $duration) { $duration = 4.0 }
        "('$(Esc $manifest.slug)', '$(Esc $_)', '$(Esc $fileId)', $duration)"
    }
    [void]$sql.AppendLine("INSERT INTO segments (slug, seg_name, file_id, duration_seconds) VALUES $($values -join ', ');")
}

$tmpFile = Join-Path $env:TEMP "import-$Slug-$(Get-Random).sql"
$sql.ToString() | Out-File -LiteralPath $tmpFile -Encoding UTF8

try {
    Write-Host "Importing $Slug ($($segNames.Count) segments) into D1 database '$Database'..."
    npx wrangler d1 execute $Database --remote --file=$tmpFile
} finally {
    Remove-Item -LiteralPath $tmpFile -ErrorAction SilentlyContinue
}
