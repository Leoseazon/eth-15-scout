# V4 data retention and on-demand storage inventory

## Current fact — not a proposed setting
V4 currently uses SQLite-backed Cloudflare Durable Object persistent storage.
The main research, sampled WebSocket and REST archives are append-only.
No automatic TTL, scheduled purge, 30-day cutoff, 90-day cutoff, or archival cleanup is configured.
Rows generally remain until explicitly removed, an account/object is removed,
or availability is affected by external platform failures or storage limits.
Dashboard row/pagination limits are NOT storage retention limits.

Cloudflare's 30-day point-in-time recovery window is a recovery history and
**does not** imply that the underlying V4 research database expires in 30 days.
Cloudflare Workers Paid has a documented SQLite-backed Durable Object storage
limit of 10 GB per object as of November 2026; usage-based costs and other
account-level limits may apply.

## Proposal, NOT active
Prefer a 90-day rolling research target once data-use/retention permissions,
actual storage growth, and replay requirements are clear. It would cover
about 8,640 non-overlapping 15-minute windows if fully collected, but there
can be gaps or exclusions. The proposed 90-day period is NOT currently enforced.
Retain summaries longer than raw samples only if licensed/authorized.
Do NOT activate automatic purging without explicit owner approval, verified
export/backup plan, and per-table reversible dry runs.

## New on-demand audit
- Authenticated viewer route: /api/v4/storage-inventory
- Internal engine route: /v1/storage-inventory
- Invoked ONLY on explicit user click; not every V4 alarm or quote.
- Reads COUNT(*), MIN(timestamp), MAX(timestamp) for a fixed list of known tables.
- Reads Cloudflare sql.databaseSize. Returned size includes indexes / storage
  overhead and other tables; it is not equal to summed raw market payload sizes.
- Returns no licensed market prices, trade details or API credentials.
- Performs no DELETE / DROP / UPDATE / INSERT / VACUUM queries.
- Requires both the V4 Worker/viewer and GitHub Pages UI code to be deployed.

## Remaining before any retention enforcement
1. Verify Kalshi/CF Benchmarks data-use and historical retention rights for personal research.
2. Measure actual 24-hour storage growth and write cost.
3. Confirm safe account/object quota, runtime reliability and 15-minute completeness.
4. Select data types and retention by permitted purpose, not simply days.
5. Design export verification, audit snapshots, rollback and a dry-run deletion report.
6. Receive explicit owner approval before creating any deletion or auto-purge code.

## References
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
