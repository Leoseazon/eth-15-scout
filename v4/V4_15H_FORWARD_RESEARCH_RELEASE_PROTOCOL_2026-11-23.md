# ETH-15 Scout V4 — 15-hour comparative research release

**Status: UNDEPLOYED until GitHub CI and owner Cloudflare verification.**
Release source is a dedicated branch based on deployed Candidate C source.
No Kalshi real orders. **DO NOT** modify live paper entry/exit behavior until
independent forward evidence supports it. User has approved research deployment.

## Research questions frozen before forward observation
1. Why do the MAIN technical composite and fee-adjusted value model favor
   opposite directions? Is disagreement predictive of directional losses?
2. Can a cheap AGAINST-TARGET contract be distinguished from an early
   **genuine recovery**, using observable official ETHUSD_RTI index movement,
   closed Kraken 1m/3m structure and non-deteriorating Kalshi execution price?
3. Does original A/B/C or A2/B2/C2 first-confirmed research outperform
   others in fee-inclusive hypotheticals WITHOUT cherry-picking later wins?
4. Would an earlier SELL on verified two-tick adverse target + 3m/1m
   reversal preserve more fee-inclusive simulated P&L than current
   baseline 96c / final 6m 40%-decline logic? Keep each candidate's
   exact original entry price, time, side and quantity.
5. Are fresh source gaps, high prices and model uncertainty causing most
   missed opportunities? Report not merely reasons, but **market price,
   target gap, central and lower scenario margin, time left and
   per-contract chronology** wherever evidence is contemporaneously valid.

## Deployed V4 main paper execution: unchanged
- Main paper BUY selection/price caps/fees/daily risk/window restrictions
  and 96c or final-six-minute-40% SELL are **not modified** by this patch.
- Main coherence evaluation is NOW CONNECTED AFTER the ordinary V4 paper
  decision. It produces a structured, non-executing main model alignment
  record in the same existing research tick, including fee-aware UP/DOWN
  central/lower sides, technical score, 3m/5m context and held-exit
  technical warnings. No additional external market requests.
- Original A/B/C **remain byte-for-byte identical**, serve as controls.
  A2/B2/C2 are new, distinct non-executing first-signal policies.
- All shadow entry observation, entry confirmation and exit replay remain
  `readOnly:true`, `executionAuthorized:false`,
  `actualFillVerified:false`, with uncalibrated scenario estimates.
- Raw WebSocket archiving remains DISABLED; no full book frames.
  Each engine tick may retain a SMALL sampled top BID per side with quote
  receipt provenance, sufficient displayed depth and verified index
  source time. This cannot prove an actual fill or continuous price path.
- No developer promises that shadow hypothetical profit can be captured.

## Frozen A2/B2/C2 hypotheses (not backtest-optimized)
- A2 uses A's original potential opportunities, requires central margin
  +3 pp beyond baseline, stressed-edge >= -4.5 pp, spread <=3c, ASK
  >=15c, >3m left. B2 uses original B potential opportunities, requires
  +4 pp central beyond baseline, stressed >= -5 pp, spread <=2c,
  ASK >=20c, >3.5m left. C2 accepts conservative baseline WATCH
  candidates, central +2.5pp, stressed >= -6pp, spread <=3c,
  ASK >=15c, >2.5m left. The core downside constraints and assumptions
  were determined before this new 15h data is observed.
- In addition, for **against-current-official-target** entries require
  1m directional three-bar move and no opposing closed 3m trend.
  Need TWO uninterrupted, individually valid observations 10–35sec apart
  on SAME ticker, SAME side, official target gap improving by at least
  max($0.25, 0.2 × 1m sigma). Missing feed breaks confirmation.
  No three-minute candle consensus veto for C2 when neutral.
- Original Candidate C's 50-cent whole-contract stake ceiling DID
  artificially eliminate many price points. C2 separates two metrics:
  *quality* at baseline-capped quote quantities up to $3, and
  **50c affordability** of at least one integer contract with entry fee.
  An otherwise high-quality quote above the limit is counted for
  directional quality, but its C2 monetary trade/exit is **UNSCORABLE**,
  not fictionalized with fractional contracts.
- A2 and B2 are counterfactual alternatives and DO NOT make paper buys.
  None of the policies receives the official result at entry time.

