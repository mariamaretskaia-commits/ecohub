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