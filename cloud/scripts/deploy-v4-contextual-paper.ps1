# ETH-15 Scout V4: audited Windows PowerShell runner.
# Owner objective: target-centered, context-aware paper decisions; predict the
# real target-side result, maximize attainable net profit, control downside.
# V3 entries are disarmed FIRST; V3 history remains intact. PAPER ONLY.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedSha,
  [Parameter(Mandatory=$true)][string]$RepositoryPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedMainSha
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
  # Pin the public GitHub Pages main source; never merge the draft PR.
  Must 'git' @('-C',$RepositoryPath,'fetch','--no-tags','--depth=1','origin','main') 'Read GitHub Pages main'
  $actualMain=(& git -C $RepositoryPath rev-parse FETCH_HEAD | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $actualMain -cne $ExpectedMainSha){
    throw ('STOPPED: main changed. Expected '+$ExpectedMainSha+', got '+$actualMain)
  }
  $siteFolder=Join-Path $env:TEMP ('eth15-v4-hub-'+$ExpectedSha)
  if(Test-Path -LiteralPath $siteFolder){
    throw ('STOPPED: reserved site worktree exists '+$siteFolder)
  }
  Must 'git' @('-C',$RepositoryPath,'worktree','add','--detach',$siteFolder,$ExpectedMainSha) 'Prepare pinned GitHub Pages source'
  foreach($asset in @('v4/index.html','v4/app.js')){
    $from=Join-Path $RepositoryPath ($asset.Replace('/','\'))
    $to=Join-Path $siteFolder ($asset.Replace('/','\'))
    Copy-Item -LiteralPath $from -Destination $to -Force
  }
  Must 'git' @('-C',$siteFolder,'add','--','v4/index.html','v4/app.js') 'Stage only audited V4 Hub assets'
  Must 'git' @('-C',$siteFolder,'diff','--cached','--check') 'Validate Hub patch whitespace'
  $changes=@(& git -C $siteFolder diff --cached --name-only)
  if($LASTEXITCODE -ne 0 -or $changes.Count -ne 2 -or
    $changes -notcontains 'v4/index.html' -or $changes -notcontains 'v4/app.js'){
    throw 'STOPPED: Hub publish must change exactly the two audited files'
  }
  $author=(& git -C $RepositoryPath config user.name | Out-String).Trim()
  $email=(& git -C $RepositoryPath config user.email | Out-String).Trim()
  if(-not $author){$author='ETH-15 Scout Release'}
  if(-not $email){$email='eth15-scout-release@users.noreply.github.com'}
  Must 'git' @('-C',$siteFolder,'-c',('user.name='+$author),
    '-c',('user.email='+$email),'commit','-m',
    ('Publish audited contextual V4 Update Hub from '+$ExpectedSha)) 'Prepare website commit'
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
  # Non-fast-forward protection prevents overwriting any new main changes.
  $currentMain=(& git -C $siteFolder ls-remote --heads origin main | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $currentMain.StartsWith($ExpectedMainSha)){
    throw 'STOPPED: GitHub main changed before V4 Hub publication'
  }
  Must 'git' @('-C',$siteFolder,'push','origin','HEAD:refs/heads/main') 'Publish only V4 Update Hub files'
  Write-Host '==> DEPLOY V4 CONTEXT-AWARE PAPER ENGINE' -ForegroundColor Yellow
  Must 'npx.cmd' @('--no-install','wrangler','deploy',
    '--config','wrangler.v4paper.toml') 'Deploy experimental V4 paper engine'
  Write-Host ('SUCCESS: V3 disarm + V4 Update Hub + V4 paper deploy accepted at '+$head) -ForegroundColor Green
  Write-Host 'GitHub Pages build and live trading-data readiness require runtime verification.'
  Write-Host 'Open V3 read-only dashboard to verify armed=false.'
  Write-Host 'Open V4 private dashboard to verify current index/book and paper-mode status.'
  Write-Host 'No real-money orders. V3 trade history remains intact.'
} finally {
  Set-Location -LiteralPath $original
}
