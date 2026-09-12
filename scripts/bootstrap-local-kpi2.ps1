param(
  [switch]$SkipRuntimeTest
)

# Windows PowerShell surfaces native stderr as NativeCommandError. External
# commands are checked explicitly through $LASTEXITCODE below.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$container = 'supabase_db_local-product-r2'
$config = Join-Path $repo 'supabase/config.toml'
$baseline = Join-Path $repo 'harness-prod-baseline.sql'
$prerequisites = Join-Path $repo 'scripts/kpi2-local-bootstrap-prerequisites.sql'
$runtimeTest = Join-Path $repo 'scripts/test-phase-kpi2-customer-linked-event-integration.sql'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required.' }
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw 'Supabase CLI is required.' }
if ((Get-Content -LiteralPath $config -Raw -ErrorAction Stop) -notmatch 'project_id\s*=\s*"local-product-r2"') {
  throw 'Refusing to run: expected the disposable local-product-r2 config.'
}

Push-Location $repo
try {
  & docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker engine is not running.' }

  # The repository intentionally has no supabase/migrations directory. Recreate
  # only the named local project, without a backup, so every run starts empty.
  # The ordered bootstrap below is authoritative for this test harness, not for
  # production migration history.
  & supabase stop --no-backup *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop the disposable local Supabase stack.' }
  & supabase start --ignore-health-check *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the disposable local Supabase stack.' }

  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    & docker exec $container pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL did not become ready.' }

  function Invoke-LocalSql([string]$path) {
    Write-Host "Applying $([IO.Path]::GetFileName($path))"
    Get-Content -LiteralPath $path -Raw -ErrorAction Stop |
      & docker exec -i $container psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f -
    if ($LASTEXITCODE -ne 0) { throw "SQL failed: $path" }
  }

  # Supabase already owns auth/storage schemas. Reuse only the public portion
  # of the tracked, data-free baseline instead of overwriting managed schemas.
  $baselineSql = Get-Content -LiteralPath $baseline -Raw -ErrorAction Stop
  $publicMarker = 'create table public.app_users'
  $publicOffset = $baselineSql.IndexOf($publicMarker)
  if ($publicOffset -lt 0) { throw "Baseline marker missing: $publicMarker" }
  Write-Host 'Applying public test baseline'
  $baselineSql.Substring($publicOffset) |
    & docker exec -i $container psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f -
  if ($LASTEXITCODE -ne 0) { throw 'Public test baseline failed.' }

  Invoke-LocalSql $prerequisites

  $orderedArtifacts = @(
    'supabase-phase-1-security-foundation.sql',
    'supabase-phase-f-crm-rls-cleanup.sql',
    'supabase-phase-p0a-transaction-ownership.sql',
    'supabase-phase-p0b-employee-assignment.sql',
    'supabase-phase-kpi1-foundation.sql',
    'supabase-phase-kpi2-final-consolidated.sql',
    'supabase-phase-kpi21e-september-cutover.sql',
    'supabase-phase-kpi21e2-draft-config-delete.sql',
    'supabase-phase-kpi21e2r-safe-kpi-undo.sql',
    'supabase-phase-kpi-r3-active-flexibility.sql',
    'supabase-phase-kpi-r31-period-lifecycle.sql',
    'supabase-phase-kpi2-customer-linked-event.sql'
  )
  foreach ($artifact in $orderedArtifacts) {
    Invoke-LocalSql (Join-Path $repo $artifact)
  }

  if (-not $SkipRuntimeTest) {
    Invoke-LocalSql $runtimeTest
    Write-Host 'PHASE2C_RUNTIME_A_TO_O_PASS'
  }
  Write-Host 'LOCAL_KPI2_BOOTSTRAP_PASS'
} finally {
  Pop-Location
}
