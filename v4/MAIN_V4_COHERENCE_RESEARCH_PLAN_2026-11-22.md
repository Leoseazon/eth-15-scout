# ETH-15 Scout V4 — MAIN strategy coherence upgrade (non-deployed)

**STATUS:** Research prototype only. No change to V4 deployed BUY, WATCH, HOLD,
SELL, bankroll, exits, data feeds, Cloudflare bindings or existing Shadows A/B/C.
**Exact pinned starting point:** `0067e9878120de85dc9f337cc757defe4009661e`
(Candidate C research deployment already running).

## What the user requested
Make the **main** V4 bot's technical indicators, target-price formulas,
entry value rules, safety checks, and exits work together consistently
**BEFORE** loosening additional main-bot entry rules, without interrupting
the already-running two-hour Candidate C forward observation.

## Source-based architectural audit
- **One actual decision path:** `settlement-first-paper.js` calls
  `evaluateSettlementFirst` in `settlement-first.js`. No vote by A/B/C.
- **Composite technical score:** target geometry 65%, grouped EMA/RSI/MACD
  momentum 22%, 3m/5m structural context 13%; generated with
  `calculateSettlementEvidence`. It is not an independent probability.
- **Actual selection:** `bestContextualOpportunity` tests UP and DOWN
  using `targetScenarioEnvelope`'s uncalibrated central/lower/upper
  scenarios and fee-inclusive Kalshi book value, selecting the strongest
  *qualified lower-scenario net* side. This can disagree with composite
  side. A disagreement is NOT necessarily a bug or unprofitable.
- **Repeated families:** RSI/EMA/MACD influence both the composite and
  the scenario drift; do **not** treat them as independent votes, and
  avoid stacking another rigid seven-out-of-seven gate.
- **Secondary structural code:** `structuralEntry` and
  `structuralExit` in `structure.js` are used in legacy V2/V3 but
  are NOT authoritative BUY/SELL gates in main V4; confirmed 3m/5m trends
  still affect scenario drift. Support/resistance, Bollinger and A/D
  context could explain bad reversal entries, but a blanket hard veto
  could also suppress legitimate value bets and must be tested.
- **Entry controls already coherent:** 14m to >90s entry clock, fresh
  authenticated Kalshi book <=5s, official ETHUSD_RTI <=15s,
  complete closed Kraken context, 87c absolute ask ceiling,
  price-band spread and risk hurdles, all-in $3 or lower budget,
  independent final conservative fee/depth check, one entry per market.
  Do not remove duplicate accounting safeguards.
- **Exit mismatch:** exits are largely 96c take-profit with >1m
  remaining, 40% contract-price stop in the final 6m (including
  final minute when triggered), else HOLD/official settlement. Declining
  technical conviction and legacy reversal signal are currently
  advisory rather than independent V4 exit orders.
- **Market regime:** ETH/BTC hourly regime is collected but is
  NOT a direct authority in the main V4 settlement-value decision.
  Avoid adding a binary risk-on/off veto without validation.

## New research prototype (created now, not imported by Worker)
`cloud/v4/src/main-coherence-research.js` includes:

1. `assessMainDecisionCoherence`: consumes the actual existing
   `evaluateSettlementFirst` result and the SAME tick's 3m/5m context.
   It labels the value-selected side versus technical-composite,
   current-target geometry, momentum, 3m and 5m directions. The
   `WATCH` regime can yield an **unqualified central-value ranking**
   ONLY for diagnostic comparison; it is emphatically **NOT a BUY**.
   The legacy structure gate is reported as `LEGACY_STRUCTURE_WOULD_VETO`
   or `SECONDARY_STRUCTURE_CAUTION` but cannot veto.
2. `assessMainHeldExitCoherence`: compares baseline actual 96c and
   40%/6m exit triggers with available technical and structural reversal
   evidence. It refuses to invent an early exit without a fresh, correct
   authenticated Kalshi BID and enough depth. It never sells.
3. `cloud/v4/tests/main-coherence-research.test.mjs`: tests source
   provenance, aligned vs conflicting sides, unqualified-vs-eligible
   value, no fake archived barrier evidence, price/clock exit behavior,
   missing WebSocket, no unauthorized account mutation.
