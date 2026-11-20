# ETH-15 Scout V3 — Permanent Change Log

**Living record. Append an entry for EVERY future design, code, strategy, data, security or deployment change. Do not erase past entries or confuse code commits with a live Cloudflare deployment.**

Reference design: [DESIGN REFERENCE.md](./DESIGN%20REFERENCE.md).

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
3. Configure its encrypted VIEW_TOKEN secret through Cloudflare; never commit the secret.
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
