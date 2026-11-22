import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('the new settlement-first paper bot remains off in the ordinary V4 research config',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const config=readFileSync(root+'cloud/wrangler.v4test.toml','utf8');
 assert.match(worker,/env\.SCOUT_V4_PAPER_MODE==='enabled' &&/);
 assert.match(worker,/env\.V4_SETTLEMENT_FIRST_EXPERIMENT==='true'/);
 assert.match(worker,/s\.armed=this\.paperExperimentAllowed&&s\.monitoring/);
 assert.match(config,/SCOUT_V4_PAPER_MODE = "disabled"/);
 assert.match(config,/V4_SETTLEMENT_FIRST_EXPERIMENT = "false"/);
 assert.match(config,/V4_RESEARCH_STREAM_ENABLED = "false"/);
 assert.match(config,/V4_FULL_BOOK_ARCHIVE_ENABLED = "false"/);
 assert.match(config,/V4_DATA_RESEARCH_AUTHORIZED = "false"/);
});
test('new paper engine uses official RTI input and immutable prediction journal, not legacy 7 checkbox purchase',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 assert.match(worker,/settlementFirstPaperStep\(s,/);
 assert.match(worker,/onPrediction:pos=>appendSettlementPrediction\(/);
 assert.match(worker,/reconcileSettlementPredictions\(this\.ctx\.storage\.sql/);
 assert.match(worker,/settlementPredictionStats\(this\.ctx\.storage\.sql\)/);
 assert.match(worker,/verified\.state==='HTTP_200_VALID_ETH_INDEX'/);
 assert.match(worker,/this\.stream\?\.status\(Date\.now\(\)\)\?\.quote/);
 assert.match(worker,/if\(this\.paperExperimentAllowed\)\{/);
 const paper=readFileSync(root+'cloud/v4/src/settlement-first-paper.js','utf8');
 assert.doesNotMatch(paper,/create_order|POST \/trade|\/portfolio\/orders/);
});

test('opt-in V4 paper release differs from default only in two explicit paper flags',()=>{
 const defaultText=readFileSync(root+'cloud/wrangler.v4test.toml','utf8');
 const paperText=readFileSync(root+'cloud/wrangler.v4paper.toml','utf8');
 const normalize=t=>t.split(String.fromCharCode(10)).filter(x=>!/^ *#/.test(x)&&x.trim()!=='')
  .map(x=>x.replace(/SCOUT_V4_PAPER_MODE = "(enabled|disabled)"/,
    'SCOUT_V4_PAPER_MODE = "PAPER_SWITCH"')
   .replace(/V4_SETTLEMENT_FIRST_EXPERIMENT = "(true|false)"/,
     'V4_SETTLEMENT_FIRST_EXPERIMENT = "EXPERIMENT_SWITCH"')).join(String.fromCharCode(10));
 assert.equal(normalize(defaultText),normalize(paperText));
 assert.match(paperText,/SCOUT_V4_PAPER_MODE = "enabled"/);
 assert.match(paperText,/V4_SETTLEMENT_FIRST_EXPERIMENT = "true"/);
 for(const [flag,value] of [
  ['V4_DATA_RESEARCH_AUTHORIZED','false'],
  ['V4_RESEARCH_STREAM_ENABLED','false'],
  ['V4_FULL_BOOK_ARCHIVE_ENABLED','false']
 ])assert.ok(paperText.includes(flag+' = "'+value+'"'));
});
