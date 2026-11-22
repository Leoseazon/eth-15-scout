# ETH-15 Scout V4 — Exhaustive 1–99¢ ASK decision and SELL rule audit
**Research record, 22 November 2026. NOT a Cloudflare deployment authorization.**
Source: V4 research branch `v4-research-sources-20261121`, `cloud/v4/src/settlement-first.js` and `settlement-first-paper.js`, inspected during audit. The user-approved **hard maximum BUY ASK is 87¢**. All rows refer to **actual selected UP or DOWN displayed ASK**; never confuse ASK with BID, contract trading price with ETH index, or scored confidence with probability.

## Exact currently implemented V4 research-paper BUY logic (not V3)
**Lifecycle:** When V4 experimental paper mode is explicitly enabled and monitoring is armed, check existing position and exits FIRST. Otherwise validate the actual KXETH15M ticker and matching `floor_strike` and closing timestamp; require **90 seconds < time remaining <= 750 seconds**. Check an authenticated `ETHUSD_RTI` official latest value with verified validity and source timestamp within 15 seconds, closed Kraken 1m/derived 3m/closed 5m numeric studies, and correct ticker, sequence-healthy authenticated Kalshi order book no older than 5 seconds. No REST-only book can simulate fills.

**Directional model:** `delta = verified ETHUSD_RTI latest - official market target`; `expectedMove = max(0.30, standard deviation of 30 completed Kraken 1m price changes × sqrt(minutes remaining))`; `geometry=tanh(clamp(delta/expectedMove,-5,5)/1.5)`. One momentum family combines 1m last vs EMA8, EMA8 vs EMA21, RSI9, MACD minus signal, and last-three-minute price change. Structure context uses recognized 3m and 5m trend states plus 5m EMA21/EMA50/RSI14 orientation. Composite `0.65*geometry + 0.22*momentum + 0.13*structure`. UP if positive, DOWN otherwise. Count independent supporting geometry/momentum/structure families at strength >=0.15. Below/equal 85c, contradicting signals are recorded but not always a veto. `score` is NOT calibrated winning probability. Recorded purchase/live 0–100 "confidence" is separate, display-only.

**Entry gates:** Current price-specific score/family/time matrix below; 87¢ absolute ASK ceiling. 85.01–87¢ requires score >=0.78 in direction, support from all 3 families, no contradictions, directed geometry >=0.30, momentum >=0.25, structure >=0.25, time <=5m and >90s, and spread <=3¢; 85¢ exactly requires score >=0.78, >=2 families, time <=5m and >90s, general spread <=5¢. All remaining eligible prices require spread <=5¢, actual displayed two-sided quantity >= full paper order, positive ASK, valid BID <=ASK. WATCH/PASS continues the SAME round and preserves specific reason.

**Account controls:** $100 initial synthetic cash, ordinary risk percentage 3% of available paper cash capped at $3 *including simulated buy fee*. ASK <20c capped at $0.50 including fees. SOFT risk mode after daily modeled -$12 loss (latching on Chicago date) caps $1.50 and requires all 3 aligned families with geometry >=0.30, momentum >=0.25, structure >=0.25, score >=0.72, no contradiction, spread <=3¢ and at least 2× displayed book depth. HARD daily -$20 stops new entries. At most one buy per exact ticker, no averaging down; <=4 pending unresolved positions gate (stops new entries if 4+). Forecast record and synthetic cash debit are committed atomically. No real orders.

## Current V4 SELL / HOLD rules for an ALREADY OPEN simulated contract — apply to every original BUY price
1. Exit checks have priority over slow Kraken/index inputs and are based on fresh, authenticated exact-contract Kalshi **BID**, not the ASK. If no verified quote or inadequate bid depth, HOLD; no invented fill.
2. If **time remaining <=6 minutes** and observed held-side BID has declined at least **40% relative to original entry ASK**, PAPER SELL at displayed BID subject to depth. This emergency stop is checked first. No preceding standard stop exists in the settlement-first paper path.
3. Otherwise, if **BID >=96¢ and remaining >60 seconds**, PAPER SELL at observed BID, less synthetic exit fee.
4. If time remaining <=60 seconds, reaching 96¢ **does not automatically SELL**; paper position can hold to official result. Emergency stop still applies, based on fresh BID and actual shown depth.
5. After expiry, held positions are PENDING until the **official finalized Kalshi YES/NO** outcome; never infer winner from Kraken, current official index tick, mark P&L, or early resale. Each original prediction is graded on correct settlement side independently of early resale profit/loss. No second entry same market after exit.
6. A BUY confidence index can increase/decrease during HOLD but **never** triggers a SELL/BUY or overrides protective exits.

## One-contract mathematical price-by-price reference
A **single contract** settles at $1 if correct and $0 if wrong. The research table shows: modeled one-contract taker fee `ceil(0.07×price×(1-price)×100)/100` dollars, **rounded up to the next whole CENT per order**; fee-inclusive settlement break-even = ASK+fee; correct-side settlement net profit = $1−ASK−fee; maximum modeled loss to settlement = ASK+fee. **The actual fee is charged on the WHOLE order, not independently to each contract**, so multiple-contract break-even percentages can differ. Confirm the exchange's current KXETH15M fee type/multiplier and tick increment before deployment. The active simulator also models a separate SELL fee on early exits. A contract at 0.01¢ is $0.0001, below this whole-cent reference grid; validate exchange tick/quotes rather than rounding or treating as 1¢.

