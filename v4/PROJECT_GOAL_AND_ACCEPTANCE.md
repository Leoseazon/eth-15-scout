# ETH-15 Scout V4 — Controlling Project Slogan & Acceptance Standard

> **target-centered, context-aware paper-trading decision engine, win the official target-side prediction, maximize the trade’s attainable net profit, and control downside on every 15-minute round**

**Owner-provided exact slogan (2026-11-22).** Keep this goal visible in all handoffs and trading-rule design decisions until the project is complete. It is an optimization objective, not a guarantee of winning any round or maximizing unknowable future profits.

## Non-negotiable interpretation

1. **TARGET-CENTERED:** Actual official KXETH15M opening target and Kalshi's official CF Benchmarks final-minute settlement rule are primary. Kraken helps model directional context, not settlement truth.
2. **CONTEXT-AWARE:** Analyze current target gap, the time and uncertainty remaining, trend quality/acceleration, volatility, opposing evidence, quoted prices, depth, spreads, fees and bankroll together. Correlated EMA/RSI/MACD indications never earn independent votes or become a substitute for coherent risk/reward reasoning.
3. **DECISION ENGINE:** Each observation produces an explained BUY / WATCH / HOLD / PAPER SELL recommendation, with exact live-source evidence and modeled uncertainty. A low ASK is not automatically a bargain; a high ASK is not automatically safe or profitable.
4. **WIN THE OFFICIAL TARGET-SIDE PREDICTION:** Measure whether the bot chose the side the official exchange ultimately settled, independently of when it closed a simulated position.
5. **MAXIMIZE ATTAINABLE NET PROFIT:** Seek positive risk-adjusted expected opportunity *given available information*, not perfect hindsight. Compare plausible settlement chances against ASK, entry fees, early-exit BID, sale fees and exposure. Do not intentionally wait to buy higher-priced contracts; buy at the first qualified opportunity.
6. **CONTROL DOWNSIDE:** Retain paper-only simulation, fee-inclusive per-position and daily-risk limits, honest fill accounting, source-freshness gating, one BUY per market, and the user's 87c absolute BUY ceiling. No deployed autonomous real-money orders.

## Acceptance tests for any new rule

- Does it improve target-side prediction quality and make favorable as-of evidence decisive rather than merely count checkmarks?
- Does it distinguish true opportunity from cheap but unlikely bets, or expensive safe-looking but low-upside bets after fees?
- Does it react early to a worthy market move and continue WATCHing the same contract on PASS?
- Does it measure settlement correctness, synthetic trade P&L, drawdown, frequency, price bands, and time-to-entry separately, against baseline, on forward/holdout as-of data?
- Does it preserve existing position safeguards and V3 isolation? Does CI pass with the exact SHA? Does it remain **not deployed** until deployment separately verified and authorized?

**Release status as of this document:** Strategy research code and paper simulation only. A composite heuristic is not a calibrated probability of winning, and perfect real-time net-profit optimization is not physically possible with uncertain future prices.
