# ETH-15 Scout V3 — Permanent Design Reference

**Approved design.** This is the canonical visual and product specification. All future changes must refine the SAME existing website, not create a replacement design unless explicitly requested.

## Canonical source of truth

- Website: https://leoseazon.github.io/eth-15-scout/v3/
- Page layout: [index.html](./index.html)
- Dark theme, typography, colors, spacing, responsive rules: [style.css](./style.css)
- Live read-only data, indicators, chart, account, risk, activity and journal: [app.js](./app.js)
- Optional original simulated BUY and SELL sounds: [sounds.js](./sounds.js)
- Audio regression checks: [test-sounds.mjs](./test-sounds.mjs)
- Every historical change and release state: [CHANGELOG.md](./CHANGELOG.md)
- Read-only gateway under development: cloud/viewer-worker.js on branch v3-dashboard-gateway-20261119.
- The original visual mockup is named eth_15_scout_v3_trading_dashboard.png. This is **appearance reference only**, not live financial data. The actual code files are the authoritative design artifact.

## Product identity

ETH-15 Scout V3 is a **paper-only research dashboard** for Kalshi ETH 15-minute contracts. It continuously observes a simulated account but NEVER places real-money trades. The person viewing makes any actual Kalshi bet independently. The read-only website is not a bot control panel.

## Night-friendly visual system — retain on every revision

- Matte dark navy/slate, **not pure black and not bright white**.
- Core CSS colors: background #0b121e, cards #131e2c, raised card #172434, stroke #29394b, main text #e7edf3, secondary text #acb9c7, quiet text #8495a7.
- Mint #7bd2bb: positive/online/BUY; amber #e7c27a: WATCH/caution; subdued rose #e2a0a7: SELL/negative. No harsh flashing or aggressive gradients.
- Low-glare borders, softly rounded cards, organized spacing, system sans-serif, readable sizes and accessible focus states.
- Desktop and mobile responsive; reduced-motion preference supported. Keep the important trade decision, contract, time left and risk readable immediately.

## Permanent layout hierarchy

1. Header: V3 brand, PAPER ONLY label, overview/signals/activity/performance navigation, connection indicator, refresh button, optional sounds.
2. Status strip: monitoring, paper mode armed/paused, current market, daily risk mode, last engine tick and staleness.
3. ETH market: live Kraken **reference** price, 1/3/5-minute candles, EMA chart, actual Kalshi ticker/strike/asks/countdown, latest V3 decision.
4. Ranked signals: five-minute primary structure and support/resistance; three-minute swing confirmation; EMA 21/50 and VWAP; one-minute trigger context; secondary RSI/Bollinger/A-D and daily BTC/ETH regime. Weak indicators must not lead the bot decision.
5. Paper account: starting $100 bankroll, available virtual cash, net realized P&L, estimated open P&L, completed exits, win rate, open trade and pending/unsettled count.
6. Daily risk: 12% soft / 20% hard; max $3 normal and $1.50 soft paper entry; show the bot's real runtime risk state, not guesses.
7. Chronological persistent research journal: paper BUY, SELL, WATCH, final PASS, fees, reason, P&L and pending records; historical pagination, CSV trade export and JSON journal export.
8. Footer: simulated-only and not official Kalshi settlement pricing.

## Notifications

- PAPER BUY: subtle, pleasant **ascending** three-note cue.
- PAPER SELL: distinct subtle **descending** three-note cue.
- Off by default with clear toggle, previews and mute. Only genuine NEW paper events; never replay past history or sound on WATCH/PASS/refresh. Browser must be open and permit audio.

## Privacy and correctness rules

- Viewer is read-only, authenticated with a **single permanent username and password** configured as encrypted Cloudflare secrets. The server issues a signed, expiring session token; the password is **never saved in the site's JavaScript or web storage**. `Remember this device` saves only the read-only session token locally for up to 30 days and survives refresh/reopening; otherwise the session is tab-scoped. Re-signing in after expiration uses the **same unchanged credentials**. Users can sign out at any time. Never place credentials or signing secrets in GitHub, screenshots or chat.
- No real broker/Kalshi API credentials or order-submission functionality.
- Unavailable/stale indicators show unavailable, not invented numbers. Kraken spot is not official Kalshi settlement reference.
- Pending positions do not count as verified wins, final profit or settled outcomes.
- Preserve V3 production Durable Object and existing event/trade/decision history. Website changes must not reset it.

## Continuity and release rules

**Before every edit:** review THIS file and the latest entry in [CHANGELOG.md](./CHANGELOG.md).

**For every edit:** modify the existing V3 files; append a dated changelog entry stating precisely what changed, why, tests and deployment/verification status. Update tests for logic, journal, security and sound changes.

**After every edit:** distinguish (a) source code committed, (b) static site published, (c) Cloudflare gateway deployed and (d) live V3 data verified. Passing GitHub tests or seeing the design online does not prove the backend connection works.

Only a specific user request can authorize a new visual direction, replacing this design, deploying over the live engine or changing real-money restrictions.