| ASK | Current BUY gate | Composite threshold | Supporting families | Entry clock | Max total new stake, fees included | Modeled buy fee, 1 contract | Settlement BE, 1 contract | Net on settle YES / loss if NO, 1 contract |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 2.0% | +98¢ / −2¢ |
| 2¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 3.0% | +97¢ / −3¢ |
| 3¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 4.0% | +96¢ / −4¢ |
| 4¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 5.0% | +95¢ / −5¢ |
| 5¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 6.0% | +94¢ / −6¢ |
| 6¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 7.0% | +93¢ / −7¢ |
| 7¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 8.0% | +92¢ / −8¢ |
| 8¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 9.0% | +91¢ / −9¢ |
| 9¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 10.0% | +90¢ / −10¢ |
| 10¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 11.0% | +89¢ / −11¢ |
| 11¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 12.0% | +88¢ / −12¢ |
| 12¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 13.0% | +87¢ / −13¢ |
| 13¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 14.0% | +86¢ / −14¢ |
| 14¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 15.0% | +85¢ / −15¢ |
| 15¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 16.0% | +84¢ / −16¢ |
| 16¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 17.0% | +83¢ / −17¢ |
| 17¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 1¢ | 18.0% | +82¢ / −18¢ |
| 18¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 2¢ | 20.0% | +80¢ / −20¢ |
| 19¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $0.50 | 2¢ | 21.0% | +79¢ / −21¢ |
| 20¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 22.0% | +78¢ / −22¢ |
| 21¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 23.0% | +77¢ / −23¢ |
| 22¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 24.0% | +76¢ / −24¢ |
| 23¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 25.0% | +75¢ / −25¢ |
| 24¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 26.0% | +74¢ / −26¢ |
| 25¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 27.0% | +73¢ / −27¢ |
| 26¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 28.0% | +72¢ / −28¢ |
| 27¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 29.0% | +71¢ / −29¢ |
| 28¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 30.0% | +70¢ / −30¢ |
| 29¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 31.0% | +69¢ / −31¢ |
| 30¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 32.0% | +68¢ / −32¢ |
| 31¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 33.0% | +67¢ / −33¢ |
| 32¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 34.0% | +66¢ / −34¢ |
| 33¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 35.0% | +65¢ / −35¢ |
| 34¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 36.0% | +64¢ / −36¢ |
| 35¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 37.0% | +63¢ / −37¢ |
| 36¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 38.0% | +62¢ / −38¢ |
| 37¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 39.0% | +61¢ / −39¢ |
| 38¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 40.0% | +60¢ / −40¢ |
| 39¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 41.0% | +59¢ / −41¢ |
| 40¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 42.0% | +58¢ / −42¢ |
| 41¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 43.0% | +57¢ / −43¢ |
| 42¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 44.0% | +56¢ / −44¢ |
| 43¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 45.0% | +55¢ / −45¢ |
| 44¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 46.0% | +54¢ / −46¢ |
| 45¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 47.0% | +53¢ / −47¢ |
| 46¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 48.0% | +52¢ / −48¢ |
| 47¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 49.0% | +51¢ / −49¢ |
| 48¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 50.0% | +50¢ / −50¢ |
| 49¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 51.0% | +49¢ / −51¢ |
| 50¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 52.0% | +48¢ / −52¢ |
| 51¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 53.0% | +47¢ / −53¢ |
| 52¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 54.0% | +46¢ / −54¢ |
| 53¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 55.0% | +45¢ / −55¢ |
| 54¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 56.0% | +44¢ / −56¢ |
| 55¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 57.0% | +43¢ / −57¢ |
| 56¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 58.0% | +42¢ / −58¢ |
| 57¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 59.0% | +41¢ / −59¢ |
| 58¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 60.0% | +40¢ / −60¢ |
| 59¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 61.0% | +39¢ / −61¢ |
| 60¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 62.0% | +38¢ / −62¢ |
| 61¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 63.0% | +37¢ / −63¢ |
| 62¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 64.0% | +36¢ / −64¢ |
| 63¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 65.0% | +35¢ / −65¢ |
| 64¢ | MAY BUY, conditional | >=0.43 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 66.0% | +34¢ / −66¢ |
| 65¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 67.0% | +33¢ / −67¢ |
| 66¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 68.0% | +32¢ / −68¢ |
| 67¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 69.0% | +31¢ / −69¢ |
| 68¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 70.0% | +30¢ / −70¢ |
| 69¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 71.0% | +29¢ / −71¢ |
| 70¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 72.0% | +28¢ / −72¢ |
| 71¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 73.0% | +27¢ / −73¢ |
| 72¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 74.0% | +26¢ / −74¢ |
| 73¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 75.0% | +25¢ / −75¢ |
| 74¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 76.0% | +24¢ / −76¢ |
| 75¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 77.0% | +23¢ / −77¢ |
| 76¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 78.0% | +22¢ / −78¢ |
| 77¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 79.0% | +21¢ / −79¢ |
| 78¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 80.0% | +20¢ / −80¢ |
| 79¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 81.0% | +19¢ / −81¢ |
| 80¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 82.0% | +18¢ / −82¢ |
| 81¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 83.0% | +17¢ / −83¢ |
| 82¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 2¢ | 84.0% | +16¢ / −84¢ |
| 83¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 1¢ | 84.0% | +16¢ / −84¢ |
| 84¢ | MAY BUY, stronger | >=0.62 | 2/3 | 1.5< t <=12.5m | $3 | 1¢ | 85.0% | +15¢ / −85¢ |
| 85¢ | MAY BUY, premium time | >=0.78 | 2/3 | 1.5< t <=5m | $3 | 1¢ | 86.0% | +14¢ / −86¢ |
| 86¢ | MAY BUY, exceptional | >=0.78 | 3/3 | 1.5< t <=5m | $3 | 1¢ | 87.0% | +13¢ / −87¢ |
| 87¢ | MAY BUY, exceptional | >=0.78 | 3/3 | 1.5< t <=5m | $3 | 1¢ | 88.0% | +12¢ / −88¢ |
| 88¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 89.0% | +11¢ / −89¢ |
| 89¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 90.0% | +10¢ / −90¢ |
| 90¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 91.0% | +9¢ / −91¢ |
| 91¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 92.0% | +8¢ / −92¢ |
| 92¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 93.0% | +7¢ / −93¢ |
| 93¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 94.0% | +6¢ / −94¢ |
| 94¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 95.0% | +5¢ / −95¢ |
| 95¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 96.0% | +4¢ / −96¢ |
| 96¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 97.0% | +3¢ / −97¢ |
| 97¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 98.0% | +2¢ / −98¢ |
| 98¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 99.0% | +1¢ / −99¢ |
| 99¢ | HARD NO BUY | N/A | N/A | none | $0 | 1¢ | 100.0% | +0¢ / −100¢ |

