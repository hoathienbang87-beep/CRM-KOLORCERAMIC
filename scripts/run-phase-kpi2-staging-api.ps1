$ErrorActionPreference = "Stop"
$ref = "ykhtpvyelpujykheycsv"
$raw = (& npx --yes supabase@latest projects api-keys --project-ref $ref --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Không lấy được ephemeral staging keys." }
$keys = $raw | ConvertFrom-Json
$anon = ($keys | Where-Object {$_.name -eq "anon" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
$service = ($keys | Where-Object {$_.name -eq "service_role" -and $_.type -eq "legacy"} | Select-Object -First 1).api_key
if (-not $anon -or -not $service) { throw "Thiếu staging API key." }
try {
  $env:STAGING_PROJECT_REF=$ref
  $env:STAGING_SUPABASE_URL="https://$ref.supabase.co"
  $env:STAGING_ANON_KEY=$anon
  $env:STAGING_SERVICE_ROLE_KEY=$service
  node scripts/test-phase-kpi2-staging-api.mjs
  if ($LASTEXITCODE -ne 0) { throw "KPI-2 staging API test failed." }
} finally {
  $env:STAGING_PROJECT_REF=$null;$env:STAGING_SUPABASE_URL=$null;$env:STAGING_ANON_KEY=$null;$env:STAGING_SERVICE_ROLE_KEY=$null
  $anon=$null;$service=$null;$raw=$null
}
