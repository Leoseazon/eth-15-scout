# V4 Deployment Status — staging verification and observation (2026-11-22, CST)

## Evidence and limits
- User screenshot `IMG_4160.png`: refresh **17:07:26 CT**; system monitoring Online, paper enabled, contextual model verified; red **Kraken 5m candles rate-limited or cooling down** warning, with 5m validation and chart-reference problems.
- User screenshot `IMG_4162.png`: refresh **17:08:18 CT**; red warning persisted; latest engine tick roughly 7s ago; paper simulation enabled. An engine heartbeat does **not** imply valid 5m entry data.
- Original evidence and hashes: [post-Kraken incident](../research/POST_KRAKEN_DEPLOY_OBSERVATION_2026-11-22.md).
- Existing uploaded `ETH-15-Scout-V4-Decision-Audit-2026-11-22.json` was exported **2026-11-22T21:40:08.779Z (15:40:08 CST)**. It contains 6,551 research ticks and **precedes** the 17:07–17:08 incident; it CANNOT establish post-upgrade three-round success or failure.
- No authenticated post-17:08 decision audit was available in this run. Do not claim three complete 15-minute rounds were verified or that the Kraken improvement resolved the issue.

## What was staged (dashboard only)
- `v4/index.html`: collapsed **Deployment Status** details directly under health bar.
- `v4/deployment-status.css`: compact responsive styling.
- `v4/deployment-status-ui.js`: consumes the existing `v4:dashboard-health` event, zero additional network requests, no writes or paper controls.
- Displays separate engine and viewer Cloudflare release IDs and deployment timestamps ONLY when authenticated `deploymentMetadata` explicitly marks verified Cloudflare API origin. **Existing viewer does not supply that metadata**: the truthful display is **Unavailable — not verified from Cloudflare**. Do not hardcode previously observed IDs or treat first contextual engine tick as latest deployment.
- Shows latest tick as successful ONLY if the latest engine status reports `lastFeedOkay===true`, no `lastError`, monitoring enabled and a fresh tick. This is NOT a guarantee that all official index/book sources were ready.
- Shows 1m and 5m feed check `ok` and `checkedAt`, error and cooldown when reported, and makes stale checks **Unknown** rather than green. The current engine status only exposes its latest tick; it cannot recover a previous successful tick after a failure.
- Security boundary: existing authenticated viewer payload, no Cloudflare secrets or API tokens exposed to browser. To show authoritative deployment IDs later, use a narrowly scoped authenticated server-side Cloudflare metadata source, not a public browser API token. Until then unavailable is correct.

## Verification performed
- Ran **7 isolated JS harness assertions** against the actual staged `deployment-status-ui.js` source using fake DOM/event dispatch: event registration; fail-closed deployment fields; 5m unhealthy; no false successful tick; activation marker not deployment; recovered healthy feed; reset clears old data.
- **No live Cloudflare or GitHub Pages deployment**; no Worker/DO/trading-engine source edits; no paper ledger/storage writes.
- Full website integration and real authenticated browser verification remain pending.
- Owner must approve publication. GitHub Pages may be published by merging an approved dashboard-only diff to the configured site branch; no Cloudflare deployment needed for the panel itself, but actual Cloudflare release metadata requires a separately approved authenticated backend enhancement.

## Immediate next observation
1. Obtain a new **Decision audit JSON exported after 17:40 CT** and confirm records cover three complete post-upgrade 15-minute contracts.
2. Quantify kraken1m and kraken5m cooldown/validation failures per eligible tick and distinct round; distinguish chart-only failure from paper-entry blocking; compare with earlier audit under consistent denominators.
3. Confirm fresh official index and Kalshi authenticated book independently of engine heartbeat before judging trading opportunity quality.
4. Keep trading rules, paper bankroll and journal untouched.
