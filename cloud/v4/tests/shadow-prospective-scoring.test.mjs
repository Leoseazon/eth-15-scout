import test from 'node:test';
import assert from 'node:assert/strict';
import {selectFirstShadowSignals,joinFinalizedOfficialOutcomes,
 summarizeFirstSignals} from '../src/shadow-prospective-scoring.js';
import {SHADOW_SPEC_VERSION} from '../src/shadow-opportunity-policies.js';
const ticker='KXETH15M-26NOV222000-00';
const closeAt=Date.parse('2026-11-23T02:00:00.000Z');
const at=closeAt-500000;
const tick=(when=at,policy='A_STRESS_RELAXED',changes={})=>({
 id:'tick-'+when,observedAt:when-300,finishedAt:when+200,
 closeAt,ticker,paperOnly:true,
 decision:{shadowProbe:{prospectiveShadow:{version:SHADOW_SPEC_VERSION,
 readOnly:true,executionAuthorized:false,outcomeAvailableAtEvaluation:false,
 observedAt:when,policies:{
  [policy]:{version:SHADOW_SPEC_VERSION,policy,
  executionAuthorized:false,calibratedProbability:null,
  status:'SHADOW_RESEARCH_CANDIDATE',ticker,
  proposed:{side:'DOWN',ask:.60,quantity:4,allIn:2.47,
    centralEdge:.12,lowerEdge:-.07}}
 }}}},...changes});
const official=(outcome='DOWN',changes={})=>({
 ticker,closeAt,settledAt:closeAt+1000,status:'OFFICIAL_RESULT',
 exchangeStatus:'finalized',outcome,
 source:'Kalshi public market API (official exchange result)',...changes});
test('first signal is earliest chronological one despite reverse archive order',()=>{
 const first=selectFirstShadowSignals([tick(at+15000),tick(at),tick(at+30000)]);
 assert.equal(first.length,1);
 assert.equal(first[0].firstObservedAt,at);
 assert.equal(first[0].policy,'A_STRESS_RELAXED');
 assert.equal(first[0].actualFillVerified,false);
 assert.equal(first[0].executeAuthorized,false);
});
test('policy A and B each get at most one independent first signal per ticker',()=>{
 const first=selectFirstShadowSignals([tick(at,'A_STRESS_RELAXED'),
  tick(at+15000,'B_EXECUTION_FILTERED'),tick(at+30000,'B_EXECUTION_FILTERED')]);
 assert.equal(first.length,2);
 assert.deepEqual(first.map(x=>x.policy).sort(),
  ['A_STRESS_RELAXED','B_EXECUTION_FILTERED']);
});
test('new market receives its own first-signal slot',()=>{
 const second='KXETH15M-26NOV222015-15';
 const other=tick(at+20000,'A_STRESS_RELAXED',{ticker:second,closeAt:closeAt+900000});
 other.decision.shadowProbe.prospectiveShadow.policies.A_STRESS_RELAXED.ticker=second;
 const first=selectFirstShadowSignals([tick(),other]);
 assert.equal(first.length,2);
});
test('research must be non-executing and stamped before close, no post-close hindsight',()=>{
 for(const bad of [
  tick(closeAt+2000),
  tick(at,'A_STRESS_RELAXED',{paperOnly:false}),
  tick(at,'A_STRESS_RELAXED',{closeAt:at-1}),
  tick(at,'A_STRESS_RELAXED',{observedAt:at-100000})
 ])assert.equal(selectFirstShadowSignals([bad]).length,0);
});
test('no malformed or executable shadow can count as a signal',()=>{
 const keys=[['executionAuthorized',true],['readOnly',false],
  ['outcomeAvailableAtEvaluation',true],['version','UNKNOWN']];
 for(const [k,value] of keys){
  const s=tick();
  s.decision.shadowProbe.prospectiveShadow[k]=value;
  assert.equal(selectFirstShadowSignals([s]).length,0);
 }
});
test('no over-budget, inconsistent quantity/ask or unrecognized policy accepted',()=>{
 for(const change of [{allIn:3.01},{allIn:1.2},{ask:.9},
    {ask:-.01},{quantity:3.5},{centralEdge:NaN}]){
  const t=tick(),p=t.decision.shadowProbe.prospectiveShadow.policies.A_STRESS_RELAXED;
  Object.assign(p.proposed,change);
  assert.equal(selectFirstShadowSignals([t]).length,0);
 }
});
test('first signal respects release notBefore timestamp',()=>{
 assert.equal(selectFirstShadowSignals([tick()],{notBefore:at+1}).length,0);
 assert.equal(selectFirstShadowSignals([tick()],{notBefore:at-1}).length,1);
});
test('official outcome is only attached after proper Kalshi finalization',()=>{
 const first=selectFirstShadowSignals([tick()]);
 for(const bad of [
  official('DOWN',{exchangeStatus:'pending'}),
  official('DOWN',{status:'estimated'}),
  official('DOWN',{source:'untrusted'}),
  official('DOWN',{settledAt:at-1000}),
  official('DOWN',{closeAt:closeAt+1})
 ])assert.equal(joinFinalizedOfficialOutcomes(first,[bad])[0].directionCorrect,null);
});
test('post-close verified direction is not a fill and is not an actual PnL claim',()=>{
 const f=selectFirstShadowSignals([tick()]);
 const s=joinFinalizedOfficialOutcomes(f,[official('DOWN')])[0];
 assert.equal(s.officialOutcome,'DOWN');
 assert.equal(s.directionCorrect,true);
 assert.equal(s.hypotheticalHoldToSettlementNet,1.53);
 assert.equal(s.actualFillVerified,false);
 assert.equal(s.profitIsCounterfactual,true);
 const wrong=joinFinalizedOfficialOutcomes(f,[official('UP')])[0];
 assert.equal(wrong.directionCorrect,false);
 assert.equal(wrong.hypotheticalHoldToSettlementNet,-2.47);
});
test('no outcomes yet leaves success metrics undefined rather than wins',()=>{
 const f=selectFirstShadowSignals([tick()]);
 const scored=joinFinalizedOfficialOutcomes(f,[]);
 assert.equal(scored[0].directionCorrect,null);
 assert.equal(scored[0].hypotheticalHoldToSettlementNet,null);
 const m=summarizeFirstSignals(scored);
 assert.equal(m.policies.A_STRESS_RELAXED.correctRate,null);
 assert.equal(m.policies.A_STRESS_RELAXED.hypotheticalHoldToSettlementNet,null);
});
test('same official result can be joined independently to first A/B decisions',()=>{
 const f=selectFirstShadowSignals([tick(at,'A_STRESS_RELAXED'),
   tick(at+15000,'B_EXECUTION_FILTERED')]);
 const m=summarizeFirstSignals(joinFinalizedOfficialOutcomes(f,[official('DOWN')]));
 for(const p of ['A_STRESS_RELAXED','B_EXECUTION_FILTERED']){
  assert.equal(m.policies[p].officiallyResolved,1);
  assert.equal(m.policies[p].directionCorrect,1);
 }
});
test('does not mutate research records or retrospective official results',()=>{
 const research=[tick()],wins=[official('DOWN')];
 const before=JSON.stringify({research,wins});
 joinFinalizedOfficialOutcomes(selectFirstShadowSignals(research),wins);
 assert.equal(JSON.stringify({research,wins}),before);
});
