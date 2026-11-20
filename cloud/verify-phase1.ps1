# Phase 1 local syntax and native Node regression verification — NO DEPLOYMENT.
# Does not change Cloudflare settings, secrets, historical trades or bankroll.
$ErrorActionPreference='Stop'
$expected='phase1-exit-feed-reliability-20261120'
Push-Location $PSScriptRoot
try {
  $actual=(git branch --show-current).Trim()
  if ($actual -ne $expected) {
    throw "Expected isolated branch $expected; current branch is '$actual'. Nothing deployed."
  }
  Write-Host 'PHASE 1: Checking source syntax (paper only)...' -ForegroundColor Cyan
  npm.cmd run check
  if ($LASTEXITCODE -ne 0) { throw 'Phase 1 syntax check FAILED. No deployment attempted.' }
  Write-Host 'PHASE 1: Running complete native Node regression suite...' -ForegroundColor Cyan
  npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Phase 1 Node tests FAILED. No deployment attempted.' }
  Write-Host 'PHASE 1 LOCAL TESTS PASSED. NOTHING DEPLOYED.' -ForegroundColor Green
  Write-Host 'NEXT: review output and require explicit approval before any paper-only release.' -ForegroundColor Cyan
} finally {
  Pop-Location
}