## Exit counterfactual research — MAIN, A/B/C and A2/B2/C2
Run two independent hypothetical paths from each frozen 1st entry:
- BASELINE_EXIT: 96c authenticated displayed BID with >60s left, or
  40% contract-price decline if <=360s left. Otherwise hold to official
  exchange settlement. Bid depth >= whole proposed quantity.
- ADAPTIVE_EXIT: preserves all baseline exits. Additionally, >60s left,
  after TWO consecutive complete research snapshots (10–35s apart)
  with fresh authenticated BID, fresh official target on both,
  closed 3m trend OPPOSED to held side, 1m directional move OPPOSED,
  falling contract BID >=1.5c and adverse target-gap movement of at
  least max($0.25,0.2 × 1m sigma):
  (a) secure PROFIT if BID >=78c and net proceeds after estimated
  sell fee > all-in entry cost; or
  (b) EARLY_RISK_CUT if contract BID has fallen >=25% from entry.
- Both policies use the INITIAL frozen first-signal side, no retrospective
  signal selection. If an early exit is unavailable due to stale or too
  shallow book, NEVER claim the trade was executed. If no observed exit,
  compare hold-to-official hypothetical. No 15s sampling guarantees
  an order could have filled, or that a brief price spike was captured.
- The main V4 paper held-position coherence module also reports whether
  a verified two-tick reversal *would have* helped, but it does NOT
  change the main V4 96c or emergency stop in this release. A trade
  system should not take a new SELL action based only on RSI overbought,
  price falling or model score disagreement.

## Fifteen-hour test: exact data collection
1. Owner deploys APPROVED paper-only source commit to
   `eth-15-scout-cloud-v4test` with `wrangler.v4paper.toml`.
   Record release commit SHA and Cloudflare version ID in audit.
2. Cohort starts at the first FULL Kalshi 15-minute contract after the
   release's first verified research tick; include exactly 60 successive
   15-minute markets = 15h, even if any have ZERO strategy signals.
   No rule changes, restarts or threshold edits during this cohort.
3. At least 15h+final result confirmation after cohort start, export
   **Research → Decision Audit JSON** from dashboard. Contains server
   research ticks and full official outcome journal, not raw book archive.
   Browser-only Feed Diagnostics is limited to last ~180 observed ticks;
   useful for the last 45m, NOT the full 15h.
4. Offline comparison joins official results only after frozen entry
   and exit selection. Distinct completed MARKETS, not every 15s tick,
   are independent market-outcome units. Different strategy guesses on
   the SAME 15m contract are paired, not independent.
5. Report per 60 windows: actual main paper BUYs, exits and realized
   net, finalized vs unresolved windows, correct direction, first
   signals A/B/C/A2/B2/C2, hypothetical original-vs-adaptive exit net,
   mean/median asked price, per-minute entry timing, 0-20, 20-35,
   35-60, 60-75, 75-87c ASK bands, gaps relative to Kalshi official
   opening target, and 1m/3m directional agreement or disagreement.
6. Report technical/data operation: completed engine ticks vs ~3,600
   expected at 15s cadence, processing p50/p95, missing or stale
   Kalshi/official index/Kraken episodes; errors, delayed/journal writes,
   number of valid book sample marks and snapshots skipped due to depth.
   Include an explicit issue section explaining abnormal patterns.
7. For each policy reason, give **top bottlenecks** AND count actionable
   near-misses (quotes within one failed value requirement), with
   contemporaneous outcome-neutral evidence. Avoid treating all
   no-candidate outcomes as regressions. No filled-size claims.
8. At most one policy adjustment may be proposed **after** a 15h
   analysis, initially in a new frozen prospective paper-only research
   cohort. 60 highly correlated windows may still be far too small
   to certify profitability or calibrate the model.

## Release gates
- No changes to `settlement-first.js`, `settlement-first-paper.js`,
  `context-opportunity.js`, `v3-policy.js`, live bankroll or limits.
- Full repository tests, integration tests and Cloudflare Wrangler
  **paper-mode DRY RUN** must be green.
- Audit bound on captured research payload and overhead; no extra market
  network requests or raw full-book recording.
- Actual Cloudflare deployment must be done by authorized owner via
  a pinned-SHA, paper-only gated command. A GitHub PR is NOT a Worker
  release. Cloudflare version ID required to mark release active.
- Two independent sell paths are **research**; main SELL changes
  require separate evidence and explicit approval before execution.

**If the resulting journal/export is missing a consecutive sample sequence,
we must report uncertainty, not force a hypothetical BUY/SELL.**
