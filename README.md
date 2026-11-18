# ETH-15 Scout

Free, responsive, **paper-only** signal and simulated trading dashboard for Kalshi's ETH 15-minute UP/DOWN markets.

## Features

- Reads public Kalshi `KXETH15M` data through a read-only Cloudflare Worker; no trading account authorization, account credentials, or order execution.
- Displays active contract, target, displayed UP/DOWN prices, countdown, and indicative taker-fee break-even calculations.
- Uses Kraken public ETH/USD ticker plus 5-minute and 1-minute OHLC data for moving averages, RSI, MACD, volume-weighted-price approximations, and momentum/reversal evidence. **Kraken ETH/USD is not Kalshi's official CF Benchmarks settlement index.**
- **Auto paper trader**: when the user arms it, it may simulate UP or DOWN purchases on reversal or momentum setups. **There is no hard contract-price ceiling**; inexpensive and higher-priced contracts may qualify.
- Estimates simulated purchase at the quoted ask and a simulated early sale at the quoted bid, with estimated general taker fees. Displays **PAPER BUY UP/DOWN** only after an entry has been saved, and **PAPER SOLD** after an early simulated exit.
- Two distinct, synthesized, non-copyrighted sound cues for simulated entry and early sale. Use the **Trade sounds ON/OFF** control. Arm the bot with a click to unlock browser audio, and allow browser/tab sound. Audio cannot be guaranteed when the tab is throttled, muted, closed, or the device sleeps.
- Auto-saves **every paper BUY, SELL, win/loss, PASS, pending settlement, and simulated cash balance** on the current device. Reloading the page is designed to restore the journal and keep trading PAUSED until the user re-arms it. Uses existing localStorage history (no migration loss) plus a secondary IndexedDB browser copy where supported.
- **Export history backup** creates a portable JSON file. **Restore history backup** imports a valid saved JSON file, after confirming replacement of current records. **Show older activity** displays earlier entries without erasing them. Keep periodic exports: browser storage can be cleared or evicted, particularly in private/in-app browsers, and there is no server-side account backup.
- Completed paper outcomes can increase required technical confirmations when recent results are unfavorable. This is **basic adaptive filtering, not a calibrated predictive model**.
- A separate manual-position tracker lets you input your own actual purchases without account access. The bot does not know your real positions.
- Save and export paper-trading history as JSON. Browser storage may be deleted by the user, device, or browser privacy settings; export JSON periodically.

## Running the app

GitHub Pages: **Settings → Pages → Deploy from a branch → main → /(root)**.

The read-only Kalshi Worker URL is:

`https://eth-15-scout-api.leoseazon.workers.dev`

On the site, press **Start monitoring**, then **Arm paper trading**. The arm state intentionally resets to paused after a page reload. The bot **is not a background service**; updates depend on the website remaining open/awake and usable network access.

A simulated position may be sold early by the bot when its quoted exit price passes an exit rule. If it survives to settlement, it is marked **PENDING**; the user must enter Kalshi's official result. Do not infer settlement from Kraken spot.

## Important limitations

**Experimental educational tool, not investment advice and not a broker/exchange trading agent.** Signals, simulated fills, prices, spreads, fees, liquidity checks, and P/L are estimates, not actual execution. The trading rules have not been statistically backtested or proven to deliver positive expected value. A low contract price is not evidence of mispricing. The app does not place real trades, predict actual settlement, or run after the webpage is closed. Browser/API restrictions, data freshness, market transitions, and market liquidity can prevent entries or exits.

### Testing

The buy/sell display, position accounting, fee arithmetic, sound triggers and mute control, UP/DOWN quote-size mapping, PASS accounting, and higher-priced candidate selection have been exercised with **mocked JavaScript scenarios**. This is not equivalent to full real-browser/end-to-end or live-market validation.

This repository contains no Kalshi login credentials or personal account data.
