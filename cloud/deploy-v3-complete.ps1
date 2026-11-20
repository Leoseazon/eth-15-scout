# ETH-15 Scout V3 paper-only data upgrade.
# Publishes the COMPLETE archival journal, same-engine candle chart,
# and official Kalshi market-window outcomes.
# SAFETY: keeps existing V3 Durable Object and existing paper entries enabled.
# Does NOT modify V2, market proxy, credentials or the paper portfolio.
$ErrorActionPreference='Stop'
if(!(Test-Path '.\wrangler.v3test.toml') -or !(Test-Path '.\wrangler.viewer.toml')){
  throw 'Open PowerShell in the eth-15-scout\cloud folder on the V3 dashboard branch.'
}
$current=(git branch --show-current).Trim()
if($current -ne 'v3-dashboard-gateway-20261119'){
  throw 'Wrong Git branch. Switch to v3-dashboard-gateway-20261119 first. No deployment performed.'
}
$orig=Get-Content '.\wrangler.v3test.toml' -Raw
if($orig -notmatch '(?m)^name\s*=\s*"eth-15-scout-cloud-v3test"\s*$' -or
   $orig -notmatch '(?m)^class_name\s*=\s*"ScoutEngine"\s*$' -or
   $orig -notmatch '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$'){
  throw 'Unexpected V3 configuration. Deployment aborted to protect live paper trading.'
}
# Do not change version-controlled fail-safe. Build a TEMPORARY deployment
# config whose paper mode matches the already-armed existing V3 service.
$replacement=[regex]::Replace($orig,
 '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$',
 'SCOUT_PAPER_MODE = "enabled"')
$tmp=Join-Path (Get-Location).Path 'wrangler.v3-RELEASE-temp.toml'
$utf8=New-Object System.Text.UTF8Encoding($false)
try{
 [System.IO.File]::WriteAllText($tmp,$replacement,$utf8)
 Write-Host 'Build check: current V3 bot + permanent journal (paper only)...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config $tmp --dry-run
 if($LASTEXITCODE -ne 0){throw 'V3 paper journal dry-run failed. Nothing deployed.'}
 Write-Host 'Build check: separate read-only website viewer...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config '.\wrangler.viewer.toml' --dry-run
 if($LASTEXITCODE -ne 0){throw 'Viewer dry-run failed. Nothing deployed.'}
 Write-Host 'Deploy V3 paper journal + chart snapshot; keep existing bot armed...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config $tmp
 if($LASTEXITCODE -ne 0){throw 'V3 journal release failed. Review Cloudflare without changing the bot.'}
 Write-Host 'Deploy separate read-only viewer; preserve username/password secrets...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config '.\wrangler.viewer.toml'
 if($LASTEXITCODE -ne 0){throw 'Viewer release failed. Bot journal may be updated; check Cloudflare.'}
 Write-Host 'Verify the viewer health URL...' -ForegroundColor Cyan
 try{
   $health=Invoke-RestMethod -Uri 'https://eth-15-scout-v3-view.leoseazon.workers.dev/health' -TimeoutSec 15
   if($health.ok -ne $true -or $health.paperOnly -ne $true){
     throw 'Unexpected viewer health response'
   }
   Write-Host 'Read-only viewer health: OK' -ForegroundColor Green
 }catch{Write-Warning ('Viewer health not verified: '+$_.Exception.Message)}
 Write-Host 'RELEASE COMPLETE (paper only)' -ForegroundColor Green
 Write-Host 'Dashboard: https://leoseazon.github.io/eth-15-scout/v3/' -ForegroundColor Green
 Write-Host 'Check: Monitoring Online, Paper Enabled, historical balance intact, Kraken chart and official Kalshi outcomes.' -ForegroundColor Cyan
 Write-Host 'Existing V2 service, saved credentials and V3 Durable Object were not replaced.' -ForegroundColor Cyan
}finally{
 Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
