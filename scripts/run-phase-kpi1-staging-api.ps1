$ErrorActionPreference = "Stop"

$projectRef = "ykhtpvyelpujykheycsv"
$productionRef = "jjeeazwlqcwynzquimeo"
$repo = "D:\SUPABASE\CRM-KOLORCERAMIC"

if ($projectRef -eq $productionRef) {
  throw "Refusing to run: staging ref equals production ref."
}

$rawKeys = (& npx --yes supabase@latest projects api-keys --project-ref $projectRef --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to retrieve ephemeral staging API keys."
}

$keys = $rawKeys | ConvertFrom-Json
$anonKey = ($keys | Where-Object { $_.name -eq "anon" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
if (-not $anonKey -or -not $serviceKey) {
  throw "Required staging API keys are unavailable."
}

try {
  $env:STAGING_PROJECT_REF = $projectRef
  $env:STAGING_SUPABASE_URL = "https://$projectRef.supabase.co"
  $env:STAGING_ANON_KEY = $anonKey
  $env:STAGING_SERVICE_ROLE_KEY = $serviceKey
  Push-Location $repo
  try {
    node scripts/test-phase-kpi1-staging-api.mjs
    if ($LASTEXITCODE -ne 0) { throw "KPI-1 staging API test failed." }
  } finally {
    Pop-Location
  }
} finally {
  $env:STAGING_PROJECT_REF = $null
  $env:STAGING_SUPABASE_URL = $null
  $env:STAGING_ANON_KEY = $null
  $env:STAGING_SERVICE_ROLE_KEY = $null
  $anonKey = $null
  $serviceKey = $null
  $rawKeys = $null
}
