# ETH-15 Scout V4 — prospective shadow observer integration

**STATUS: DRAFT, staged for review, NOT deployed. No existing paper decision is changed.**
**Engine baseline:** deployed Cloudflare paper Worker source commit
`9f354288c21ca80a6b2f5de888b0817bd5318da3` (5m Kraken caching).
**Controlling model:** `V4-TARGET-CONTEXTUAL-VALUE-20261122`.
**Experimental parameters:** `V4-SHADOW-PREREG-20261122-v1`. Frozen values taken
unchanged from `v4-research-shadow-prereg-20261122`; *nothing was tuned against
the already examined performance outcomes*.

## Why now?
Two post-Kraken-upgrade audits showed the bot evaluates markets consistently but
rejects most for `NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK`. The retained
5-second authenticated Kalshi book freshness gate and occasional Kraken API rate
limits still limit qualified decisions. A historical 50–87-cent subset was
selected after seeing outcomes, so cannot establish edge. Therefore test
alternative policies prospectively while keeping baseline BUY/SELL/PASS unchanged.

## Implementation boundary
- The V4 **original** `settlementFirstPaperStep` completes FIRST and is not modified.
- `observeProspectiveShadow()` is a pure read-only function called afterward.
  It uses the SAME tick's already fetched official ETHUSD_RTI index, Kraken
  1m/3m/5m closed structure, current connected authenticated Kalshi book,
  existing baseline WATCH and per-side rejection evidence, and daily risk mode.
- **No external requests** are made for either alternative; no new WebSockets,
  Cloudflare credentials, delayed market history, settlement outcomes, database
  tables, bank debits, orders, or additional storage writes.
- Shadow observations are included as
  `researchTicks[].shadowProbe.prospectiveShadow` in the existing append-only
  research tick JSON only when this experimental engine branch is deployed.
  They do **not** appear on the current dashboard until the owner separately
  authorizes and validates a paper-only Cloudflare engine deployment.
- The observer requires `NORMAL` daily risk state and no already-entered ticker,
  fresh correct market, authenticated WS book within **5s**, fresh official
  index within **15s**, and EXACT latest closed 1m/3m/5m candle evidence.
  All requirements must hold independently; a REST depth sample never suffices.
  Each side must have passed upstream price/depth/fee gates and failed the
  conservative risk-adjusted value gate specifically.
- The observer returns `executionAuthorized:false`, `readOnly:true`, and
  `calibratedProbability:null` regardless of results.
- Research errors are caught and cannot suppress or reverse a baseline BUY/SELL
  or account for an unverified fill.

## Candidate A — A_STRESS_RELAXED
Requires the central scenario to clear the current fee-inclusive break-even +
baseline edge requirement + **2 percentage points**, but permits stressed
(lower) scenario edge as low as **−7.5 percentage points**. At most 5-cent
spread, existing 87-cent ask ceiling and clock/time/risk constraints.

## Candidate B — B_EXECUTION_FILTERED
Requires central scenario to clear fee-inclusive break-even + baseline edge +
**4 percentage points**, permits stressed edge as low as **−10 points**,
enforces tighter 2-cent spread, no sub-20-cent asks and more than 150 seconds
remaining. This was NOT selected by matching past winning outcomes.

### First-per-ticker and outcome protocol (still to be implemented and verified)
The observer emits raw *per-tick research proposals*, not an actual proposed
order log. A **separate chronology-first scorer** must choose the earliest
qualified signal per ticker AND policy, before joining settlement labels.
A "candidate" is NOT a fill. Any hypothetical P&L must include all fees,
latency, depth, slippage assumptions and exits. Report forecast accuracy,
calibration where applicable and net outcome separately. A single 45-minute
test is a functionality/reliability sample, not a statistical guarantee.

## Validation so far
- 10 original preregistered shadow policy unit tests **pass**.
- 14 new observer tests **pass**, including stale/disconnected/mismatched/crossed
  WebSocket books, Kraken 1m/5m failures, incomplete 3m/5m structure, invalid
  official index, outside-clock situations, SOFT/HARD risk, duplicate ticker,
  zero execution authorization and immutable source inputs.
- **24/24 relevant source-based tests pass in isolated JS.**
- Full repository CI, Cloudflare dry-run, independent runtime behavior and
  paper accounting/settlement regression: **not yet verified for this branch**.
- NO new paper trading rules and NO shadow code deployed to the live Worker.

## Parallel completed website feature
A separate read-only `Feed Investigation` panel was published on `main`
via PR #14. It holds at most 180 distinct sampled engine ticks in browser
memory from existing 15s authenticated status refreshes and can export
sanitized observed feed reasons. It is not a continuous Cloudflare server log
and must not be mistaken for such.

## Release decision
For future **owner-authorized** paper Worker deployment only:
1. Verify PR contains just the frozen observer, bridge, tests and minimal
   post-baseline journal integration; no change to `settlement-first-paper.js`,
   `context-opportunity.js`, existing fees/caps/stops or Durable Object binding.
2. Complete full CI and Wrangler dry-run; compare actual release source to
   currently deployed baseline and confirm exact SHA and variables.
3. Inspect 3+ completely observed 15-minute rounds post-release to verify
   stream of shadow records, original paper ledger, unchanged baseline entry
   decisions and sources. Prefer 100+ resolved eligible rounds across regimes
   for initial inference. If any invariant fails, revert to the verified paper
   baseline. Never activate a new BUY policy without subsequent review.
