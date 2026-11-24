# V4 experimental early-loss protection — NOT DEPLOYED

**State:** Candidate source and tests only. Worker 1 MAIN and Worker 2 RESEARCH
remain unchanged in Cloudflare. This is not an instruction to turn the feature on.

## Why review the legacy stop

The current 40% contract-price stop is inactive until **six minutes or fewer**
remain. A bid can already be far below the threshold when the stop first fires.
On Nov 23 the first Opportunistic DOWN paper position bought at 20.0c and exited
at 3.1c (-84.5% from the entry quote), recording -$2.56 after simulated fees.

The dashboard postmortem reports **two observed stop exits, -$2.97 combined,
zero subsequent observed return-to-entry bids in its limited 30/60/120-second
windows, and zero correctly predicted official directions.** This is a tiny
and incomplete sample. It does **not** prove an earlier bid was available or
that the proposed algorithm would improve net results.

## Candidate rule (feature flag OFF)

New rule is evaluated **only for a held V4 paper position, with >6 minutes left**,
and only after the contract-price bid has fallen at least 40% below entry.
It requires contemporaneous evidence:
1. Current held-side bid/ask from a fresh, uncrossed authenticated Kalshi
   WebSocket book, with displayed bid capacity for the full simulated quantity
   and a spread <=8c. REST quotes and missing book depth never count.
2. Fresh, verified official ETHUSD_RTI **on the side of the strike adverse
   to the held position**, by >max($0.30, 0.25 x Kraken 1m SD).
3. Completed 3-minute Kraken structure explicitly opposing the position;
   5-minute trend must not explicitly support the original side; completed
   one-minute price/EMA, RSI and MACD must also be adverse.
4. Two observations with *different* fresh WebSocket book and official-index
   timestamps and at least 15 seconds apart (no more than 90 seconds).
   A single price spike, repeated sample or input-quality failure cannot sell.

The original final-six-minute 40% emergency stop is **unchanged**. The
96c displayed-bid exit before the final minute is **unchanged**.
The existing paper-only $3 size cap, journal, fees, official settlement
reconciliation, account state, quote-depth checks, and one-entry-per-round
control are **unchanged**. No additional HTTP/WebSocket calls or APIs are added.

## Source / authorization protections

- Only the new MAIN source references this helper.
- `confirmedEarlyExitEnabled` defaults to false in the paper step.
- The audited `cloud/wrangler.v4paper.toml` remains **byte-for-byte unchanged**.
  It does **not** contain `V4_CONFIRMED_EARLY_EXIT_ENABLED`; absent means OFF.
  A future, independently approved release must explicitly enable the flag.
- The fast held-position exit path does **not** authorize this candidate:
  it lacks the independent official RTI / completed Kraken evidence.
- The seven-control Worker and private viewer source are not edited.
- Do **not merge or deploy** this research change before independent replay,
  review, and explicit owner authorization.

## Evidence needed before any approval

A prospective *research-only* replay should compare baseline vs candidate
on time-aligned historical official RTI readings, completed 1m/3m/5m
candles, AND distinct authenticated market depth observations. Missing
records must stay missing; don't backfill from later prices or outcomes.
For each trade report whether the proposed confirmation happened before the
legacy stop, whether full displayed bid depth existed, quote-age and
spread, hypothetical fee-inclusive P&L, actual early-sale P&L, and official
settlement direction. Report false-stop rates and opportunity costs.
Do not infer order fills from displayed quotes or claim statistical
improvement from just the two stopped trades.

**Resume operational release checklist:** first complete the separate
read-only **Worker 2 post-deployment health check**, then preserve/review
MAIN journals after its first full BUY/SELL/settlement cycle. No new
Cloudflare deployment needed for these checks.
