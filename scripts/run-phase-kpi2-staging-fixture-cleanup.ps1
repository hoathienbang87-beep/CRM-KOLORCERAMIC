$ErrorActionPreference = "Stop"
$ref = "ykhtpvyelpujykheycsv"
$raw = (& npx --yes supabase@latest projects api-keys --project-ref $ref --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Khong lay duoc ephemeral staging keys." }
$keys = $raw | ConvertFrom-Json
$service = ($keys | Where-Object {$_.name -eq "service_role" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
if (-not $service) { throw "Thieu staging service key." }
try {
  $env:STAGING_PROJECT_REF=$ref
  $env:STAGING_SUPABASE_URL="https://$ref.supabase.co"
  $env:STAGING_SERVICE_ROLE_KEY=$service
  node scripts/cleanup-phase-kpi2-staging-fixtures.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2 staging fixture cleanup failed." }
} finally {
  $env:STAGING_PROJECT_REF=$null
  $env:STAGING_SUPABASE_URL=$null
  $env:STAGING_SERVICE_ROLE_KEY=$null
  $service=$null
  $raw=$null
}
