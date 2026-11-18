# ETH-15 Scout

Free, responsive, **paper-only** monitoring dashboard for Kalshi's ETH 15-minute up/down markets.

## What it does

- Fetches public Kalshi `KXETH15M` contracts through a read-only Cloudflare Worker.
- Shows the published price-to-beat, UP/DOWN asking prices, scheduled close, countdown, and estimated general taker-fee break-even points when data is available.
- Fetches Kraken ETH/USD public ticker and 5-minute OHLC candles to calculate EMA 21/50, RSI 14, MACD, an OHLC-based volume-weighted-price approximation and nearby swing levels.
- Displays a **technical directional bias**, not a verified win probability. The trade decision remains **PASS** without an evidence-backed positive edge.
- Refreshes about every 30 seconds **while the dashboard tab is open and active**.
- Records locally saved paper snapshots (no actual orders or account linkage).

## Setup

The dashboard is a static HTML file. Publish with GitHub Pages: repository **Settings → Pages → Deploy from a branch → main → /(root) → Save**. Then visit the repository's GitHub Pages URL.

The Kalshi public-data Worker is preconfigured as:

`https://eth-15-scout-api.leoseazon.workers.dev`

If its HTTPS or API connection is not available, the dashboard must display an error or PASS—not fabricate an ETH contract or order. You can enter another authorized read-only `.workers.dev` endpoint in the Kalshi connection field.

## Limitations and safety

**Experimental educational tool; not investment advice or an automated order execution system.** No trading keys or credentials are needed. Kraken's spot quote is **not** the CF Benchmarks ETH index used to settle Kalshi contracts. The program does not independently verify future outcomes, execution liquidity, or statistical forecast accuracy. The published general fee formula is an estimate; actual Kalshi series fees, spreads, and fills may differ. Browser/API restrictions and stale data may prevent useful signals.

This repository does not include trading account credentials or personal data.