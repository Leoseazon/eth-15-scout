# ETH-15 Scout V4 — Master development plan
**Created:** 2026-11-21 · **Status:** Foundation development · **Paper/shadow only**

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
- [ ] Run all existing V3 tests, V4 tests, dry-run builds and branch diff checks.
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
V4 branch creation does **not** mean V4 recorder, live WebSocket, pricing models, dashboard, or tests are complete. No trading edge is established. The current V3 remains the operational reference system.

## Prioritized build order
Isolation > timestamps/feed correctness > recorder > settlement arithmetic > bid/ask and execution correctness > forecast models > shadow validation > V4 paper performance.
