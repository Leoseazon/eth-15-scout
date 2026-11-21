# ETH-15 Scout V4 — Master development plan
**Created:** 2026-11-21 · **Status:** Separate V4 read-only Worker deployed and monitoring, paper trading hard-disabled; Kalshi streaming capture enabled but still no confirmed order-book connection · Gate 2 connectivity repair ongoing.

## Mission
Upgrade V3, not replace it. Model an executable Kalshi 15-minute ETH contract's expected early resale return separately from its probability of winning at official settlement. Preserve the ability to recognize justified inexpensive entries below 60c without equating low cost with an edge.

## Frozen reference baseline
- V3 live engine: `eth-15-scout-cloud-v3test`, hotfix commit `6b4e2987f37cc2f8adb297c5cfaa1bb30a0d3659`.
- V3 private viewer: `eth-15-scout-v3-view`.
- V3 actual dashboard is `main:v3/index.html`, `style.css`, `app.js`, `sounds.js`.
- V3 Durable Object: `SCOUT` / `ScoutEngine` / `single-paper-scout`.
- Never modify, reset, migrate or copy V3 live account/journal into V4.
- V4 proposed separate engine `eth-15-scout-cloud-v4test`, DO `SCOUT_V4` / `ScoutEngineV4`, `v4-single-paper-scout`, viewer `eth-15-scout-v4-view`, dashboard `/v4/`.
- No real Kalshi order endpoint, live brokerage keys, automatic production deployment or unauthenticated private journal.

## Gate 0 — Correctness and source of truth
- [ ] Reconcile all V3 audit issues and regression tests with exact hotfix source.
- [ ] Verify official KXETH15M contract terms, 60-second opening/final CF Benchmarks average, rounding and boundary timing.
- [ ] Verify the Kalshi API schemas, WebSocket authentication/order-book semantics, fees, depth, settlement fields and permitted historical data retention.
- [ ] Track Kraken-versus-official-index basis; never call Kraken settlement authoritative.
- [ ] Label OBSERVED, ESTIMATED, CONFIRMED and UNAVAILABLE distinctly.

## Gate 1 — Isolated research foundation
- [x] Create a development branch from the verified V3 hotfix.
- [ ] Clone V3 engine support modules into a V4-only tree; do not edit existing V3 paths.
- [ ] Create V4-only Worker, DO class/instance, SQLite storage, viewer secrets/session, dashboard theme.
- [ ] V4 remains HARD-DISARMED for simulated entries until independently approved.
- [ ] Add deterministic settlement-average arithmetic and minimal append-only quote recorder, with source timestamps and test fixtures.
- [x] Run existing V3 tests, V4 unit tests, syntax checks and standalone Wrangler dry-run CI; complete branch isolation audit again before release.
- [ ] Prove V4 has no code path to V3's Durable Object or settings.

## Gate 2 — Data acquisition
- [ ] Add official Kalshi WebSocket ticker, book snapshot/deltas and public trades; authenticate/entitle only where required.
- [ ] Reconstruct bids/asks correctly from Kalshi YES/NO bid book; verify sizes, sequences and any gaps.
- [ ] Capture official ETHUSD_RTI and final-minute averages if entitled; Kraken remains proxy/directional feed.
- [ ] Store exchange/event time if supplied, receipt/ingest time, quote age, clock offset, reconnects and stale/gap flags.
- [ ] Persist complete window price paths at feasible frequency and retention per applicable API/data licenses.
- [ ] V4 chart: UP/DOWN executable bid/ask vs remaining time, synchronized with ETH reference and strike.

### Gate 2A — Read-only WebSocket book reconstruction (development checkpoint)
- [x] Verified Kalshi's current WebSocket orderbook envelope: `orderbook_snapshot` uses `yes_dollars_fp`/`no_dollars_fp`; `orderbook_delta` uses `price_dollars`, `delta_fp`, and `side`. Subscription-wide `seq` must be contiguous; per-market `clock` is not a gap counter.
- [x] Implemented independent, tested V4-only pure `KalshiBookStream` library with exact fixed-point parsing, complementary ask/depth reconstruction, fail-closed sequence gaps, snapshot recovery, source timestamps, stale-book flags, and research-only displayed-depth walkthroughs.
- [x] Develop a V4-only, deliberately **unwired** read-only WebSocket transport prototype with Kalshi-signed RSA-PSS PKCS#8 / recommended Ed25519 PKCS#8 handshakes, scoped single-market subscription, specific snapshot recovery, and reconnect/backoff; deterministic mocked-channel tests are included.
- [ ] Wire the prototype to the isolated V4 Durable Object and validate Cloudflare WebSocket lifecycles, market rollover, recovery, no-downtime failure modes, and actual Kalshi scopes. The book library is **not** yet fed by a live socket.
- [ ] Record authenticated stream observations with provenance in durable storage; enforce bounds, cleanup, permissions, read-only gateway exposure, and long-run/reconnect tests.
- [ ] Verify official ETH index entitlement, start and ending 60-second settlement averages, and historical official-result reconciliation.
- [ ] Validate market-data continuity on real streams before any paper execution uses the model.

