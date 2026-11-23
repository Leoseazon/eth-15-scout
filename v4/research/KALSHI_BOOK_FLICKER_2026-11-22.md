# ETH-15 Scout V4 — Intermittent Kalshi live-book warning, Nov 22 2026

**Status: READ-ONLY INCIDENT REVIEW. No engine rule changes, deployments, secrets, or trading-account writes.** Report by owner at approx. 18:50–18:58 CST (America/Chicago), after successful V4 5-minute Kraken-cache deployment.

## Actual owner observations
- A red bar sometimes mentions Kalshi book then disappears.
- Yellow `Live Kalshi order book is missing, delayed or reconnecting` warnings flicker approximately at every dashboard refresh, with healthy green intervals in between.
- In a supplied 18:50:56 CST screenshot, a distinct Kraken 5m cooldown alert is red while last engine tick is ~14 seconds old; paper simulation is still enabled.
- The preceding decision-audit JSON ended around 18:46 CST and excludes the separate WebSocket stream-event archive, so exact Kalshi disconnect causes after that time are **not directly proven**.

## Confirmed source-based mechanisms
1. `v4/app.js` polls private dashboard every **15 seconds**; `v4/health-ui.js` also recomputes health every **15 seconds**.
2. `cloud/v4/src/kalshi-orderbook.js`: `KalshiBookStream.view(ticker,now,maxAgeMs=5000)` sets `fresh=false` when last authenticated snapshot/delta receipt is more than **5 seconds** old (or when sending/event clock verification, book validity, or market crossing fails).
3. **Executed a minimal source-level replay:** one valid orderbook snapshot and no subsequent deltas yielded `valid=true,fresh=true` at 5,000 ms and `valid=true,fresh=false,reason=STALE_OR_UNVERIFIED_TIMESTAMPS` at 5,001/6,000/10,000/15,000 ms. This proves legitimate no-delta intervals can trigger a warning even when the local reconstructed book remains valid. Does NOT prove transport is connected on the owner's dashboard.
4. `v4/health-ui.js` reports `KALSHI_BOOK` when the WebSocket is disconnected, ticker is wrong, book `fresh`/valid is false or last book receipt exceeds 5s relative to browser clock. Yellow escalates to red after **30 seconds of continuously observed warning** and clears after an observed healthy refresh. A genuine sequence gap is a *separate* immediate red `BOOK_SEQUENCE`.
5. `KalshiReadOnlySocket.watchdog` asks `get_snapshot` after stale (at most once each 10s), but the Worker calls watchdog in its **15-second engine loop**. Repeated snapshot requests are possible when book activity is quiet; auth and WebSocket rate limits need respect.
6. The watchdog reconnects after **45 seconds without JSON market-data messages**. It updates `lastMessageAt` when JSON data arrives but cannot observe WebSocket protocol Ping through the same handler. Per official Kalshi docs, Ping heartbeats occur after **10 seconds of no data frame**. Therefore a correctly connected *idle* market is a plausible source of redundant reconnections, depending on actual message cadence. This is a **hypothesis, not proven incident cause**.
7. The dashboard computes `activeAge(quote.receivedAt, browser Date.now())` based on a server-origin timestamp; viewer/browser polling delays or clock skew could alter the displayed warning, independently of server-side entry verification.
8. The original export contained official REST order-book fallbacks at 18:00:27, 18:08:43, 18:15:13, 18:30:13 and 18:45:42 CST. Since `cloud/v4/src/worker.js` invokes this 15s REST fallback **only if live Kalshi WS book is unusable**, it confirms some real book-unusable moments before the newer screenshot. **18:08:43 is mid-round**, not only a new-contract subscription gap. REST samples are receipt-only research and DO NOT authorize paper BUYs.

## Why safety should not be loosened without measurement
- Official Kalshi orderbook stream is event driven: snapshot first, then incremental updates, not guaranteed each second. A healthy socket and fresh top-of-book are different evidence. Official docs https://docs.kalshi.com/websockets/orderbook-updates
- Official connection keepalive sends Ping after 10s idle, but Ping is NOT evidence of an updated executable order price. Official docs https://docs.kalshi.com/websockets/connection-keep-alive
- Therefore keep 5-second execution-freshness gate until timing/price/impact measured. Do NOT substitute REST fallback for WS fill verification or suppress real stream warnings.

