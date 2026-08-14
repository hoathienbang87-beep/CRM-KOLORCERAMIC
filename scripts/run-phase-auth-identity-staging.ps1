$ErrorActionPreference = "Stop"

$projectRef = "ykhtpvyelpujykheycsv"
$productionRef = "jjeeazwlqcwynzquimeo"
$repo = "D:\SUPABASE\CRM-KOLORCERAMIC"
$runtime = "D:\SUPABASE\BACKUP-TEMP\AUTH-IDENTITY-STAGING"
$queryHelper = "D:\SUPABASE\BACKUP-TEMP\invoke-supabase-management-query.ps1"
$manifest = Join-Path $runtime "fixture-manifest.json"
$migrationOutput = Join-Path $runtime "migration-output.json"
$evidenceOutput = Join-Path $runtime "post-test-evidence.json"
$residueOutput = Join-Path $runtime "residue-check.json"

if ($projectRef -eq $productionRef) { throw "Refusing to run: staging ref equals production ref." }
if (-not (Test-Path -LiteralPath $queryHelper)) { throw "Management query helper is unavailable." }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

$rawKeys = (& npx --yes supabase@latest projects api-keys --project-ref $projectRef --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Unable to retrieve ephemeral staging API keys." }
$keys = $rawKeys | ConvertFrom-Json
$anonKey = ($keys | Where-Object { $_.name -eq "anon" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
if (-not $anonKey -or -not $serviceKey) { throw "Required staging API keys are unavailable." }
$testPassword = "$([guid]::NewGuid().ToString('N'))aA1!"
$bootstrapped = $false

try {
  $env:STAGING_PROJECT_REF = $projectRef
  $env:STAGING_SUPABASE_URL = "https://$projectRef.supabase.co"
  $env:STAGING_ANON_KEY = $anonKey
  $env:STAGING_SERVICE_ROLE_KEY = $serviceKey
  $env:IDENTITY_TEST_PASSWORD = $testPassword
  $env:IDENTITY_TEST_MANIFEST = $manifest

  Push-Location $repo
  try {
    node scripts/test-phase-auth-identity.mjs
    if ($LASTEXITCODE -ne 0) { throw "Identity static contract failed." }
    node scripts/test-phase-auth-identity-staging-api.mjs bootstrap
    if ($LASTEXITCODE -ne 0) { throw "Identity fixture bootstrap failed." }
    $bootstrapped = $true

    $migrationSql = Get-Content -LiteralPath (Join-Path $repo "supabase-phase-auth-identity-linking-repair.sql") -Raw
    & $queryHelper -ProjectRef $projectRef -Sql $migrationSql -OutputPath $migrationOutput
    $migrationSql = $null

    node scripts/test-phase-auth-identity-staging-api.mjs test
    if ($LASTEXITCODE -ne 0) { throw "Identity staging API suite failed." }

    $fixture = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $run = $fixture.run.Replace("'", "''")
    $evidenceSql = @"
select
  (select count(*) from public.identity_link_requests where target_app_user_id like '$run%') as identity_requests,
  (select count(*) from public.audit_logs where entity_id like '$run%' and action in ('linkEmployeeAuthIdentity','relinkEmployeeAuthIdentity')) as identity_audits,
  (select count(*) from public.app_users where raw_data->>'testRun' = '$run') as fixture_users,
  (select count(*) from (select supabase_auth_id from public.app_users where supabase_auth_id is not null group by supabase_auth_id having count(*) > 1) d) as duplicate_auth_mappings,
  (select count(*) from public.customers where coalesce(raw_data->>'testRun','') = '$run') as changed_customers,
  (select count(*) from public.kpi_assignments where employee_id like '$run%') as changed_kpi_assignments;
"@
    & $queryHelper -ProjectRef $projectRef -Sql $evidenceSql -OutputPath $evidenceOutput

    node scripts/test-phase-p0a.mjs
    node scripts/test-phase-p0b.mjs
    node scripts/test-phase-kpi1.mjs
    node scripts/test-phase-kpi2.mjs
    node scripts/test-phase-kpi2r2.mjs
    if ($LASTEXITCODE -ne 0) { throw "A static regression suite failed." }

    node scripts/test-phase-p0a-staging-api.mjs
    if ($LASTEXITCODE -ne 0) { throw "P0-A staging regression failed." }
    node scripts/test-phase-p0b-staging-api.mjs
    if ($LASTEXITCODE -ne 0) { throw "P0-B staging regression failed." }
    node scripts/test-phase-kpi1-staging-api.mjs
    if ($LASTEXITCODE -ne 0) { throw "KPI-1 staging regression failed." }
    node scripts/test-phase-kpi2-staging-api.mjs
    if ($LASTEXITCODE -ne 0) { throw "KPI-2 staging regression failed." }
    node scripts/test-phase-kpi2r2-staging-api.mjs
    if ($LASTEXITCODE -ne 0) { throw "KPI-2R.2 staging regression failed." }
  } finally {
    Pop-Location
  }
} finally {
  if ($bootstrapped -and (Test-Path -LiteralPath $manifest)) {
    try {
      $fixture = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
      $run = $fixture.run.Replace("'", "''")
      $cleanupSql = @"
delete from public.identity_link_requests where target_app_user_id like '$run%' or actor_app_user_id like '$run%';
delete from public.audit_logs where entity_id like '$run%' and action in ('linkEmployeeAuthIdentity','relinkEmployeeAuthIdentity');
delete from public.app_users where raw_data->>'testRun' = '$run';
"@
      & $queryHelper -ProjectRef $projectRef -Sql $cleanupSql | Out-Null
      Push-Location $repo
      try { node scripts/test-phase-auth-identity-staging-api.mjs cleanup } finally { Pop-Location }
      $residueSql = @"
select
  (select count(*) from public.identity_link_requests where target_app_user_id like '$run%' or actor_app_user_id like '$run%') as identity_request_residue,
  (select count(*) from public.audit_logs where entity_id like '$run%' and action in ('linkEmployeeAuthIdentity','relinkEmployeeAuthIdentity')) as audit_residue,
  (select count(*) from public.app_users where raw_data->>'testRun' = '$run') as app_user_residue,
  (select count(*) from auth.users where lower(email) like lower('$run-%@example.test')) as auth_user_residue;
"@
      & $queryHelper -ProjectRef $projectRef -Sql $residueSql -OutputPath $residueOutput
    } catch {
      Write-Error "Fixture cleanup failed: $($_.Exception.Message)"
    }
  }
  $env:STAGING_PROJECT_REF = $null
  $env:STAGING_SUPABASE_URL = $null
  $env:STAGING_ANON_KEY = $null
  $env:STAGING_SERVICE_ROLE_KEY = $null
  $env:IDENTITY_TEST_PASSWORD = $null
  $env:IDENTITY_TEST_MANIFEST = $null
  $anonKey = $null
  $serviceKey = $null
  $rawKeys = $null
  $testPassword = $null
}
