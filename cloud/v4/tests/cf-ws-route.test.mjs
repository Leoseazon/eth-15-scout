import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('live CF entitlement is isolated from V4 trading engine and recorder',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const gateway=readFileSync(root+'cloud/v4/viewer-worker.js','utf8');
 const config=readFileSync(root+'cloud/wrangler.v4test.toml','utf8');
 assert.match(gateway,/getByName\('v4-cf-one-shot-probe'\)/);
 assert.match(gateway,/\/api\/v4\/cf-ws-verify/);
 assert.match(worker,/\/v1\/cf-ws-verify/);
 assert.match(worker,/cf-ws-verification-last-at/);
 assert.match(config,/V4_CF_WS_PROBE_ENABLED = "true"/);
 assert.match(config,/V4_RESEARCH_STREAM_ENABLED = "false"/);
 assert.match(config,/V4_FULL_BOOK_ARCHIVE_ENABLED = "false"/);
 assert.match(config,/SCOUT_V4_PAPER_MODE = "disabled"/);
});
test('website exposes one-time check separately and never exposes credentials',()=>{
 const html=readFileSync(root+'v4/index.html','utf8');
 const ui=readFileSync(root+'v4/cf-ws-probe-ui.js','utf8');
 assert.match(html,/cf-ws-probe-ui\.js/);
 assert.match(html,/id="cf-ws-probe-button"/);
 assert.match(ui,/\/api\/v4\/cf-ws-verify/);
 assert.doesNotMatch(ui,/KALSHI-ACCESS-(KEY|SIGNATURE)/);
 assert.doesNotMatch(ui,/\/v1\/(arm|stop|start)/);
});
