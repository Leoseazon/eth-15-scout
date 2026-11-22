# ETH-15 Scout V4 — BUY and LIVE confidence regression audit
Status: STAGED on research branch. No Cloudflare release has been deployed from this audit.

## User requirement (locked)
For every V4 PAPER BUY, show a fixed 0–100% confidence reading at the moment of entry. While the exact contract is held, display a confidence value that can RISE or FALL based on contemporaneous market evidence. Display direction/delta from entry plus an up/down history trace. Preserve the entry score in the immutable forecast, trade record, journal event and position. V3 must remain unchanged.

## Important meaning distinction
The percent-formatted number is a **non-calibrated heuristic decision-confidence INDEX**. It is not an observed historical win percentage or a model-estimated probability that the contract will settle correctly. The 90-day outcome audit does not calibrate this model. Do not label 83% as an 83% chance of winning.

## Algorithm / sources
`cloud/v4/src/buy-confidence.js`: fixed reproducible heuristic (0–100) from signed combined evidence 30%, official target alignment 25%, independent indicator strength 20%, independent family agreement 10%, book spread quality 10%, index/quote freshness 5%, minus 8pts per contradiction capped at 24pts.
Official signed ETHUSD_RTI from existing read-only Kalshi REST feed, <=15s source age. Authenticated Kalshi book, <=5s receipt age, correct ticker, uncorrupted and uncrossed. Kraken closed 1m/3m/5m technical features and market close time required. If a source is missing/stale, live score is UNAVAILABLE—not zero or an invented neutral value.
During the last minute, the live confidence remains based on the latest official index and indicators, NOT the accumulator of the final sixty settlement samples. UI explicitly warns that the final accumulator is not incorporated.

## Engine changes
- `settlement-first.js` uses a single shared `calculateSettlementEvidence` for both eligible entry and held-position evaluations; this prevents duplicate, contradictory EMA/MACD/target algorithms. A refactor initially referenced an undefined `index`; tests caught and corrected this to `indexValue` BEFORE release.
- `settlement-first-paper.js` records the score at BUY into `pos.entryConfidence`, initializes `pos.liveConfidence`, and records bounded `confidenceHistory` and explanation. The value is not an extra entry threshold and does not change contract quantity or stop/96c exit logic. An invalid confidence result safely prevents an UNRECORDED / UNEXPLAINABLE paper BUY.
- `worker.js` retrieves a fresh official ETH index while a position is held, ONLY when the normal closed-candle and Kalshi book prerequisites are satisfied. It runs `scoreHeldConfidence` AFTER normal `settlementFirstPaperStep`; never changes paper cash, direction, entry, or exit based on the score. Invalid/stale data returns a clear unavailability reason. Keeps last 60 meaningful observations.
- `settlement-predictions.js` archives the original entry confidence in the unique immutable pre-entry forecast record; after an early sale, the original score and history remain in the trade record.
- The isolated read-only UI `v4/confidence-ui.js` responds to authenticated dashboard events, with entry score, live score, movement vs purchase, trend sparkline and stale/offline indicator. `v4/app.js` forwards only the existing viewer data; no new secrets, network endpoints, orders or database writes.
- `v4/index.html` embeds the widget in the main open paper position; `v4/style.css` includes mobile responsive styles.

## Audit and verified tests
- Unit: score bounded integer 0–100, transparent component calculation, invalid data rejected, stronger aligned evidence scores higher than contradictory evidence.
- Unit: the SAME UP position falls when official target / momentum / structure reverse and rises again when evidence recovers. Held DOWN evaluated against DOWN, never against fresh entry suggestion.
- Unit: stale index, stale book, missing Kraken feature, wrong book source/ticker and expired contract return UNAVAILABLE (not a misleading 0%).
- Unit: final-minute caveat present; win probability remains NULL / uncalibrated.
- Integration: every BUY stores entry confidence (paper position, unique settlement forecast, event, decision); post-trade paper record preserves score.
- Integration: confidence calculation is AFTER ordinary paper trade decision; no impact to $3 stake, PASS loop, 40% final-six-minute stop, 96c exit or final-minute hold.
- UI: DOM simulated refresh tests show 70→82 (up), 70→51 (down), actual 0 remains 0%, stale/monitoring-stop suppress CURRENT, meter ARIA and chart update.
- CI: full V4 cloud + private viewer test suite and Wrangler dry-runs must pass on EXACT final commit; inspect linked GitHub Actions run before deployment.

## Remaining testable only in Cloudflare after owner deployment
Verify new paper V4 Worker & viewer deployed from same reviewed SHA. In an eligible paper market, confirm purchase entry confidence, at least 2 successive live confidence updates (up/down when evidence moves), time stamps, stale/unavailable display during feed disruption, no unexpected stake/exit change, no V3 impact. Do not simulate actual Kalshi execution or claim accuracy edge from this score alone.

Repo: https://github.com/Leoseazon/eth-15-scout
Research PR: https://github.com/Leoseazon/eth-15-scout/pull/6
Default V4 disabled: cloud/wrangler.v4test.toml
Explicit experimental paper-only: cloud/wrangler.v4paper.toml
Never run an old pinned PowerShell SHA from earlier document versions; use the final audited handoff.
