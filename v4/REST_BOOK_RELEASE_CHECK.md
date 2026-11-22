# V4 WebSocket diagnostics + official REST depth fallback — release checklist

**Scope:** `eth-15-scout-cloud-v4test` only. V3 is not a deployment target. V4 is shadow/read-only, simulated entries hard-disabled, and real trading endpoints do not exist.

## What is implemented
- V4 WebSocket error taxonomy classifies additional recognizable runtime, Upgrade/header, scheme, outbound egress and network error patterns. Unknown Cloudflare failures remain `NETWORK_CONNECT_FAILED`; raw exception text, stack, signing headers and API secrets are never logged.
- Independent direct Kalshi `GET /trade-api/v2/markets/{ticker}/orderbook?depth=20` (official documentation says no auth required), guarded by V4-only `V4_REST_BOOK_CAPTURE_ENABLED=true` and absence of a verified fresh WebSocket book.
- REST fallback attempts no more than once per 15s, with 120s backoff after HTTP 429. It never changes strategy, paper positions, official settlement or V3.
- V4 SQLite table `v4_rest_book_samples` stores requested/received times, source, YES/NO fixed-point bid depth and complementary asks. Unknown exchange age and no sequence are recorded as unavailable; an empty/crossed book is never an asserted fill.
- V4 viewer has a separate private GET-only `api/v4/rest-book` archive, counts, last receipt and full JSON evidence export with source-specific cursor.

## Owner-run local verification; no deployment until owner reviews

From PowerShell in the V4 checkout:

```powershell
cd "$HOME\eth-15-scout-v4\cloud"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "STOP: Git update failed" }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "STOP: tests failed" }
npx.cmd wrangler deploy --config wrangler.v4test.toml --dry-run
if ($LASTEXITCODE -ne 0) { throw "STOP: V4 dry run failed" }
```

Expected binding: `SCOUT_V4` class `ScoutEngineV4`. Expected vars: `SCOUT_V4_PAPER_MODE="disabled"`, `V4_STREAM_CAPTURE_ENABLED="true"`, `V4_REST_BOOK_CAPTURE_ENABLED="true"`. Existing Kalshi read credentials remain encrypted Cloudflare secrets and are not pasted into commands. If Wrangler warns it will overwrite unexpected dashboard config, answer **N** and review it first.

After a successful review, the **separately authorized V4-only production deployment** command is:

```powershell
npx.cmd wrangler deploy --config wrangler.v4test.toml
```

Do not use `wrangler.v3test.toml`, `wrangler.toml`, GitHub PR merge, or a V3 Worker name.

## Verify new table in V4 Data Studio

Cloudflare → Durable Objects → `ScoutEngineV4` → Data Studio → instance name `v4-single-paper-scout` → Jurisdiction None (default) → Explore. Data Studio might ask for the instance name each visit. After the engine executes, use this **read-only** SQL query:

```sql
SELECT
  (SELECT COUNT(*) FROM v4_rest_book_samples) AS official_rest_books,
  (SELECT datetime(MAX(received_at)/1000,'unixepoch') FROM v4_rest_book_samples) AS latest_rest_utc,
  (SELECT COUNT(*) FROM v4_stream_samples) AS ws_book_samples_not_all_verified,
  (SELECT detail FROM v4_stream_events WHERE kind='REST_BOOK_FAULT' ORDER BY id DESC LIMIT 1) AS latest_rest_error;
```

Then inspect safe events, if needed:

```sql
SELECT datetime(at/1000,'unixepoch') AS time_utc,kind,detail
FROM v4_stream_events
WHERE kind IN ('REST_BOOK_SNAPSHOT','REST_BOOK_FAULT','STREAM_FAULT')
ORDER BY id DESC LIMIT 20;
```

An increase in `official_rest_books` **only proves REST research snapshots are being stored**. It is not a validated WebSocket feed, exchange-timestamped tick, or simulated/executable fill. An empty table or 401/429/timeout fault requires investigation without assuming credentials were exposed or V3 was affected.

## Optional read-only Cloudflare log collector

After deployment and local git update:

```powershell
node .\v4\tools\read-only-cloudflare-tail.mjs --minutes 3
```

Upload only the sanitized `ETH15-V4-Cloudflare-ReadOnly-...txt` report from Downloads; never raw logs or keys.

## V4 website deployment is separate

The V4 viewer source changes and new REST archive are in the **draft** PR. They will not appear on the V4 GitHub Pages website until its page is published and the independent, authenticated V4 viewer Worker is separately approved and configured. Do not deploy `wrangler.v4viewer.toml` as a substitute for deploying the V4 engine; never expose its session secrets or reuse V3's viewer.

## Remaining checks

- Live Kalshi REST depth success and observed storage growth.
- Whether the new safe WebSocket categories identify a runtime root cause; generic `NETWORK_CONNECT_FAILED` means still unresolved.
- Authenticated WebSocket 101, valid snapshots and gap-free cross-window continuity before declaring WebSocket recovered.
- Market-data retention rights and storage quotas/costs before indefinite 15-second archival.
- Strategy validation and the 40% stop experiment require independent holdout evidence; this release introduces **no new trading rules**.

References: https://docs.kalshi.com/getting_started/orderbook_responses and https://developers.cloudflare.com/workers/runtime-apis/websockets/