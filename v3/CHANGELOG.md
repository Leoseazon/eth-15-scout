# ETH-15 Scout V3 — Permanent Change Log

**Living record. Append an entry for EVERY future design, code, strategy, data, security or deployment change. Do not erase past entries or confuse code commits with a live Cloudflare deployment.**

Reference design: [DESIGN REFERENCE.md](./DESIGN%20REFERENCE.md).

## 2026-11-19 ~11:40 PM CST — Pre-release audit, frozen observation sample and latency improvements

- **Time classification:** User supplied approximately **11:40 PM Central, November 19, 2026** as the *editing/change reference*, not live deployment. Updated Cloudflare bot writes a **one-time immutable first-engine-tick marker** in `release_markers` at its actual first live tick. The site labels and counts only confirmed paper exits whose **entry** began on/after this live marker for the next 50–100-trade sample. See [OBSERVATION PROTOCOL.md](./OBSERVATION%20PROTOCOL.md).
- **Appearance audit / published frontend:** Reordered page to put the actual Kalshi contract identifier, precise strike, current UP and DOWN asks and bids and quote-refresh age **inside the first bot-activity panel**, paper performance/cash/fee-adjusted realized P/L/open and pending exposure **second**, system metrics, Kraken chart, indicator hierarchy, risk and append-only journal afterward. Reconciles unsettled stake when the pending journal is available. Responsive night colors retained, duplicate DOM IDs and missing linked labels checked, unauthenticated account content explicitly hidden.
- **No fabricated live quotes:** The read-only gateway calls Kalshi public **Get Market** for the bot's validated current contract; displays exchange YES/NO bid/ask without price interpolation. Hides stale/expired/mismatched prices and labels when feed is unavailable. Kalshi REST is cached; display observation time is not an exchange tick timestamp. The V3 strategy's quote proxy remains separate.
- **Latency:** Data engine schedule prepared for 15-second nonoverlapping polling vs 30 seconds, and Kraken one-minute candles are fetched concurrently with 5-minute candles, Kalshi proxy and Kraken spot. Paper decisions are recorded before slower archival settlement scanning. Chart reuses engine candles. No promise of millisecond/streaming execution; WebSocket would be a separate future development.
- **Audit testing:** Added `v3/test-layout.mjs` (screen order, all IDs, privacy, stale quotes, observation marker and mobile styles) and cloud tests for exact Kalshi market prices, outcome confirmation and malicious ticker rejection. CI workflows include the layout test.
- **Hold period:** Preserve current paper risk controls, trade selection, $100 original simulated bankroll, separate V2, Durable Object, historical trades and credentials. Do not retune for 50–100 post-release completed trades except for verified safety/correctness. Do not confuse a website GitHub Pages deployment with a Cloudflare bot release.
- **Cloudflare release:** **NOT YET CONFIRMED** as of this code/change log entry. Owner must execute `cloud/deploy-v3-complete.ps1` and verify running V3 paper state and log.

## 2026-11-19 CT — Highest-priority live trade panel, dependable chart and official 15-minute results

- **What (published frontend):** Added a top-of-dashboard V3 PAPER BOT ACTIVITY hero ahead of account metrics and ETH chart. Shows current action, live/stale indicator, actual open simulated position and UP/DOWN side, quantity, entry/stake, estimated open P&L, market close countdown and latest saved paper transaction. Added the permanent **Official Kalshi 15-Minute Market Outcomes** timeline showing window-end Central Time, confirmed UP/DOWN result, associated paper-trading activity, and pending/unconfirmed status.
- **Why:** Current paper trading decisions matter most to the person watching Kalshi; the historical audit needs to cover *every exchange window*, not just those V3 traded.
- **What (backend prepared):** Reuse the V3 engine's successfully fetched Kraken 1m/3m/5m candles and quote snapshots to populate the chart; fallback market calls are independent, so a missing Kalshi quote or 1m request cannot blank a healthy 5m chart. Save Kalshi public settled YES/NO results, as UP/DOWN, for all KXETH15M contracts in the 48-hour rolling API scan, with the result permanently stored in the existing Durable Object. Older history, trade journal and official window outcomes are paginated and exported to JSON. No new real-money trading capability, no changes to trade selection or risk rules.
- **Tests:** Frontend syntax/audio workflow and GitHub Pages deployment checked. Cloud engine and official outcome parser tests added, with Wrangler dry-run checks.
- **Deployment:** **STATIC WEBSITE PUBLISHED.** Running Cloudflare V3 engine and viewer have NOT YET received this new backend build. Use the one-command safe release `cloud/deploy-v3-complete.ps1` from `v3-dashboard-gateway-20261119`, then verify live feed, original balance, paper arm state, chart, archived journal and Kalshi official outcomes. The temporary release config keeps `SCOUT_PAPER_MODE=enabled`; the tracked default remains disabled. Never reset the Durable Object.

