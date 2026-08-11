$ErrorActionPreference = "Stop"

$projectRef = "ykhtpvyelpujykheycsv"
$productionRef = "jjeeazwlqcwynzquimeo"
$repo = "D:\SUPABASE\CRM-KOLORCERAMIC"
$runtimeRoot = "D:\SUPABASE\BACKUP-TEMP"
$playwrightEntry = Join-Path $runtimeRoot "node_modules\playwright\index.mjs"
$browserPath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

if ($projectRef -eq $productionRef) { throw "Refusing to run: staging ref equals production ref." }
if (-not (Test-Path -LiteralPath $browserPath)) { throw "Chrome executable is unavailable for KPI-1 UI test." }
if (-not (Test-Path -LiteralPath $playwrightEntry)) {
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
  & npm install --prefix $runtimeRoot --no-audit --no-fund --ignore-scripts playwright@1.62.1
  if ($LASTEXITCODE -ne 0) { throw "Unable to prepare Playwright outside the repository." }
}

$rawKeys = (& npx --yes supabase@latest projects api-keys --project-ref $projectRef --output json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Unable to retrieve ephemeral staging API keys." }
$keys = $rawKeys | ConvertFrom-Json
$anonKey = ($keys | Where-Object { $_.name -eq "anon" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
if (-not $anonKey -or -not $serviceKey) { throw "Required staging API keys are unavailable." }

try {
  $env:STAGING_PROJECT_REF = $projectRef
  $env:STAGING_SUPABASE_URL = "https://$projectRef.supabase.co"
  $env:STAGING_ANON_KEY = $anonKey
  $env:STAGING_SERVICE_ROLE_KEY = $serviceKey
  $env:KPI1_PLAYWRIGHT_ENTRY = $playwrightEntry
  $env:KPI1_BROWSER_PATH = $browserPath
  Push-Location $repo
  try {
    node scripts/test-phase-kpi1-staging-ui.mjs
    if ($LASTEXITCODE -ne 0) { throw "KPI-1 staging UI test failed." }
  } finally { Pop-Location }
} finally {
  $env:STAGING_PROJECT_REF = $null
  $env:STAGING_SUPABASE_URL = $null
  $env:STAGING_ANON_KEY = $null
  $env:STAGING_SERVICE_ROLE_KEY = $null
  $env:KPI1_PLAYWRIGHT_ENTRY = $null
  $env:KPI1_BROWSER_PATH = $null
  $anonKey = $null
  $serviceKey = $null
  $rawKeys = $null
}
