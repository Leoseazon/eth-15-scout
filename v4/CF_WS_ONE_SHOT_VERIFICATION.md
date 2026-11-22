# V4 — One-time live ETHUSD_RTI WebSocket verification

## Scope
This is a one-off authenticated Kalshi WebSocket entitlement and live-value check, NOT continuous recording, a data license, a paper order, or a proven trading model.
The V4 viewer routes the authenticated request to a different named Durable Object: v4-cf-one-shot-probe. Existing v4-single-paper-scout monitoring and V3 are unaffected.
Raw index frames, key material, subscriptions, and index values are NOT stored in research tables. The diagnostic instance stores only a last-attempt timestamp to enforce a 90-second cooldown.

## Gates
- V4_CF_WS_PROBE_ENABLED=true only enables this ephemeral diagnostic.
- V4_RESEARCH_STREAM_ENABLED=false and V4_FULL_BOOK_ARCHIVE_ENABLED=false remain disabled.
- SCOUT_V4_PAPER_MODE=disabled remains unchanged.
- The WebSocket connection closes on success, denial, error, or the 10-second timeout.
- Never paste keys, signatures, or auth tokens into a browser or this conversation.

## Verification sequence
1. Sign the exact Kalshi WebSocket GET path with the existing V4 server-side read-only key.
2. Require a WebSocket 101 upgrade; report 401/403/429 without interpreting them as successful access.
3. Subscribe to cfbenchmarks_value using index_ids=[ETHUSD_RTI].
4. Require a subscribed acknowledgement with a valid assigned SID (Kalshi documents msg.sid).
5. Request update_subscription action=indexlist for that SID.
6. Require ETHUSD_RTI in the returned cfbenchmarks_value_indexlist.
7. Require an actual cfbenchmarks_value message, correctly attributed and parsed, with a source timestamp within 30 seconds (plus 5s skew).
8. Close immediately. Only a complete pass reports WS_ETH_INDEX_VERIFIED.

An HTTP 101 handshake or subscription acknowledgement alone does not prove index availability.
REST passthrough verification alone does not prove WebSocket availability.

## Limits
This does not establish 15-minute continuity, official settlement reconciliation, replay completeness, data retention/AI training permission, or strategy profitability.
No permanent index stream should be enabled without reviewing the provider's data-use/retention terms.

## Deployment
After CI passes on the exact commit, deploy only cloud/wrangler.v4test.toml and cloud/wrangler.v4viewer.toml from the V4 research branch.
Publish the V4-only website changes to main, and use the Verify live WebSocket control while signed in.

## Official specifications
- https://docs.kalshi.com/websockets/cfbenchmarks-value
- https://docs.kalshi.com/websockets/websocket-connection
