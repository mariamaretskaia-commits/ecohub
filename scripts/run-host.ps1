# EcoHub – постоянный хостинг на этом ПК (сервер + Cloudflare Tunnel + webhook)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"
$LogDir = Join-Path $Root "logs"
$ServerLog = Join-Path $LogDir "server.log"
$TunnelLog = Join-Path $LogDir "tunnel.log"
$tunnelErr = Join-Path $LogDir "tunnel.err.log"
$PidFile = Join-Path $LogDir "host.pids.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Read-EnvMap {
  $map = @{}
  if (-not (Test-Path $EnvFile)) { return $map }
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $map[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $map
}

function Set-EnvValue($key, $value) {
  $lines = @()
  $found = $false
  if (Test-Path $EnvFile) {
    $lines = Get-Content $EnvFile
    $lines = $lines | ForEach-Object {
      if ($_ -match "^\s*$key=") { $found = $true; "$key=$value" } else { $_ }
    }
  }
  if (-not $found) { $lines += "$key=$value" }
  $lines | Set-Content -Encoding UTF8 $EnvFile
}

function Start-Background($file, $processArgs, $cwd, $out, $err) {
  return Start-Process -FilePath $file -ArgumentList $processArgs `
    -WorkingDirectory $cwd `
    -RedirectStandardOutput $out -RedirectStandardError $err `
    -PassThru -WindowStyle Hidden
}

function Stop-PortListener($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
}

function Wait-TunnelUrl {
  param([int]$Seconds = 90)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $paths = @($TunnelLog)
    if (Test-Path $tunnelErr) { $paths += $tunnelErr }
    if (Test-Path $TunnelLog) {
      $match = Select-String -Path $paths -ErrorAction SilentlyContinue -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -Last 1
      if ($match) { return $match.Matches[0].Value }
    }
    Start-Sleep -Seconds 2
  }
  return $null
}

Write-Host "♻️ EcoHub host starting…" -ForegroundColor Green

# Build frontend if missing
$dist = Join-Path $Root "web\dist\index.html"
if (-not (Test-Path $dist)) {
  Write-Host "Building web…"
  Push-Location $Root
  npm run build
  Pop-Location
}

Stop-PortListener 3001

$envMap = Read-EnvMap
$env:NODE_ENV = "production"
if ($envMap.BOT_TOKEN) { $env:BOT_TOKEN = $envMap.BOT_TOKEN }
if ($envMap.JWT_SECRET) { $env:JWT_SECRET = $envMap.JWT_SECRET }
if ($envMap.WEBAPP_URL) { $env:WEBAPP_URL = $envMap.WEBAPP_URL }

$serverErr = Join-Path $LogDir "server.err.log"

# Tunnel first – learn public URL, then start server with correct webhook
$npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $npx) { $npx = (Get-Command npx -ErrorAction SilentlyContinue).Source }
$tunnel = Start-Background $npx @("--yes", "cloudflared", "tunnel", "--url", "http://127.0.0.1:3001") (Join-Path $Root "server") $TunnelLog $tunnelErr

$url = Wait-TunnelUrl
if (-not $url) {
  if (Test-Path $tunnelErr) {
    $url = (Select-String -Path $tunnelErr -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -Last 1).Matches[0].Value
  }
}
if (-not $url) {
  Write-Error "Cloudflare tunnel URL not found. See $TunnelLog and $tunnelErr"
}

Set-EnvValue "WEBAPP_URL" $url
$env:WEBAPP_URL = $url
Write-Host "Public URL: $url"
Start-Sleep -Seconds 10

# Server with fresh WEBAPP_URL
$server = Start-Background "node" @("src/index.js") (Join-Path $Root "server") $ServerLog $serverErr

@{ tunnel = $tunnel.Id; server = $server.Id; url = $url; started = (Get-Date).ToString("o") } |
  ConvertTo-Json | Set-Content $PidFile

Start-Sleep -Seconds 6
Push-Location $Root
cmd /c "npm run bot:setup > `"$(Join-Path $LogDir 'bot-setup.log')`" 2>&1"
Pop-Location

Write-Host "✅ EcoHub running. Logs: $LogDir"
Write-Host "   Bot: @EcoHubBY_bot → $url"
