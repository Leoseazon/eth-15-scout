# KXETH15M — Settlement-first research specification (V4 only)

Status: research design; NOT a live deployment, not a request to activate paper trading, not a claim of a profitable edge.

## Core answer the strategy must produce
At each eligible decision point during a real KXETH15M contract:
1. Which side of that exact market's official opening target will the final 60-second ETHUSD_RTI average settle on?
2. What contemporaneous evidence supports UP, DOWN, or PASS? What contradicts it?
3. How much time remains and how far is the observed official index from the actual target relative to the current volatility?
4. Is the selected direction worth buying at the executable Kalshi ask + fees and realistic available size?
5. If already holding, should the paper policy sell at a validated bid, stop, or hold toward settlement?
Primary metric is directionCorrect on directional predictions; trade outcomes and P&L are separately scored.

## Rule truth and provenance
- Unit of study: actual KXETH15M market ticker, not arbitrary Kraken candles or 15-minute bars.
- Kalshi crypto help: compare the CF Benchmarks one-minute pre-close average with one-minute pre-open average.
- An actual sample KXETH15M market rule says YES when the closing average is AT LEAST the opening average: exact tie -> YES.
- Read and preserve each actual market's `rules_primary`, `rules_secondary`, target (`floor_strike`), state, times, result and any amendments. A generic CRYPTO document must never override the specific market wording.
- Truth label: official finalized Kalshi `result` (`yes`/`no`). Store `expiration_value` if reported; no Kraken inference.
- Distinguish `closed`, `determined`, `amended`, `disputed`, `finalized`; provisional result is not settled truth.
- Historical CF data may have later revisions. Store historical-versus-as-of availability and never leak revised information into simulated earlier decisions.
- Keep all timestamps as UTC epoch and derive local reporting time only for UI; never parse tickers for close timestamps.

## The special final-minute window — critical
- Official `cfbenchmarks_value` WS has `avg_60s_data`: rolling last 60s, NOT automatically the settlement average.
- The distinct `last_60s_windowed_average_15min` only appears in the last minute before each quarter hour.
- Per Kalshi's current API docs, this accumulator uses `(close-60s, close]`, with close tick included.
- `window_size` climbs from 1 to 60; a partial last-minute average is not a final outcome.
- For each update preserve `window_size`, time bounds, source/receive times and missing tick status.
- Late predictions should use partial settlement arithmetic and the remaining-tick uncertainty, NOT only last spot price.
- Never count an early partial average or trailing 60s average as the official final settlement value.

## Ranked independent feature families
1. **Target geometry**: signed index-target displacement; percent distance; normalized distance / expected remaining volatility; prior target-cross count, recross risk, target-confirmation lag.
2. **Settlement clock and trajectory**: elapsed/remaining seconds, index motion toward/away from target, partial close-minute average and samples remaining, likely feasible path to opposite side.
3. **Independent market structure**: 1m/3m/5m CLOSED Kraken candle price action, EMAs, momentum, support/resistance, RSI/MACD/volume/VWAP. Correlated indicators are not separate 'votes'; test incremental contribution.
4. **Cross-market information**: BTC/ETH momentum, ETH-vs-BTC disagreement, regime volatility and correlation, broader stress only when time-aligned and genuinely available.
5. **Market microstructure/price**: Kalshi YES/NO executable ask and bid, size, spread, quote age, market price relative to calibrated settlement probability. Quotes inform trade value; prices are NOT official truth labels.

## Research question hierarchy
First research whether a contemporaneous side prediction is RIGHT at settlement.
Second research WHERE and WHEN it is most consistently right with useful coverage.
Third research whether it can be bought early/affordably (e.g. under 60c when justified),
and whether realistic fee-inclusive sale / settlement can make money.
Never optimize hit rate solely by allowing 96-99c purchases at the last seconds;
that can make direction accuracy look excellent without producing an economic edge.
Compare always-UP/DOWN, current-side-of-target, momentum-only and market-implied
price baselines on the SAME decision times and same valid market sample.

## Per-market time-grid and gates
- Collect actual market/target, official final result and all time-indexed sources within permitted access.
- Analyze at reproducible checkpoint times (e.g. after opening target is published, 3m, 6m, 9m, 12m, 13m, 14m, and final-minute ticks) plus every true candidate entry.
- Distinguish initial opening period, middle, late and final 60s; no one-size-fits-all thresholds.
- At each point calculate UP/DOWN/PASS with reasons, contrary evidence and a reliability grade.
- PASS means remain eligible to re-evaluate the SAME market, not automatically wait for next round.
- Treat missing target, sequence gaps, future/late data, stale quotes, or final outcome as unknown/invalid rather than assume.
- Keep stop loss, bid-based exit and final-minute holding policy separately auditable; no trading rules are authorized by this spec.

## Data access and evidence gates
- Official historical market `result`, `floor_strike`, `expiration_value` and rules via Kalshi live/historical market endpoints.
- Kalshi cutoff endpoint determines which older markets/trades/candles moved to historical tier; paginate by series/ticker.
- Historical YES bid/ask OHLC available at 1m intervals, but 1m candles cannot reconstruct exact-second executable fills or intrabar stops.
- Historical CF `ETHUSD_RTI` ticks may be queried via `GET /trade-api/v2/cfbenchmarks/history/values?id=ETHUSD_RTI&timespan=HOUR&timestamp=<UTC_hour>`;
  this requires an independent `STREAM_HISTORICAL_VALUES` entitlement, NOT proven by REST latest or live WS access.
- Probe ONE historical hour read-only, with response limits, timeouts, rate-limit checks and zero archiving, before any broad 90-day fetch.
- Cloudflare V4 continuous index recording stays OFF until data-use permission and storage policy are addressed.
- If required historical tick-level order book is unavailable, historical trading-feasibility is explicitly approximate, not a verified fill.

## Evaluation and holdout
- Use available real contracts inside the 90-day calendar horizon; count actual valid markets, missing markets and incomplete observations.
- Keep chronologically later markets untouched until all research/selection decisions are frozen.
- Report confusion matrix, UP/NO performance, prediction coverage, number of PASS, target-margin/time-to-expiry bands, confidence calibration and uncertainty intervals.
- Secondary: fee-inclusive simulated P&L, entry price/size, 96c early-sale observations, -40% stop, latency, unfilled orders and last-minute holding.
- Separate market outcome accuracy from early profitable resale; neither implies the other.
- Conduct live forward paper shadow validation after retrospective work, without waiting another 90 days.

## Primary public documents
- https://help.kalshi.com/en/articles/13823838-crypto-markets
- https://docs.kalshi.com/websockets/cfbenchmarks-value
- https://docs.kalshi.com/cfbenchmarks/rest-passthrough
- https://docs.cfbenchmarks.com/api/rest/historical-values/
- https://docs.kalshi.com/getting_started/historical_data
- https://docs.kalshi.com/getting_started/market_lifecycle
- https://docs.kalshi.com/getting_started/orderbook_responses
- https://docs.kalshi.com/api-reference/market/get-market
