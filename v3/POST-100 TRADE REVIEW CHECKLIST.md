# ETH-15 Scout V3 — Running Post-100-Trade Review Checklist

**Created:** November 20, 2026 (America/Chicago).  
**Status:** Observation notes only. DO NOT change, deploy, reset, or re-arm the bot from this checklist.  
**Strategy review boundary:** V3-TIME40-6M-20261120, first live revised engine tick shown on the dashboard as approximately **November 20, 2026, 2:11 AM CT**. The original V3 release (November 20, 12:15 AM CT) remains separate.

## Purpose and milestone

Review proposed improvements **after the first 100 qualifying completed PAPER trades entered on or after the revised strategy's real first tick**, with the existing 50–100-trade observation milestone as an earlier review point. The dashboard currently treats completed *early-sale* trades as the principal observation cohort; **also count and report held-to-official-settlement positions separately**, without silently combining the two denominators. Historical/pre-update trades remain in all-time statistics but not in revised-strategy statistics. Do not substitute exit time for entry time.

**Bot philosophy:** Anticipate a high-quality directional move before Kalshi fully prices the contract; look for an attractive entry with sufficient evidence, adapt decisions to time remaining, avoid duplicate correlated votes and minimize avoidable realized losses without assuming every reversal will recover. Optimize **net realized paper P/L and risk-adjusted expectancy**, not win rate or raw number of trades.

## Open strategy changes — NOT IMPLEMENTED / NOT APPROVED FOR ACTIVATION

- [ ] **Late-window entry experiment (highest-priority open idea).** Investigate a separate time-to-expiry entry policy for around 1m30s–3m remaining. An 80c+ contract with a strong, fresh **1-minute** trend should not automatically require all slower 3m/5m indicators to agree; **neutral 3m is not automatically a rejection**. Consider 3m/5m as context instead of universal vetoes, while keeping strike distance, volatility, spread, executable depth, signal freshness and expected fee-adjusted payoff central. Evaluate the strict existing 7/7 rule versus a more targeted subset; do **not** authorize buys based on the 1m chart alone. Do not enter during unverified final-60-second CF Benchmarks RTI averaging without a separate, researched safeguard.
- [ ] **Stop-loss alternatives: 40% vs 50% vs 60% with <6m left.** Keep the existing 40% trigger unchanged during observation. Review bid-by-bid available snapshots and finalized market results to estimate whether wider stops would have avoided premature exits **and** how much larger losing trades could have become. A trigger at 40% does not limit realized loss if the observed bid gaps through it.
- [ ] **Stop timing / dynamic thresholds.** Compare the existing fixed 40% stop armed strictly under six minutes with time-dependent or volatility/strike-distance-based thresholds in a *shadow/backtest* study, not live-paper strategy modifications. Include discretionary two-candle structural exits separately.
- [ ] **Late 80c+ contract economics.** Estimate break-even win probability including fees, spread, and any executable-size limitation at 1m30s, 2m, 3m, and 5m. Determine if favorable-looking late UP/DOWN quotes actually provide enough upside. Do not confuse implied contract price with a calibrated forecast probability.
- [ ] **Support/resistance false-rejection review.** Revisit the confirmed five-minute swing-zone veto and its two completed 3-minute-close breakout requirement. Evaluate whether it rejects profitable early entries, while recognizing that nearby barriers often prevent false breakouts. Track neutral 3m cases separately.
- [ ] **Early-setup scoring calibration.** Test 1m EMA8/21, RSI9, MACD6/13/5, 3m structure, five-minute trend and strike distance in distinct feature groups; verify whether grouping correlated signals is useful across real observations. Existing independent-family heuristic is implemented; **further reweighting or removing vetoes is not**.
- [ ] **Holding vs early cash-out at 96c.** Compare actual realized early exits with hypothetical holds to final official settlement, net of fees, and separately identify the existing final-minute hold exception. Counterfactual holds require genuine subsequent quotes/results; no made-up fills.
- [ ] **Market data and simulation reliability.** Check bid/ask spreads, size/depth, quote age (15-second polls are not fills), simulated slippage, stale Kraken bars, and whether the final CF RTI minute is correctly treated as an unobserved official index average.

## Observations logged so far (do not infer general profitability)

| Date/time CT | Observation | Review question |
| --- | --- | --- |
| Nov 20, 2:06:15 buy; 2:11:15 sale | **Pre-update** standard REVERSAL: bought nine UP paper contracts at 28c, estimated all-in $2.65; early-sold at 99c with **+$6.25 realized paper P/L**. | Strong illustration of cheap early repricing, but not an EARLY-REVERSAL post-update result; must not count toward revised cohort. |
| Nov 20, 2:22:30 buy; 2:24:15 sale | **Post-update** bought five UP at 50c, sold at 21c, realized **-$1.60**; 40%-loss stop was armed with 5m45s remaining; observed decline had already reached 58%. | Contract later confirmed **UP** on Kalshi at 2:30 AM; examine whether hypothetical 50%/60% stop would have survived every intervening bid and all costs. Do not assume it would have. |
| Nov 20, approx. 2:32–2:43 | Repeated WATCH/PASS on the 2:45 AM contract: UP blocked by nearby five-minute support/resistance and sometimes insufficient price-direction-plus-momentum evidence; 3m chart was reported neutral. At 1m05s and 50s remaining, displayed UP asks were 81c and 87c, but the bot's entry minimum was 1m30s. | Study whether a more suitable late-window decision rule could recognize a worthwhile opportunity **earlier** (before final minute) without overpaying or ignoring the RTI settlement rule. We have not established that a trade would have won. |

