# V4 — Private, read-only Cloudflare log collection

## What this does
The single V4-only collector uses `wrangler tail eth-15-scout-cloud-v4test --format json` for a bounded, owner-initiated session. It **does not** deploy, edit, delete, query private SQL, read credentials, use order routes, or operate V3. It saves a **timestamped local text report** of explicitly allowlisted diagnostic codes in your Windows Downloads folder. Raw logs and authorization material are discarded in memory.

Unlike Data Studio, the tail is **live-only**; missing entries during a capture do not mean they never occurred. Cloudflare may sample logs. The existing V4 Durable Object keeps the authoritative append-only market-data and diagnostic archive separately.

## Prerequisites
- The existing personal V4 checkout at `C:\Users\Admin\eth-15-scout-v4\cloud`.
- Node.js/npm installed and authenticated `wrangler login` already set up for the user's Cloudflare account. No new token is necessary to start with the user's existing Wrangler login. Cloudflare documents that `wrangler tail` needs only Worker Metadata Read-Only access for the specific Worker.
- The V4-only safe logging change must first be deployed as a **separate, manually approved** code update of `wrangler.v4test.toml`. Until that change is live, no `ETH15_V4_AUDIT` codes are expected. This script never performs that deployment.

## Install and verify without changing the live Worker

In PowerShell:

```powershell
cd "$HOME\eth-15-scout-v4\cloud"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "Stop — Git update failed" }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "Stop — tests failed" }
npx.cmd wrangler deploy --config wrangler.v4test.toml --dry-run
if ($LASTEXITCODE -ne 0) { throw "Stop — dry run failed" }
```

The owner must review any production configuration changes before an **optional** explicit V4-only deployment:

```powershell
npx.cmd wrangler deploy --config wrangler.v4test.toml
```

If Cloudflare warns of an unexpected config discrepancy, answer **N** and stop. This targets only `eth-15-scout-cloud-v4test`. Its `SCOUT_V4_PAPER_MODE = "disabled"` remains unchanged.

## Collect a local sanitized report

After the V4-only diagnostic mirror is deployed:

```powershell
cd "$HOME\eth-15-scout-v4\cloud"
node .\v4\tools\read-only-cloudflare-tail.mjs --minutes 3
```

The report appears at `Downloads\ETH15-V4-Cloudflare-ReadOnly-<UTCSTAMP>.txt`. You can upload **that sanitized report** to ChatGPT; do **not** upload a raw Wrangler tail, token, secret, or private key.

To capture a longer session manually, use `--minutes 8` (maximum eight minutes). Each invocation runs once in the foreground; it is not a scheduled background monitoring service.

## Credential hardening (optional later)
If the owner wishes to replace their OAuth Wrangler login with a narrowly scoped API token, create it inside Cloudflare with **Workers Metadata Read-Only scoped to only `eth-15-scout-cloud-v4test`**, set it securely in the local operating-system environment (never the repository), and verify `wrangler tail` works. No editor, admin, D1 write, Workers Scripts Write, or Durable Object edit privileges are needed for tailing.

The read-only token is for **your local Wrangler collector**, not for sharing with ChatGPT. GitHub remains a public repository and no Cloudflare token should be stored there.

## Failure and interpretation
- `AUTH_REST_HTTP_200` proves the Kalshi read-only signing succeeds via REST, **not** that WebSocket upgrading succeeds.
- `NETWORK_REST_CHECK` HTTP 200 on both hosts proves public API reachability, not live streaming.
- `WS_HOST_HTTPS_CHECK` HTTP 401 can be expected for the deliberately unauthenticated, non-upgrade probe.
- `BOOK_SNAPSHOT RECORDED` indicates a **valid and fresh book snapshot persisted** by V4 (not a trade or a profitable forecast).
- A report with zero events is **inconclusive**: check deployment, Wrangler permissions and whether any V4 Worker invocation occurred during the capture.
- No diagnostics script, token or viewer should ever expose V3 production controls or grant Kalshi trading/write scopes.
