# ETH-15 Scout V4 — Opportunity-accountability philosophy (read-only)

**Scope:** V4 paper research and dashboard presentation only. This policy is
an evaluation framework, **not an instruction to the live trading engine**.
The V4 BUY/SELL rules, fees, risk limits, execution simulation, official-index
requirements, one-entry-per-round rule and settlement accounting are unchanged.

## The two errors worth measuring

1. **Taking unattractive paper trades:** Entering despite inadequate evidence,
   unfavorable all-in ask/fee economics, stale official data or unacceptable
   risk. The existing V4 conservative value checks and hard safety limits
   remain binding.
2. **Rejecting potentially attractive opportunities:** Repeatedly skipping
   eligible, contemporaneously attractive positions due to overly strict
   thresholds, incomplete observations or implementation problems. Such claims
   need an actual historical replay; a later winning Kalshi outcome alone is
   not proof that the earlier contract ask was cheap, available or executable.

The objective is to **maximize credible long-run, fee-adjusted paper value
while controlling downside**, not to maximize how often the bot buys or its
raw win percentage. A profitable or 100%-win-rate sample gives no reason to
stop accepting independently qualified opportunities. A zero-entry hour is
neither automatically a good nor a bad result.

## Current read-only observables

- Final ROUND PASS counts derive only from V4's persisted one-per-contract
  PASS decisions. Temporary WATCH / PASS-WATCH messages do not count.
- The Opportunity Review computes consecutive PASSes only when the most
  recent completed 15-minute slots have adjacent final PASS records within
  two minutes of scheduled close. A 45-second stabilization delay avoids
  reporting the just-completed round before the Worker can finalize it.
  Missing/delayed logs are **unknown**, never inferred as completed PASSes.
- **Four verified consecutive passes** (approximately one hour) create an
  **amber research flag**. The flag **cannot** open a trade, adjust limits,
  override the hard daily risk stop or cause more API requests.
- Time since last BUY uses already loaded authenticated V4 trade, event,
  open-position and pending-position timestamps. If none are available, the
  widget says that the time is not established from recent history.
- The most recent final PASS reason is the **last logged blocker**, not a
  causal audit of every evaluation in that round. It may be a final-minute
  timing restriction even if earlier BUY opportunities were rejected for
  different reasons.
- Official outcome coverage only establishes that Kalshi reported a finalized
  UP/DOWN result for a skipped market. **It cannot establish missed profit,
  probability of winning, quoted liquidity, executable fills or edge.**

## Evidence necessary before claiming a missed opportunity

An audit should align the same ticker and timestamp for: official Kalshi
target and up-to-date ETHUSD_RTI index; closed Kraken candles; authenticated
Kalshi displayed bid/ask and depth; applicable fee and bankroll; entry and
risk clock; recorded decision and last blocker; available opportunity model
state; and eventual official outcome. Preserve missing data as missing. An
offered displayed ask still does **not** verify a real fill.

After the 72-hour collection, compare WIN, LOSS, final ROUND PASS, and
unobserved/data-incomplete rounds separately. Review both false-positive
entries and credible false-negative missed opportunities by fee-adjusted
economics, not hindsight direction alone.

**Rule:** Opportunity Review is a diagnostic observer. Never turn four passes,
elapsed idle time, paper win rate, or hypothetical missed profit into a BUY
trigger without a separate, audited strategy change explicitly authorized by
the user.
