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
 assert.match(worker,/onPrediction:pos=>\{s\.pendingPredictionToCommit=pos\}/);
 assert.match(worker,/if\(forecastToCommit\)appendSettlementPrediction\(sql,forecastToCommit\)/);
 assert.match(worker,/delete runtime\.pendingPredictionToCommit/);
 assert.match(worker,/if\(forecastToCommit\)delete s\.pendingPredictionToCommit/);
 assert.match(worker,/reconcileSettlementPredictions\(this\.ctx\.storage\.sql/);
 assert.match(worker,/settlementPredictionStats\(this\.ctx\.storage\.sql\)/);
 assert.match(worker,/verified\.state==='HTTP_200_VALID_ETH_INDEX'/);
 assert.match(worker,/this\.stream\?\.status\(Date\.now\(\)\)\?\.quote/);
 assert.match(worker,/if\(this\.paperExperimentAllowed\|\|continueV4Position\)\{/);
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

test('a simulated cash debit and immutable forecast commit in the SAME storage transaction',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const begin=worker.indexOf('this.ctx.storage.transactionSync(()=>{',worker.indexOf('save(s,meta={}'));
 const forecast=worker.indexOf('appendSettlementPrediction(sql,forecastToCommit)',begin);
 const account=worker.indexOf("this.ctx.storage.kv.put('runtime',runtime)",begin);
 const completion=worker.indexOf('if(forecastToCommit)delete s.pendingPredictionToCommit;',account);
 assert.ok(begin>0&&forecast>begin&&account>forecast&&completion>account);
 assert.doesNotMatch(worker.slice(worker.indexOf('async tick(){'),worker.indexOf('async alarm(){')),
   /onPrediction:pos=>appendSettlementPrediction\(/);
});
test('V4 open positions continue V4 exit logic under emergency return to disarmed config',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 assert.match(worker,/const continueV4Position=s\.open\?\.strategy==='V4_SETTLEMENT_FIRST'/);
 assert.match(worker,/if\(this\.paperExperimentAllowed\|\|continueV4Position\)/);
 assert.match(worker,/continuingPreDisarmV4Position:/);
 assert.match(worker,/s\.armed=this\.paperExperimentAllowed&&s\.monitoring/);
});
test('official index and book are fail-closed, status may not claim an old index reading is fresh',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 assert.match(worker,/entrySourcesReady&&decisionBookFresh&&index!==null/);
 assert.match(worker,/SKIPPED_NO_FRESH_WS_BOOK/);
 assert.match(worker,/officialIndexFeedCheck:/);
 assert.match(worker,/paperFeedHealth:/);
 assert.match(worker,/Date\.now\(\)-s\.lastOfficialIndexCheck\.at<=30000/);
});

test('open V4 paper positions have a Kalshi WebSocket protective-exit fast path before ALL Kraken requests',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const fast=worker.indexOf('FAST PAPER EXIT PATH');
 const upstream=worker.indexOf('const batch=await collectThrottledMarketFeeds(',fast);
 assert.ok(fast>0&&upstream>fast);
 const snippet=worker.slice(fast,upstream);
 assert.match(snippet,/s\.open\?\.strategy==='V4_SETTLEMENT_FIRST'/);
 assert.match(snippet,/this\.stream\?\.status\(Date\.now\(\)\)\?\.quote/);
 assert.match(snippet,/settlementFirstPaperStep\(s,/);
 assert.match(snippet,/if\(exit\.status==='PAPER_SELL'\|\|s\.open===null\)/);
 assert.match(snippet,/this\.save\(s,/);
});
test('experimental decision path does NOT evaluate redundant V3 seven-vote probe',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const i=worker.indexOf('// Exactly ONE active decision philosophy');
 const j=worker.indexOf('// Never block decisions on Kalshi settlement-data availability.',i);
 const relevant=worker.slice(i,j);
 assert.match(relevant,/if\(this\.paperExperimentAllowed\|\|continueV4Position\)/);
 assert.match(relevant,/else\{/);
 assert.match(relevant,/engine\.probe\(/);
});
test('no auxiliary research journal is allowed to claim paper buy before account transaction commits',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const tick=worker.slice(worker.indexOf('async tick(){'),worker.indexOf('async alarm(){'));
 const primary=tick.indexOf('// Commit the official-target prediction');
 const save=tick.indexOf('this.save(s,tickMeta)',primary);
 const research=tick.indexOf('recordResearchTick(',primary);
 assert.ok(primary>0&&save>primary&&research>save);
});

test('signed index HTTP latency cannot reuse a pre-REST stale Kalshi entry book',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const check=worker.indexOf('const verified=await checkCFValuesAccess');
 const refetch=worker.indexOf('const decisionBook=this.stream?.status(Date.now())?.quote',check);
 const decision=worker.indexOf('book:decisionBook,now:Date.now()',refetch);
 assert.ok(check>0&&refetch>check&&decision>refetch);
 assert.match(worker,/decisionBookFresh&&index!==null/);
});
test('reference REST quote source timestamp is forwarded, not replaced by the latest tick time',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 assert.match(worker,/yes_bid_dollars:market.yes_bid_dollars/);
 assert.match(worker,/no_bid_dollars:market.no_bid_dollars/);
 assert.match(worker,/quoteObservedAt:s.lastQuoteRetrievedAt/);
 assert.match(worker,/V4 PAPER fills use authenticated WS book/);
});

test('the live settlement-first path guards the 87c ceiling with 85c exception and reports processing defects',()=>{
 const src=readFileSync(root+'cloud/v4/src/settlement-first.js','utf8');
 const paper=readFileSync(root+'cloud/v4/src/settlement-first-paper.js','utf8');
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 assert.match(src,/export const NORMAL_PREMIUM_ASK=0\.85/);
 assert.match(src,/export const MAX_PAPER_ENTRY_ASK=0\.87/);
 assert.match(src,/exceptionalPremiumEligible/);
 assert.match(paper,/exceptionalPremiumEligible\(d\)/);
 assert.match(src,/ask>MAX_PAPER_ENTRY_ASK/);
 assert.match(paper,/d\.ask>MAX_PAPER_ENTRY_ASK/);
 assert.match(worker,/V4_DECISION_PROCESSING_ERROR/);
 assert.match(worker,/lastError:error/);
});
