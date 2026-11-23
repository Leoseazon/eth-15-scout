import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../tools/report-v4-two-workers.mjs',import.meta.url));
const start=Date.parse('2026-11-23T04:00:00Z');
const at=start+16000,closeAt=start+900000;
const ticker='KXETH15M-26NOV222215-15';
function mainRow(time){
 return {id:time,observedAt:time,closeAt,ticker,paperOnly:true,shadowOnly:true,
  decision:{shadowProbe:{
   mainStrategyProfile:{active:'OPPORTUNISTIC'},
   mainCoherence:{readOnly:true},reason:'PAPER_VALUE_TEST',
   decision:null
  }}};
}
function controlRow(time){
 return {id:time,observedAt:time,closeAt,ticker,paperOnly:true,shadowOnly:true,
 decision:{shadowProbe:{
  researchWorkerRole:'CONTROLS_ONLY',
  conservativeReference:{readOnly:true,status:'WATCH'},
  prospectiveShadow:null,conservativeControl:{persisted:true}
 }}};
}
const account={version:'V4-CONSERVATIVE-INDEPENDENT-20261123-v1',
 journalIndependentOfMain:true,initial:100,cash:100,realized:0,entries:0,
 trades:[],pendingPositions:[],finalRoundPasses:[]};
const main=()=>({
 format:'ETH-15 Scout V4 complete research evidence',paperOnly:true,
 exportedAt:new Date(start+120000).toISOString(),
 researchTicks:[{...mainRow(start-1000),closeAt:start},mainRow(at),mainRow(at+15000)],
 journals:{trades:[],windows:[],pending:[],open:null}
});
const controls=()=>({
 format:'ETH-15 Scout V4 controls-only evidence',paperOnly:true,readOnly:true,
 workerRole:'CONTROLS_ONLY',engineMainTradingDisabled:true,
 exportedAt:new Date(start+120000).toISOString(),
 snapshot:{status:{armed:false,mainTradingDisabledByCode:true}},
 researchTicks:[{...controlRow(start-500),closeAt:start},controlRow(at+3000),controlRow(at+19000)],
 journal:{windows:[],trades:[],conservativeControlJournal:account}
});
function run(a,b){
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'v4-2-worker-'));
 const ma=path.join(d,'main.json'),co=path.join(d,'controls.json');
 try{
 fs.writeFileSync(ma,JSON.stringify(a));fs.writeFileSync(co,JSON.stringify(b));
 return spawnSync(process.execPath,[cli,ma,co],
 {encoding:'utf8',maxBuffer:7*1024*1024});
 }finally{fs.rmSync(d,{recursive:true,force:true})}
}
test('60-round comparison uses both independent Worker streams but no fake fills',()=>{
 const x=run(main(),controls());
 assert.equal(x.status,0,x.stderr);
 const r=JSON.parse(x.stdout);
 assert.equal(r.format,'ETH-15 Scout V4 physically isolated 8-strategy 15h comparison');
 assert.equal(r.workers.length,2);
 assert.equal(r.workers[0].role,'MAIN');
 assert.equal(r.workers[1].role,'CONTROLS');
 assert.equal(r.rounds.length,60);
 assert.equal(r.cohort.bothSourcesOnAllWindows,1);
 assert.equal(r.cohort.sourceExportsCover15h,false);
 assert.equal(r.mainOpportunistic.distinctDocumentedBuys,0);
 assert.equal(r.separateConservative.privateInitialBankroll,100);
 assert.equal(r.realExchangeFillsVerified,false);
});
test('rejects controls with paper main armed, old same Worker source or absent ledger',()=>{
 for(const modify of [
  c=>{c.snapshot.status.armed=true},
  c=>{c.workerRole='MAIN'},
  c=>{delete c.journal.conservativeControlJournal},
  c=>{c.snapshot.status.mainTradingDisabledByCode=false}
 ]){
 const c=controls();modify(c);
 const x=run(main(),c);
 assert.notEqual(x.status,0);
 }
});
test('rejects absent or mismatched main profile observations',()=>{
 const m=main();m.researchTicks.forEach(t=>{
  t.decision.shadowProbe.mainStrategyProfile.active='CONSERVATIVE';
 });
 const r=run(m,controls());assert.notEqual(r.status,0);
 assert.match(r.stderr,/Both Workers must show verified/);
});
test('main historical balance must not be silently reset to $100 in report',()=>{
 const m=main();m.journals.account={initial:100,cash:107.25,realized:7.25};
 const r=run(m,controls());assert.equal(r.status,0,r.stderr);
 const o=JSON.parse(r.stdout);
 assert.ok(!('privateInitialBankroll' in o.mainOpportunistic));
 assert.equal(o.separateConservative.privateInitialBankroll,100);
});
