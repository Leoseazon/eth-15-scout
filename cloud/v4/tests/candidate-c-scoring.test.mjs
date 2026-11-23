import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCandidateCFirstConfirmed as first,
 scoreCandidateCConfirmed as resolve,summarizeCandidateC as summarize}
 from '../src/candidate-c-scoring.js';
import {CANDIDATE_C_SPEC,CANDIDATE_C_POLICY}
 from '../src/candidate-c-observer.js';
const close=Date.parse('2026-11-23T03:45:00.000Z');
const at=close-300000,ticker='KXETH15M-26NOV222145-45';
const candle=Math.floor(at/180000)*180-180;
function tick(time=at,side='UP',over={}){
 const c={version:CANDIDATE_C_SPEC,policy:CANDIDATE_C_POLICY,
  status:'QUALIFYING_OBSERVATION',executionAuthorized:false,readOnly:true,
  outcomeAvailableAtEvaluation:false,calibratedProbability:null,
  ticker,observedAt:time,proposed:{side,threeMinuteTrend:side,
   threeClosedAt:candle,ask:.30,bid:.29,observedSpread:.01,
   quantity:1,entryFee:.02,allIn:.32,breakEven:.32,
   centralScenario:.42,lowerScenario:.285,centralEdge:.10,lowerEdge:-.035,
   actualFillVerified:false}};
 const row={id:time,source:'V4_ISOLATED_ENGINE_TICK',paperOnly:true,
  observedAt:time-200,finishedAt:time+500,
  closeAt:close,ticker,
  decision:{shadowProbe:{prospectiveShadow:{candidateC:c}}},
  ...over};
 return row;
}
const result=(side='UP')=>({ticker,closeAt:close,settledAt:close+1000,
 status:'OFFICIAL_RESULT',exchangeStatus:'finalized',
 outcome:side,source:'Kalshi official market result'});