## Low-risk required diagnosis and change proposal (NOT implemented)
**Immediately after 45-min observation:**
1. On the private dashboard open **Research → Streaming connection** and record `Streaming connection`, `Stream sequence gaps`, `Last book receipt`, and `Recorded book observations` on both healthy green and flickering yellow states. The current `Deployment Status` alone is insufficient for Kalshi transport root cause.
2. Export new **Decision audit JSON** (no WebSocket archive) and compare Kraken 1m/5m checks, engine ticks, outcomes, WATCH/PASS/BUY reasons. This export alone does NOT contain complete WebSocket event/health transition history.
3. From an authorized read-only backend, evaluate `streamConnection.connected,targetTicker,quote.valid,quote.fresh,quote.reason,quote.receivedAt,attempts,retryAfter,lastFailure,sequenceGaps,needResync` at multiple warning and healthy timestamps. Never share credentials, signed requests, raw auth headers, or raw exceptions.
4. In any future code candidate, **separate connection-health warning** (valid socket, correct ticker, no sequence gap, watchdog heartbeat/transport) from **price freshness warning** (last authenticated book change/snapshot within 5sec). Keep BUY eligibility unchanged. Document a genuine disconnect distinctly from an idle-but-stale valid book. Record event transitions only, low network/storage overhead.
5. Consider whether 45s JSON-only idle reconnect is sound given official Ping behavior. Any watchdog changes must be fully simulated, use bounded reconnection/resync, and be reviewed before deployment. Avoid new WebSocket connections per 15s or unbounded snapshot requests.
6. Publish the dashboard distinction only after automated tests verify existing BUY/SELL safety invariants and truthful warning states.

**Root-cause status:** The 5sec freshness/UI threshold is CONFIRMED, and genuine momentary unusability is evidenced by historical REST fallbacks. Whether the reported flashes are only benign quiet-book expiration or actual socket/sequence failures remains UNRESOLVED without live WS status transition evidence.


## Additional owner screenshot — later green immediately after transient yellow
The owner uploaded `image(20261123-010316).png` showing the V4 research panel after a yellow Kalshi warning had just appeared and disappeared. This is a **green-state screenshot**, not an image of the warning itself. Reported values:
- `Streaming connection: Connected · fresh snapshot`
- `Recorded book observations: 668,497`
- `Stream sequence gaps: 0 this connection`
- `Last book receipt: 2s ago · KXETH15M-26NOV222015-15`
- `Official REST depth archive: 962 stored · REST only`
- `Last REST receipt: 2m ago`
- `Official ETHUSD_RTI stream: Disabled — pending entitlement and source retention review`
- `Full book-frame archive: Disabled pending cost and rights approval`
Interpretation: The connection and latest authenticated book were healthy at the screenshot moment, but the latest fallback REST snapshot two minutes earlier shows at least one recently observed unusable WS book in the engine's fallback logic. Zero sequence gaps are counted **only in the current connection**; an earlier reconnect could have reset that counter. No claim that earlier yellow flashes were solely cosmetic or that BUY freshness safeguards should be loosened. Recommended next capture: current `streamConnection.connected, quote.fresh, quote.valid, quote.reason, quote.receivedAt, lastFailure, attempts, retryAfter, sequenceGaps, needResync, targetTicker` during yellow, with no secret/token fields.