**Gate 2A/2B prototype scope:** No new trading rules, deployment, real trades, trading-model calibration or Cloudflare secret configuration. The old REST recorder is still preliminary and labeled possibly cached. Passing mocked transport tests does NOT mean a Cloudflare connection or live streaming feed is operating. A dedicated Kalshi `read`-scope key, never a default read/write key, is required for eventual V4-only deployment. WebCrypto code accepts Ed25519 PKCS#8 or RSA-PSS PKCS#8; Kalshi-issued RSA PKCS#1 PEM needs offline PKCS#8 conversion first. Never commit or send private keys in chat.

## Evidence retention contract — preserve V3 and extend V4
- [x] Preserve V3-style append-only event, completed-trade, WATCH/final-PASS, pending paper positions and official Kalshi market-outcome records in separate V4 Durable Object storage. Dashboard recent-row limits never truncate the canonical archive.
- [x] Add V4 append-only research_ticks recording every monitored engine evaluation, including no-market windows, source receipt/proxy times, observed contract prices, 1m/5m signals, 3m/5m structure, market regime, feed failures, decision notes, account state and stop diagnostics.
- [x] Add separate research_book_samples schema and writer for timestamped YES/NO WebSocket bids and sizes; NOT connected to live streaming.
- [x] Expose bounded, authenticated research and quote archive pages with high-water anchored pagination, on-site evidence timeline, load-older interactions and JSON export combining research ticks, REST prices, journal and official outcomes.
- [x] Add optional on-site stop-loss postmortem from stored trades and bid observations, looking +30/+60/+120 seconds ahead only when real observations exist. Explicitly separate official settlement direction from resale and never infer missing fills.
- [ ] Store authenticated WebSocket book paths, market trades, exchange timestamps and freshness after future Gate 2 isolated deployment and data-retention permission review.
- [ ] Upgrade archival pagination beyond one million observations, implement coverage/gap reporting and consistent exports for long-term operation.
- [ ] Add full entry/no-entry rationales, fee-adjusted hypothetical fills, shadow predictions and model-version lineage only when forecasting models exist.
- [ ] Add automated post-stop followups from true streaming snapshots; current postmortem is based on possibly cached REST and is not proof of executable resale.
- [ ] Verify live durable history/export coverage under long-running load. CI alone does not establish historical completeness.

## V4 stop-loss experiment — high priority
- [x] Keep emergency −40% contract bid decline stop armed strictly inside the final six minutes. No unilateral widening to 50%/60% or removing it based on a few later-winning settlements.
- [x] Fix the V4 exact 40% threshold using integer 1/10000-dollar prices and whole-second six-minute boundary; regression-test equality, 6:00 vs 5:59, invalid data and expiry. V3 remains untouched.
- [x] Change V4-only two-candle adverse-reversal evaluation to start after purchase, requiring two consecutive fully post-entry closed 1m candles, at most one of seven directional confirmations and confirmed adverse 3m/5m structure. The existing emergency-stop, 96¢ target and last-minute policies retain priority. Treat this as an experiment, not a proven improvement.
- [x] Persist stop arming time, entry-to-bid decline, available bid, estimated mark P&L, severe-indicator evidence and 3m/5m structure in the V4 research history.
- [ ] Run counterfactual replay and out-of-sample shadow comparisons: early-candle exits, no change, or hold-to-settlement; account for fills, slippage, depth, missed winners, severe losers and data gaps.
- [ ] Measure cases that crossed the −40% threshold before six-minute arming and losses that exceeded a nominal 40% due to gaps, late checks or thin bids.

**Interpretation:** A 40% contract-price trigger is not a guaranteed execution price. A sellable bid may gap or have insufficient depth. A $2.29 simulated loss alongside $0.96 winners can occur even with a nominal 40% stop. The mechanism must be established from timed bid and depth evidence rather than assumed.