test('C produces zero first signals from a single qualifying tick',()=>{
 assert.equal(first([tick()]).length,0);
});
test('two consecutive same direction observations create ONE research signal at SECOND quote',()=>{
 const r=first([tick(at+15000),tick(at)]);
 assert.equal(r.length,1);
 assert.equal(r[0].firstQualifyingObservedAt,at);
 assert.equal(r[0].firstObservedAt,at+15000);
 assert.equal(r[0].side,'UP');
 assert.equal(r[0].confirmationCount,2);
 assert.equal(r[0].allIn,.32);
 assert.equal(r[0].actualFillVerified,false);
 assert.equal(r[0].executeAuthorized,false);
});
test('later same-contract repetitions never multiply independent trade count',()=>{
 assert.equal(first([tick(at),tick(at+15000),tick(at+30000),
 tick(at+45000)]).length,1);
});
test('direction flip resets confirmation, no lookahead winner substitution',()=>{
 assert.equal(first([tick(at,'UP'),tick(at+15000,'DOWN')]).length,0);
 const f=first([tick(at,'UP'),tick(at+15000,'DOWN'),
  tick(at+30000,'DOWN'),tick(at+45000,'UP')]);
 assert.equal(f.length,1);assert.equal(f[0].side,'DOWN');
 assert.equal(f[0].firstObservedAt,at+30000);
});
test('invalid intervening research tick interrupts adjacent confirmation',()=>{
 const missing=tick(at+15000);
 delete missing.decision.shadowProbe.prospectiveShadow.candidateC;
 assert.equal(first([tick(at),missing,tick(at+30000)]).length,0);
});
test('brief network gap over 35s does not count as consecutive',()=>{
 assert.equal(first([tick(at),tick(at+45000)]).length,0);
});
test('same side on different completed 3m structures does not confirm a single stable signal',()=>{
 const next=tick(at+15000);
 next.decision.shadowProbe.prospectiveShadow.candidateC.proposed.threeClosedAt=candle+180;
 assert.equal(first([tick(at),next]).length,0);
});
test('a new ticker cannot confirm a previous contract',()=>{
 const next=tick(at+15000);
 next.ticker='KXETH15M-26NOV222200-00';
 next.closeAt=close+900000;
 next.decision.shadowProbe.prospectiveShadow.candidateC.ticker=next.ticker;
 assert.equal(first([tick(at),next]).length,0);
});
test('expired or post-close records can never be confirmed',()=>{
 const n1=tick(close+1000),n2=tick(close+16000);
 assert.equal(first([n1,n2]).length,0);
});
test('release cutoff excludes earlier tick even if preceding interval almost qualifies',()=>{
 assert.equal(first([tick(at),tick(at+15000)],{notBefore:at+1}).length,0);
});
test('client-replayed research rows after last event cannot be re-labeled as C',()=>{
 const late=tick(at+15000);
 late.decision.shadowProbe.prospectiveShadow.candidateC.observedAt=at+120000;
 assert.equal(first([tick(at),late]).length,0);
});
test('unverified, unsafe or executable observations never confirm',()=>{
 for(const [key,bad] of [['status','PAPER_BUY'],['executionAuthorized',true],
   ['readOnly',false],['calibratedProbability',.8],
   ['outcomeAvailableAtEvaluation',true],['version','INCORRECT']]){
  const a=tick(at),b=tick(at+15000);
  b.decision.shadowProbe.prospectiveShadow.candidateC[key]=bad;
  assert.equal(first([a,b]).length,0);
 }
});
test('bad paper-sized economics, price, spread and fill flag cannot confirm',()=>{
 for(const [key,bad] of [
  ['allIn',.53],['ask',.95],['observedSpread',.07],['actualFillVerified',true],
  ['quantity',0],['breakEven',.61]
 ]){
  const a=tick(at),b=tick(at+15000);
  b.decision.shadowProbe.prospectiveShadow.candidateC.proposed[key]=bad;
  assert.equal(first([a,b]).length,0);
 }
});
test('official future outcome cannot create first signal and pending outcome remains unresolved',()=>{
 const signals=first([tick(at),tick(at+15000)]);
 // No pending outcome may be counted as a finalized win.
 const pending={...result('UP'),status:'PENDING'};
 assert.equal(resolve(signals,[pending])[0].directionCorrect,null);
 assert.equal(first([tick(at)]).length,0);
});
test('official UP after signal is a direction win, not a fill',()=>{
 const s=resolve(first([tick(at),tick(at+15000)]),[result('UP')]);
 assert.equal(s.length,1);
 assert.equal(s[0].directionCorrect,true);
 assert.equal(s[0].hypotheticalHoldToSettlementNet,.68);
 assert.equal(s[0].profitIsCounterfactual,true);
 assert.equal(s[0].actualFillVerified,false);
});
test('official DOWN counts as wrong and a hypothetical loss, not actual account debit',()=>{
 const s=resolve(first([tick(at),tick(at+15000)]),[result('DOWN')]);
 assert.equal(s[0].directionCorrect,false);
 assert.equal(s[0].hypotheticalHoldToSettlementNet,-.32);
 const stats=summarize(s);
 assert.equal(stats.directionWrong,1);
 assert.equal(stats.hypotheticalHoldToSettlementNet,-.32);
});
test('unresolved markets are not scored as losses or zero-dollar profits',()=>{
 const r=summarize(resolve(first([tick(at),tick(at+15000)]),[]));
 assert.equal(r.unresolved,1);
 assert.equal(r.correctRate,null);
 assert.equal(r.hypotheticalHoldToSettlementNet,null);
});
test('scoring does not mutate research data or official outcomes',()=>{
 const ticks=[tick(at),tick(at+15000)],outcomes=[result('UP')];
 const before=JSON.stringify({ticks,outcomes});
 const scored=resolve(first(ticks),outcomes);
 summarize(scored);
 assert.equal(JSON.stringify({ticks,outcomes}),before);
});
