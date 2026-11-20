# ETH-15 Scout V3 PAPER-only release: original Durable Object retained.
# No modification of V2, market proxy, passwords, or historic paper balance.
# IMPORTANT: abort rather than falsely reporting success after a cancelled deploy.
$ErrorActionPreference='Stop'
if(!(Test-Path '.\wrangler.v3test.toml') -or !(Test-Path '.\wrangler.viewer.toml')){
  throw 'Open PowerShell in the eth-15-scout\cloud folder on the V3 dashboard branch.'
}
$current=(git branch --show-current).Trim()
if($current -ne 'v3-dashboard-gateway-20261119'){
  throw 'Wrong Git branch. No deployment attempted.'
}
$orig=Get-Content '.\wrangler.v3test.toml' -Raw
if($orig -notmatch '(?m)^name\s*=\s*"eth-15-scout-cloud-v3test"\s*$' -or
   $orig -notmatch '(?m)^class_name\s*=\s*"ScoutEngine"\s*$' -or
   $orig -notmatch '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$' -or
   $orig -notmatch '(?m)^workers_dev\s*=\s*false\s*$' -or
   $orig -match '(?m)^preview_urls\s*='){
  throw 'Unexpected V3 configuration. No deployment attempted.'
}
# Preserve the tracked fail-safe (disabled) and generate a TEMP-only PAPER config.
# Explicitly retain Cloudflare's current disabled preview-URL setting.
$replacement=[regex]::Replace($orig,
 '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$',
 'SCOUT_PAPER_MODE = "enabled"')
$replacement=[regex]::Replace($replacement,
 '(?m)^workers_dev\s*=\s*false\s*$',
 ('workers_dev = false' + [Environment]::NewLine + 'preview_urls = false'))
$tmp=Join-Path (Get-Location).Path 'wrangler.v3-RELEASE-temp.toml'
$utf8=New-Object System.Text.UTF8Encoding($false)
try{
 [System.IO.File]::WriteAllText($tmp,$replacement,$utf8)
 Write-Host 'Build check: V3 PAPER engine + journal...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config $tmp --dry-run
 if($LASTEXITCODE -ne 0){throw 'V3 dry-run failed. Nothing deployed.'}
 Write-Host 'Build check: separate read-only viewer...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config '.\wrangler.viewer.toml' --dry-run
 if($LASTEXITCODE -ne 0){throw 'Viewer dry-run failed. Nothing deployed.'}
 Write-Host 'Deploy V3 PAPER engine (keep existing Durable Object)...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config $tmp | Tee-Object -Variable v3DeployLog
 # Wrangler 4.x can return exit code 0 if the user declines a warning!
 if($LASTEXITCODE -ne 0 -or
    (($v3DeployLog -join [Environment]::NewLine) -notmatch 'Deployed eth-15-scout-cloud-v3test')){
   throw 'V3 engine deployment NOT CONFIRMED; do not start observation.'
 }
 Write-Host 'V3 WORKER DEPLOYED: CONFIRMED.' -ForegroundColor Green
 Write-Host 'Deploy separate read-only viewer (retain saved secrets)...' -ForegroundColor Cyan
 npx.cmd wrangler deploy --config '.\wrangler.viewer.toml' | Tee-Object -Variable viewerDeployLog
 if($LASTEXITCODE -ne 0 -or
    (($viewerDeployLog -join [Environment]::NewLine) -notmatch 'Deployed eth-15-scout-v3-view')){
   throw 'Viewer deployment NOT CONFIRMED; V3 may already be updated.'
 }
 Write-Host 'Check read-only viewer health...' -ForegroundColor Cyan
 try{
   $health=Invoke-RestMethod -Uri 'https://eth-15-scout-v3-view.leoseazon.workers.dev/health' -TimeoutSec 15
   if($health.ok -ne $true -or $health.paperOnly -ne $true){
      throw 'Unexpected viewer response'
   }
 }catch{
   throw ('Both deploy messages seen but viewer health not verified: '+$_.Exception.Message)
 }
 Write-Host 'RELEASE COMPLETE (paper only; both Workers confirmed deployed)' -ForegroundColor Green
 Write-Host 'Dashboard: https://leoseazon.github.io/eth-15-scout/v3/' -ForegroundColor Green
 Write-Host 'NEXT: Verify first release engine tick and unchanged historical bankroll.' -ForegroundColor Cyan
}finally{
 Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
