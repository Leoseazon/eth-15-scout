# Deploy ONLY a separate read-only V3 website viewer.
# Does NOT redeploy V3 trading engine or touch its account/history.
# Run in cloud folder on branch v3-dashboard-gateway-20261119.
param([switch]$SkipLoginSetup)
$ErrorActionPreference='Stop'
if(-not (Test-Path '.\wrangler.viewer.toml')){
  throw 'Run this from the eth-15-scout\cloud directory on the V3 viewer branch.'
}
Write-Host 'Check read-only viewer build...' -ForegroundColor Cyan
npx.cmd wrangler deploy --config wrangler.viewer.toml --dry-run
if($LASTEXITCODE -ne 0){ throw 'Build failed. Nothing deployed.' }
Write-Host 'Deploy separate read-only viewer Worker...' -ForegroundColor Cyan
npx.cmd wrangler deploy --config wrangler.viewer.toml
if($LASTEXITCODE -ne 0){ throw 'Viewer deployment failed.' }

if(-not $SkipLoginSetup){
  Write-Host 'Choose one permanent username/password. Do NOT share them in chat.' -ForegroundColor Cyan
  $name=Read-Host 'V3 dashboard username (3+ characters)'
  if($name.Length -lt 3 -or $name.Length -gt 128){throw 'Username length must be 3–128 characters.'}
  $name | npx.cmd wrangler secret put SCOUT_LOGIN_USER --config wrangler.viewer.toml
  if($LASTEXITCODE -ne 0){throw 'Username secret setup failed.'}

  $secure=Read-Host 'V3 dashboard password (at least 16 characters; input hidden)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{
    $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if($password.Length -lt 16 -or $password.Length -gt 256){
      throw 'Password length must be 16–256 characters.'
    }
    $password | npx.cmd wrangler secret put SCOUT_LOGIN_PASSWORD --config wrangler.viewer.toml
    if($LASTEXITCODE -ne 0){throw 'Password secret setup failed.'}
  }finally{
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $password=$null
  }
  $bytes=New-Object byte[] 32
  $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
  $signingSecret=[BitConverter]::ToString($bytes).Replace('-','')
  try{
    $signingSecret | npx.cmd wrangler secret put SCOUT_SESSION_SECRET --config wrangler.viewer.toml
    if($LASTEXITCODE -ne 0){throw 'Session secret setup failed.'}
  }finally{
    $signingSecret=$null
    [Array]::Clear($bytes,0,$bytes.Length)
  }
  Write-Host 'Login credentials securely configured in Cloudflare.' -ForegroundColor Green
  Write-Host 'Password does not rotate at page refresh. Remembered sessions expire after 30 days.' -ForegroundColor Green
}else{
  Write-Host 'Login secret setup skipped: existing Cloudflare secrets must be configured.' -ForegroundColor Yellow
}
Write-Host 'Viewer health: https://eth-15-scout-v3-view.leoseazon.workers.dev/health'
Write-Host 'V3 website: https://leoseazon.github.io/eth-15-scout/v3/'
Write-Host 'The running V3 paper bot and its SQLite journal were not changed by this deployment.' -ForegroundColor Green
