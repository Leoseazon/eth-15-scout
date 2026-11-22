import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('new archive recorders require data-use authorization plus separate opt-in',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const config=readFileSync(root+'cloud/wrangler.v4test.toml','utf8');
 assert.match(worker,/this\.dataResearchAuthorized=env\.V4_DATA_RESEARCH_AUTHORIZED==='true'/);
 assert.match(worker,/this\.dataResearchAuthorized&&env\.V4_RESEARCH_STREAM_ENABLED==='true'/);
 assert.match(worker,/this\.fullBookRecordingEnabled=this\.dataResearchAuthorized&&/);
 assert.match(worker,/onRawFrame:this\.fullBookRecordingEnabled\?/);
 assert.match(config,/V4_DATA_RESEARCH_AUTHORIZED = "false"/);
 assert.match(config,/V4_RESEARCH_STREAM_ENABLED = "false"/);
 assert.match(config,/V4_FULL_BOOK_ARCHIVE_ENABLED = "false"/);
 assert.match(config,/SCOUT_V4_PAPER_MODE = "disabled"/);
});
