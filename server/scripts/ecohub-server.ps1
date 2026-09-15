# EcoHub server manager (local).
#
# Spawns node detached via WMI (Win32_Process.Create) so the process is NOT a
# child of the calling shell/terminal wrapper: no stray pipe handles, no
# "Unknown: ChildProcess.kill", no accidental kills. Logs go to
# server\data\logs\server-{out,err}.log.
#
# Usage (from server\):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ecohub-server.ps1 start|stop|restart|status
# Optional: -Port 3001 -PidFile ...
param(
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'status',
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$ServerDir = Split-Path -Parent $PSScriptRoot
$LogsDir = Join-Path $ServerDir 'data\logs'
$PidFile = Join-Path $LogsDir 'ecohub-server.pid'
$OutLog = Join-Path $LogsDir 'server-out.log'
$ErrLog = Join-Path $LogsDir 'server-err.log'
$NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { $NodeExe = 'C:\Program Files\nodejs\node.exe' }

function Read-PortFromEnv {
    $envFile = Join-Path $ServerDir '..\.env'
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match '^PORT=(\d+)\s*$') { return [int]$Matches[1] }
        }
    }
    return 3001
}

if ($Port -le 0) { $Port = Read-PortFromEnv }

function Get-ListenerPid {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return $null
}

function Invoke-Start {
    $existing = Get-ListenerPid
    if ($existing) {
        Write-Output "server: already listening on $Port (pid $existing)"
        return
    }

    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
    $cmd = 'cmd /c ""{0}" src/index.js >> "{1}" 2>> "{2}""' -f $NodeExe, $OutLog, $ErrLog
    $wmi = ([wmiclass]'Win32_Process').Create($cmd, $ServerDir, $null)
    if ($wmi.ReturnValue -ne 0) {
        throw "Win32_Process.Create failed, code $($wmi.ReturnValue)"
    }

    $listenerPid = $null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Milliseconds 750
        $listenerPid = Get-ListenerPid
        if ($listenerPid) { break }
    }
    if ($listenerPid) {
        Set-Content -LiteralPath $PidFile -Value $listenerPid
        Write-Output "server: started on $Port (pid $listenerPid) -- logs: $OutLog"
    } else {
        Write-Output 'server: process spawned but no listener yet -- see logs:'
        if (Test-Path -LiteralPath $OutLog) { Get-Content -LiteralPath $OutLog -Encoding UTF8 -Tail 10 }
        if (Test-Path -LiteralPath $ErrLog) { Get-Content -LiteralPath $ErrLog -Encoding UTF8 -Tail 10 }
        exit 1
    }
}

function Invoke-Stop {
    $listenerPid = Get-ListenerPid
    if (-not $listenerPid -and (Test-Path -LiteralPath $PidFile)) {
        $saved = [int](Get-Content -LiteralPath $PidFile)
        if (Get-Process -Id $saved -ErrorAction SilentlyContinue) { $listenerPid = $saved }
    }
    if (-not $listenerPid) {
        Write-Output 'server: not running'
        return
    }
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-ListenerPid)) { break }
    }
    Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
    Write-Output "server: stopped (pid $listenerPid)"
}

switch ($Action) {
    'start'   { Invoke-Start }
    'stop'    { Invoke-Stop }
    'restart' { Invoke-Stop; Start-Sleep -Seconds 1; Invoke-Start }
    'status' {
        $listenerPid = Get-ListenerPid
        if ($listenerPid) {
            $proc = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
            $health = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($health) {
                Write-Output "server: RUNNING pid=$listenerPid port=$Port since=$($proc.StartTime) health=$($health.ok)"
            } else {
                Write-Output "server: RUNNING pid=$listenerPid port=$Port since=$($proc.StartTime) health=UNKNOWN"
            }
        } else {
            Write-Output "server: STOPPED port=$Port"
        }
    }
}