## Price-aware proposed corrections — NOT currently part of the paper BUY/SELL gate
**P1 — Actual-target-aware calibrated value:** Estimate `P(official correct settlement side | official target distance, time to the 60s closing average, rolling as-of index volatility, recrosses, trend/contradictions and actual current quote context)`, with no future data and independent chrono holdout. Compare a conservative estimate (including calibration uncertainty and bid/ask/fee/latency) with the exact fee-inclusive break-even `(q×ASK + entryFee)/q`. Buy on the **first eligible live snapshot** with demonstrated conservative positive expected edge, not a higher-looking 85c quote. Price itself is not an edge. The original target, official benchmark clock and volatility are first-class features; 1m RSI/EMA/MACD are contextual. 85¢ / 5-min restriction requires its own evidence rather than an arbitrary safe-looking filter.
**P2 — Separate resale-vs-settlement hold value:** For an already held position, investigate the relative expected value of net sale at a fresh BID versus expected settlement proceeds / position risk. Reevaluate 96c fixed sale and final-six-minute stop with historical bid/depth and independent settlement correctness. Do **not** silently change existing exits in the same release as entry model change.
**Missing data:** The ~8,536 actual market targets/outcomes inventoried over ~90 days do not provide complete time-aligned Kalshi WebSocket best quotes, historical authenticated ETHUSD_RTI every second, target crossing path, fee/latency, or a complete as-of strategy holdout. Historical cross-sectional win rates by ASK are not personalized strategy test results.

**Known code/research gaps and release blockers:**
- Current V4 score gates are *not* estimates of winning probability, and there is no actual ASK-versus-calibrated-P expected value or reward/risk filter.
- Below 85c contradictions and official index-to-Kraken basis dislocations can be recorded without necessarily blocking entry; test harm before making veto.
- The `expectedMove` SD×sqrt(time) is an uncalibrated proxy; opening target and closing-minute benchmark averaging need proper validation of 60-second settlement variance.
- Current code does not base late held-position decisions on the official quarter-hour accumulating final-minute mean; it flags confidence uncertainty.
- `completedFresh()` allows up to roughly 4m for completed 1m candle timestamp and 12m for completed 5m timestamp; audit for stale directional evidence before paper activation.
- Test that observed book tick precision/quantity, order-level taker fees, market-specific fee multiplier, site status and simulations reconcile with Kalshi.
- Hypothetical scenario calculator `cloud/v4/src/price-value-research.js` does not authorize any purchase, and its entryEligible flag is permanently false.
- Existing V4 paper price rules are *staged source code*; Cloudflare deployment, real continuous live feed behavior, and out-of-sample profitable edge remain unverified.

Research references: https://help.kalshi.com/en/articles/13823838-crypto-markets ; https://kalshi.com/fee-schedule ; https://cepr.org/voxeu/columns/economics-kalshi-prediction-market ; https://kalshieye.com/data/kalshi/kxeth15m/stats/ .