## 2026-11-19 CT — Permanent username/password login instead of a viewer key

- **What:** Replaced the V3 public page's manual viewing-key prompt with a private username/password sign-in form, a 30-day **Remember this device** option, a Sign out control and token restoration after normal page refresh. Credentials are never stored in website files, browser storage or Git. Only an expiring read-only signed session is remembered.
- **Cloud gateway:** Added encrypted-secrets verification, HMAC-SHA256 signed sessions, login attempts limited with a Cloudflare rate-limit binding, method/origin validation and tests for expired/tampered sessions. Updated the one-time local PowerShell setup script to ask privately for the owner's chosen credentials and generate its session-signing secret.
- **Why:** Owner alone uses the V3 dashboard and wants one consistent personal login without re-entering a changing key after every refresh. The username and password remain fixed until the owner chooses to change them. Saved browser sessions expire after 30 days, at which point the *same* credentials work.
- **Validation:** Frontend JavaScript checks and username/password gateway tests passed in GitHub Actions, including malformed/expired session rejection and authenticated journal access.
- **Deployment:** Updated **static V3 login website published via GitHub Pages** after its build; Cloudflare login gateway **still requires the one-time secret setup and deployment**. No changes were deployed to the V3 paper-trading engine or Durable Object trading history. Its records remain intact.

## 2026-11-19 CT — Reusable deployment script and assistant continuity rules

