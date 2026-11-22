# V4 Research Sources — implementation and acceptance gates
Updated: 2026-11-21 (America/Chicago)
Scope: *isolated branch only*. V3 never changes. V4 paper trades remain hard-disabled.

## Evidence levels
- **SOURCE CODE PRESENT** means a module exists on this development branch, not deployed.
- **CI PASS** means deterministic tests and Wrangler dry-runs passed, not live entitlement.
- **LIVE VERIFIED** requires owner-approved Cloudflare deployment and durable observations.
- **MODEL PROVEN** requires independent holdout and conservative fee-adjusted replay. Nothing currently qualifies.

## Inputs
| Source | Research use | Code | Activation/limits |
|---|---|---|---|
| Kraken 1m/5m closed candles and derived 3m | Technical context, not official settlement | Existing V4 | Continue freshness checks |
| Kalshi REST market proxy | Market metadata and possible cached quotes | Existing V4 | Receipt-only, not a fill |
| Kalshi authenticated WS orderbook | Best price/size, sequence faults and sampled 15s archive | Existing V4 | Earlier live checks; re-verify continuity |
| Kalshi official REST orderbook | Emergency research snapshot only | Existing V4 | Unknown exchange event time; never fill or heal WS gaps |
| Official ETHUSD_RTI via Kalshi WS 1Hz | Source-time reference value and supplied final-minute 60s average | New research-socket/research-sources | V4_RESEARCH_STREAM_ENABLED=false by default; entitlement and retention review first |
| Kalshi public trade channel | Completed trade price, count and taker side | New research-socket/research-sources | Same optional research-only socket and read key |
| Complete raw WS book frame archive | Preserve accepted snapshot/delta and quantity evolution | New full-book-archive | V4_FULL_BOOK_ARCHIVE_ENABLED=false by default; high write usage requires explicit operator/cost approval |
| Kalshi signed CF REST response check | Confirm accessible data envelope, not numerical correctness | New cf-access.js | V4_CF_ACCESS_PROBE_ENABLED=false; six-hour cache; costs 50 Kalshi read tokens per call |
| Official CF history backfill | Recover verified values with source-time labels | NOT IMPLEMENTED | Requires confirmed entitlement and actual response schema/sample |
| High-frequency 5Hz official CF source | Higher-resolution optional reference | NOT IMPLEMENTED | 1Hz must first pass verification |
| Model-relevant market replay | Reconstruct historical decisions without future information | NOT IMPLEMENTED | Need complete synchronized sources and gap reports |
| Holistic reversal/settlement/resale models | Independent decision modeling | NOT IMPLEMENTED | Needs training, calibration, shadow/holdout and paper-only authorization |

## Defect corrections
1. V4 research-tick schema **v2** now converts Kraken OHLC seconds to milliseconds for closed-candle timestamps. Older v1 records are *not rewritten*. Historical replay must normalize legacy rows by schema version and must NOT mix original units.
2. The legacy source-level measureBookCoverage default 5s gap remains a frame-continuity diagnostic. New measureSampledBookCadence uses a separate 30s sampling tolerance for the 15s archive and **never** reports reconstructed order-book continuity or proof of fills.
3. Raw book frames preserve upstream fixed-point decimal strings as evidence. Frame archival is separately gated and does not change the current in-memory book, V3 or the V4 shadow strategy. A SQL write failure creates missing evidence and cannot be hidden or reconstructed.

## Required acceptance tests, in order
- [ ] Confirm CI success for this branch (including V3 regressions and V4 Wrangler dry-runs).
- [ ] Check GitHub diff: no V3 source, keys, account orders or DO binding changes.
- [ ] Owner reviews Kalshi/CF data retention/redistribution permissions and Cloudflare storage/write capacity.
- [ ] Deploy **only** the V4 engine/viewer after human approval. Existing flags remain false.
- [ ] Enable the six-hour-cached V4_CF_ACCESS_PROBE_ENABLED, verify CF GET is signed with /trade-api/v2/cfbenchmarks/values (without the query), press the V4 dashboard "Check index access" button. A 200 or data envelope alone is **not** proof of valid ETH index values.
- [ ] Independently verify indexlist contains ETHUSD_RTI, source timestamps, actual index value payloads and final-minute averages on a complete 15m market; then enable V4_RESEARCH_STREAM_ENABLED.
- [ ] Verify public trade feed on the intended market, rollover/reconnect, sequence gaps, and no interference with original orderbook WS.
- [ ] Compute actual daily write usage for the full-book recorder. Explicit approval is required before enabling V4_FULL_BOOK_ARCHIVE_ENABLED and a retention/rotation policy.
- [ ] Persist 24h of evidence with no silent gaps, negative duration, or unreported failed archive writes.
- [ ] Test multi-window chronology, matched strike, market official results, 60s settlement boundary, Kraken/CF basis, and signed historical backfill.
- [ ] Build separate settlement probability and early resale models; compare with V3 using time-ordered holdout and fee-inclusive executable depth.
- [ ] Only then discuss independent V4 virtual $100 paper activation. Never auto-promote to V3.

## Read-only SQLite spot checks (Cloudflare > V4 DO > Data Studio)
The V4 Durable Object must have been deployed with the new tables.
```sql
SELECT COUNT(*) AS cf_count, datetime(MAX(received_at)/1000,'unixepoch') AS latest_cf_utc FROM v4_cf_values;
SELECT COUNT(*) AS public_trade_count, datetime(MAX(received_at)/1000,'unixepoch') AS latest_trade_utc FROM v4_public_trades;
SELECT COUNT(*) AS raw_book_frames, datetime(MAX(received_at)/1000,'unixepoch') AS latest_book_utc FROM v4_book_frames;
SELECT kind, COUNT(*) AS total FROM v4_research_feed_events GROUP BY kind ORDER BY total DESC;
SELECT schemaVersion, COUNT(*) AS records FROM
  (SELECT json_extract(payload,'$.schemaVersion') AS schemaVersion FROM research_ticks)
 GROUP BY schemaVersion ORDER BY schemaVersion;
```
Never paste Kalshi credentials into browsers, logs, chat or GitHub. The URL in a browser needs a full host and cannot authorize a signed API call by itself.

## Official references
- https://docs.kalshi.com/cfbenchmarks/rest-passthrough
- https://docs.kalshi.com/websockets/cfbenchmarks-value
- https://docs.kalshi.com/websockets/public-trades
- https://docs.kalshi.com/websockets/orderbook-updates
