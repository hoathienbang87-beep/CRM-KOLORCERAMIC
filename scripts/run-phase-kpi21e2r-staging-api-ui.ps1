$ErrorActionPreference = "Stop"
$ref = "ykhtpvyelpujykheycsv"
$runtime = "D:\SUPABASE\BACKUP-TEMP"
$playwright = Join-Path $runtime "node_modules\playwright\index.mjs"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$raw = (& npx --yes supabase@latest projects api-keys --project-ref $ref --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Cannot retrieve ephemeral staging keys." }
$keys = $raw | ConvertFrom-Json
$anon = ($keys | Where-Object {$_.name -eq "anon" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
$service = ($keys | Where-Object {$_.name -eq "service_role" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
if (-not $anon -or -not $service) { throw "Missing staging API key." }
try {
  $env:STAGING_PROJECT_REF = $ref
  $env:STAGING_SUPABASE_URL = "https://$ref.supabase.co"
  $env:STAGING_ANON_KEY = $anon
  $env:STAGING_SERVICE_ROLE_KEY = $service
  $env:KPI21E2R_PLAYWRIGHT_ENTRY = $playwright
  $env:KPI21E2R_BROWSER_PATH = $chrome
  node scripts/test-phase-kpi21e2r-staging-api-ui.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2.1E.2R staging API/UI failed." }
} finally {
  $env:STAGING_PROJECT_REF = $null
  $env:STAGING_SUPABASE_URL = $null
  $env:STAGING_ANON_KEY = $null
  $env:STAGING_SERVICE_ROLE_KEY = $null
  $env:KPI21E2R_PLAYWRIGHT_ENTRY = $null
  $env:KPI21E2R_BROWSER_PATH = $null
  $anon = $null
  $service = $null
  $raw = $null
}
