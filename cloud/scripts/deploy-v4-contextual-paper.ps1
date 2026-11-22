# ETH-15 Scout V4: audited Windows PowerShell runner.
# Owner objective: target-centered, context-aware paper decisions; predict the
# real target-side result, maximize attainable net profit, control downside.
# V3 entries are disarmed FIRST; V3 history remains intact. PAPER ONLY.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedSha,
  [Parameter(Mandatory=$true)][string]$RepositoryPath
)
$ErrorActionPreference = 'Stop'
function Must([string]$Executable,[string[]]$CommandArgs,[string]$Stage) {
  Write-Host ("==> " + $Stage) -ForegroundColor Cyan
  & $Executable @CommandArgs
  if($LASTEXITCODE -ne 0) {
    throw ("STOPPED at " + $Stage + " (exit code " + $LASTEXITCODE + ")")
  }
}
$original=Get-Location
try {
  if($env:OS -ne 'Windows_NT'){throw 'Windows PowerShell required'}
  foreach($cmd in @('git','node','npm.cmd','npx.cmd')){
    if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)){
      throw ("Previously installed command missing: " + $cmd)
    }
  }
  if(-not (Test-Path -LiteralPath $RepositoryPath -PathType Container)){
    throw 'Exact source repository folder unavailable'
  }
  $head=(& git -C $RepositoryPath rev-parse HEAD | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $head -cne $ExpectedSha){
    throw ("STOPPED: source commit is not the verified commit: " + $head)
  }
  $dirty=(& git -C $RepositoryPath status --porcelain | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $dirty){
    throw 'STOPPED: source contains uncommitted changes'
  }
  $cloud=Join-Path $RepositoryPath 'cloud'
  $v4Config=Join-Path $cloud 'wrangler.v4paper.toml'
  $v3Config=Join-Path $cloud 'wrangler.v3test.toml'
  $engine=Join-Path $cloud 'v4\src\context-opportunity.js'
  $runner=Join-Path $cloud 'scripts\deploy-v4-contextual-paper.ps1'
  foreach($file in @($v4Config,$v3Config,$engine,$runner)){
    if(-not (Test-Path -LiteralPath $file -PathType Leaf)){
      throw ("STOPPED: missing audited file " + $file)
    }
  }
  $v4Settings=Get-Content -LiteralPath $v4Config -Raw
  foreach($pattern in @(
    '(?m)^name\s*=\s*"eth-15-scout-cloud-v4test"\s*$',
    '(?m)^main\s*=\s*"v4/src/worker.js"\s*$',
    '(?m)^SCOUT_V4_PAPER_MODE\s*=\s*"enabled"\s*$',
    '(?m)^V4_SETTLEMENT_FIRST_EXPERIMENT\s*=\s*"true"\s*$',
    '(?m)^V4_DATA_RESEARCH_AUTHORIZED\s*=\s*"false"\s*$',
    '(?m)^V4_FULL_BOOK_ARCHIVE_ENABLED\s*=\s*"false"\s*$'
  )){
    if($v4Settings -notmatch $pattern){
      throw 'STOPPED: V4 paper-only configuration safety check failed'
    }
  }
  $v3Settings=Get-Content -LiteralPath $v3Config -Raw
  foreach($pattern in @(
    '(?m)^name\s*=\s*"eth-15-scout-cloud-v3test"\s*$',
    '(?m)^main\s*=\s*"src/worker.js"\s*$',
    '(?m)^SCOUT_PAPER_MODE\s*=\s*"disabled"\s*$',
    '(?m)^keep_vars\s*=\s*true\s*$'
  )){
    if($v3Settings -notmatch $pattern){
      throw 'STOPPED: V3 disarm configuration safety check failed'
    }
  }
  Set-Location -LiteralPath $cloud
  Must 'npm.cmd' @('ci') 'Install existing pinned project dependencies'
  Must 'npm.cmd' @('run','check') 'Source syntax/compatibility checks'
  foreach($source in @(
    'v4/src/context-opportunity.js',
    'v4/src/price-value-research.js',
    'v4/src/settlement-first.js',
    'v4/src/settlement-first-paper.js',
    'v4/src/worker.js'
  )){
    Must 'node' @('--check',$source) ('Syntax check: '+$source)
  }
  Must 'npm.cmd' @('test') 'Complete V3/V4 regression suite'
  Must 'npx.cmd' @('--no-install','wrangler','whoami') 'Existing Cloudflare authorization'
  Must 'npx.cmd' @('--no-install','wrangler','deploy',
    '--config','wrangler.v3test.toml','--dry-run',
    '--outdir','.cloudflare-build-v3-disarmed') 'V3 disarmed Worker dry-run'
  Must 'npx.cmd' @('--no-install','wrangler','deploy',
    '--config','wrangler.v4paper.toml','--dry-run',
    '--outdir','.cloudflare-build-v4paper') 'V4 paper Worker dry-run'
  Write-Host '==> DISARM V3 NEW PAPER BUYS; history stays in its Durable Object' -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy',
    '--config','wrangler.v3test.toml') 'Deploy disabled V3 entry flag'
  Write-Host '==> DEPLOY V4 CONTEXT-AWARE PAPER ENGINE' -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy',
    '--config','wrangler.v4paper.toml') 'Deploy experimental V4 paper engine'
  Write-Host ('SUCCESS: Wrangler accepted V3 disarm and V4 paper deploy at '+$head) -ForegroundColor Green
  Write-Host 'Open V3 read-only dashboard to verify armed=false.'
  Write-Host 'Open V4 private dashboard to verify current index/book and paper-mode status.'
  Write-Host 'No real-money orders. V3 trade history remains intact.'
} finally {
  Set-Location -LiteralPath $original
}