4. `cloud/v4/tools/report-main-coherence.mjs`: analyzes an existing
   *saved* Decision Audit JSON **offline**, first comparable observation
   PER CONTRACT frozen before joining the official finalized outcome.
   It does NOT make Cloudflare/API requests or create a strategy backtest.
   `node cloud/v4/tools/report-main-coherence.mjs audit.json > result.json`

### Exploratory historical audit, NOT model training
From user-supplied
`ETH-15-Scout-V4-Decision-Audit-2026-11-23 (2).json`
(exported Nov 22, 2026 at 21:44:40 CST), analyzed without replaying fills:

- 3,084 contextual research evaluations had a technical composite score.
- 1,977 also had both sides' fee-inclusive *central* scenario data.
- In 796 / 1,977 **repeated observations**, ranking the two unqualified
  central scenario edges disagreed with the signed technical composite
  (40.3%). A repeated tick is NOT an independent trade or contract.
- Freeze the **first comparable** tick per contract: 74 unique contracts,
  24 directional disagreements, 73 subsequently finalized official
  outcomes. Among the 24 disagreements, composite side matched the official
  settlement on 14, and central-value ranking on 10. These are
  exploratory directional forecasts, **NOT executable buy outcomes**
  or an unbiased proof that the composite is superior. Selection of this
  analysis followed exposure to the data and cannot be used to set a new
  gate and claim validation.

## Proposed main V4 coherent decision contract, for future tests
1. **One primary choice:** fee-adjusted UP/DOWN settlement-value selection.
   Composite side is context for that choice, not another competing order.
2. **Explain disagreements, do not silently overwrite decisions.**
   Name separate target-side, momentum, 3m trend, 5m trend and technical
   composite tensions. Prefer transparent evidence to mystery vetoes.
3. **No extra vote counting:** treat correlated EMA/RSI/MACD as a
   single momentum family; do not automatically double-penalize the
   same candle information in both scenario and confidence layers.
4. **Structure is evidence:** run complete closed-candle support/resistance,
   Bollinger/A-D entry cautions only with full contemporaneous source,
   and initially compare their effectiveness without new hard blocks.
5. **Keep price-aware risk primary:** preserve fees, actual available depth,
   time-to-expiry, account caps, current premium gates, live source
   freshness and scenario stress requirements until separately proven.
6. **Exits are a separate timing problem:** study technical reversals
   against observed exit-bid paths and settlement outcomes; do not add an
   early SELL based only on indicator weakening or predicted direction.
7. **Separate decision confidence from chance of winning:** neither
   the 0-100 index nor Gaussian scenario values are calibrated odds.
   Do not optimize based on high scores without held-out outcomes.

## Validation required before any main strategy change
- Full unit/integration tests AND Wrangler paper-only dry run.
- Replay *first* eligible signals under original and any future proposed
  coherent policy using only as-of closed bars, official fresh index,
  same-tick authenticated book, conservative fee-inclusive cost.
- One clear decision reason at each step: `FEED_UNAVAILABLE`,
  `OUTSIDE_CLOCK`, `PRICE_ABOVE_CAP`, `INSUFFICIENT_VALUE`,
  `TECHNICAL_CONFLICT` (advisory initially), `RISK_STOP`,
  `PAPER_BUY`, `HOLD`, `PAPER_SELL`.
- Report independent resolved markets, correct side, actual paper
  net vs hypothetical HOLD net, max drawdown, profits/losses by ASK
  band and minutes-to-expiry. Correct forecasts are distinct from
  early paper-sale P&L.
- Compare one change at a time; pre-register thresholds before
  measuring forward market results. No hindsight recalibration.
- Start with isolated research-only observations; no merge/deploy into
  `eth-15-scout-cloud-v4test` without subsequent user authorization.

**Decision today:** Do not deploy. Keep Candidate C's two-hour cohort
unchanged and use its full decision audit as independent observation.
A unified evidence report is a necessary research foundation, NOT
evidence of a newly profitable trading strategy.
