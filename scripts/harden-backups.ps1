$ErrorActionPreference = "Stop"

# Hardening of local folders that hold personal-data copies (dumps, .env, pg-url.txt).
# Removes inherited grants (e.g. NT AUTHORITY\Users) and keeps only:
#   - the current user      (the one running the scheduled backup task)
#   - BUILTIN\Administrators
#   - NT AUTHORITY\SYSTEM

$targets = @(
  "C:\Users\Admin\eco-db-backups",
  "C:\Users\Admin\eco-backup-2026-09-09"
)

$sidAdmins = "S-1-5-32-544"
$sidSystem = "S-1-5-18"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($dir in $targets) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  $grant = "${currentUser}:(OI)(CI)F"
  icacls $dir /inheritance:r /grant:r "$grant" "*${sidAdmins}:(OI)(CI)F" "*${sidSystem}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls failed for $dir" }
  # Ensure every item has explicit grants (items moved from elsewhere may carry orphaned inherited ACEs)
  Get-ChildItem -LiteralPath $dir -Force | ForEach-Object {
    icacls $_.FullName /inheritance:r /grant:r "${currentUser}:(F)" "*${sidAdmins}:(F)" "*${sidSystem}:(F)" | Out-Null
  }
  Write-Output "hardened: $dir"
}

Write-Output "done"