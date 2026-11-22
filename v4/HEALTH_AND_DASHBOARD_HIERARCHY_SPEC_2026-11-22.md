# V4 trade-first dashboard and lightweight red health strip

Status: **V4 code staged; Cloudflare paper Worker deployment requires owner action**.

## Purpose and layout contract
Top of page must serve a human monitoring a 15-minute KXETH15M paper round.
Order, from most urgent to least:
1. Minimal private/paper-only notice (no real Kalshi orders).
2. Compact system health strip (RED for critical failures, yellow for degraded/temporary, green for no detected monitored problems, gray for intentionally paused/disabled).
3. Active actual Kalshi round: ticker, official displayed target, UP/YES and DOWN/NO ask/bid, bot's selected side, paper quantity, entry/stake, authenticated held-side WS bid, mark P&L, remaining time, confidence at BUY and changing confidence.
4. Kraken ETH price chart, 3m/5m indicator context and risk controls. Chart is a reference, NOT the CF settlement value.
5. Synthetic cash and performance; paper trade activity and official settled outcomes.
6. Lower-priority research/quote archives and verbose diagnostics.

## Red operational health: on existing dashboard poll only
- `v4/health-ui.js` is a standalone browser-side module, not a Durable Object job. It consumes `v4:dashboard-health` emitted during the existing authenticated `/api/v4/dashboard` call. There is NO new HTTP route, API poll, storage write, SDK or webhook.
- A local 15-second timer rechecks how old the previous engine tick is; hidden tabs skip the extra DOM work. Returning to the tab uses the next normal dashboard refresh.
- Immediate RED: latest reported processing error, stopped/stale engine heartbeat (>60s while monitoring expected), dashboard connection lost, or a corrupted WS orderbook needing resync.
- Short Kalshi book disconnect/ticker mismatch or required price-feed failure: YELLOW during first 30s, RED if continuing. This avoids a false alarm on normal 15m rollover; newly observed problems still surface at once.
- Warnings (YELLOW, not necessarily bot failure): confidence unavailability, official settlement verification delay, research journal/chart viewer unavailable, daily paper risk hard halt, unexpected disarmed simulation, newly failed official index verification.
- Green: required monitored conditions have no identified current issue. Green does NOT prove the strategy predicts correctly or that order fills are executable.
- Gray: signed-out/initial, paper disabled, intentionally stopped. Disabled optional archives and absence of unrequested full-book data are NOT errors.
- When a problem is found, show the most urgent concise description, any additional-issue count, and `Diagnose issue` expandable static explanatory code plus suggested source to inspect. Avoid secrets, raw stack traces, copied response bodies, or credentials.
- Clear old faults after good data; a recovered WebSocket or engine must not remain red. Connection fetch failure invalidates former green status until recovery.

## Data provenance and safe display
- Critical state originates in `cloud/v4/src/worker.js` status and authenticated viewer `cloud/v4/viewer-worker.js`: `lastTick`, `lastError`, `feedChecks`, `streamConnection`, official index check, dailyRisk, paperMode, journal scan errors.
- The held-side quote in the live position card reads only the exact position's authenticated Kalshi WS BID from `status.streamConnection.quote`; it is shown only if connected, same ticker, uncorrupted/resynced, and <=5s old.
- A stale, mismatched or disconnected WebSocket makes displayed bid say **Unavailable** instead of reusing an old price. The displayed best bid is NOT a guaranteed exchange fill; the site remains read-only.
- Static `v4/index.html`, `v4/style.css`, `v4/app.js` and new `v4/health-ui.js` are published through V4-only GitHub Pages. The Worker code is not changed by this dashboard feature.
- The heading/banner must never claim 'paper hard-disabled' when the experimental paper deployment is on; it reads status and says which mode is active.

## Test requirements
- Browser-state unit tests: green with fresh engine/book, immediate red for engine processing error/heartbeat stall, yellow-then-red if book or required feed remains down, recovery back to green, private viewer fetch error red, sign-out/disabled neutral, explanatory list capped and concise.
- Regression: no additional fetch/HTTP, no mutation or order endpoint, no raw error text as DOM HTML.
- Structural regression: all IDs unique, sections well nested, existing app references still present, top-to-bottom order matches hierarchy, mobile CSS 1-column fallback.
- Existing settlement-first code, bankroll, exit, forecast ledger, confidence module, V3 isolation and Cloudflare dry-runs must remain passing.

## Readable high-priority user interpretation
Red means a known current operational problem requires attention; do not treat a stale BUY indication as current. Yellow means degraded/temporarily reconnecting or a safety guard is engaged. Green means the monitored systems have not reported an issue; it is NOT a claim that the bot's prediction is correct. Gray means intentionally inactive.

## Links
- Source repository: https://github.com/Leoseazon/eth-15-scout
- Research draft PR: https://github.com/Leoseazon/eth-15-scout/pull/6
- Dashboard: https://leoseazon.github.io/eth-15-scout/v4/
- V4 paper config: `cloud/wrangler.v4paper.toml` (opt-in, paper simulation only).
- Default no-new-paper-entry config: `cloud/wrangler.v4test.toml`.

Do NOT run an old PowerShell pinned SHA from prior handoff versions; use the latest audited release revision after tests and source safety review.