### Gate 2C — Live-stream integration and safety (code committed; not activated)
- [x] Wire the read-only Kalshi WebSocket prototype into the **isolated V4 Durable Object** only behind `V4_STREAM_CAPTURE_ENABLED = "false"` by default. No V3 codepaths, production order submission, paper positions or secret values are touched.
- [x] Require separate V4-only `KALSHI_V4_READ_KEY_ID` and `KALSHI_V4_READ_PRIVATE_KEY` environment secrets when stream capture is explicitly enabled. A read-permission-scoped API key must be provisioned outside chat.
- [x] Re-subscribe to the detected 15-minute ETH contract; close/reconnect on dead feeds; preserve timestamped book and fault events in separate append-only SQLite tables. Subscriber-wide sequence gaps are recorded, not hidden.
- [x] Add an authenticated read-only `/api/v4/stream` cursor archive and dashboard provenance/coverage indicators, plus bounded browser export of retained observations.
- [x] Add conservative book-walk levels and fee-aware **hypothetical** fills. No simulated order or P&L is activated by this.
- [ ] Validate real authenticated stream connectivity and market rollover in Cloudflare. Mock WebSocket success is **not** real activation or source verification.
- [ ] Capture official CF Benchmarks ETH index values and opening/closing 60-second means with confirmed license/entitlement. Kraken spot cannot replace these values.
- [ ] Validate actual KXETH15M fee multiplier/rules, latency, book depth and take/exit behavior under realistic data; model slippage, missed fills and partial liquidity.
- [ ] Confirm provider market-data retention and redistribution conditions before running the long-term archive and exposing the private research website.
- [ ] Assess Cloudflare storage, CPU, duration and connection limits after opt-in deployment; outbound connections cannot be assumed immortal. Stop monitoring must close outbound connections.

### Gate 3A — Baseline shadow research (code complete, performance NOT validated)
- [x] Add an explicitly untrained, read-only UP/DOWN/WATCH baseline probe to each paper-disabled V4 engine tick. It reuses the V3 candidate eligibility tests but cannot enter or exit positions.
- [x] Persist candidate side, quoted ask/bid, seven source checks and families, structural evidence and rejection reasons. Heuristic ranking scores are NOT calibrated probabilities.
- [ ] Train real settlement and future-resale forecasts on retained exchange/CF index data, using time-ordered windows and held-out sessions without future information leakage. Do not retrofit a score to the original 34 V3 trades and claim an edge.

### Gate 4A — Execution research foundation (code complete, fills NOT verified)
- [x] Hypothetical order-book walk captures the exact price-level quantities on YES and NO bid ladders, with fees applied to each recorded displayed level.
- [x] All-in `$3` maximum and provisional published general taker-fee schedule used in tests; market-specific fee verification required. Simulated depth is not a guarantee of an executable fill.
- [x] Preserve the 40% final-six-minute emergency stop and experimental from-purchase severe two-candle reversal exit; V3's running logic remains untouched.
- [ ] Integrate conservative delayed quote matching, real feed freshness, partial/missed fills, finalized market results and persistent virtual bankroll only **after** Gate 2 evidence checks pass.

### Gate 5A — Statistical validation infrastructure (code complete, insufficient live observations)
- [x] Add fixed-horizon, one-forecast-per-market holdout Brier/log-loss evaluation from **official Kalshi finalized outcomes only**, plus book-history gap/coverage diagnostics.
- [x] Fail closed when no forecasts, no verified results or too few independent windows exist. These tests explicitly refuse to claim a profitable or calibrated model.
- [ ] Gather a clean independent sample, compare resale versus settlement forecasts, model ablations, fee-adjusted expectancy, stop-out loss severity and holdout confidence intervals.

**Release blocker:** Offline code and CI cannot prove market-stream entitlement, WebSocket resiliency in live Cloudflare, official CF settlement access, source retention permission, quote execution fidelity or forecast profitability. V4 read-only capture was separately enabled by the owner; actual Kalshi WebSocket book capture remains unverified. V4 paper-entry code stays hard-disarmed until separate explicit simulation-activation approval.

## Gate 2D — Live Kalshi WebSocket connectivity incident (November 21, 2026)
**Observed in owner's V4-only Data Studio:** successful monitoring ticks, paper armed=0, zero WS book samples, repeated NETWORK_CONNECT_FAILED. Local signing finished before the outbound WS fetch failed without an HTTP status; this does NOT establish an invalid Kalshi API key.

