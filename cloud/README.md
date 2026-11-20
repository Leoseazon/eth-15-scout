# ETH-15 Scout — isolated Cloudflare PAPER bot

## Deployment separation
The existing production Worker `eth-15-scout-cloud-v2` is a running, PAPER-ONLY V2 service. This **V3 checklist branch is NOT deployed**. The public market-data Worker `eth-15-scout-api` and the GitHub Pages browser trader are separate and must not be changed by this strategy update.

A unique Durable Object named `single-paper-scout` maintains simulated account state, and a once-per-minute Cron bootstraps ~30-second best-effort DO alarms. Both Cloudflare Workers and their local clone need to be validated independently before any release.

## Nov 18–19 checklist: changes in this branch
- Default PAPER stake budget: **up to $3 including simulated entry fees**, subject to the available simulated cash and 3% of current paper equity. NO real Kalshi orders or credentials.
- Entry times: **1.5 to 12.5 minutes** remaining, only if the market, Kraken 1m/5m data and quotes are fresh enough for the engine to evaluate.
- Ban **80¢ or more with at least 3 minutes remaining**. With under 3 minutes remaining, any new entry must pass all 7 fast indicators, 5m trend alignment, target plausibility, and spread no greater than 3¢; entry bids at 96¢ or above are blocked.
- When a held contract's **executable bid reaches 96¢**, simulate an early sale if there is sufficient quote depth. **Inside the final 60 seconds**, holding it until official settlement is allowed; such a position becomes PENDING and no outcome is inferred from Kraken.
- A preliminary **PASS/WATCH** keeps checking *the same market* while it is open. One final PASS is written only after its window expires without an entry. WATCH changes are journaled without duplicating unchanged snapshots every 30 seconds.
- Retain one position/entry per market, 4% daily realized-loss stop, 40% price stop, conservative quote/depth checks, and an unarmed default. The new SQL `runtime_status` table permits read-only production verification of `armed` and `monitoring` in Cloudflare Data Studio without enabling public Worker URLs.
- Regression tests cover timing, budget, premium gating, 96¢ exits, last-minute hold, final PASS, and daily loss cap.

**No edge has been established.** The prior 24 paper exits (15 wins, 9 losses, +$0.85 including approximated fees) are a small, correlated research sample, not evidence of calibrated probabilities or realistic fills.

## Intentionally deferred checklist items
1. Review and privately migrate the 24 historical trades and PASS; deduplicate by ticker and preserve source/verification labels. Do not upload personal trade history to this public repository.
2. Independently validate official Kalshi settlement/CF Benchmarks reference, and reconcile pending contracts before any automated outcome accounting. Kraken ETH spot is only a directional proxy.
3. Improve bid/ask freshness, spread, queue depth, fill/slippage, and fee schedules. Existing fills remain **simulated displayed-price fills**.
4. Compare V2 vs V3 on the same market snapshots and run out-of-sample replay; do not treat 7/7 indicator confirmations as calibrated odds.
5. Later study support/resistance in entry logic, conditional size scaling, market reversal, scalping, and statistically disciplined learning; none are authorized by this patch.

## Security and operations
- `workers_dev = false`; do **not** enable public Worker routes or preview URLs for simple status checks.
- `.dev.vars` is ignored by Git and only for local testing. Production uses an encrypted `SCOUT_ADMIN_TOKEN` secret. Never share either value.
- The V3 branch must pass `npm run check`, `npm test` and `npx wrangler deploy --dry-run` before a separate supervised deployment decision. **Do not run a production deployment from this branch until reviewed and scheduled.**
- In production Data Studio, read-only query:
  `SELECT armed, monitoring, observed_at, last_market, last_error FROM runtime_status WHERE id=1;`
- The historical journal is not automatically imported; `pending` positions cannot be assumed settled. If 4 pending positions accumulate, new entries are blocked.
- Calls to `/v1/arm` are capable of enabling PAPER simulated entries, and must not be used without supervised acceptance testing. No actual trades are implemented.
