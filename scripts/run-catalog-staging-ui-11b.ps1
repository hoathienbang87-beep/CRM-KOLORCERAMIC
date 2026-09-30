$ErrorActionPreference = "Stop"

$repo = "D:\SUPABASE\CRM-KOLORCERAMIC"
$stagingRef = "nalkeptqohjbjnqwpzzv"
$productionRef = "jjeeazwlqcwynzquimeo"
$node = "C:\Users\hoath\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$playwright = "C:\Users\hoath\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.js"
$browser = "C:\Program Files\Google\Chrome\Application\chrome.exe"

Push-Location $repo
try {
  if ($stagingRef -eq $productionRef) { throw "Refusing to run: staging ref equals production ref." }
  $linkedRef = (Get-Content -LiteralPath "supabase/.temp/project-ref" -Raw).Trim()
  $pooler = (Get-Content -LiteralPath "supabase/.temp/pooler-url" -Raw).Trim()
  if ($linkedRef -ne $stagingRef -or -not $pooler.Contains($stagingRef) -or $pooler.Contains($productionRef)) {
    throw "Refusing to run: Supabase linked ref/pooler is not the approved staging project."
  }
  $projects = (& supabase projects list --output json 2>$null | Out-String) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Supabase project status lookup failed." }
  $staging = $projects | Where-Object { $_.id -eq $stagingRef }
  $production = $projects | Where-Object { $_.id -eq $productionRef }
  if ($staging.status -ne "ACTIVE_HEALTHY" -or -not $staging.linked -or $production.linked) {
    throw "Refusing to run: cloud staging identity/status guard failed."
  }
  if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $playwright) -or -not (Test-Path -LiteralPath $browser)) {
    throw "Required bundled Node/Playwright/Chrome dependency is unavailable."
  }
  Write-Output "11B_IDENTITY_GUARD_PASS: staging=$stagingRef; production_linked=false"

  $rawKeys = (& supabase projects api-keys --project-ref $stagingRef --output json 2>$null | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Unable to retrieve ephemeral staging API keys." }
  $keys = $rawKeys | ConvertFrom-Json
  $anonKey = ($keys | Where-Object { $_.name -eq "anon" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
  $serviceKey = ($keys | Where-Object { $_.name -eq "service_role" -and $_.type -eq "legacy" } | Select-Object -First 1).api_key
  if (-not $anonKey -or -not $serviceKey) { throw "Required staging API keys are unavailable." }

  try {
    $env:STAGING_PROJECT_REF = $stagingRef
    $env:STAGING_SUPABASE_URL = "https://$stagingRef.supabase.co"
    $env:STAGING_ANON_KEY = $anonKey
    $env:STAGING_SERVICE_ROLE_KEY = $serviceKey
    $env:CATALOG_11B_PLAYWRIGHT_ENTRY = $playwright
    $env:CATALOG_11B_BROWSER_PATH = $browser
    & $node "scripts/test-catalog-staging-ui-11b.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Prompt 11B live staging UI test failed." }
  } finally {
    foreach ($name in @(
      "STAGING_PROJECT_REF", "STAGING_SUPABASE_URL", "STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY",
      "CATALOG_11B_PLAYWRIGHT_ENTRY", "CATALOG_11B_BROWSER_PATH"
    )) { [Environment]::SetEnvironmentVariable($name, $null, "Process") }
    $anonKey = $null
    $serviceKey = $null
    $rawKeys = $null
  }

  & "C:\Users\hoath\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" -NoProfile -File "scripts/run-catalog-staging-e2e-11a.ps1"
  if ($LASTEXITCODE -ne 0) { throw "Prompt 11A regression failed after 11B UI rehearsal." }
  Write-Output "CATALOG_11B_STAGING_UI_PASS"
} finally {
  Pop-Location
}