- [x] Confirm Kalshi's primary external-api-ws.kalshi.com and officially supported compatibility api.elections.kalshi.com, with same GET /trade-api/ws/v2 signing path.
- [x] V4-only fallback after two consecutive network failures, restricted to official allowlisted hosts. Never bypass auth 401/403 or rate-limit 429 via host switching.
- [x] Safe fixed diagnostic categories for DNS, TLS, timeout, connection loss and fetch rejection; back off at least two minutes on 429. Never store raw errors, secrets, signatures or response bodies.
- [x] After persistent failure, periodically compare two public unauthenticated Kalshi /exchange/status REST endpoints; at most one probe per 10 minutes, HTTP status labels only, no account data.
- [x] Audit host switches using WS_FALLBACK_COMPAT_SELECTED and WS_FALLBACK_PRIMARY_SELECTED; log bounded NETWORK_REST_CHECK results in existing V4-only history.
- [ ] After passing CI and operator's dry-run review, deploy this V4-only read-only fix and inspect real source-tagged error events.
- [ ] Validate HTTP 101 handshake, live order-book snapshots and multi-window continuity. A successful public REST check is NOT proof of WebSocket connectivity.
- [ ] If both WS hosts remain unreachable, investigate Cloudflare egress and service policy; assess secure separate relay only with authorization and data/license review.
- [ ] Review market-data storage/retention rights before scaling historical collection.

**Nonnegotiable:** No real trades, no V4 simulated entries, no secret exposure, no V3 source or V3 Durable Object modifications.

## Gate 3 — Modeling
- [ ] **Settlement model:** time, target, official-reference distance, intrawindow volatility, and final-minute accumulated official average.
- [ ] **Resale model:** distribution of future executable bid under a specific exit policy, fees, latency, depth, losses and missed exits.
- [ ] **Reversal model:** 10/30/60s ETH acceleration/velocity, 1m/3m/5m structure, EMA/RSI/MACD with correlated signals deweighted; book and volume context.
- [ ] No hardcoded Kelly or OBI thresholds without validation.
- [ ] Shadow UP/DOWN/PASS with uncertainty and evidence, no simulated entries yet.
- [ ] Test official settlement probability calibration on out-of-sample windows; separate from early-sale forecasting.

## Gate 4 — Paper execution and V3 fixes
- [ ] V4 new independent $100 virtual account, all-in simulated entry maximum $3.
- [ ] Book-walk taker fills, conservative latency, partial/missed fills, correct fee schedule/quantity rounding, mark-to-bid and realized versus unsettled P&L.
- [ ] Repair exact -40% stop boundary, price-clock freshness and exit priority over slower Kraken calls.
- [ ] Compare adaptive early-sale targets with legacy 96c policy, including final-minute exception and stop timing.
- [ ] Retain hard drawdown protection; DO NOT automatically import V3's temporary -12% soft-guard bypass.
- [ ] Reconcile only Kalshi finalized results; no fabricated outcomes.

## Gate 5 — Independent validation
- [ ] Timestamp-aligned V3/V4 decisions on the same contracts, with coverage and fill-quality tags.
- [ ] Walk-forward/holdout tests, ablations and robustness to missing/stale feeds.
- [ ] Evaluate fee-adjusted expectancy, loss severity, drawdown, fill rate, calibration, passes, false reversals and missed opportunities.
- [ ] Do not optimize to the same 34 V3 trades and claim the model validated.

## Gate 6 — Controlled release
- [ ] Security review: no real-money capabilities, no leaked tokens, read-only gateway auth.
- [ ] Passing V3 and V4 tests, standalone Wrangler dry runs, correct DO migration and rollback.
- [ ] Separate user approval for V4 Worker and viewer Cloudflare deployment.
- [ ] Separate later approval to activate V4 paper entries after shadow observation.

## Known limits
V4's Worker, recorder, read-only shadow engine and tests have been deployed or built as indicated, but the private V4 viewer, authenticated live Kalshi WebSocket capture, official index access, predictive models, and realistic paper execution are not yet complete or validated. No trading edge is established. V3 remains the operational reference system.

## Prioritized build order
Isolation > timestamps/feed correctness > recorder > settlement arithmetic > bid/ask and execution correctness > forecast models > shadow validation > V4 paper performance.
