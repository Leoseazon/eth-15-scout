# ETH-15 Scout V4 — owner-approved PAPER contract-price rule matrix (2026-11-22)

**Current controlling price instruction:** 87c is the absolute maximum Kalshi ASK for any NEW V4 synthetic BUY. 85c is the normal high-price threshold; **85.01–87c is NOT standard entry** and requires an explicit exceptional-quality gate. **Above 87c ALWAYS WATCH/PASS**. The 96c price is a **BID-based SELL target for existing positions**, never a BUY threshold.

The active V4 experimental paper path is `settlement-first.js` -> `settlement-first-paper.js`. Older V3 baseline files (`v3-policy.js`, `v2.js`, and specialty early/late/honey/micro policies) are intentionally preserved and are not the price authority when V4 settlement-first PAPER is enabled. No V3 changes.

## Exactly how the active V4 paper model handles prices

| Selected-side ASK | Entry evidence threshold | Extra gate | Maximum fee-inclusive stake |
| --- | --- | --- | --- |
| Greater than 0 through <20c | Absolute combined heuristic score >=0.43 and 2 independent supporting families | All common source, spread, time, depth/risk checks | 50c |
| 20c to <65c | Score >=0.43; at least 2 families | All common checks | $3 |
| 65c to <85c | Score >=0.62; at least 2 families | All common checks | $3 |
| Exactly 85c | Score >=0.78; at least 2 families | <=5 minutes remaining (and >90 seconds), all common checks | $3 |
| Above 85c through exactly 87c | Score >=0.78 and **all 3 independent families** | <=5 minutes and >90 seconds, no contradictions, <=3c spread, target/geometry direction >=0.30, momentum direction >=0.25, higher-timeframe structure direction >=0.25; all common source/depth/risk checks | $3 |
| Above 87c through 99c+ | Irrelevant | HARD NO-BUY, no exception | $0 |

All ranges are determined from the actual ASK of the selected YES/UP or NO/DOWN contract, NOT BID or on-screen confidence. Scores are fixed uncalibrated contextual heuristics, **not probability of settlement success**. The exception permits strong 85.01–87c evidence, not a forced trade.

## Common V4 rules (apply below AND at limits)
- A NEW simulated BUY requires **more than 90 seconds and no more than 12.5 minutes** remaining; existing premium tiers further restrict timing.
- The authentic contract ticker, actual official opening target and close time must be present.
- Fresh signed ETHUSD_RTI (<=15s old), valid closed Kraken 1m/derived 3m/closed 5m features, a fresh correct-ticker authenticated Kalshi WebSocket book (<=5s), uncrossed bids/asks, displayed depth and suitable spread are mandatory. Default maximum displayed spread is 5c; exceptional premium maximum is 3c. Fixed-point comparison prevents floating-point rounding from disqualifying an exactly 3c spread.
- Only one entry per actual market, with no adding after sale. Simulated BUY at ASK and size only if displayed two-sided depth covers the paper order. No actual exchange order or guaranteed fill.
- Fee-inclusive stake <=$3 (under 20c: <=50c), reduced to <=$1.50 in daily SOFT loss mode (with stronger separate 3-family conditions). Daily hard risk halt blocks new buys.
- PASS/WATCH continues scanning the SAME eligible 15m contract. No stale or unavailable input may force a BUY.
- Existing positions may sell when authenticated held-side Kalshi **BID reaches 96c**, provided more than 60 seconds remain and displayed bid depth suffices. During final <=60s, 96c does not automatically trigger an exit. A 40% adverse bid move in last 6m is a distinct protective stop and can take precedence. Official settlement result remains a separate truth label.
- The dashboard's moving confidence is **display-only**. It cannot override limits, buys, exits, or stakes.

## Audit controls
- `MAX_PAPER_ENTRY_ASK=0.87` and `NORMAL_PREMIUM_ASK=0.85` exist in the same V4 decision module.
- `exceptionalPremiumEligible` is shared by candidate evaluation and a distinct fail-closed paper debit check; both enforce the absolute limit.
- Entry tests cover 85c, 85.01c, 86c, 87c, 87.01c and higher; no-buy situations include remaining >5 minutes, wide spread and contradictory 3m/5m evidence. A separate regression preserves 96c paper SELL.
- Existing V4 code error `remainingMinutes` previously undefined in candidate function was fixed before new tests.
- Decision-processing exceptions now generate a sanitized V4 code in existing status/error diagnostics; no raw error logs or credentials are pushed to the UI.
- CI success for **the exact final commit** and Cloudflare live paper smoke test remain distinct and mandatory. This document does not prove a prediction edge, full execution realism, or that the updated code is live deployed.
