import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../tools/report-v4-15h-forward.mjs',import.meta.url));
const at=Date.parse('2026-11-23T03:07:00Z');
const close=Date.parse('2026-11-23T03:30:00Z');
const ticker='KXETH15M-26NOV222130-30';
const round=()=>({
 id:1,source:'V4_ISOLATED_ENGINE_TICK',paperOnly:true,shadowOnly:true,
 observedAt:at+8*60000,finishedAt:at+8*60000+120,processingMs:120,
 closeAt:close,ticker,secondsRemaining:(close-at-8*60000)/1000,
 dataStatus:'READY_FOR_HEURISTIC_EVALUATION',lastError:null,
 sampledExitBook:{source:'SAME_TICK_AUTHENTICATED_BOOK_SAMPLE',
  readOnly:true,executionAuthorized:false,
  actualFillVerified:false,ticker,
  observedAt:at+8*60000+120,bookState:'FRESH_SAME_TICK',
  bookReceivedAt:at+8*60000,
  upBid:{price:.55,depth:8},downBid:{price:.44,depth:8},
  indexState:'OFFICIAL_FRESH',
  indexSourceAt:at+8*60000,indexPrice:1751,officialTarget:1750},
 decision:{shadowProbe:{
  mainCoherence:{entry:{version:'V4-MAIN-COHERENCE-R1-20261122',
   status:'EVIDENCE_RECONCILED',baselineReason:'NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK',
   baselineDecision:'WATCH',concordance:{classification:'PRICE_VALUE_AND_TECHNICAL_ALIGNED',
   flags:[]},technical:{technicalPreferredSide:'UP'},
   value:{side:'UP',status:'UNQUALIFIED_CENTRAL_RANKING',
    currentlyEligibleBaselineSide:null}}},
  prospectiveShadow:{version:'V4-SHADOW-PREREG-20261122-v1',
   readOnly:true,executionAuthorized:false,
   outcomeAvailableAtEvaluation:false,
   sourceWitness:{authenticatedBookFresh:true,officialIndexFresh:true},
   policies:{},
   revised:{version:'V4-ABC-QUALITY-V2-20261123',
    readOnly:true,executionAuthorized:false,
    policies:{A2_RECOVERY:{reason:'NO_REVISED_QUALITY_SETUP'},
     B2_EXECUTION:{reason:'NO_REVISED_QUALITY_SETUP'},
     C2_EVIDENCE:{reason:'NO_REVISED_QUALITY_SETUP'}}}}}}});
function fixture(rows=[round()]){
 return {format:'ETH-15 Scout V4 decision audit evidence',
  exportedAt:new Date(at+9*60000).toISOString(),paperOnly:true,
  readOnly:true,completeness:'complete for included records',
  researchTicks:rows,
  journal:{windows:[],trades:[]}};
}
function run(value){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eth-v4-15h-'));
 const file=path.join(dir,'audit.json');
 try{fs.writeFileSync(file,JSON.stringify(value));
  return spawnSync(process.execPath,[cli,file],{encoding:'utf8',
   maxBuffer:8*1024*1024});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('complete report executes on missing trades without inventing phantom fills',()=>{
 const x=run(fixture());
 assert.equal(x.status,0,x.stderr);
 const r=JSON.parse(x.stdout);
 assert.equal(r.cohort.consecutiveMarketCount,60);
 assert.equal(r.cohort.complete,false);
 assert.equal(r.mainBot.paperBuys,0);
 assert.equal(r.originalControls.AandB.policies.A_STRESS_RELAXED.firstRoundSignals,0);
 assert.equal(r.revisedQuality.outcomes.policies.C2_EVIDENCE.uniqueFirstConfirmedContracts,0);
 assert.equal(r.exitStudy.summary.executionAuthorized,false);
 assert.equal(r.all60Markets.length,60);
 assert.equal(r.all60Markets[0].sampledEngineTicks,1);
 assert.equal(r.technicalFeeds.sampledBookFresh,1);
});
test('rejects input without a verified revised release, rather than scoring old archive',()=>{
 const r=round();
 delete r.decision.shadowProbe.prospectiveShadow.revised;
 const x=run(fixture([r]));
 assert.notEqual(x.status,0);
 assert.ok(x.stderr.includes('No complete revised V4 release observations'));
});
test('rejects historical empty evidence and real/trading exports',()=>{
 const d=fixture();d.paperOnly=false;
 const x=run(d);
 assert.notEqual(x.status,0);
 assert.ok(x.stderr.includes('paper-only V4'));
});
