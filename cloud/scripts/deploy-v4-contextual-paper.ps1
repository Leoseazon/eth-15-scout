# ETH-15 Scout V4 — audited PowerShell deploy runner (PAPER ONLY).
# Disarm V3 paper entries before deploying paper-only V4; preserve V3 history.
# Called from a fresh clone pinned to a GitHub Actions-tested exact commit.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedSha,
  [Parameter(Mandatory=$true)][string]$RepositoryPath
)
$ErrorActionPreference = 'Stop'
function Must([string]$Executable,[string[]]$CommandArgs,[string]$Stage) {
  Write-Host "==> $Stage" -ForegroundColor Cyan
  & $Executable @CommandArgs
  if($LASTEXITCODE -ne 0) { throw "STOPPED: $Stage failed (exit $LASTEXITCODE). Nothing after this stage was run." }
}
$original = Get-Location
try {
  if($env:OS -ne 'Windows_NT'){throw 'STOPPED: this one-paste deployment runner is Windows PowerShell specific'}
  if(-not (Test-Path -LiteralPath $RepositoryPath -PathType Container)){throw "Repository folder missing"}
  foreach($app in @('git','node','npm.cmd','npx.cmd')) {
    if(-not (Get-Command $app -ErrorAction SilentlyContinue)){throw "Missing previously installed tool: $app"}
  }
  $head=(& git -C $RepositoryPath rev-parse HEAD | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $head -cne $ExpectedSha) {
    throw "STOPPED: cloned GitHub SHA $head does not match audited SHA $ExpectedSha"
  }
  $dirty=(& git -C $RepositoryPath status --porcelain | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $dirty) {throw "STOPPED: source folder is not clean"}
  $cloud=Join-Path $RepositoryPath 'cloud'
  $conf=Join-Path $cloud 'wrangler.v4paper.toml'
  $v3conf=Join-Path $cloud 'wrangler.v3test.toml'
  $engine=Join-Path $cloud 'v4\src\context-opportunity.js'
  $scriptName=Join-Path $cloud 'scripts\deploy-v4-contextual-paper.ps1'
  if(-not (Test-Path $conf) -or -not (Test-Path $v3conf) -or -not (Test-Path $engine) -or -not (Test-Path $scriptName)){
    throw "STOPPED: V4 paper configuration, engine or deployment runner missing"
  }
  $settings=Get-Content -LiteralPath $conf -Raw
  $checks=@(
    '(?m)^name\s*=\s*"eth-15-scout-cloud-v4test"\s*$',
    '(?m)^main\s*=\s*"v4/src/worker.js"\s*$',
    '(?m)^SCOUT_V4_PAPER_MODE\s*=\s*"enabled"\s*$',
    '(?m)^V4_SETTLEMENT_FIRST_EXPERIMENT\s*=\s*"true"\s*$',
    '(?m)^V4_DATA_RESEARCH_AUTHORIZED\s*=\s*"false"\s*$',
    '(?m)^V4_FULL_BOOK_ARCHIVE_ENABLED\s*=\s*"false"\s*$'
  )
  foreach($regex in $checks){if($settings -notmatch $regex){throw "STOPPED: unexpected paper-only V4 settings"}}
  $v3Settings=Get-Content -LiteralPath $v3conf -Raw
  foreach($regex in @('(?m)^name\s*=\s*"eth-15-scout-cloud-v3test"\s* @('ci') 'Install EXISTING project dependencies only (no new subscriptions)'
  Must 'npm.cmd' @('run','check') 'Check original V3 compatibility surfaces'
  Must 'node' @('--check','v4/src/context-opportunity.js') 'Check V4 contextual engine syntax'
  Must 'node' @('--check','v4/src/settlement-first.js') 'Check V4 evaluator syntax'
  Must 'node' @('--check','v4/src/settlement-first-paper.js') 'Check V4 paper state machine syntax'
  Must 'node' @('--check','v4/src/worker.js') 'Check V4 Cloudflare Worker syntax'
  Must 'npm.cmd' @('test') 'Run complete CI-equivalent unit/integration tests'
  Must 'npx.cmd' @('--no-install','wrangler','whoami') 'Verify existing Cloudflare login'
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml',
   '--dry-run','--outdir','.cloudflare-build-v4paper') 'Cloudflare paper Worker DRY RUN'
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v3test.toml',
    '--dry-run','--outdir','.cloudflare-build-v3-pause') 'V3 paper DISARM dry-run'
  Write-Host '==> Disarm V3 new paper BUYs (history preserved)' -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v3test.toml') 'Disarm V3 paper entries'
  Write-Host "==> Deploying TESTED V4 paper simulator, commit $head" -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml') 'Deploy V4 paper Worker'
  Write-Host ''
  Write-Host "V4 PAPER deploy request accepted by Wrangler. Confirm actual runtime and live feeds in private V4 dashboard." -ForegroundColor Green
  Write-Host "Audit SHA: $head"
  Write-Host 'V3 paper entry flag disabled in Wrangler config. Verify armed=false on V3 dashboard.'
  Write-Host 'V3 trade history preserved. No real-money order capability.'
} finally {
  Set-Location $original
}
,
    '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s* @('ci') 'Install EXISTING project dependencies only (no new subscriptions)'
  Must 'npm.cmd' @('run','check') 'Check original V3 compatibility surfaces'
  Must 'node' @('--check','v4/src/context-opportunity.js') 'Check V4 contextual engine syntax'
  Must 'node' @('--check','v4/src/settlement-first.js') 'Check V4 evaluator syntax'
  Must 'node' @('--check','v4/src/settlement-first-paper.js') 'Check V4 paper state machine syntax'
  Must 'node' @('--check','v4/src/worker.js') 'Check V4 Cloudflare Worker syntax'
  Must 'npm.cmd' @('test') 'Run complete CI-equivalent unit/integration tests'
  Must 'npx.cmd' @('--no-install','wrangler','whoami') 'Verify existing Cloudflare login'
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml',
   '--dry-run','--outdir','.cloudflare-build-v4paper') 'Cloudflare paper Worker DRY RUN'
  Write-Host "==> Deploying TESTED V4 paper simulator ONLY, commit $head" -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml') 'Deploy V4 paper Worker'
  Write-Host ''
  Write-Host "V4 PAPER deploy request accepted by Wrangler. Confirm actual runtime and live feeds in private V4 dashboard." -ForegroundColor Green
  Write-Host "Audit SHA: $head"
  Write-Host "V3 not deployed or modified. No real-money order capability."
} finally {
  Set-Location $original
}
,
    '(?m)^keep_vars\s*=\s*true\s* @('ci') 'Install EXISTING project dependencies only (no new subscriptions)'
  Must 'npm.cmd' @('run','check') 'Check original V3 compatibility surfaces'
  Must 'node' @('--check','v4/src/context-opportunity.js') 'Check V4 contextual engine syntax'
  Must 'node' @('--check','v4/src/settlement-first.js') 'Check V4 evaluator syntax'
  Must 'node' @('--check','v4/src/settlement-first-paper.js') 'Check V4 paper state machine syntax'
  Must 'node' @('--check','v4/src/worker.js') 'Check V4 Cloudflare Worker syntax'
  Must 'npm.cmd' @('test') 'Run complete CI-equivalent unit/integration tests'
  Must 'npx.cmd' @('--no-install','wrangler','whoami') 'Verify existing Cloudflare login'
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml',
   '--dry-run','--outdir','.cloudflare-build-v4paper') 'Cloudflare paper Worker DRY RUN'
  Write-Host "==> Deploying TESTED V4 paper simulator ONLY, commit $head" -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml') 'Deploy V4 paper Worker'
  Write-Host ''
  Write-Host "V4 PAPER deploy request accepted by Wrangler. Confirm actual runtime and live feeds in private V4 dashboard." -ForegroundColor Green
  Write-Host "Audit SHA: $head"
  Write-Host "V3 not deployed or modified. No real-money order capability."
} finally {
  Set-Location $original
}
)) {
    if($v3Settings -notmatch $regex){throw 'STOPPED: V3 disarm settings are not safe'}
  }
  Set-Location -LiteralPath $cloud
  Must 'npm.cmd' @('ci') 'Install EXISTING project dependencies only (no new subscriptions)'
  Must 'npm.cmd' @('run','check') 'Check original V3 compatibility surfaces'
  Must 'node' @('--check','v4/src/context-opportunity.js') 'Check V4 contextual engine syntax'
  Must 'node' @('--check','v4/src/settlement-first.js') 'Check V4 evaluator syntax'
  Must 'node' @('--check','v4/src/settlement-first-paper.js') 'Check V4 paper state machine syntax'
  Must 'node' @('--check','v4/src/worker.js') 'Check V4 Cloudflare Worker syntax'
  Must 'npm.cmd' @('test') 'Run complete CI-equivalent unit/integration tests'
  Must 'npx.cmd' @('--no-install','wrangler','whoami') 'Verify existing Cloudflare login'
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml',
   '--dry-run','--outdir','.cloudflare-build-v4paper') 'Cloudflare paper Worker DRY RUN'
  Write-Host "==> Deploying TESTED V4 paper simulator ONLY, commit $head" -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy','--config','wrangler.v4paper.toml') 'Deploy V4 paper Worker'
  Write-Host ''
  Write-Host "V4 PAPER deploy request accepted by Wrangler. Confirm actual runtime and live feeds in private V4 dashboard." -ForegroundColor Green
  Write-Host "Audit SHA: $head"
  Write-Host "V3 not deployed or modified. No real-money order capability."
} finally {
  Set-Location $original
}
