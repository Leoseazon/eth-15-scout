# V4 preflight coding and feed audit — 2026-11-22

STATUS: STAGED, NOT DEPLOYED. Paper-only release. No claim of zero bugs, continuous feed reliability or profitable trading edge.
Owner objective: predict actual KXETH15M target-side official closing ETHUSD_RTI 60s settlement average, independently of early sale profits.
V3 runtime and code must remain unchanged. No real money or order-placement APIs. PASS watches the same market. $100 synthetic bankroll and <=$3 all-in stake.

## Severity-ranked findings fixed in the research branch
1. P0 Forecast record and synthetic bankroll were separately written; worker.save now commits INSERT and KV cash state atomically inside storage.transactionSync.
2. P0 Disarming experimental V4 once position exists could hand its exit to V3 legacy engine; continueV4Position now preserves V4 exit rules without new entries.
3. P0 Kraken network fetch could delay protection: a fresh Kalshi WS BID exit fast path runs before external REST/indicator requests and persists a valid sell promptly.
4. P0 Auxiliary research journal could record a buy before primary cash committed: primary save now happens first.
5. P0 Missing forecast persistence callback allowed a synthetic debit: no callback is a fail-closed PASS with no debit.
6. P1 Buy needed displayed ask depth but did not require displayed bid-side exit depth for quantity: both sides now checked.
7. P1 Paper exits now explicitly require authenticated Kalshi WS orderbook origin, correct ticker and fresh receipt, not a substituted REST quote.
8. P1 Soft-loss mode now requires independent target geometry, momentum and 3m/5m structure alignment; tighter <=3c spread, 2x displayed depth, $1.50 max stake. Not 7 correlated checkboxes.
9. P1 Missing EMA/MACD/RSI/volatility/5m features could be silently converted to neutral: all mandatory features now checked for finite values and valid trend enumerations.
10. P1 Redundant V3 candidate-probe was running in V4 paper mode: only one decision philosophy now active per tick.
11. P1 Dashboard lacked proxy bids and used the latest engine time as a proxy for cached quote freshness: real proxy retrieval timestamp, both bids and source provenance now supplied.
12. P1 Status always claimed official index unavailable: now reports last read-only index state with 30-second expiry and separate per-feed health.
13. P1 Official-index REST would poll even without a valid live WS book: early prerequisites now gate the signed GET.
14. P1 Book snapshot was read before HTTP official-index lookup and could be stale at decision: reacquired AFTER lookup, freshness checked again.
15. P2 PAPER config comments wrongly said paper was disabled, and V4 UI incorrectly displayed legacy 7/7 SOFT policy: both corrected.
16. Prior code audit: CF Benchmarks WebSocket subscription ACK SID was read from wrong location; now msg.sid and official indexlist required; prior owner live one-shot probe succeeded.

## Current data and safety acceptance gates
- Kalshi target, ticker and contract close must be present from a verified market snapshot.
- Official benchmark: authenticated ETHUSD_RTI latest with source age <=15s; Kraken cannot replace official settlement index.
- Kalshi buy/sell quote: same-ticker authenticated read-only WS, accepted snapshot/deltas, no sequence corruption, <=5s data freshness, displayed two-sided depth, suitable spread. Recheck after index GET.
- Independent Kraken 1m/5m closed candles, derived 3m structure and complete numerical EMA/RSI/MACD/volatility/structure; missing data forces PASS.
- 96c paper BID take-profit; user allows hold at <=60s; 40% contract-price stop in final 6 minutes; official finalized outcome for settlement.
- Forecast side correctness is scored for EVERY simulated BUY whether sold early or held. Early money profit does not mean correct prediction.
- Default V4 research deployment remains disarmed. V4 paper config differs only in two paper flags; new index/public-trade/full-book archives remain off.
- Still NO real orders. Cloudflare owner deployment and live source tests are unverified until actual PowerShell deployment and dashboard screenshots.

## Historical research limitations
An independent Kalshi public market audit fetched and deduplicated 8,536 actual finalized KXETH15M markets in a rolling ~90-day period.
A representative near-final run had UP=4,235, DOWN=4,301, all 8,536 with actual targets and official results; outcome counts vary slightly by run time.
Historical pagination stopped upon an observed pre-study date boundary; this is extensive coverage but not proven mathematically exhaustive.
Historical official index/second-level order-book data is not yet assembled; the offline replay code can test only supplied valid as-of records.
NO validated 90-day algorithm accuracy, probability calibration, exact-fill simulation or profitability advantage has yet been established.

## Architecture / sources of truth
cloud/v4/src/worker.js — alarm, paper activation, fast exit path, feed orchestration, transaction state, reports
cloud/v4/src/settlement-first.js — settlement-side hypothesis from target geometry, volatility, momentum, 3m/5m context
cloud/v4/src/settlement-first-paper.js — PASS, quantity, risk, stops, synthetic ledger state
cloud/v4/src/settlement-predictions.js — unique prediction before synthetic debit and independent official direction score
cloud/v4/src/window-journal.js — Kalshi finalized actual outcome
cloud/v4/src/paper-ledger.js and settlement-accounting.js — official cash settlement
cloud/v4/src/kalshi-ws-transport.js and kalshi-orderbook.js — read-only authenticated book
cloud/v4/src/cf-access.js and cf-ws-probe.js — official benchmark REST and WS diagnostics
cloud/v4/src/history-90d-audit.js and settlement-replay.js — actual historical market inventory and as-of evaluation framework
cloud/v4/viewer-worker.js, v4/index.html, v4/app.js, v4/settlement-paper-ui.js — private viewer and settlement score
cloud/wrangler.v4test.toml — default V4 off; cloud/wrangler.v4paper.toml — V4 paper simulation on

## Mandatory go/no-go
1. GitHub Actions must pass Node tests, V4 cloud dry-runs and V4 viewer dry-run on the exact intended pinned commit.
2. Verify PR 6 only touches V4 files and the test workflow; no V3 runtime file.
3. Verify GitHub Pages V4 dashboard workflow passed and is available.
4. Owner deploys paper-only engine then viewer from exact reviewed SHA and screenshots success; no secret disclosures.
5. First live round: confirm both feeds, expiry, target, index receipt age and WS quote age. Monitor PASS/BUY/SELL and official outcome. Any bad source means WAIT/NO PAPER BUY.
6. The experiment may run only if all gates pass. Fast rollback: deploy cloud/wrangler.v4test.toml (disables NEW paper entries, V4 existing exits remain V4).
7. No claim of an effective edge or full completion until real out-of-sample retrospective and forward paper results support it.

Project repo https://github.com/Leoseazon/eth-15-scout
Draft PR https://github.com/Leoseazon/eth-15-scout/pull/6
Audit authored on 2026-11-22, with additional live validation still required.