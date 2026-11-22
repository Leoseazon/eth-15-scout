# ETH-15 Scout V4 — frozen prospective shadow entry research (2026-11-22)

**STATUS: research only, staged, NOT deployed. NO new paper or real orders.**
**Controlling baseline:** deployed Kraken reliability commit 6ea7e3e6170acdac5420b7d1419eabd52f350608.
**Spec version:** V4-SHADOW-PREREG-20261122-v1.

Project mission: target-centered, context-aware paper-trading decision engine,
win the official target-side prediction, maximize the trade's attainable net profit,
and control downside on every 15-minute round.

## Why these two candidates, without historical optimization
The Nov 22 15:40 CST historical research archive contains 1,490 strict-value
rejected evaluations. The central scenario cleared its normal edge hurdle in
506 tick-level side evaluations over 43 rounds, but the first per-round
unrestricted counterfactual was 20 correct / 42 resolved and -$1.84
simplified all-in hold-to-settlement paper P&L. The old 13/16 positive subset
was selected after seeing outcomes, so it is NOT a validated edge.
These fixed parameters are hypotheses to test on **new unseen** market rounds.

## Both shadow proposals share unaltered guards
- The original V4 BUY/SELL/PASS engine is unchanged and remains the CONTROL.
- Official KXETH15M ticker, target and fresh ETHUSD_RTI; authentic, valid,
  fresh SAME-TICKER Kalshi WS book; closed Kraken 1m/3m/5m; no as-of leaks.
- Starting-minute entry guard, strict last-90s cutoff, ask<=87 cents,
  actual spread/depth/size checks from baseline, <=$3 all-in, <$0.20 ask
  max $0.50 stake, one per ticker and only NORMAL daily risk mode.
- Both sides from the SAME tick. Only conservative-value rejections that
  passed baseline's prior execution and market validations may be studied.
- An immutable source witness is required. Stored REST depth observations
  are NOT authenticated book quotes and may NOT authorize opportunities.
- Every result has executionAuthorized:false, no Worker import, no writes,
  no cash changes, and NO trading API access.

## Candidate A: A_STRESS_RELAXED
- Positive central scenario edge must clear baseline requiredEdge PLUS 0.02.
- Lower scenario edge no worse than -0.075.
- ASK >=0.005 and <=0.87, spread <=0.05, time remaining >90s <=840s.

## Candidate B: B_EXECUTION_FILTERED
- Central scenario edge must clear baseline requiredEdge PLUS 0.04.
- Lower scenario edge no worse than -0.10.
- ASK >=0.20 and <=0.87, spread <=0.02, time remaining >150s <=840s.
- This avoids ultra-cheap longshot reversal entries; NOT the retrospectively
  optimized 50-cent minimum.

## Outcome and research protocol
1. Freeze code version/hash and all features prior to any new outcome labels.
2. At most FIRST valid proposed entry per policy/ticker. Preserve the baseline
   same-ticker decision and watch reasons alongside it.
3. Attach official finalized result later; evaluate official direction
   correctness separately from P&L under a fixed pre-specified exit policy.
4. Report per-ticker paired Brier and log-loss, calibration bins, after-fee
   expected settlement value, P&L under stated hypothetical ask/bid/latency
   assumptions, stop/take-profit modeling, worst drawdown, and missing feeds.
5. No quote assumed an executable fill. Include fee schedule/version.
   Never use a quote or candle received after decision time.
6. Review 100 new resolved eligible rounds as an INITIAL DIAGNOSTIC only.
   Prefer several hundred resolved rounds across volatility/time regimes
   for independent inference; no guaranteed sample size confers true edge.
7. If failures, missing source verification, overstated profitability or
   evidence of strategy overfitting occur, keep baseline unchanged.
   Trading rules can change only after owner-reviewed CI/runtime results
   and a documented rollback, never through shadow code itself.

## Historical schema verification only (not OOS or performance)
- 2026-11-22 15:40 CT archive:
  A: 102 repeating tick-level signals, 18 distinct rounds.
  B: 119 repeating tick-level signals, 23 distinct rounds.
- Source verification correctly interprets stored closedAt as CANDLE OPEN
  timestamp, verifies exact latest finished 1m/3m/5m windows.
- Ten unit tests pass locally; full cloud tests and runtime integration
  remain outstanding.

## Primary literature and operator documentation
- C. Manski, Economics Letters (2006): https://www.nber.org/papers/w10359
- Wolfers & Zitzewitz, FRBSF/NBER (2006):
  https://www.frbsf.org/research-and-insights/publications/working-papers/interpreting-prediction-market-prices-as-probabilities/
- Gneiting et al., JRSS B (2007):
  https://academic.oup.com/jrsssb/article/69/2/243/7109375
- Harvey, Liu & Zhu, Review of Financial Studies (2016):
  https://academic.oup.com/rfs/article-abstract/29/1/5/1843824
- Bailey et al., probability of backtest overfitting:
  https://escholarship.org/uc/item/4w1110bb
- ETH/Bitcoin periodicity in volatility and liquidity, J Financial Econometrics:
  https://academic.oup.com/jfec/article-abstract/22/1/224/6759403
- Kalshi 15-minute crypto settlement:
  https://help.kalshi.com/en/articles/13823838-crypto-markets

## Archive and storage parallel work (unexecuted)
Full Kalshi WS archive >550k observations; decision audit excludes it.
Before retention/deletion, design a read-only bounded benchmark, then a
cursor-anchored chunked export with SHA256 manifest, resumability and <=100
rows/request with backoff and throttling. Avoid 5500+ unthrottled requests to
the live Durable Object. This proposal does NOT trigger an archive download.
Cloudflare SQL Durable Object per-object limit 10GB:
https://developers.cloudflare.com/durable-objects/platform/limits/
