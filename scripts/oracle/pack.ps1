# Упаковать проект для загрузки на Oracle (без node_modules)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$Out = Join-Path $env:USERPROFILE "Desktop\ecohub-oracle.zip"
if (-not (Test-Path (Split-Path $Out))) { $Out = Join-Path $Root "ecohub-oracle.zip" }

$staging = Join-Path $env:TEMP "ecohub-pack-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$excludeDirs = @('node_modules', '.git', 'logs', 'dist', 'tmp-eco-docx', '.cursor')
function Copy-Filtered($src, $dst) {
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Get-ChildItem -Force $src | ForEach-Object {
    if ($_.PSIsContainer -and ($excludeDirs -contains $_.Name)) { return }
    if ($_.Name -eq '.env') {
      Copy-Item $_.FullName (Join-Path $dst '.env')
      return
    }
    if ($_.PSIsContainer) {
      Copy-Filtered $_.FullName (Join-Path $dst $_.Name)
    } else {
      Copy-Item $_.FullName (Join-Path $dst $_.Name)
    }
  }
}

Write-Host "Packing $Root → $Out"
Copy-Filtered $Root $staging

if (Test-Path $Out) { Remove-Item $Out -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $Out -Force
Remove-Item $staging -Recurse -Force

Write-Host "OK: $Out"
Write-Host "Upload this zip to the VM (WinSCP / scp), then unzip to ~/ecohub"
