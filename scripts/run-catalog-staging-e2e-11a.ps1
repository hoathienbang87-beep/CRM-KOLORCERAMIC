$ErrorActionPreference = "Stop"

$repo = "D:\SUPABASE\CRM-KOLORCERAMIC"
$stagingRef = "nalkeptqohjbjnqwpzzv"
$productionRef = "jjeeazwlqcwynzquimeo"
$migrationId = "20260930110100"
$migrationFile = Join-Path $repo "supabase\migrations\${migrationId}_catalog_staging_e2e_11a.sql"
$node = "C:\Users\hoath\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$playwright = "C:\Users\hoath\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.js"
$browser = "C:\Program Files\Google\Chrome\Application\chrome.exe"

function Assert-LastExit([string]$label) {
  if ($LASTEXITCODE -ne 0) { throw "$label failed with exit code $LASTEXITCODE." }
}

function Invoke-NodeTest([string]$file) {
  & $node $file
  Assert-LastExit $file
}

Push-Location $repo
try {
  if ($stagingRef -eq $productionRef) { throw "Refusing to run: staging ref equals production ref." }
  if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $playwright) -or -not (Test-Path -LiteralPath $browser)) {
    throw "Required bundled Node/Playwright/Chrome dependency is unavailable."
  }

  $linkedRef = (Get-Content -LiteralPath "supabase/.temp/project-ref" -Raw).Trim()
  $pooler = (Get-Content -LiteralPath "supabase/.temp/pooler-url" -Raw).Trim()
  if ($linkedRef -ne $stagingRef -or -not $pooler.Contains($stagingRef) -or $pooler.Contains($productionRef)) {
    throw "Refusing to run: Supabase linked ref/pooler is not the approved staging project."
  }

  $projects = (& supabase projects list --output json 2>$null | Out-String) | ConvertFrom-Json
  Assert-LastExit "Supabase project status lookup"
  $staging = $projects | Where-Object { $_.id -eq $stagingRef }
  if ($staging.status -ne "ACTIVE_HEALTHY" -or -not $staging.linked) {
    throw "Refusing to run: staging project is not active and linked."
  }
  $production = $projects | Where-Object { $_.id -eq $productionRef }
  if ($production.linked) { throw "Refusing to run: production project is linked." }
  Write-Output "11A_IDENTITY_GUARD_PASS: staging=$stagingRef; production_linked=false"

  & $node "scripts/build-catalog-staging-e2e-11a.mjs" $migrationFile
  Assert-LastExit "11A SQL build"

  & supabase db push --linked --include-all --yes
  Assert-LastExit "11A staging migration test"

  $migrationList = (& supabase migration list --linked 2>$null | Out-String) | ConvertFrom-Json
  Assert-LastExit "11A migration read-back"
  if (-not ($migrationList.migrations | Where-Object { $_.remote -eq $migrationId })) {
    throw "11A migration history read-back failed."
  }
  Write-Output "11A_DATABASE_E2E_PASS: migration=$migrationId"

  $rawKeys = (& supabase projects api-keys --project-ref $stagingRef --output json 2>$null | Out-String)
  Assert-LastExit "Staging anon-key lookup"
  $keys = $rawKeys | ConvertFrom-Json
  $anonKey = ($keys | Where-Object { $_.name -eq "anon" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
  if (-not $anonKey) { throw "Staging legacy anon key is unavailable." }
  try {
    $env:STAGING_PROJECT_REF = $stagingRef
    $env:STAGING_SUPABASE_URL = "https://$stagingRef.supabase.co"
    $env:STAGING_ANON_KEY = $anonKey
    Invoke-NodeTest "scripts/test-catalog-staging-rest-11a.mjs"
  } finally {
    $env:STAGING_PROJECT_REF = $null
    $env:STAGING_SUPABASE_URL = $null
    $env:STAGING_ANON_KEY = $null
    $anonKey = $null
    $rawKeys = $null
  }

  foreach ($test in @(
    "scripts/test-catalog-data-contract.mjs",
    "scripts/test-catalog-migration-01b.mjs",
    "scripts/test-catalog-rls-rpc-02b.mjs",
    "scripts/test-catalog-import-03b.mjs",
    "scripts/test-catalog-public-api-05a.mjs",
    "scripts/test-catalog-website-leads-05b.mjs",
    "scripts/test-catalog-admin-06a.mjs",
    "scripts/test-catalog-admin-import-06b.mjs",
    "scripts/test-catalog-website-07a.mjs",
    "scripts/test-catalog-website-07b.mjs",
    "scripts/test-crm-product-selector-08a.mjs",
    "scripts/test-crm-catalog-retirement-08b.mjs",
    "scripts/test-app-routing-09.mjs",
    "scripts/test-firebase-redirect-10.mjs"
  )) { Invoke-NodeTest $test }

  try {
    $env:CATALOG_ADMIN_PLAYWRIGHT_ENTRY = $playwright
    $env:CATALOG_ADMIN_BROWSER_PATH = $browser
    $env:CATALOG_WEBSITE_PLAYWRIGHT_ENTRY = $playwright
    $env:CATALOG_WEBSITE_BROWSER_PATH = $browser
    $env:CRM_SELECTOR_PLAYWRIGHT_ENTRY = $playwright
    $env:CRM_SELECTOR_BROWSER_PATH = $browser
    $env:CRM_RETIREMENT_PLAYWRIGHT_ENTRY = $playwright
    $env:CRM_RETIREMENT_BROWSER_PATH = $browser
    $env:ROUTING_09_PLAYWRIGHT_ENTRY = $playwright
    $env:ROUTING_09_BROWSER_PATH = $browser
    foreach ($test in @(
      "scripts/test-catalog-admin-06a-browser.mjs",
      "scripts/test-catalog-admin-import-06b-browser.mjs",
      "scripts/test-catalog-website-07a-browser.mjs",
      "scripts/test-catalog-website-07b-browser.mjs",
      "scripts/test-crm-product-selector-08a-browser.mjs",
      "scripts/test-crm-catalog-retirement-08b-browser.mjs",
      "scripts/test-app-routing-09-browser.mjs"
    )) { Invoke-NodeTest $test }
  } finally {
    foreach ($name in @(
      "CATALOG_ADMIN_PLAYWRIGHT_ENTRY", "CATALOG_ADMIN_BROWSER_PATH",
      "CATALOG_WEBSITE_PLAYWRIGHT_ENTRY", "CATALOG_WEBSITE_BROWSER_PATH",
      "CRM_SELECTOR_PLAYWRIGHT_ENTRY", "CRM_SELECTOR_BROWSER_PATH",
      "CRM_RETIREMENT_PLAYWRIGHT_ENTRY", "CRM_RETIREMENT_BROWSER_PATH",
      "ROUTING_09_PLAYWRIGHT_ENTRY", "ROUTING_09_BROWSER_PATH"
    )) { [Environment]::SetEnvironmentVariable($name, $null, "Process") }
  }

  Write-Output "CATALOG_11A_AUTOMATED_STAGING_PASS"
} finally {
  Pop-Location
}
