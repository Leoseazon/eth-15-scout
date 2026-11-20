# ETH-15 Scout V3 — Indicator and CF Benchmarks Settlement Audit
Date: November 20, 2026. Applies to pending PAPER-only revision, not confirmation of a live deployment.

## Authoritative settlement rule
Kalshi KXETH15M compares the average CF Benchmarks Ethereum RTI value during the last 60 seconds of the window with the specified starting price/reference. Neither the last Kraken trade nor a final one-minute candle is the official final value. One second's movement contributes only a fraction of that final average. Only Kalshi's finalized nonprovisional result is an accepted authoritative settlement outcome.

The bot does NOT currently receive the 60 authoritative RTI observations. Its settlement phase is therefore labeled RTI_60_SECOND_AVERAGING_UNVERIFIED during the last minute. It does not predict a locked result, infer settlement from Kraken, or make any new entries within 1.5 minutes of the end.

## Source-to-purpose audit
| Input/indicator | Actual implementation | Correct use and limitation |
| --- | --- | --- |
| Kalshi market floor_strike | Market's published floor_strike | Official contract comparison reference. Do not replace with rounded Kraken price |
| Kalshi YES/NO ask and bid | Public REST, quote age and size check | Entry/exit liquidity; REST can be cached and does not guarantee fills |
| Kraken ETH reference | Kraken ticker and completed OHLC candles | Directional spot proxy only, not official RTI |
| 1m EMA 8/21 | EMA on completed 1m prices | Entry-timing alignment, not probability and not official settlement |
| 1m RSI 9 | Wilder-style rolling RSI, price momentum | Fast momentum only. Corrected: perfectly flat gains/losses => 50, not 100 |
| 1m fast MACD 6/13/5 | MACD fast response via two EMAs and signal EMA | NONSTANDARD fast MACD. May amplify noise; used only within 7-check entry confirmation |
| 3m structure | UTC-aligned triplets of consecutive completed 1m bars | Confirmed direction/exit; partial 3m bars prohibited |
| 3m RSI 14 and EMA 8/21 | On completed three-minute candles | Slower structure context, never last-tick settlement |
| 3m Bollinger (20, 2) | 20 completed 3m closes (~60m) | Secondary stretch/caution only, not a standalone buy/sell |
| 3m A/D pressure | Kraken OHLC volume-weighted close location | Kraken-only local-volume proxy, not consolidated ETH order flow |
| 5m EMA 21/50 | On completed five-minute candles (~105/250m) | Higher-timeframe directional filter; can lag a 15-minute reversal |
| 5m MACD 12/26/9 and RSI 14 | Completed five-minute closes | 5m trend/context; slow for a short binary contract |
| 5m rolling volume-weighted price | Typical price × Kraken volume over up to 96 complete 5m candles (~8 hours) | NOT session VWAP; website relabeled accurately |
| 5m clustered support/resistance | Swing pivots with two neighboring candles on each side, zones need ≥2 pivots | Veto nearby barriers; require 2 completed 3m closes beyond shallow breakouts |
| Daily BTC/ETH regime | Completed hourly Kraken ETH and BTC prices, volumes | 24h contextual regime, not a Fed/event calendar or official Kalshi signal |
| Time remaining | Kalshi contract close_time vs clock, seconds recorded with paper trade | 80c+ new buys allowed only at <=5m; fixed 40% loss stop only <6m; no new entries <1.5m |
| Final 60 seconds | Clock phase, no official RTI samples available | Never infer final index, never guarantee settlement; existing 96c final-minute hold exception and risk checks remain |
| Official outcomes | Kalshi market.result when market.status=finalized and not provisional | Only source for held-to-expiry paper settlement, separate from realized early-sale win/loss |

## Behavioral limits / things not yet validated
- A 5m or 3m trend near the Kalshi strike does not imply a 60-second RTI average will finish on that side.
- There is no verified statistical edge for a six-minute 40% stop, five-minute 80c entry rule or any 7/7 score without out-of-sample paper results.
- 15-second REST polling is not tick-by-tick, and Kalshi bids, depth and theoretical paper fills are not guaranteed executable.
- For high-priced contracts, maximum binary payout upside shrinks; fees, slippage, false breakouts and full-settlement loss remain material.
- No official real-time RTI feed is connected. Only use a validated, timestamped official-compatible feed before attempting an in-progress average calculation.
- Do not mix the original 12:15 AM CT V3 cohort with the revised time-gated stop cohort. Each requires its actual first engine tick.
- Full production verification still needs local Node tests, Wrangler dry-runs, authenticated viewer checks, SQL bankroll reconciliation and release-marker checks.

## Sources
- Kalshi Help Center: https://help.kalshi.com/en/articles/13823838-crypto-markets
- Kalshi public ETH contract rules: https://kalshi-public-docs.s3.amazonaws.com/contract_terms/ETH.pdf
- CF Benchmarks methodology context: https://www.cfbenchmarks.com/blog/who-signs-the-price-the-cme-cf-real-time-indices-through-cfb-oracle
- Kalshi 15-minute UI: https://kalshi.com/pro/help/fifteen-minute-markets
