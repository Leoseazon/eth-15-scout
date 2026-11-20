# Repository Development Rules — ETH-15 Scout

## Always preserve the existing V3 product

The user has approved the current professional, low-glare, dark navy/slate V3 paper-trading website. **Do not redesign, replace or rebuild it from scratch unless expressly requested.**

Before working on V3:
1. Read [v3/DESIGN REFERENCE.md](./v3/DESIGN%20REFERENCE.md) for canonical appearance, UX, paper-only product scope and source files.
2. Read [v3/CHANGELOG.md](./v3/CHANGELOG.md) for history, tests, release state and next steps.
3. Update existing v3/index.html, v3/style.css, v3/app.js and v3/sounds.js. Preserve user's customizations.
4. **Append a dated entry to v3/CHANGELOG.md during EVERY change** to frontend, cloud gateway, journal, strategy, audio, security or deployment. The entry must state why, what, test result and actual deployment status.
5. Do not mistake passing CI, a mockup or a static GitHub Pages build for verified live paper-bot connectivity.

## Immutable safety / continuity constraints

- ETH-15 Scout V3 is **paper only**; the user manually decides about real Kalshi bets. No live broker/Kalshi order placement or account credential integration.
- Never expose trading controls or Cloudflare secrets through the public website. The viewer gateway must be read-only and authenticated.
- Keep production V3 Durable Object identity **single-paper-scout**, existing stored event/trade/decision journal and bankroll intact. Do not reset, migrate to a new instance or wipe history on site updates.
- Show provisional/PENDING settlement separately from verified completed paper trades.
- Existing V2 site/Worker and the existing Kalshi market proxy are separate; do not overwrite without specific user direction.
- V3 paper-mode setting on the running Cloudflare Worker may differ from the checked-in Wrangler default. Do not accidentally disable it during a code rollout.
- Prefer strict data provenance, no fabricated prices or P&L, accessible dark styling, restrained motion, and distinct opt-in PAPER BUY and PAPER SELL sounds.

## Status

- V3 static website: https://leoseazon.github.io/eth-15-scout/v3/
- V3 viewer/journal gateway code under review: v3-dashboard-gateway-20261119 branch, [PR #3](https://github.com/Leoseazon/eth-15-scout/pull/3).
- Do **not** claim that live backend gateway is deployed without verifying Cloudflare activation and the read-only endpoint.
