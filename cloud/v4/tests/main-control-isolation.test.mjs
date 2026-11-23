import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const read=p=>readFileSync(root+p,'utf8');
test('MAIN BUY/SELL and unique official forecast COMMIT before ANY controls run',()=>{
 const w=read('cloud/v4/src/worker.js');
 const main=w.indexOf('report=settlementFirstPaperStep(s,{market,index,one');
 const barrier=w.indexOf('CRITICAL COMMIT BARRIER',main);
 const commit=w.indexOf('this.save(s,{lastTick:Date.now()',barrier);
 const ref=w.indexOf('const plain=evaluateSettlementFirst({',commit);
 const control=w.indexOf('const simulated=evaluateConservativePortfolio(',commit);
 const shadows=w.indexOf('prospectiveShadow=observeProspectiveShadow({',commit);
 assert.ok(main>0&&barrier>main&&commit>barrier&&
  ref>commit&&control>ref&&shadows>control);
 assert.match(w,/report\.status==='PAPER_BUY'\|\|report\.status==='PAPER_SELL'/);
 assert.ok(w.includes("if(forecastToCommit)appendSettlementPrediction(sql,forecastToCommit)"));
 assert.ok(w.includes("this.ctx.storage.transactionSync(()=>{"));
});
test('MAIN profile does not use Conservative cash, risk or blocked tickers',()=>{
 const w=read('cloud/v4/src/worker.js');
 const p=read('cloud/v4/src/settlement-first-paper.js');
 assert.match(w,/profile:this\.mainProfileName/);
 assert.match(w,/priorOfficialIndex:s\.lastVerifiedOfficialForProfile/);
 assert.match(w,/loadConservativePortfolio\(this\.ctx\.storage\.kv\)/);
 assert.match(w,/evaluateConservativePortfolio\(controlState/);
 assert.match(w,/controlState=simulated\.next/);
 assert.match(w,/saveConservativePortfolio\(this\.ctx\.storage\.kv,controlState\)/);
 assert.match(p,/checked\.mainProfile!==profile/);
 assert.match(p,/checked\.profileAssessment\?\.ok/);
});
test('A/B/C and A2/B2/C2 get independent ORIGINAL Conservative reference, never MAIN BUY veto',()=>{
 const w=read('cloud/v4/src/worker.js');
 assert.match(w,/profile:'CONSERVATIVE',priorOfficialIndex:null/);
 assert.match(w,/report:conservativeReference,index,book:decisionBook/);
 assert.match(w,/riskMode:'NORMAL',blocked:\[\]/);
 assert.ok(w.indexOf('prospectiveShadow=observeProspectiveShadow')>
  w.indexOf('report=settlementFirstPaperStep(s,{market,index,one'));
 const observer=read('cloud/v4/src/shadow-research-observer.js');
 assert.match(observer,/evaluateShadowPolicy/);
 assert.match(observer,/for\(const policy of Object\.keys\(SHADOW_POLICIES\)\)/);
 assert.match(observer,/for\(const policy of Object\.keys\(REVISED_POLICY\)\)/);
 assert.match(observer,/catch\{/);
});
test('independent Conservative account and journal never write to MAIN paper ledger',()=>{
 const src=read('cloud/v4/src/conservative-control.js');
 assert.ok(src.includes("CONSERVATIVE_CONTROL_STORAGE_KEY='research.conservative.paper.v1'"));
 assert.doesNotMatch(src,/appendSettlementPrediction\(/);
 assert.doesNotMatch(src,/INSERT INTO trades/);
 assert.doesNotMatch(src,/kv\.put\('runtime'/);
 assert.match(src,/buildPaperSettlement\(/);
 assert.match(src,/controlVersion:CONSERVATIVE_CONTROL_VERSION/);
});
test('dashboard complete export retains separate control ledger and 60-market comparison source',()=>{
 const app=read('v4/app.js'),w=read('cloud/v4/src/worker.js');
 assert.match(app,/conservativeControlJournal=page\.conservativeControlJournal\|\|null/);
 assert.match(app,/return \{format:'ETH-15 Scout V4 research journal'/);
 assert.match(w,/conservativeControlJournal:this\.controlSnapshot\(true\)/);
 assert.match(w,/conservativeControl:this\.controlSnapshot\(\)/);
 const report=read('cloud/v4/tools/report-v4-profile-comparison.mjs');
 assert.match(report,/completeLedgerExported:controlJournalValid/);
 assert.match(report,/cohortEnd=cohortStart\+15\*60\*60\*1000/);
 assert.match(report,/allExecutionsSimulated:true,realFillsVerified:false/);
});
test('release is authorized paper-only; main default research worker remains disarmed',()=>{
 const enabled=read('cloud/wrangler.v4paper.toml');
 const disarmed=read('cloud/wrangler.v4test.toml');
 assert.match(enabled,/V4_MAIN_PROFILE = "OPPORTUNISTIC"/);
 assert.match(enabled,/SCOUT_V4_PAPER_MODE = "enabled"/);
 assert.match(enabled,/V4_SETTLEMENT_FIRST_EXPERIMENT = "true"/);
 assert.match(enabled,/V4_DATA_RESEARCH_AUTHORIZED = "false"/);
 assert.match(enabled,/V4_FULL_BOOK_ARCHIVE_ENABLED = "false"/);
 assert.match(disarmed,/SCOUT_V4_PAPER_MODE = "disabled"/);
 assert.match(disarmed,/V4_SETTLEMENT_FIRST_EXPERIMENT = "false"/);
});
