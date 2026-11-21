# ETH-15 Scout PAPER SOFT-GUARD HOTFIX: local verification + two Cloudflare dry-runs.
# DEFAULT = DRY-RUN ONLY. Explicit -Deploy and typed confirmation needed to publish.
# Uses the SAME V3 Worker name, Durable Object class/binding and migration.
# NEVER makes real trades, changes passwords, resets paper bankroll, or wipes records.
param([switch]$Deploy)
$ErrorActionPreference='Stop'
$expected='hotfix-v3-paper-soft-guard-bypass-20261120'
Push-Location $PSScriptRoot
$tmp=$null
try {
  Write-Host 'PAPER SOFT-BYPASS -- PRE-FLIGHT SAFETY VALIDATION' -ForegroundColor Cyan
  $actual=(git branch --show-current).Trim()
  if($LASTEXITCODE -ne 0 -or $actual -ne $expected){
    throw "Wrong Git branch '$actual'. Expected '$expected'. No deployment."
  }
  $changes=@(git status --porcelain --untracked-files=normal)
  if($LASTEXITCODE -ne 0 -or $changes.Count -gt 0){
    $sample=($changes | Select-Object -First 8) -join '; '
    throw "Working tree is not clean ($sample). Do not risk deploying local unreviewed changes."
  }
  $confPath='wrangler.v3test.toml'
  $viewerConf='wrangler.viewer.toml'
  if(!(Test-Path $confPath) -or !(Test-Path $viewerConf)) {
    throw 'Expected V3 engine and viewer Wrangler configuration files missing.'
  }
  $orig=Get-Content $confPath -Raw
  $viewer=Get-Content $viewerConf -Raw
  $validConfig=(
    $orig -match '(?m)^name\s*=\s*"eth-15-scout-cloud-v3test"\s*$' -and
    $orig -match '(?m)^main\s*=\s*"src/worker.js"\s*$' -and
    $orig -match '(?m)^name\s*=\s*"SCOUT"\s*$' -and
    $orig -match '(?m)^class_name\s*=\s*"ScoutEngine"\s*$' -and
    $orig -match '(?m)^tag\s*=\s*"v1"\s*$' -and
    $orig -match '(?m)^new_sqlite_classes\s*=\s*\["ScoutEngine"\]\s*$' -and
    $orig -match '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$' -and
    $orig -match '(?m)^workers_dev\s*=\s*false\s*$' -and
    $orig -notmatch '(?m)^preview_urls\s*=' -and
    $orig -match 'eth-15-scout-api.leoseazon.workers.dev/markets' -and
    $viewer -match '(?m)^name\s*=\s*"eth-15-scout-v3-view"\s*$' -and
    $viewer -match '(?m)^script_name\s*=\s*"eth-15-scout-cloud-v3test"\s*$'
  )
  if(!$validConfig){throw 'Worker/Durable Object/paper-only config differs from reviewed deployment safety baseline.'}
  # Ensure we do not silently undo Phase 1 fixes or upload unrelated code.
  $engine=Get-Content 'src/v2.js' -Raw
  $worker=Get-Content 'src/worker.js' -Raw
  $feed=Get-Content 'src/feed-health.js' -Raw
  $policy=Get-Content 'src/v3-policy.js' -Raw
  if($engine -notmatch 'EXIT RISK' -or
     $engine -notmatch "if\(!m5\|\|!fresh\)" -or
     $engine -notmatch 'honeyStopTriggered' -or
     $worker -notmatch 'collectMarketFeeds' -or
     $worker -notmatch 'PHASE1_TAG' -or
     $feed -notmatch 'Promise\.allSettled' -or
     $worker -notmatch 'makeV2Engine\(s,\{softGuardEnabled:false\}\)' -or
     $engine -notmatch 'pendingExposure,previousMode,softGuardEnabled' -or
     $policy -notmatch 'softGuardEnabled!==false'){
    throw 'Phase 1 safeguards or SOFT bypass code missing. No deployment.'
  }
  Write-Host 'SAFE: isolated branch; same V3 Worker + Durable Object; stored paper mode disabled.' -ForegroundColor Green

  if(!(Test-Path '.\node_modules\.bin\wrangler.cmd')){
    Write-Host 'Dependencies not installed; running npm ci...' -ForegroundColor Cyan
    npm.cmd ci
    if($LASTEXITCODE -ne 0){throw 'npm ci FAILED. No deployment.'}
  }
  Write-Host 'Verifying all JavaScript syntax...' -ForegroundColor Cyan
  npm.cmd run check
  if($LASTEXITCODE -ne 0){throw 'Syntax check FAILED. No deployment.'}
  Write-Host 'Running COMPLETE native Node regression suite...' -ForegroundColor Cyan
  npm.cmd test
  if($LASTEXITCODE -ne 0){throw 'Node regression FAILED. No deployment.'}
  Write-Host 'PASS: native Node tests and source syntax.' -ForegroundColor Green

  # The committed TOML stays explicitly DISABLED. Only a temporary copy is
  # enabled for DRY RUN and (if separately confirmed) PAPER-ONLY release.
  $release=[regex]::Replace($orig,
    '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$','SCOUT_PAPER_MODE = "enabled"')
  $release=[regex]::Replace($release,
    '(?m)^workers_dev\s*=\s*false\s*$',
    ('workers_dev = false'+[Environment]::NewLine+'preview_urls = false'))
  if($release -notmatch '(?m)^SCOUT_PAPER_MODE\s*=\s*"enabled"\s*$' -or
     $release -notmatch '(?m)^preview_urls\s*=\s*false\s*$'){
    throw 'Temporary PAPER-ONLY config could not be validated.'
  }
  $tmp=Join-Path $PSScriptRoot 'wrangler.soft-bypass-RELEASE-temp.toml'
  [System.IO.File]::WriteAllText($tmp,$release,(New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'Cloudflare ENGINE build dry-run (NO DEPLOYMENT)...' -ForegroundColor Cyan
  npx.cmd wrangler deploy --config $tmp --dry-run
  if($LASTEXITCODE -ne 0){throw 'Cloudflare V3 engine dry-run FAILED.'}
  Write-Host 'Cloudflare read-only VIEWER build dry-run (NO DEPLOYMENT)...' -ForegroundColor Cyan
  npx.cmd wrangler deploy --config $viewerConf --dry-run
  if($LASTEXITCODE -ne 0){throw 'Cloudflare V3 viewer dry-run FAILED.'}
  Write-Host 'PASS: BOTH CLOUDFLARE DRY-RUNS (nothing published).' -ForegroundColor Green

  $viewerHealth='https://eth-15-scout-v3-view.leoseazon.workers.dev/health'
  try {
    $health=Invoke-RestMethod -Uri $viewerHealth -TimeoutSec 15
    if($health.ok -eq $true -and $health.paperOnly -eq $true) {
      Write-Host 'PASS: currently deployed read-only viewer health and paper-only status.' -ForegroundColor Green
    }else{
      Write-Warning 'Viewer responded but did not satisfy expected health fields. Review before deployment.'
      if($Deploy){throw 'Viewer health precheck FAILED. Cannot deploy.'}
    }
  }catch{
    Write-Warning ('Cannot verify current viewer health: '+$_.Exception.Message)
    if($Deploy){throw 'Viewer health precheck FAILED. Cannot deploy.'}
  }

  if(!$Deploy){
    Write-Host 'SOFT BYPASS FULL PREFLIGHT PASSED. NOTHING DEPLOYED.' -ForegroundColor Green
    Write-Host 'Review output with ChatGPT before opting into deployment.' -ForegroundColor Cyan
    exit 0
  }
  Write-Warning 'You requested -Deploy. This will update the EXISTING V3 PAPER engine.'
  Write-Warning 'It should retain the same SQLite Durable Object, cash, trades, secrets and histories.'
  $answer=Read-Host 'Type EXACTLY DEPLOY PAPER SOFT BYPASS to authorize the paper-only engine update'
  if($answer -cne 'DEPLOY PAPER SOFT BYPASS'){
    Write-Host 'Deployment cancelled. Dry-runs completed; Cloudflare unchanged.' -ForegroundColor Yellow
    exit 0
  }
  Write-Host 'Deploying ONLY V3 PAPER engine (viewer unchanged)...' -ForegroundColor Cyan
  npx.cmd wrangler deploy --config $tmp | Tee-Object -Variable deployLog
  if($LASTEXITCODE -ne 0 -or
     (($deployLog -join [Environment]::NewLine) -notmatch 'Deployed eth-15-scout-cloud-v3test')){
    throw 'Paper engine deployment NOT CONFIRMED. Do not assume release succeeded.'
  }
  Write-Host 'SOFT BYPASS PAPER ENGINE DEPLOY CONFIRMED. Viewer source and secrets unchanged.' -ForegroundColor Green
  Write-Host 'Dashboard: https://leoseazon.github.io/eth-15-scout/v3/' -ForegroundColor Cyan
  Write-Host 'NEXT: verify SOFT_GUARD_HOTFIX_TAG first tick, dailyRisk.softGuardEnabled=false, paper bankroll and historical journal.' -ForegroundColor Cyan
} finally {
  if($tmp -and (Test-Path -LiteralPath $tmp)){
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
