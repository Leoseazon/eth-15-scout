import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../tools/report-v4-profile-comparison.mjs',import.meta.url));
const prior=Date.parse('2026-11-23T03:43:00Z');
const at=Date.parse('2026-11-23T03:46:00Z');
const closeAt=Date.parse('2026-11-23T04:00:00Z');
const ticker='KXETH15M-26NOV222200-00';
const marker=at-450000;
const control={version:'V4-CONSERVATIVE-INDEPENDENT-20261123-v1',
 journalIndependentOfMain:true,
 trades:[],pendingPositions:[],finalRoundPasses:[],realized:0,
 completed:0};
const row=(time=at,dAt=time)=>({
 id:time,paperOnly:true,shadowOnly:true,ticker,closeAt,
 observedAt:time,finishedAt:time+250,
 decision:{shadowProbe:{
  mainStrategyProfile:{active:'OPPORTUNISTIC',configurationValid:true},
  conservativeReference:{status:'WATCH',readOnly:true,executionAuthorized:false},
  conservativeControl:{version:control.version,persisted:true,
   entries:1,completed:0},
  decision:{status:'PAPER_BUY',at:dAt,side:'UP',entry:.4,
   cost:2.91},
  prospectiveShadow:null
 }}
});
const fixture=()=>({
 format:'ETH-15 Scout V4 complete research evidence',paperOnly:true,
 exportedAt:new Date(at+100000).toISOString(),
 researchTicks:[
  {...row(prior),closeAt:Date.parse('2026-11-23T03:45:00Z')},
  row(at),row(at+15000,at)],
 journals:{trades:[],windows:[],
  conservativeControlJournal:control}
});
function run(json){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v4-profile-'));
 const source=path.join(dir,'evidence.json');
 try{
  fs.writeFileSync(source,JSON.stringify(json));
  return spawnSync(process.execPath,[cli,source],
   {encoding:'utf8',maxBuffer:12*1024*1024});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('exactly 60 windows and no repeated sticky PAPER_BUY inflation',()=>{
 const a=run(fixture());assert.equal(a.status,0,a.stderr);
 const r=JSON.parse(a.stdout);
 assert.equal(r.cohort.fullMarketWindows,60);
 assert.equal(r.markets.length,60);
 assert.equal(r.mainOpportunistic.firstPaperBuyDecisions,1);
 assert.equal(r.mainOpportunistic.completedPaperTrades.completed,0);
 assert.equal(r.independentMainConservative.completeLedgerExported,true);
 assert.equal(r.independentMainConservative.newPaperAccountInitial,100);
 assert.equal(r.cohort.complete,false);
 assert.equal(r.realFillsVerified,false);
 assert.equal(r.allExecutionsSimulated,true);
});
test('absent Conservative journal is explicitly INCOMPLETE, never zero-dollar success',()=>{
 const x=fixture();
 delete x.journals.conservativeControlJournal;
 const r=run(x);assert.equal(r.status,0,r.stderr);
 const v=JSON.parse(r.stdout);
 assert.equal(v.independentMainConservative.completeLedgerExported,false);
 assert.equal(v.independentMainConservative.completedPaperTrades,null);
 assert.equal(v.independentMainConservative.incompleteIfMissingLedger,true);
});
test('rejects unsupported/non-paper data and old records without selected active profile',()=>{
 const x=fixture();x.paperOnly=false;
 assert.notEqual(run(x).status,0);
 const y=fixture();y.researchTicks.forEach(z=>{
  z.decision.shadowProbe.mainStrategyProfile.active='CONSERVATIVE';
 });
 const result=run(y);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/No verified Opportunistic MAIN/);
});
