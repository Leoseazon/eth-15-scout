# V3 PAPER test deployment — isolated from V2

**Purpose:** Run V3 simulations only. This project never submits real Kalshi orders.
The existing `eth-15-scout-cloud-v2` and `eth-15-scout-api` Workers remain separate.

## From the existing Windows PowerShell clone

Start in `C:\\Users\\Admin\\KalshiBot\\eth-15-scout\\cloud`.
Make sure `git status --short` has no output before switching branches.
Then run each command separately:

```powershell
git fetch origin
git switch --track origin/strategy-v3-paper-checklist-20261119
npm.cmd install
npm.cmd run check
npm.cmd test
npx.cmd wrangler deploy --config wrangler.v3test.toml --dry-run
npx.cmd wrangler deploy --config wrangler.v3test.toml
```

**Do not run `npm run deploy` or a bare `wrangler deploy`** from this
branch: the legacy default `wrangler.toml` still names the V2 Worker.
Only use the explicit `--config wrangler.v3test.toml` target above.

## Initial Cloudflare verification (paper entries DISABLED)
The new Worker name is `eth-15-scout-cloud-v3test`. Its public workers.dev
URL is disabled and no route is attached. This is deliberate.

In Cloudflare dashboard > Durable Objects > the V3test ScoutEngine SQLite
namespace > Data Studio > instance `single-paper-scout`, query:

```sql
SELECT armed,monitoring,observed_at,last_market,last_error
FROM runtime_status WHERE id=1;
```

You should see **armed=0, monitoring=1** once scheduled ticks start.
A timestamp and market/feed error report should be reviewed; never
infer a healthy data feed from deployment alone.

## Enable PAPER simulation only after confirming it is healthy
In Cloudflare dashboard > Workers & Pages >
`eth-15-scout-cloud-v3test` > Settings > Variables and Secrets, change
the plain-text variable `SCOUT_PAPER_MODE` from `disabled` to **`enabled`**,
then save/deploy the setting. No Kalshi API key is required or used.

The script's Durable Object will then use `armed=1` for **paper simulated
entries only**, if monitoring is running. To pause paper purchases, change
the variable back to `disabled`. A new Wrangler deployment with the
tracked config resets it to `disabled` as a safety precaution.

The `/v1/arm` and `/v1/pause` routes intentionally reject attempts to
override the deployment-controlled paper-mode flag.

Read-only paper trade journal queries from Data Studio:

```sql
SELECT happened_at,data FROM events ORDER BY happened_at DESC LIMIT 40;
SELECT exit_at,data FROM trades ORDER BY exit_at DESC LIMIT 40;
SELECT decided_at,data FROM decisions ORDER BY decided_at DESC LIMIT 40;
```

The history starts **empty** and is independent of the prior V2 browser paper
journal. No trades means no qualified simulated trade yet; check
`runtime_status.last_error` and `events` for more context.
Unsettled positions are not counted as confirmed profit.

The V3test Worker uses `workers_dev=false` and no external route.
The existing dashboard and existing V2 deployments are not modified.

## Boundaries
- A passing unit test / dry-run is not evidence that production data feeds,
  scheduled execution, available order book size, or modeled P/L are accurate.
- V3test has its own $100 simulated bankroll, 12% soft/20% hard daily risk policy,
  max $3 normal / $1.50 soft-size paper entries.
- A/D uses Kraken candle volume and the ETH spot proxy, not the official
  CF Benchmarks settlement price. Official settlement reconciliation and
  representative market snapshot replay remain on the checklist.
- Changing Worker variables through Cloudflare Dashboard may be overwritten by
  future Wrangler deploys; the tracked test configuration deliberately defaults
  to disabled and must not be edited to commit an enabled flag publicly.