## At each review, record data and compare by cohort

- [ ] Capture strategyVersion, **entry** and exit timestamps (America/Chicago and UTC), time left at each, side, ask, actual simulated bid/size, quoted spread, assumed entry/exit fees, qty, cost, net P/L, exit reason, and official result if available.
- [ ] Distinguish standard REVERSAL, guarded EARLY-REVERSAL, MOMENTUM; separate early cash-outs from finalized held settlements.
- [ ] Compute **wins, losses, flats, net P/L, total stakes, profit factor, maximum drawdown, average win/loss, average return per dollar at risk, and fee-adjusted expectancy** for each cohort.
- [ ] Split results by **entry price:** under 35c, 35–49c, 50–69c, 70–79c, 80–89c, 90c+.
- [ ] Split by **minutes remaining at purchase:** 12.5–10, 10–7, 7–5, 5–3, 3–1.5. Record time left at stop/sale.
- [ ] Track **maximum adverse/favorable excursions** only if actual historical quote snapshots exist; mark data gaps explicitly.
- [ ] Review WATCH/PASS decisions for **missed opportunities**, including 3m NEUTRAL, 5m resistance, late 7/7, and an otherwise sound price/strike setup; do not relabel missed trades as certain winners.
- [ ] Examine the **40%, 50%, 60% counterfactual stops** using recorded executable-bid paths and official outcomes, including cases that went to zero.
- [ ] Compare live-paper behavior with a **frozen shadow policy** if sufficient quote snapshots are available; never use hindsight to tune and then report the same sample as an unbiased test.
- [ ] Verify bankroll reconciliation, pending stakes settled exactly once, realized win/loss counters independent of eventual outcomes for early sales, and both release timestamps intact.
- [ ] Summarize what improved, what regressed, failure cases, uncertainty, and potential decision changes; decide whether a new isolated observation cohort is warranted for any adopted rule.

## Review gate / change control

1. **Before 100 qualifying post-revision early-sale trades:** Capture observations and defects. Do not change trading weights, stop or late-entry rules just because of a few memorable recoveries.
2. **At 50 qualifying trades:** Preliminary health and accounting review, not a definitive optimization.
3. **At 100 qualifying trades:** Full review above, including a clearly separate held-to-settlement count and a realistic assessment of small-sample uncertainty.
4. **If an accounting/security defect appears:** Fix it separately with tests, a dated version marker, preserved bankroll/history, and no silent changes to the active strategy.
5. **If changes are adopted after review:** Explicit approval, paper-only deployment, regression audit, and a NEW first-engine-tick observation marker.

## Trade-frequency and pass-rate standing audit — added November 20, 2026

**First check:** November 21, 2026, at about 3 AM CT, one day after this rule was set. This is an observation/review, **not** authorization to loosen any live paper-entry protections or deploy new code.

- [ ] Count the number of actual paper **BUY entries**, completed early SALES, official held-to-settlement closures and still-open positions **entered after November 20, 2:11 AM CT**. Distinguish entries from exits, and from historical all-time counts.
- [ ] Calculate the entry frequency **per hour**, time since the last paper entry, and the **longest no-entry gap** while the bot was actually monitoring; do not include offline or stale-data windows as normal passes.
- [ ] Group PASS/WATCH decisions by **hour, contract and unique 15-minute window**. Do not mistake repeated 15-second WATCH samples for independent trading opportunities.
- [ ] Quantify rejection reasons (5m support/resistance, missing price-direction/RSI/MACD family, 3m/5m trend veto, early-exception time/price range, 7/7 late-entry requirements, wide spread/low depth, strike reachability, stale data and daily risk).
- [ ] Flag **60+ minutes of online monitoring with zero entries** for prompt investigation, not an automatic strategy defect. Compare against real market conditions, the number of windows with plausible opportunities, and simulated fee-adjusted P/L. Extended inactivity may be correct in a poor market.
- [ ] Review whether the bot missed unusually attractive contracts or was excessively strict, using contemporaneous quote history where available. Do not infer hypothetical guaranteed winners from final contract results.
- [ ] Report cumulative and post-update realized P/L, win/loss by *trade*, stake awaiting verified settlement, and expected net return versus possible full binary loss. More trades alone does not imply a better strategy.
- [ ] If data are unavailable behind the signed-in V3 viewer, explicitly request the **Export full journal JSON** or **Export trades CSV** and current performance screenshot, and avoid inventing trade counts.
- [ ] Keep the live PAPER strategy frozen pending observation; propose changes for the post-100 trade checklist unless a verified safety/accounting defect requires correction.

## Running notes

- **Nov 20, 2026:** Recorded proposed late-window 1m-dominant, strike/time/quote-aware alternative and deferred 40/50/60 stop study. **NO live bot changes were made from this checklist.**
