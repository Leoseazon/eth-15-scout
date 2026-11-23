#Requires -Version 5.1
<#
Owner-only, fail-closed MAIN V4 Opportunistic cutover.
NEVER deploys Controls, V3, Viewer or the shared market proxy.
Requires the exact audited source SHA and existing MAIN Cloudflare version.
A full JSON export is evidence, NOT a backup of Cloudflare DO internal data.
Usage:
 powershell -NoProfile -ExecutionPolicy Bypass -File cloud/scripts/deploy-v4-main-only-opportunistic.ps1 -ExpectedCommit <SHA> -ExpectedMainVersion <original-version-UUID>
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9-]{36}$')][string]$ExpectedMainVersion
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$cloud=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root=(Resolve-Path (Join-Path $cloud '..')).Path
$actual=((& git -C $root rev-parse HEAD) -join '').Trim()
if($LASTEXITCODE -ne 0 -or $actual -ne $ExpectedCommit){
 throw 'Pinned audited Git commit mismatch. MAIN unchanged.'
}
if(@(git -C $root status --porcelain).Count -gt 0){
 throw 'Uncommitted files in checkout. MAIN unchanged.'
}
$mainCfg=Get-Content (Join-Path $cloud 'wrangler.v4paper.toml') -Raw
$stoppedCfg=Get-Content (Join-Path $cloud 'wrangler.v4test.toml') -Raw
$controlCfg=Get-Content (Join-Path $cloud 'wrangler.v4controls.toml') -Raw
$viewerCfg=Get-Content (Join-Path $cloud 'wrangler.v4viewer.toml') -Raw
$code=Get-Content (Join-Path $cloud 'v4/src/main-only-worker.js') -Raw
foreach($needed in @(
 'name = "eth-15-scout-cloud-v4test"',
 'main = "v4/src/main-only-worker.js"',
 'keep_vars = true',
 'workers_dev = false',
 'SCOUT_V4_PAPER_MODE = "enabled"',
 'V4_SETTLEMENT_FIRST_EXPERIMENT = "true"',
 'V4_MAIN_PROFILE = "OPPORTUNISTIC"',
 'name = "SCOUT_V4"',
 'class_name = "ScoutEngineV4"',
 'tag = "v4-new-class-v1"'
)){
 if(-not $mainCfg.Contains($needed)){
  throw "MAIN-only deployment configuration has changed: $needed"
 }
}
if($mainCfg.Contains('SCOUT_CONTROLS') -or $mainCfg.Contains('script_name = ') -or
 $mainCfg.Contains('eth-15-scout-v4-controls') -or
 -not $stoppedCfg.Contains('main = "v4/src/main-only-worker.js"') -or
 -not $viewerCfg.Contains('script_name = "eth-15-scout-cloud-v4test"') -or
 -not $controlCfg.Contains('name = "eth-15-scout-v4-controls"') -or
 -not $code.Contains("export class ScoutEngineV4 extends DurableObject") -or
 -not $code.Contains("getByName('v4-single-paper-scout')") -or
 -not $code.Contains("report=settlementFirstPaperStep(s,") -or
 -not $code.Contains("this.ctx.storage.transactionSync(()=>{")){
 throw 'MAIN identity, viewer binding or paper-trade state machine does not match audit. MAIN unchanged.'
}
foreach($forbidden in @('observeProspectiveShadow','conservative-control',
 'SCOUT_CONTROLS','controlState','shadow-research-observer')){
 if($code.Contains($forbidden)){throw "Research leaked into MAIN: $forbidden"}
}
function Read-ActiveMainVersion {
 $lines=@(& npx.cmd --no-install wrangler deployments status --name eth-15-scout-cloud-v4test --json)
 if($LASTEXITCODE -ne 0){throw 'Cloudflare MAIN version not readable. No deploy.'}
 try{$obj=($lines -join "`n")|ConvertFrom-Json -ErrorAction Stop}
 catch{throw 'Cloudflare MAIN status JSON invalid. No deploy.'}
 $active=@($obj.versions|Where-Object {$_.percentage -eq 100})
 if($active.Count -ne 1 -or
    [string]$active[0].version_id -notmatch '^[a-fA-F0-9-]{36}$'){
  throw 'Cloudflare MAIN must have exactly one 100%-active version.'
 }
 return [string]$active[0].version_id
}
function Read-ControlsHealth {
 $secretFile=Join-Path $env:LOCALAPPDATA 'ETH15-Scout\controls-admin-token.dpapi'
 if(-not (Test-Path -LiteralPath $secretFile -PathType Leaf)){
  throw 'No local encrypted Worker2 token; refuse MAIN deployment.'
 }
 $raw=(Get-Content -LiteralPath $secretFile -Raw).Trim()
 $secure=ConvertTo-SecureString -String $raw -ErrorAction Stop
 $ptr=[IntPtr]::Zero
 try{
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $headers=@{Authorization='Bearer '+$token}
  $s=Invoke-RestMethod -Uri 'https://eth-15-scout-v4-controls.leoseazon.workers.dev/v1/status' -Headers $headers -Method GET -TimeoutSec 20
  return $s
 }finally{
  if($ptr -ne [IntPtr]::Zero){
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  Remove-Variable raw,token,headers,secure -ErrorAction SilentlyContinue
 }
}
function Assert-ControlsHealthy {
 param($s)
 $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 if($s.researchWorkerRole -ne 'CONTROLS_ONLY' -or
    $s.researchControlsAllowed -ne $true -or
    $s.mainTradingDisabledByCode -ne $true -or
    $s.armed -ne $false -or
    $s.settlementPaperAllowed -ne $false -or
    $s.streamConnection.connected -ne $true -or
    $s.paperFeedHealth.kalshiWsBookFresh -ne $true -or
    $s.paperFeedHealth.officialIndexLastState -ne 'HTTP_200_VALID_ETH_INDEX' -or
    $s.paperFeedHealth.officialIndexLastAgeMs -lt 0 -or
    $s.paperFeedHealth.officialIndexLastAgeMs -gt 15000 -or
    [long]$s.lastResearchTickAt -lt ($now-45000) -or
    [long]$s.lastResearchTickAt -gt $now -or
    $s.lastError -or $s.lastResearchError){
  throw 'Worker2 health no longer passes; MAIN unchanged.'
 }
}
Push-Location $cloud
try{
 Write-Host 'AUDIT: checking MAIN-only source and dry-run. No deployment yet.' -ForegroundColor Cyan
 & npm.cmd ci
 if($LASTEXITCODE -ne 0){throw 'npm ci failed; MAIN unchanged'}
 & npm.cmd run check
 if($LASTEXITCODE -ne 0){throw 'Source check failed; MAIN unchanged'}
 & npm.cmd test
 if($LASTEXITCODE -ne 0){throw 'Regression test failed; MAIN unchanged'}
 & npx.cmd --no-install wrangler deploy --config wrangler.v4paper.toml --dry-run
 if($LASTEXITCODE -ne 0){throw 'MAIN dry-run failed; MAIN unchanged'}

 $version=Read-ActiveMainVersion
 if($version -ne $ExpectedMainVersion){
  throw "MAIN active version drifted ($version). Expected $ExpectedMainVersion. No deployment."
 }
 Assert-ControlsHealthy (Read-ControlsHealth)
 Write-Host 'Main baseline version and independent Worker2 verified.' -ForegroundColor Green
 Write-Host ('MAIN rollback version: '+$version) -ForegroundColor Yellow

 # Verify separately saved, non-empty historical JSON files, without parsing
 # enormous archives or displaying any private token / journal contents.
 $dirs=@((Join-Path $HOME 'Downloads'),
         (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ETH15-Backups'))
 $files=@()
 foreach($dir in $dirs){
  if(Test-Path -LiteralPath $dir -PathType Container){
   $files+=@(Get-ChildItem -LiteralPath $dir -File -Filter '*.json')
  }
 }
 $journal=@($files|Where-Object {
  $_.Name -like 'ETH-15-Scout-V4-Research-*.json' -and $_.Length -ge 1000
 }|Sort-Object LastWriteTime -Descending|Select-Object -First 1)
 $audit=@($files|Where-Object {
  ($_.Name -like '*Audit*.json' -or
   $_.Name -like 'ETH-15-Scout-V4-Complete-Evidence-*.json') -and
  $_.Length -ge 1000
 }|Sort-Object LastWriteTime -Descending|Select-Object -First 1)
 if($journal.Count -ne 1 -or $audit.Count -ne 1){
  throw 'Could not find separate nonempty Journal and Audit JSON exports in Downloads or Documents\ETH15-Backups. MAIN unchanged.'
 }
 Write-Host ('Journal backup found: '+$journal[0].FullName)
 Write-Host ('Audit backup found: '+$audit[0].FullName)
 Write-Host 'These exports are evidence, NOT a complete Durable Object database snapshot.' -ForegroundColor Yellow
 Write-Host 'Inspect your current MAIN dashboard before approving: no open position, no unsettled trades, current data feeds and prior cash/trades visible.' -ForegroundColor Yellow
 $review=(Read-Host 'If checked, type MAIN DASHBOARD VERIFIED').Trim()
 if($review -cne 'MAIN DASHBOARD VERIFIED'){
  throw 'MAIN dashboard not confirmed. No deployment.'
 }
 $approval=(Read-Host 'To deploy ONLY eth-15-scout-cloud-v4test, type DEPLOY MAIN OPPORTUNISTIC').Trim()
 if($approval -cne 'DEPLOY MAIN OPPORTUNISTIC'){
  throw 'No explicit MAIN-only cutover approval. No deployment.'
 }
 # Recheck BOTH live systems, after all confirmations, before any write.
 if((Read-ActiveMainVersion) -ne $ExpectedMainVersion){
  throw 'MAIN changed since preflight. No deployment.'
 }
 Assert-ControlsHealthy (Read-ControlsHealth)
 Write-Host 'DEPLOYING ONLY MAIN. Worker2/Viewer/V3/market proxy are not targeted.' -ForegroundColor Cyan
 & npx.cmd --no-install wrangler deploy --config wrangler.v4paper.toml
 if($LASTEXITCODE -ne 0){throw 'MAIN deployment command failed. Inspect Cloudflare and use preserved version if necessary.'}
 $newVersion=Read-ActiveMainVersion
 Write-Host ('OLD MAIN VERSION: '+$ExpectedMainVersion) -ForegroundColor Yellow
 Write-Host ('NEW MAIN VERSION: '+$newVersion) -ForegroundColor Green
 Write-Host 'Deployment command finished. Inspect MAIN live dashboard/history and Worker2 health immediately; do not assume post-deploy regression checks passed.' -ForegroundColor Yellow
}finally{
 Pop-Location
}
