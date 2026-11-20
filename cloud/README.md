# ETH-15 Scout — Cloud V2 isolated deployment

**Status: IMPLEMENTATION STAGING, NOT DEPLOYED OR CONNECTED TO THE GITHUB PAGES DASHBOARD.**
This cloud project is *separate* from the existing public read-only Kalshi market proxy and from the browser-side V2 trader. Deploying does NOT replace either.

## Purpose and safety
- One Durable Object ID (\`single-paper-scout\`) serializes the central paper trading engine.
- Cloudflare Cron every minute bootstraps its Durable Object alarm; alarms request another tick about 30 seconds later, even if no browser is open. Alarms can be delayed.
- Workers fetch public Kalshi market data from the EXISTING Worker proxy plus Kraken public ticker / 1m / 5m feeds.
- Initial state: **monitoring on; paper entries disarmed**. There are NO real Kalshi orders, credentials or broker integrations.
- The originally defined **V2** entry window (2.5–12.5 minutes), 2%/$2 cap, fixed stop and take-profit are preserved. The user's V3 1.5-minute entry, 80-cent rule, 96-cent exit, $3 cap and WATCH-vs-final-PASS rules are NOT yet enabled.
- The cloud journal starts **empty**. The 24-trade historical browser journal is NOT sent to GitHub or automatically imported. Import/deduplication is a separate checklist item.
- SQLite stores the trade, pass and event rows; the active position, paper bankroll, blocked current-market tickers, alarm state and pause/arm state are durable.
- No authentication secrets or exported private paper history are stored in the public repo.

## Deployment (requires your Cloudflare account)
From inside the \`cloud/\` directory:

\`\`\`bash
npm install
npm run check
npx wrangler login
npx wrangler secret put SCOUT_ADMIN_TOKEN
npx wrangler deploy
\`\`\`

Set the secret to a **random, long token (at least 32 bytes)** when prompted. Never paste it into chat or GitHub. The new Worker name is \`eth-15-scout-cloud-v2\`, deliberately distinct from your existing \`eth-15-scout-api\`.

Cloudflare usually starts the first Cron within one minute of deployment. Polling continues server-side even with the tab closed, provided the Cloudflare account, upstream providers and available limits allow it.

### Test from a trusted terminal
\`\`\`bash
export SCOUT_URL="https://eth-15-scout-cloud-v2.YOUR-SUBDOMAIN.workers.dev"
export SCOUT_TOKEN="the-secret-you-set-locally"
curl "$SCOUT_URL/health"
curl -H "Authorization: Bearer $SCOUT_TOKEN" "$SCOUT_URL/v1/status"
curl -X POST -H "Authorization: Bearer $SCOUT_TOKEN" "$SCOUT_URL/v1/arm"
curl -X POST -H "Authorization: Bearer $SCOUT_TOKEN" "$SCOUT_URL/v1/pause"
\`\`\`

Use \`/v1/start\` to resume passive monitoring, \`/v1/stop\` to halt the monitor and disable entries, or \`/v1/history\` for recent ledger rows. **Do not arm while the browser V2 is also armed** or you will have two separate paper simulations; the cloud backend is not connected to the existing browser journal yet.

## Important
- Alarm scheduling is best-effort, not guaranteed sub-second execution. Network requests, broker quotes and settlement may fail or be delayed.
- The current V2 logic assumes fills at publicly displayed bid/ask, and 5-minute Kraken candles are a proxy, not the official Kalshi settlement index. Realistic fill modeling and official settlement reconciliation are later checklist items.
- The pending queue still requires manual settlement verification; adding reliable automatic settlement is another phase-1 checklist item. The legacy pending-count guard can eventually halt new entries if four positions expire without verified settlement.
- Keep paper trading **paused until** the service's health and parity testing has been completed.
- Deployment, security validation, monitoring reliability testing, journal migration and dashboard integration have NOT been performed in this PR.
