# ETH-15 Scout V4 — Post-Kraken-deployment observation, November 22, 2026

**Evidence status:** user-supplied screenshots and 85.400s screen recording.
**Window observed:** approximately 5:06–5:08 PM **America/Chicago (CST)** on 2026-11-22.
**Purpose:** retain a distinct, time-bound post-deployment health incident for the subsequent 45-minute/three-complete-round review and development of a truthful Deployment Status panel.

## Primary artifacts supplied in the project conversation
- Screenshot `IMG_4160.png` (screen around 5:07 PM; website refresh `17:07:26 CT`), SHA-256 `fdd12e50a4b12528b36eb437a47c7dbe1b9892abf09c5d104fff505413993056`.
- Screenshot `IMG_4162.png` (screen around 5:08 PM; website refresh `17:08:18 CT`), SHA-256 `58485571264d728a86c2d083527ee8853785217a521e8dbd17d463373f456be8`.
- Screen recording `ScreenRecording_11-22-2026 17-06-48_1.mp4`, 85.400 seconds, SHA-256 `1bb49165a42a7646c51229bb22d24adb65a4f5df431321bec684aecc11029cc5`.
- These filenames/hashes identify the user's **conversation uploads**. The media bytes are **not duplicated in this repository**; retrieve from the original conversation when available.

## What is directly observable
- At about 5:07:26 PM CT, page displayed `System issue detected` with headline **`Kraken 5-minute candles was rate-limited or is cooling down`**, plus two further diagnostics.
- At about 5:08:18 PM CT, the alert persisted. Expanded `Diagnose issue` section included:
  1. `ENGINE ERROR`: `Kraken 5-minute candles was rate-limited or is cooling down. New paper BUYs require valid feeds. Inspect feed checks and Worker logs; Kalshi-book protective exits remain separate.`
  2. `FEED kraken5m`: `Kraken 5-minute candles feed failed validation. Inspect source freshness and V4 feed logs.`
  3. `CHART REFERENCE`: `Dashboard chart reference is temporarily unavailable. Check Kraken chart requests; verify trading data independently.`
- The dashboard still displayed `System monitoring: Online`, `Paper simulation: Enabled`, `Daily risk mode: Normal`, and `Contextual V4 engine version verified · paper enabled`.
- During screenshot capture the last reported engine tick was approximately 7–28 seconds old, so the monitoring loop was reporting. This does **not** imply all required entry feeds were healthy.
- The screen recording reportedly included an earlier `No detected system issues` state, followed by the Kraken issue; verification should use the original frames/logs when needed.

## What this proves and what it does not
- **PROVES:** at least one **post-deployment** 5m Kraken cooldown/rate-limit or feed-validation interruption was visible around 17:07–17:08 CT. The new 1m closed-bar cache did **not** eliminate all 5m issues.
- **DOES NOT PROVE:** that the new Kraken release was ineffective overall, that the rate limit affected every 15m round, or that a specific profitable BUY was missed.
- **DOES NOT PROVE:** source of rate limit (same provider quota, hidden additional callers, provider outage, cached 5m rollover, etc.). The chart warning may be secondary to missing 5m data; investigate from feedChecks and exact tick evidence.
- The updated Worker deployment succeeded with version ID `7c1fcef3-ab3b-4234-9d49-fee2ab8ad163` in earlier user screenshots; the dashboard's model-version marker alone cannot independently attest to this specific Cloudflare version.

## Mandatory follow-up after three completed 15m rounds
1. Export **Decision audit JSON** from the V4 dashboard and identify exact deployment-time boundary before any before/after claims.
2. Count rate-limit/cooldown events and failed/successful kraken1m/kraken5m checks per eligible tick, and compare against the previous 6,551-tick audit using consistent denominators.
3. Separate engine heartbeat, chart-reference errors, official RTI freshness, authenticated book freshness, and Kraken-context validity. Report reasons BUY was blocked on each tick without counting repeated ticks as distinct markets.
4. Check if repeated 5m calls are caused by 5-minute rollover, 60s cache TTL, expiry of latest closed candle, other Kraken clients, or an actual provider response `EGeneral:Too many requests`.
5. In the planned **Deployment Status** panel, surface **real** latest engine release ID/deploy timestamp only from authoritative release metadata, latest successful tick, Kraken 1m/5m feed health and source age; do not mistake original contextual activation marker for latest deployment.
6. Preserve paper history and current entry/exit safeguards. No unsanctioned release, engine rule edit, or storage deletion.

## Interpretation
This is a **runtime reliability incident during observation**, not a regression-test simulation and not evidence of the engine being entirely offline. The relevant immediate investigation is Kraken 5m feed health and its rate-limit/cooldown timing, followed by controlled prospective shadow-rule comparison only after data validity is demonstrated.
