param([switch]$CleanupTestAudit)
$ErrorActionPreference = "Stop"
$ref = "ykhtpvyelpujykheycsv"
$raw = (& npx --yes supabase@latest projects api-keys --project-ref $ref --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Khong lay duoc ephemeral staging keys." }
$keys = $raw | ConvertFrom-Json
$service = ($keys | Where-Object {$_.name -eq "service_role" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
if (-not $service) { throw "Thieu staging service role key." }
try {
  $env:STAGING_PROJECT_REF = $ref
  $env:STAGING_SUPABASE_URL = "https://$ref.supabase.co"
  $env:STAGING_SERVICE_ROLE_KEY = $service
  $env:KPI2_CLEAN_TEST_AUDIT = if ($CleanupTestAudit) { "1" } else { "0" }
  node scripts/check-phase-kpi2-staging-clean.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2 staging residue check failed." }
} finally {
  $env:STAGING_PROJECT_REF = $null
  $env:STAGING_SUPABASE_URL = $null
  $env:STAGING_SERVICE_ROLE_KEY = $null
  $env:KPI2_CLEAN_TEST_AUDIT = $null
  $service = $null
  $raw = $null
}
