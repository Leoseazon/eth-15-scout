# ETH-15 Scout V3 — Frozen 50–100-Trade Observation Protocol

**Change reference supplied by owner:** November 19, 2026, approximately **11:40 PM America/Chicago (CST)**. This is when revisions were being made, **not the date/time Cloudflare was deployed**.

**True technical cutover:** the first engine tick of release `V3-OBSERVATION-50-100-20261119`, written once into persistent Durable Object SQLite table `release_markers`. The actual first tick is the authoritative post-release comparison boundary. The original 11:40 PM timestamp remains a pre-deployment note. If the code is never deployed, there is no live cutover.

## Observation rules

- Maintain the same strategy decisions, risk levels, simulated starting account, fees and existing trade database. No strategy optimization or win-rate redefinition during the next 50–100 **completed simulated exits**, unless needed for safety or correctness.
- The post-release trade cohort is defined by the simulated position's **ENTRY** time >= first engine tick, not merely exit time. Positions entered before cutover remain pre-release, even if they exit afterward.
- Count **completed confirmed early-sale paper trades**, excluding PASS, WATCH, unfinished open positions, unverified settlements, cancelled/voided exchange markets and any historical before-release trades. Unresolved settlement is not assumed to win.
- Source of truth for simulated fills and fee/P&L is the existing Cloudflare Durable Object SQLite `trades`/`events`/`decisions` tables; source for exchange UP/DOWN outcome is Kalshi's public API `market.result` when `status=settled` and `is_provisional` is false.
- Preserve a separate record for every listed KXETH15M market close (including windows where V3 never bought). Never imply a close is a settled result.
- Preserve full history. Do not clear, compact away, reinitialize, or overwrite existing paper bankroll or SQLite tables.
- Compare post-release win rate, net *fee-adjusted* simulated P&L, average/median per-trade P&L, take-profit versus stop-loss frequency, unresolved stakes, strategy-side direction, win/loss streaks, quote age, stale-feed incidents, false/true PASS rates and official outcomes when research window ends.
- Record missing quotes, stale quotes, unavailable chart candles, Kalshi API throttling, and any bot/runtime faults separately. Never invent price data to hide gaps.

## Frozen operating envelope

- Existing V3 worker `eth-15-scout-cloud-v3test`, durable object name `single-paper-scout`, same paper account, no broker credentials or real orders.
- Same paper safety settings: nominal max $3 stake, soft daily loss -$12 with restricted $1.50 maximum, hard stop at -$20, standard profit-taking at 96¢, final-minute rule as approved. No risk increases in the observation build.
- Decision scheduler improved from 30-second to **15-second REST polling** with parallel 1m/5m/Kalshi input requests and original complete-candle guards. This improves typical polling opportunity, but does **not** guarantee tick-by-tick execution. Cloudflare, Kraken and Kalshi latency and cached REST responses remain limits.
- Password/login and 30-day device session stay unchanged. Website is read-only.
- Last confirmed pre-release screenshot in conversation showed **$98.18 available paper cash, +$0.65 realized, 4 completed exits, 1 pending settlement, and no open paper position**. This is a snapshot, not a frozen or guaranteed exact deployment balance. **Record actual cutover account state after deployment**, then verify no reset.

## Deployment verification (must be real, never assumed)

1. Run `cloud/deploy-v3-complete.ps1` from the separate V3 dashboard branch in PowerShell. Never deploy default `wrangler.v3test.toml` directly: tracked `SCOUT_PAPER_MODE=disabled` is fail-safe and would pause paper entries.
2. Confirm Cloudflare shows both V3 Workers deployed successfully; no V2 or market proxy script touched. Check `/health`.
3. Verify the site is signed in, monitoring **Online**, paper entries **Enabled**, account values continuous, old rows still in SQLite, 1m/3m/5m reference data visible when feeds are healthy, bids/asks and contract strike from Kalshi when available.
4. Verify one `release_markers` entry with actual first tick; verify displayed observation sample starts at zero or only counted trades whose entry was on/after cutover.
5. Verify official Kalshi results gradually appear for historical closed windows, show pending until settlement, and get preserved in JSON export; verify CSV/JSON working without truncating history.
6. Let live paper activity continue to 50–100 completed **new-cohort** paper exits, periodically checking health but avoiding strategy tweaks. If there is any safety or accounting issue, investigate first and tag all changes.

## UI priority

1. Live contract / UP and DOWN bid/ask quotes, current status, open paper position and countdown.
2. Available paper cash, settled/unsettled exposure, realized P/L, completed exits and observation-cohort counter.
3. System/market context, technical charts, signals, risk, historical journal and official window results.

**Audit status:** Code, tests and deployed site may be ready independently from live Cloudflare Worker activation. Never describe the entire upgrade as active until the owner's actual PowerShell deployment and live end-to-end verification succeed.
