# ETH-15 Scout V4 — Candidate C / two-hour prospective paper-only protocol

**STATE: CANDIDATE, NOT DEPLOYED, NOT AUTHORIZED TO PLACE PAPER OR REAL ORDERS.**
**Source parent:** `v4-shadow-observer-integration-20261122` at
`037812de414fc2193b304ca11889e32e437e331d`, already verified as a
paper-only shadow runtime. **Never deploy to an actual trading account.**

## Why Candidate C exists
The original V4 paper strategy rejected many quotes due to strict downside
risk-adjusted value. Two earlier research alternatives, Shadows A and B,
generated more first signals but only 1 correct direction in 3 finalized
contracts in the first cohort. A/B were useful hypotheses, not winning
strategies. Candidate C is a distinct, **predeclared** further experiment:
more permissive than the original V4 downside scenario, but tighter
than A/B on execution price, trend agreement, confirmation and exposure.
The purpose is better *selection quality*, not simply higher trade count.

## Frozen research rule C_MODERATE_CONFIRM
- The baseline paper engine must **WATCH** with an independently documented
  `CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT` rejection for the proposed side.
  No C signal from a baseline PAPER_BUY, active held position, unverified feed,
  missing Kalshi book or other non-value rejection.
- All original SAME-TICK verified sources remain necessary: official
  `ETHUSD_RTI` verified within 15s, authenticated Kalshi WS book newer
  than 5s and same ticker, closed Kraken 1m/3m/5m structure, normal risk
  mode, no previous baseline buy that round, and one contract market target.
  REST book archives are **not fill-quality evidence**.
- The latest **CLOSED 3-minute** structure must have unambiguous trend UP or
  DOWN and agree with the proposed side at each observation. A 3m neutral,
  opposing trend, or an unavailable/old candle means no C observation.
- Candidate C demands the central uncalibrated settlement scenario clear
  the fee-adjusted break-even by the baseline required edge **plus 4.0
  percentage points**. It permits a pessimistic-scenario shortfall of at
  most **4.5 percentage points** below break-even. Original V4 instead
  requires the pessimistic scenario itself to clear a positive margin.
- Contract ASK permitted 20–87c by rule, spread max 3c, but the **0.50 USD
  including entry fees** cap is *binding* with integer contracts. Thus
  any ASK so high that a full contract plus fees exceeds 50c yields no
  C observation. Do not create fictional fractional fills.
- One 15-minute market open buffer and final entry cutoff are preserved:
  more than 150s and at most 840s until closing for C observation.
- **Two consecutive normal engine research ticks**, separated by 10–35s,
  both individually passing all rules with the **same ticker, side, and
  CLOSED 3m candle identifier**. One failed/missing intermediary tick,
  direction flip, expired quote, clock violation, new market, or gap
  invalidates confirmation. The SECOND tick's quote and fee-inclusive
  quantity are the counterfactual entry reference.
- **One first confirmed signal per market** for C, forever. Record later
  observations only as research. Do not cherry-pick a later winning side.
- C does not alter main paper BUY/SELL, 96c profit exit, emergency stop,
  one-entry-per-market cap, $3 baseline risk allowance, paper account or
  immutable official settlement records. No new APIs/WS or tables. It
  only appends a small structured subrecord under the existing
  `researchTicks[].decision.shadowProbe.prospectiveShadow.candidateC`.
- All states are `readOnly:true`, `executionAuthorized:false`,
  `calibratedProbability:null`, `actualFillVerified:false` and
  `outcomeAvailableAtEvaluation:false`. An isolated C error is
  downgraded to a research reason and **cannot veto Shadows A/B or baseline**.

## Two-hour forward-test protocol (after a separately verified deployment)
1. Preserve exact candidate release commit and Cloudflare Worker version ID.
   Do not change parameters or code during observation. Verify continuous
   engine ticks and unchanged original V4 paper decisions.
2. Start the 120-minute cohort at the **first full 15-minute window after
   deployment** where all 3 policies are simultaneously recording.
   This spans approximately **eight** distinct windows. Allow extra time
   for official result finalization; pending windows are unresolved, not
   automatically losses or wins.
3. Continue receiving validated journal/research/quote/stream observation
   inputs. Intermittent Kraken/Kalshi rate limits are recorded as
   exclusions, never overwritten or treated as phantom fills. No forced
   BUYs just to create a sample.
4. Export dashboard **Research → Decision audit JSON**, plus
   **Feed Investigation → Download observed feed diagnostics JSON**
   if the dashboard was kept open; the latter has a 180-tick/roughly-45-minute
   browser-only ring buffer and therefore **cannot by itself cover 2h**.
   A persistent 2-hour research cohort comes from the server's research
   ticks in the Decision Audit JSON.
5. Run `node cloud/v4/tools/report-candidate-c-comparison.mjs <saved-file.json>`
   against the saved paper-only audit. The report explicitly chooses
   A/B/C first signals under the **same post-C activation cutoff**,
   deduplicates by market and policy before outcome joining, and reports
   only official finalized exchange results. It does not read or change
   Cloudflare production data.
6. Summarize per policy: tick opportunities, unique first signals,
   # finalized, directional wins/losses, all-in hypothetical entry,
   fee-inclusive hypothetical hold-to-final profit/loss, loss-size,
   the realized original V4 paper results (different from shadow),
   source readiness and missed research ticks. Report no-fills/possible
   slippage separately; the displayed ASK cannot prove executable fills.
7. **No auto-promotion.** 2h is a release functionality/correctness smoke
   test, not adequate statistical evidence of trading edge or enough to
   loosen the original paper BUY rule. A and B historical trades before
   C activation are excluded from fair prospective comparisons.
   Any attempted C order placement, unauthorized bankroll change or
   baseline decision divergence is a critical regression and a reason
   to revert the *research-only* patch to the known shadow baseline.

## 50-cent cap implications
An ASK of 55c or 60c cannot fit even one integer Kalshi contract in a
50-cent all-in paper experiment. C deliberately passes it. The original
bot can still consider it with its existing independent $3 cap if
its original conservative value requirements are met. Candidate C is
not a replacement for the original bot or for Shadows A/B.

## Limitations
- Original V4 model central/lower scenario estimates are not calibrated win
  probabilities. Passing any edge inequality is not proof of positive EV.
- A shadow ASK is a displayed order-book quote, not a verified exchange fill.
- Even the hypothetical hold-to-settlement result is distinct from the
  original bot's early-sale/stop-management path.
- Entry signals can change side later in a round. C uses the earliest
  qualifying two-tick confirmation, without retroactively replacing a
  losing direction after official results are known.
- Historical evaluation outcomes are never accessible to C at signal time.

## Release gate
Do not deploy until full GitHub test suite, Cloudflare Wrangler dry-run,
exact SHA and diff scope, risk-state regression and no-paper-BUY proof pass.
To activate the two-hour cohort, the user must perform an approved
paper-only Cloudflare Worker deployment and report the resulting
Cloudflare Version ID. The assistant cannot silently deploy the private
Cloudflare account's Worker.
