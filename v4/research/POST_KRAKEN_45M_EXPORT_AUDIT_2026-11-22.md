# ETH-15 Scout V4 — Post-deployment 45-minute comparison (Nov 22, 2026)
**Source:** user-uploaded `ETH-15-Scout-V4-Decision-Audit-2026-11-22 (1).json`, exported 17:41:45 CST; compared with previous audit export at 15:40:08 CST. Screenshots of Kraken warnings 17:07–17:08; WebSocket history/storage screenshots approximately 17:42–17:43.
**Interpretation:** observed research data; this is NOT proof of causal improvement or verified trading fills. Full 5:41 audit JSON excludes separately retained high-volume WS archive.

| Metric | 14:55–15:40 CST | 16:55–17:40 CST |
|---|---:|---:|
| Engine research ticks | 178 | 180 |
| 1m Kraken failures | 20 (11.2%) | 8 (4.4%) |
| 5m Kraken failures | 40 (22.5%) | 40 (22.2%) |
| Distinct 5m Kraken `EGeneral:Too many requests` | 5 | 5 |
| Core research feeds ready | 120 (67.4%) | 133 (73.9%) |
| Decision-processing errors | 0 | 0 |
| Tick gaps >30 sec | 0 | 0 |

**Detailed 5m incident times (CST):** 17:03:11, 17:07:11, 17:10:11, 17:14:11, 17:27:11. Each was followed by 7 x 15-second 5m cooldown observations (5+35=40 failures). This corroborates the user screenshot near 17:07:26. Two 1m provider rate-limit responses at 16:55:11 and 17:11:11 were followed by 3 cooldown observations apiece (8 total 1m failures).

**Post-period decision notices, mutually exclusive per research tick:** 67 `NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK`; 49 `PRICE_ABOVE_87C_HARD_BUY_LIMIT`; 34 `FRESH_OFFICIAL_ETHUSD_RTI_REQUIRED`; 26 `OUTSIDE_EARLY_PAPER_ENTRY_WINDOW`; 4 no active contract. **ALL 34 official-index-required notices occurred on ticks with failed Kraken context: 26 only failed 5m, 4 only failed 1m, 4 failed both. Do NOT misreport these as 34 independent official Kalshi index failures.** The health model reports the first blocking reason in the decision pathway.

**Export growth:** 6,551 -> 7,037 research ticks (+486), 6,433 -> 6,910 REST quotes (+477), 946 -> 955 REST order books (+9), 49 -> 57 finalized PASS decisions (+8), 343 -> 351 official outcomes (+8), and 2 -> 2 completed paper trades (0 new). Paper cumulative net remains +$6.14. Screenshot WebSocket archive 555,434 -> 609,815 (+54,381 in roughly two hours). This archive load is a separate retention risk but does NOT establish that it caused Kraken's API rejections. The 100-observation bid chart represents a very short selected sample and no verified fills.

**Clock window accuracy:** 16:55–17:40 spans only **two full** 15m contracts (17:00–17:15 and 17:15–17:30); 16:45–17:00 and 17:30–17:45 are partial. There were three closed contracts by 17:40, not three completely observed full windows.

**Instrument warning:** `researchTicks` fields `shadowOnly:true`, `simulationArmed:false`, and legacy `UNVALIDATED_V3_BASELINE_SHADOW` are hardcoded by `buildResearchTick` even when the V4 paper engine is enabled. These fields should not override authentic V4 status; this logging-schema discrepancy is distinct from trading safety and can be fixed separately.

**Root-cause candidate:** Deployed `kraken-feed-scheduler.js` verifies the latest closed 5m bar on each tick yet unnecessarily gives an unchanged 5m response only 60s cache TTL. Separate branch `v4-kraken5m-boundary-cache-20261122` stages TTL 300s, while still checking latest closed 5m candle each reuse; strict validation at every five-minute boundary, rate-limit backoff and exit logic remain unchanged. 11 targeted source-level tests pass; **full CI/Cloudflare dry run not yet completed**. The branch is NOT deployed. This likely removes unnecessary provider calls; actual rate-limit improvement is unproven, and shared IP/provider issues remain plausible. Official Kraken rate limit reference: https://support.kraken.com/gb/articles/206548367-what-are-the-api-rate-limits-.

**Decision:** Keep deployed trading policies and bankroll/history unchanged. Verify full suite, seek owner approval before another paper engine deployment, re-export new observations and compare verified provider rejections, feed readiness and missed opportunities prospectively. Preserve WS archive for separate bounded backup. The research shadow-policy work remains non-executing.
