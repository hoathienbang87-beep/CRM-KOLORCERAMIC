$ErrorActionPreference = "Stop"
$workspace = "D:\SUPABASE\BACKUP-TEMP\CRM-KOLORCERAMIC-KPI2R2-STAGING"
$testFile = "D:\SUPABASE\CRM-KOLORCERAMIC\scripts\test-phase-kpi2r2-attached-serialization.sql"
if (-not (Test-Path -LiteralPath $workspace)) { throw "Khong tim thay isolated staging workspace." }
if (-not (Test-Path -LiteralPath $testFile)) { throw "Khong tim thay KPI-2R.2 SQL integration test." }
$linkedRef = Get-Content -Raw (Join-Path $workspace "supabase\.temp\project-ref") -ErrorAction SilentlyContinue
if ($linkedRef.Trim() -ne "ykhtpvyelpujykheycsv") { throw "Staging project guard failed." }
Push-Location $workspace
try {
  $ErrorActionPreference = "Continue"
  $output = (& npx --yes supabase@latest db query --linked --file $testFile --output-format json 2>$null | Out-String)
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($exitCode -ne 0) { throw $output }
  if ($output -notmatch '"attachedDiscardDenied"\s*:\s*true' -or $output -notmatch '"discardWinsAttachDenied"\s*:\s*true') {
    throw "KPI-2R.2 attached/discard serialization assertions missing or false."
  }
  Write-Output "KPI-2R.2 attached/discard serialization: PASS (transaction rolled back)"
} finally {
  Pop-Location
}
