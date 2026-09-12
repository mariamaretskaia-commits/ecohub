$ErrorActionPreference = "Stop"

$OutDir = "C:\Users\Admin\eco-db-backups"
$Repo = Split-Path -Parent $PSScriptRoot
$date = Get-Date -Format "yyyyMMdd-HHmm"
$dump = Join-Path $OutDir ("ecohub-" + $date + ".sql")

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

if (-not $env:PG_URL) {
  $urlFile = "C:\Users\Admin\eco-db-backups\.pg-url.txt"
  if (Test-Path -LiteralPath $urlFile) {
    $env:PG_URL = (Get-Content -LiteralPath $urlFile -Raw).Trim()
  }
}
if (-not $env:PG_URL) {
  throw "PG_URL not set and .pg-url.txt is missing"
}

# --- Self-healing: keep the Render Postgres IP allow-list in sync with the
#     current public IP (home/CGNAT connections change addresses). If the list
#     is stale, the dump below would silently fail. ---
function Resolve-PublicIp {
  $candidates = @('https://api.ipify.org', 'https://icanhazip.com', 'https://ifconfig.me/ip')
  foreach ($u in $candidates) {
    try { return (Invoke-RestMethod -Uri $u -TimeoutSec 20).Trim() } catch { }
  }
  throw "could not resolve public IP"
}
function Get-RenderCli {
  foreach ($p in @('C:\Users\Admin\AppData\Local\Microsoft\WinGet\Links\render.exe')) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $g = Get-Command render -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  return $null
}

try {
  $renderCli = Get-RenderCli
  $currentIp = Resolve-PublicIp
  if ($renderCli -and $currentIp) {
    $listJson = & $renderCli postgres list -o json 2>&1 | Out-String
    $listed = ($listJson | ConvertFrom-Json).data[0].ipAllowList |
      ForEach-Object { $_.cidrBlock }
    $want = "$currentIp/32"
    if ($listed -contains $want) {
      Write-Output "allow-list OK: $want"
    } else {
      Write-Output "allow-list stale ($($listed -join ', ')) -> updating to $want"
      & $renderCli postgres update ecohub-db `
        --ip-allow-list "cidr=$want,description=PC backup current" --confirm | Out-String | Write-Output
      if ($LASTEXITCODE -ne 0) { Write-Output "WARN: allow-list update failed (exit $LASTEXITCODE)" }
    }
  } else {
    Write-Output "WARN: render CLI or public IP unavailable; skipping allow-list sync"
  }
} catch {
  Write-Output "WARN: allow-list sync skipped: $($_.Exception.Message)"
}

$env:DUMP_PATH = $dump
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "node" }

& $node (Join-Path $Repo "server\dbdump.mjs")
if ($LASTEXITCODE -ne 0) { throw "dbdump.mjs failed with exit code $LASTEXITCODE" }

$size = (Get-Item $dump).Length
$log = Join-Path $OutDir "backup.log"
"[$(Get-Date -Format 'o')] OK $dump ($size bytes)" | Add-Content -LiteralPath $log

# Retention: keep only the most recent dumps (default 4)
$keep = 4
Get-ChildItem -LiteralPath $OutDir -Filter "ecohub-*.sql" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $keep |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    "[$(Get-Date -Format 'o')] pruned $($_.FullName)" | Add-Content -LiteralPath $log
  }

# Enforce restrictive ACLs on the backup folder
& (Join-Path $PSScriptRoot "harden-backups.ps1")

Write-Output "Backup OK: $dump ($size bytes)"