- **What:** Added a safe cloud/deploy-viewer.ps1 script on development branch v3-dashboard-gateway-20261119, which deploys only the separate read-only V3 viewer and creates a private viewing key locally in Windows PowerShell; added repository-wide [AGENTS.md](../AGENTS.md) to require reuse of the approved design and a log entry on every future change.
- **Why:** Faster setup, no accidental V2/V3 Worker replacement, no need to rebuild the website design and consistent historical documentation.
- **Tests:** [Gateway test and dry-run validation](https://github.com/Leoseazon/eth-15-scout/actions/runs/44674702503) passed.
- **Deployment:** Script committed and tested in development; **Cloudflare viewer still not deployed**. V3 live bot and stored records unchanged.

## 2026-11-19 CT — Read-only V3 viewer gateway audit

- **What:** Corrected the journal page-number validation; added an authenticated read-only pagination regression test and opened [Gateway PR #3](https://github.com/Leoseazon/eth-15-scout/pull/3).
- **Why:** Ensure the future dashboard can retrieve a consistent full research journal while blocking malformed requests, unauthorized access and write/control endpoints.
- **Tests:** GitHub Actions [viewer and cloud validation run](https://github.com/Leoseazon/eth-15-scout/actions/runs/44674462628) passed, including V3 bot tests, gateway tests and separate Cloudflare dry-run builds.
- **Deployment:** **Code reviewed/tested only.** Viewer Worker and new journal endpoint are NOT yet deployed. Existing V3 paper bot/data unchanged.

## 2026-11-19 CT — Canonical design and lasting update history

- **What:** Created the permanent V3 design specification and this persistent change log in the GitHub repository.
- **Why:** Future work should build on the existing professional, night-friendly website rather than generating a different design. Every modification must be traceable.
- **Tests:** Documentation-only; verified existing source files are versioned and GitHub Pages/dashboard CI completed successfully.
- **Deployment:** Documentation saved on main. Existing trading bot and Cloudflare settings not touched.

## 2026-11-19 CT — Distinct PAPER BUY/PAPER SELL audio

- **What:** Optional, softly ascending three-note paper BUY and softly descending three-note paper SELL, manual toggle, previews and mute; no autoplay and no historical alert replay. Added regression tests.
- **Why:** A person watching real Kalshi can immediately recognize new simulated actions without watching the screen continuously.
- **Tests:** Validate V3 dashboard and paper-trade audio GitHub Actions succeeded; GitHub Pages build succeeded.
- **Deployment:** Static V3 UI published. Actual live trade sound notifications require a connected read-only V3 gateway and enabled browser audio.

## 2026-11-19 CT — Permanent paper-trade research journal

- **What:** Added development-branch read-only V3 endpoint for anchored, paginated history from SQLite events, decisions and completed trades, with pending positions explicitly marked unconfirmed. Added viewer gateway pagination and website controls for older events, full JSON research export and CSV trade export.
- **Why:** A complete, consistent record is necessary for studying entry/exit patterns, risk, simulated fees, WATCH and PASS behavior. Do not silently cut off the archive at 100 records or lose records upon browser closure.
- **Tests:** Code written on v3-dashboard-gateway-20261119 development branch; full Cloudflare integration and historical export remain to be validated.
- **Deployment:** The persistent SQLite tables already exist in running V3; the NEW journal endpoint and the NEW viewer gateway are NOT YET deployed to Cloudflare. A published frontend alone cannot access these new endpoints.
- **Protection:** Future deployments must preserve existing Durable Object state and previous paper history. Do not report pending settlements as confirmed P&L.

## 2026-11-19 CT — Professional low-glare V3 website

- **What:** Published separate /v3/ site at https://leoseazon.github.io/eth-15-scout/v3/ using existing index.html, style.css and app.js. Responsive slate/navy design with market chart, live status placeholders, ranked technical indicator reference, paper account, risk mode, decision feed, read-only key entry and manual refresh.
- **Why:** Finished-product style for a viewer using simulated bot entries to decide whether to place manual Kalshi bets.
- **Tests:** GitHub Pages build succeeded. No new trading controls added.
- **Deployment:** Static HTML/CSS/JS site published. The private live-data connection still depends on deploying the separate viewer gateway; until then, screen must show connection/empty states, not fabricated trading data.

## 2026-11-19 CT — Isolated V3 bot running in Cloudflare

- **What:** User deployed eth-15-scout-cloud-v3test and configured SCOUT_PAPER_MODE=enabled for virtual entries only. Cloudflare Data Studio screenshots confirmed monitoring=1, armed=1, current ETH 15-minute ticker and null last_error. WATCH and PASS events appeared; no paper BUY/SELL recorded at that snapshot.
- **Rules:** Paper-only $100 test bankroll, $3 normal/$1.50 soft maximum entry, 12% soft/20% hard daily risk, 96-cent profit policy, 3m/5m structure, 1m triggers, Bollinger Bands, A/D, support/resistance and daily BTC/ETH context.
- **Deployment:** Bot already running; do NOT reset it. The older V2 bot/site are separate. Current tracked Wrangler V3 config has SCOUT_PAPER_MODE=disabled as a safe default, so an unreviewed redeploy could pause paper entries.

## Next steps — NOT YET completed

1. CI-check the new Cloudflare viewer gateway branch and read-only API.
2. Deploy eth-15-scout-v3-view as a separate Worker without changing the V3 trading script or its database.
3. Configure encrypted Cloudflare secrets `SCOUT_LOGIN_USER`, `SCOUT_LOGIN_PASSWORD` and `SCOUT_SESSION_SECRET` using the local `cloud/deploy-viewer.ps1` script; never commit or share credentials.
4. Safely release the journal endpoint to the existing V3 Worker while retaining the exact existing Durable Object binding, instance name, and paper trading mode.
5. Verify private V3 data, historical event pagination, accurate open/pending balances, exports, CORS/security, and sound alerts.
6. Record every actual deploy date, its tests, result and limitations in this file.

---

## Required template for every future update

### YYYY-MM-DD HH:MM CT — Concise change title

- **Area:**
- **What changed:**
- **Why:**
- **Tests and verification:**
- **Deployment status:** Code only / Static site published / Cloudflare deployed / Live V3 connection verified
- **Known limitations / next steps:**

**Rule:** Update this changelog in the SAME change as the files being modified. Preserve all previous entries.
