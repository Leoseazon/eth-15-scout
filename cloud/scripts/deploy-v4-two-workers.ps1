#Requires -Version 5.1
<#
Owner-authorized, fail-closed PHYSICAL two-Worker deployment.
- Research Worker2 first, entirely separate name / Durable Object / admin token.
- Verify its own fresh Kalshi/Kraken/official index sources before deploying MAIN.
- MAIN Worker1 uses same existing DO + bankroll and Opportunistic profile.
- Requires owner-provided Kalshi READ-ONLY key ID and PEM FILE; we cannot
  retrieve secrets from the existing main Cloudflare Worker.
- NO live Kalshi trade API, no real orders, no shadow paper BUYs.
Usage from the pinned cloned repo:
  powershell -NoProfile -ExecutionPolicy Bypass -File cloud/scripts/deploy-v4-two-workers.ps1 -ExpectedCommit <verified SHA>
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ExpectedCommit)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$cloud=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot=(Resolve-Path (Join-Path $cloud '..')).Path
$expected=$ExpectedCommit.ToLowerInvariant()
if($expected -notmatch '^[a-f0-9]{40}$'){throw 'Invalid pinned release commit SHA'}
$actual=((& git -C $repoRoot rev-parse HEAD) -join '').Trim().ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $actual -ne $expected){
 throw 'Local clone is not the vetted release commit. No deployments.'
}
if(@(git -C $repoRoot status --porcelain).Count -ne 0){
 throw 'Local working tree is not clean. No deployments.'
}
$mainCfg=Get-Content (Join-Path $cloud 'wrangler.v4paper.toml') -Raw
$ctrlCfg=Get-Content (Join-Path $cloud 'wrangler.v4controls.toml') -Raw
$stopped=Get-Content (Join-Path $cloud 'wrangler.v4test.toml') -Raw
foreach($flag in @(
 'name = "eth-15-scout-cloud-v4test"',
 'main = "v4/src/main-only-worker.js"',
 'SCOUT_V4_PAPER_MODE = "enabled"',
 'V4_SETTLEMENT_FIRST_EXPERIMENT = "true"',
 'V4_MAIN_PROFILE = "OPPORTUNISTIC"'
)){
 if(-not $mainCfg.Contains($flag)){throw "Main paper safety gate missing: $flag"}
}
foreach($flag in @(
 'name = "eth-15-scout-v4-controls"',
 'main = "v4/src/controls-only-worker.js"',
 'SCOUT_V4_PAPER_MODE = "disabled"',
 'V4_SETTLEMENT_FIRST_EXPERIMENT = "false"',
 'V4_PHYSICAL_ISOLATION_ROLE = "CONTROLS_ONLY"',
 'V4_RESEARCH_CONTROLS_ENABLED = "true"',
 'name = "SCOUT_CONTROLS"',
 'class_name = "ScoutControlResearchV4"'
)){
 if(-not $ctrlCfg.Contains($flag)){throw "Controls isolation gate missing: $flag"}
}
if($ctrlCfg.Contains('script_name = ') -or
 $mainCfg.Contains('SCOUT_CONTROLS') -or
 -not $stopped.Contains('main = "v4/src/main-only-worker.js"')){
 throw 'Unexpected shared Worker/DO configuration. No deployments.'
}
$mainCode=Get-Content (Join-Path $cloud 'v4/src/main-only-worker.js') -Raw
$ctrlCode=Get-Content (Join-Path $cloud 'v4/src/controls-only-worker.js') -Raw
foreach($bad in @('observeProspectiveShadow','conservative-control',
 'SCOUT_CONTROLS','controlState','shadow-research-observer')){
 if($mainCode.Contains($bad)){throw "Controls leaked into MAIN source: $bad"}
}
if(-not $ctrlCode.Contains('this.paperExperimentAllowed=false;') -or
 $ctrlCode.Contains('report=settlementFirstPaperStep(s,') -or
 -not $ctrlCode.Contains('prospectiveShadow=observeProspectiveShadow({')){
 throw 'Controls Worker can trade MAIN or lacks a control observer. No deployment.'
}
Write-Host 'Verified isolated source, separate DO identities and Opportunistic main profile.' -ForegroundColor Green
Push-Location $cloud
try{
 Write-Host 'Running full repository tests and TWO Cloudflare dry runs...' -ForegroundColor Cyan
 & npm.cmd ci
 if($LASTEXITCODE -ne 0){throw 'npm ci failed'}
 & npm.cmd run check
 if($LASTEXITCODE -ne 0){throw 'Source verification failed'}
 & npm.cmd test
 if($LASTEXITCODE -ne 0){throw 'One or more isolation tests failed'}
 & npx.cmd --no-install wrangler deploy --config wrangler.v4controls.toml --dry-run
 if($LASTEXITCODE -ne 0){throw 'Controls Worker dry run failed'}
 & npx.cmd --no-install wrangler deploy --config wrangler.v4paper.toml --dry-run
 if($LASTEXITCODE -ne 0){throw 'MAIN Worker dry run failed'}
 Write-Host 'We must provision a SEPARATE read-only credential in Worker2.' -ForegroundColor Yellow
 Write-Host 'Do not paste the key or PEM in ChatGPT. Use a LOCAL file already on your computer.' -ForegroundColor Yellow
 $keyId=(Read-Host 'Paste the Kalshi READ-ONLY API key ID').Trim()
 $pemPath=(Read-Host 'Full path of existing READ-ONLY private key PEM file').Trim('"')
 if($keyId.Length -lt 12 -or $keyId.Length -gt 200){throw 'Read key ID invalid'}
 if(-not (Test-Path -LiteralPath $pemPath -PathType Leaf)){
  throw 'Private key file not found. MAIN deployment not attempted.'
 }
 $pem=Get-Content -LiteralPath $pemPath -Raw
 if($pem -notmatch '-----BEGIN (RSA |EC )?PRIVATE KEY-----' -or
  $pem -notmatch '-----END (RSA |EC )?PRIVATE KEY-----'){
  throw 'Read-only PEM structure invalid. MAIN deployment not attempted.'
 }
 $privateStore=Join-Path $env:LOCALAPPDATA 'ETH15-Scout'
 New-Item -ItemType Directory -Path $privateStore -Force|Out-Null
 $protectedToken=Join-Path $privateStore 'controls-admin-token.dpapi'
 if(Test-Path $protectedToken){
  $secure=Get-Content $protectedToken -Raw|ConvertTo-SecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
 }else{
  $bytes=New-Object byte[] 48
  $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
  $token=[BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
  (ConvertTo-SecureString $token -AsPlainText -Force|
   ConvertFrom-SecureString)|Set-Content $protectedToken
 }
 if($token.Length -lt 64){throw 'Research secret too short'}
 Write-Host 'STEP 1/2: Deploying ONLY the new research Worker and separate DO.' -ForegroundColor Cyan
 & npx.cmd --no-install wrangler deploy --config wrangler.v4controls.toml
 if($LASTEXITCODE -ne 0){throw 'Separate research Worker deployment failed; MAIN unchanged'}
 # Never write any secrets to logs, command lines, or GitHub.
 $token | & npx.cmd --no-install wrangler secret put SCOUT_ADMIN_TOKEN --config wrangler.v4controls.toml
 if($LASTEXITCODE -ne 0){throw 'Research admin-token provisioning failed; MAIN unchanged'}
 $keyId | & npx.cmd --no-install wrangler secret put KALSHI_V4_READ_KEY_ID --config wrangler.v4controls.toml
 if($LASTEXITCODE -ne 0){throw 'Research read-key ID provisioning failed; MAIN unchanged'}
 $pem | & npx.cmd --no-install wrangler secret put KALSHI_V4_READ_PRIVATE_KEY --config wrangler.v4controls.toml
 if($LASTEXITCODE -ne 0){throw 'Research private-key provisioning failed; MAIN unchanged'}
 $pem=$null
 # This is the expected account subdomain from the existing V4 viewer.
 # Strict HTTPS, do not send research token to a user-supplied arbitrary URL.
 $base='https://eth-15-scout-v4-controls.leoseazon.workers.dev'
 $headers=@{Authorization='Bearer '+$token}
 try{
  $health=Invoke-RestMethod -Uri ($base+'/health') -Method GET -TimeoutSec 15
  if($health.role -ne 'CONTROLS_ONLY' -or $health.mainTradingDisabledByCode -ne $true){
   throw 'Wrong physical research target'
  }
  $ignore=Invoke-RestMethod -Uri ($base+'/bootstrap') -Headers $headers -Method GET -TimeoutSec 20
 }catch{throw "Separate research API verification failed: $($_.Exception.Message). MAIN unchanged."}
 Write-Host 'Waiting for controls-only Worker to demonstrate healthy fresh market evidence...' -ForegroundColor Cyan
 $ready=$false
 for($i=0;$i -lt 12;$i++){
  try{
   $status=Invoke-RestMethod -Uri ($base+'/v1/status') -Headers $headers -Method GET -TimeoutSec 15
   if($status.researchWorkerRole -eq 'CONTROLS_ONLY' -and
      $status.researchControlsAllowed -eq $true -and
      $status.mainTradingDisabledByCode -eq $true -and
      $status.armed -eq $false -and
      $status.settlementPaperAllowed -eq $false -and
      $status.streamConnection.connected -eq $true -and
      $status.paperFeedHealth.kalshiWsBookFresh -eq $true -and
      $status.paperFeedHealth.officialIndexLastState -eq 'HTTP_200_VALID_ETH_INDEX' -and
      [long]$status.lastResearchTickAt -gt 1000000000000){
      $ready=$true;break
   }
  }catch{}
  Start-Sleep -Seconds 10
 }
 if(-not $ready){
  throw 'RESEARCH Worker is isolated but its fresh authenticated WS/index data is not yet verified. MAIN deployment blocked. Review Worker2 secrets and feeds.'
 }
 Write-Host 'Worker2 verified: independent account, fresh WebSocket, official index, no MAIN trading.' -ForegroundColor Green
 Write-Host 'STEP 2/2: Deploying MAIN-only Opportunistic V4 to EXISTING Worker/DO.' -ForegroundColor Cyan
 & npx.cmd --no-install wrangler deploy --config wrangler.v4paper.toml
 if($LASTEXITCODE -ne 0){throw 'MAIN deployment failed; inspect Cloudflare output'}
 Write-Host 'SUCCESS: TWO PHYSICALLY SEPARATE V4 ENGINES DEPLOYED' -ForegroundColor Green
 Write-Host "Source SHA: $expected" -ForegroundColor Green
 Write-Host 'MAIN account preserved under existing ScoutEngineV4.' -ForegroundColor Green
 Write-Host 'CONTROL account created under new ScoutControlResearchV4.' -ForegroundColor Green
 Write-Host 'Keep both Cloudflare Version IDs from the output for the 15-hour audit.' -ForegroundColor Yellow
}
finally{
 Remove-Variable token,keyId,pem -ErrorAction SilentlyContinue
 Pop-Location
}
