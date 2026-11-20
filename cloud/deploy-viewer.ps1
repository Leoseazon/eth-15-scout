# ETH-15 Scout V3: deploy a separate READ-ONLY website viewer.
# Never deploys the V3 trading Worker or changes SCOUT_PAPER_MODE.
# Run from the cloud folder after switching to v3-dashboard-gateway-20261119.
param([switch]$SkipKeySetup)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.\wrangler.viewer.toml')) {
  throw 'Run from C:\Users\Admin\KalshiBot\eth-15-scout\cloud on the V3 viewer branch.'
}
Write-Host '== Verify isolated V3 dashboard gateway ==' -ForegroundColor Cyan
npx.cmd wrangler deploy --config wrangler.viewer.toml --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Viewer build failed. No viewer deployed.' }

Write-Host '== Deploy NEW read-only V3 dashboard gateway ==' -ForegroundColor Cyan
npx.cmd wrangler deploy --config wrangler.viewer.toml
if ($LASTEXITCODE -ne 0) { throw 'Viewer deploy failed. No secret created.' }

if (-not $SkipKeySetup) {
  Write-Host '== Set private V3 viewer key (copy never shown) ==' -ForegroundColor Cyan
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $key = [BitConverter]::ToString($bytes).Replace('-','')
  try {
    # Wrangler accepts a piped secret. The value is never printed to screen.
    $key | npx.cmd wrangler secret put VIEW_TOKEN --config wrangler.viewer.toml
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare secret setup failed.' }
    Set-Clipboard -Value $key
    Write-Host 'Private dashboard key created and copied to your clipboard.' -ForegroundColor Green
    Write-Host 'Do NOT paste the key into this chat or any screenshot.' -ForegroundColor Yellow
  } finally {
    $key = $null
    [Array]::Clear($bytes,0,$bytes.Length)
  }
} else {
  Write-Host 'Skipped VIEW_TOKEN setup. Existing Cloudflare viewer key must already exist.' -ForegroundColor Yellow
}
Write-Host 'Read-only viewer URL: https://eth-15-scout-v3-view.leoseazon.workers.dev/health'
Write-Host 'Dashboard: https://leoseazon.github.io/eth-15-scout/v3/'
Write-Host 'Open the dashboard and paste the clipboard key into the secure viewer field.'
Write-Host 'V3 paper-trading engine, bankroll and stored trades were NOT modified by this script.' -ForegroundColor Green
