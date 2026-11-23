#Requires -Version 5.1
# Download complete independent 15h controls journal AFTER observation.
# Never sends credentials to the main Worker or saves admin token as plaintext.
[CmdletBinding()]
param([string]$OutputDirectory=(Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ETH15-V4-Evidence'))
$ErrorActionPreference='Stop'
$cloud=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tokenFile=Join-Path $env:LOCALAPPDATA 'ETH15-Scout/controls-admin-token.dpapi'
if(-not (Test-Path -LiteralPath $tokenFile)){
 throw 'Separate CONTROLS token is missing. Use the owner deployment script first.'
}
$secure=Get-Content -LiteralPath $tokenFile -Raw|ConvertTo-SecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if($token.Length -lt 64){throw 'Invalid controls-only DPAPI token'}
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$output=Join-Path $OutputDirectory ('ETH-15-V4-Controls-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
$env:V4_CONTROLS_ADMIN_TOKEN=$token
$env:V4_CONTROLS_API_URL='https://eth-15-scout-v4-controls.leoseazon.workers.dev'
Push-Location $cloud
try{
 & node.exe v4/tools/export-v4-controls.mjs $output
 if($LASTEXITCODE -ne 0){throw 'Control journal export failed; do not infer completeness'}
 Write-Host 'Verified separate controls journal:' -ForegroundColor Green
 Write-Host $output
 Write-Host 'Also export main V4 complete evidence from the existing dashboard.' -ForegroundColor Yellow
}finally{
 $env:V4_CONTROLS_ADMIN_TOKEN=$null
 Remove-Variable token -ErrorAction SilentlyContinue
 Pop-Location
}
