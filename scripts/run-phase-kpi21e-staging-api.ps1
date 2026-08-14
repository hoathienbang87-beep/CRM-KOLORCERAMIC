$ErrorActionPreference = "Stop"

$repo = "D:\SUPABASE\CRM-KOLORCERAMIC"
$ref = "ykhtpvyelpujykheycsv"
$productionRef = "jjeeazwlqcwynzquimeo"
$queryHelper = "D:\SUPABASE\BACKUP-TEMP\invoke-supabase-management-query.ps1"
$migration = Join-Path $repo "supabase-phase-kpi21e-september-cutover.sql"
$playwright = "D:\SUPABASE\BACKUP-TEMP\node_modules\playwright\index.mjs"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$restoreSql = @'
create or replace function public.crm_legacy_kpi_clock_now()
returns timestamptz
language sql
volatile
set search_path = public
as $$ select clock_timestamp(); $$;
'@

if ($ref -eq $productionRef) { throw "Refusing to run against production." }
if (-not (Test-Path -LiteralPath $queryHelper)) { throw "Missing controlled Management API query helper." }

$raw = (& npx --yes supabase@latest projects api-keys --project-ref $ref --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Cannot retrieve ephemeral staging API keys." }
$keys = $raw | ConvertFrom-Json
$anon = ($keys | Where-Object {$_.name -eq "anon" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
$service = ($keys | Where-Object {$_.name -eq "service_role" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
if (-not $anon -or -not $service) { throw "Missing staging API key." }

$runId = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$password = "$([Guid]::NewGuid().ToString('N'))aA1!"
$overrideFile = Join-Path $env:TEMP "kpi21e-clock-$runId.sql"
$failed = $false

try {
  $env:STAGING_PROJECT_REF = $ref
  $env:STAGING_SUPABASE_URL = "https://$ref.supabase.co"
  $env:STAGING_ANON_KEY = $anon
  $env:STAGING_SERVICE_ROLE_KEY = $service
  $env:KPI21E_RUN_ID = $runId
  $env:KPI21E_TEST_PASSWORD = $password

  $env:KPI21E_TEST_MODE = "CLEANUP_ALL"
  node scripts/test-phase-kpi21e-staging-api.mjs
  if ($LASTEXITCODE -ne 0) { throw "Cannot clean previous KPI-2.1E staging fixtures." }

  $env:KPI21E_TEST_MODE = "PRE"
  node scripts/test-phase-kpi21e-staging-api.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2.1E PRE test failed." }

  @'
create or replace function public.crm_legacy_kpi_clock_now()
returns timestamptz
language sql
volatile
set search_path = public
as $$ select timestamptz '2026-08-31 17:00:01+00'; $$;
'@ | Set-Content -LiteralPath $overrideFile -Encoding utf8
  & $queryHelper -ProjectRef $ref -Sql (Get-Content -LiteralPath $overrideFile -Raw) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cannot install temporary staging post-cutover clock." }

  $env:KPI21E_TEST_MODE = "POST"
  node scripts/test-phase-kpi21e-staging-api.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2.1E POST test failed." }

  if (-not (Test-Path -LiteralPath $playwright) -or -not (Test-Path -LiteralPath $chrome)) {
    throw "KPI-2.1E Playwright runtime is unavailable."
  }
  $env:KPI21E_PLAYWRIGHT_ENTRY = $playwright
  $env:KPI21E_BROWSER_PATH = $chrome
  node scripts/test-phase-kpi21e-staging-ui.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2.1E POST UI test failed." }
} catch {
  $failed = $true
  Write-Warning $_
} finally {
  $restoreExit = 0
  try {
    & $queryHelper -ProjectRef $ref -Sql $restoreSql | Out-Null
  } catch {
    $restoreExit = 1
    Write-Warning "Staging DB clock restore failed: $_"
  }
  $env:KPI21E_TEST_MODE = "CLEANUP"
  node scripts/test-phase-kpi21e-staging-api.mjs
  $cleanupExit = $LASTEXITCODE

  Remove-Item -LiteralPath $overrideFile -Force -ErrorAction SilentlyContinue
  $env:STAGING_PROJECT_REF = $null
  $env:STAGING_SUPABASE_URL = $null
  $env:STAGING_ANON_KEY = $null
  $env:STAGING_SERVICE_ROLE_KEY = $null
  $env:KPI21E_RUN_ID = $null
  $env:KPI21E_TEST_PASSWORD = $null
  $env:KPI21E_TEST_MODE = $null
  $env:KPI21E_PLAYWRIGHT_ENTRY = $null
  $env:KPI21E_BROWSER_PATH = $null
  $anon = $null
  $service = $null
  $raw = $null

  if ($restoreExit -ne 0) { $failed = $true; Write-Warning "CRITICAL: staging DB clock restore failed." }
  if ($cleanupExit -ne 0) { $failed = $true; Write-Warning "Staging fixture cleanup failed." }
}

if ($failed) { exit 1 }
Write-Output "KPI-2.1E staging API lifecycle PASS; authoritative DB clock restored."