## Frame-by-frame owner-video verification (uploaded IMG_4163.mp4)
- Media: 25.2-second, 512×910 H.264 clip recorded by phone filming the laptop's V4 dashboard; physical display becomes sideways in camera orientation, so frames were reoriented for inspection.
- The user explicitly noted the warning/diagnose region flashes too quickly at normal playback. Reviewed at 0.25-second frame intervals with still frames enlarged. Created a 10× slowed, upright, 27.7-second excerpt from source video 6.5–9.25s, stored in the conversation's sandbox, not the repository.
- At approximately source-video **7.25–8.25 seconds**, the banner is **YELLOW** `System needs attention` with the exact visible message `Live Kalshi order book is missing, delayed or reconnecting.`
- At approximately source-video **8.5 seconds**, banner is **GREEN** `No detected system issues` with `Engine is reporting; no monitored error is active.`
- The screenshot at ~7.75s shows `Diagnose issue` as a collapsed line. **CORRECTED after full-film reinspection:** at 22.7–23.0 seconds of the original video the user DOES expand the `Diagnose issue` section. The sole visible diagnostic row is `KALSHI BOOK`: `Live Kalshi order book is missing, delayed or reconnecting. Check authenticated WebSocket, ticker and latest book receipt.` This is the generic UI diagnosis; it still does **not** establish `lastFailure`, `sequenceGaps`, `needResync`, or whether the live book was disconnected versus valid-but-stale.
- At warning capture, page indicates `Last engine tick 20s ago` while the adjacent refresh label shows `Last refresh 19:05:19 CT · Engine 5s ago` and a `Refreshing…` badge, indicating that different dashboard elements may briefly display status from different poll/render cycles. By the green frame (~8.5s), the status updates to `Last engine tick 7s ago` and `Last refresh 19:05:34 CT · Engine 7s ago`. **The video appears to compress dashboard wall-clock time**, so 1.25s of video must NOT be claimed as the real-world warning duration.
- During both states, paper mode remained enabled and the engine displayed online. The recording **proves a transient display warning**; it does not prove that buy execution was available during the warning.
- Follow-up engineering study should instrument the existing authenticated status responses and distinguish a synchronized snapshot's lastTick, browser poll age, WebSocket connected/quote valid, quote reason, and event timestamps. Do not change the BUY freshness threshold based solely on the flashing UI.

### Full-video correction (all 25.2 seconds reviewed)
- At source-video 22.50–23.00 s the owner clicks and opens **Diagnose issue** during yellow `System needs attention`.
- Only one row appears, code **`KALSHI BOOK`** and exact text: **`Live Kalshi order book is missing, delayed or reconnecting. Check authenticated WebSocket, ticker and latest book receipt.`**
- Around 23.25 s the next dashboard update clears the warning, and the panel returns green.
- The earlier statement that diagnosis was never expanded was wrong, caused by stopping review at ~8.5 s; this corrected log supersedes it.
- This confirms UI `KALSHI_BOOK` branch but cannot discriminate `connected=false`, mismatched ticker, `quote.valid=false`, `quote.fresh=false`, or old `quote.receivedAt` without status metadata.


## Second owner video — IMG_4164.mp4 (8.867 seconds, 30 fps)
**Source:** directly examined original uploaded video on November 22, 2026. Video was reviewed across full duration at 0.25–0.5s intervals, and the original frames were enlarged in a diagnostic timeline. This is a screen recording filmed by phone; playback seconds are *not* necessarily the duration of the underlying service incident.
- At source 0.0s red status: `ENGINE ERROR` reports **Kraken 5-minute candles was rate-limited or is cooling down**; `FEED kraken5m` fails validation. The dashboard paper engine is online.
- At ~1.5s, still red but updated status: `ENGINE ERROR` reports **Kraken 1-minute candles was rate-limited or is cooling down**; `FEED kraken1m` fails validation. This is a separate source from 5-minute requests.
- At ~6.5s, red with `+2 more`: same `ENGINE ERROR` (Kraken 1m) and `FEED kraken1m`, plus third **`KALSHI BOOK`: `Live Kalshi order book is missing, delayed or reconnecting. Check authenticated WebSocket, ticker and latest book receipt.`**
- By source ~7.5s, health returns green `No detected system issues`, paper simulation still enabled, system monitoring `Online`, engine tick ~7 seconds old.
- **Major diagnostic implication:** Multiple independent feed-health warnings can overlap, so a red system bar should not be attributed only to 5m Kraken, or only to Kalshi WS; exact `feedChecks` + `streamConnection` transitions are necessary. The movie shows no uncaught decision-processing exception or documented actual trade execution.
- The red-to-green transition is most consistent with new valid feed inputs arriving before the next authenticated status refresh; this remains a hypothesis. Warning clearing does not retroactively verify any skipped BUY.
- A 4× slowed diagnostic version and four-frame evidence montage were generated in the conversation sandbox; the raw video is still the primary evidence, not committed to GitHub.
