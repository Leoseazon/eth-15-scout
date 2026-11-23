import test from 'node:test';
import assert from 'node:assert/strict';
import {observeQualityRevisions as observe,REVISED_POLICY,SHADOW_QUALITY_VERSION}
 from '../src/shadow-quality-revisions.js';
import {selectRevisedFirstConfirmed as first,
 joinRevisedOfficialOutcomes as join,summarizeRevisedOutcomes as summary}
 from '../src/shadow-quality-scoring.js';

const at=Date.parse('2026-11-23T03:10:00Z');
const ticker='KXETH15M-26NOV222115-15';
const target=1750;
const validWitness=()=>Object.fromEntries([
 'officialIndexFresh','authenticatedBookFresh','sameTickerBook',
 'kraken1mClosed','kraken3mClosed','kraken5mClosed',
 'baselineSpreadDepthAndFeeChecksPassed'].map(k=>[k,true]));
const fee=(p,q)=>Math.ceil(Math.max(0,.07*q*p*(1-p))*100-1e-8)/100;
const rejects=({ask=.3,bid=.29,qty=9,central=.42,lower=.29}={})=>{
 const cost=qty*ask+fee(ask,qty);
 return {side:'UP',status:'REJECT',
  reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
  ask,bid,spread:ask-bid,quantity:qty,allIn:Number(cost.toFixed(6)),
  breakEven:Number((cost/qty).toFixed(6)),
  centralScenario:central,lowerScenario:lower,requiredEdge:.035};
};
function fixture({now=at,indexPrice=1749,
  a=.3,b=.29,qty=9,central=.42,lower=.29,
  trend='UP',score=.3,momentum=.2,
  delta=1}={}){
 const r=rejects({ask:a,bid:b,qty,central,lower});
 const original={A_STRESS_RELAXED:{status:'SHADOW_RESEARCH_CANDIDATE',
    proposed:{side:'UP'}},
   B_EXECUTION_FILTERED:{status:'SHADOW_RESEARCH_CANDIDATE',
    proposed:{side:'UP'}}};
 return {
  market:{ticker,floor_strike:target,
   close_time:new Date(at+300000).toISOString()},
  index:{indexId:'ETHUSD_RTI',validValuesVerified:true,
   price:indexPrice,sourceAt:now-1000},
  one:{sd:1,three:delta},
  context:{three:{trend,closedAt:Math.floor(now/180000)*180-180}},
  book:{ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
   valid:true,fresh:true,crossed:false,receivedAt:now-1000,
   yesAsk:{price:a,sizeFp:30},yesBid:{price:b,sizeFp:30},
   noAsk:{price:1-b,sizeFp:30},noBid:{price:1-a,sizeFp:30}},
  report:{status:'WATCH',candidate:{score,momentum,
   consideredSideValues:[r]}},
  sourceWitness:validWitness(),originalPolicies:original,
  riskMode:'NORMAL',alreadyTraded:false,now
 };
}
function pair(time, price, {trend='UP',ask=.3}={}){
 const x=fixture({now:time,indexPrice:price,trend,
  a:ask,b:ask-.01,qty:ask>.5?4:9,
  central:ask>.5?.80:.42,lower:ask>.5?.64:.29});
 const revised=observe(x);
 return {id:time,paperOnly:true,shadowOnly:true,observedAt:time-200,
  finishedAt:time+500,closeAt:at+300000,ticker,
  decision:{shadowProbe:{prospectiveShadow:{revised}}}};
}
function official(outcome='UP'){
 const closeAt=at+300000;
 return {ticker,closeAt,settledAt:closeAt+5000,
  status:'OFFICIAL_RESULT',exchangeStatus:'finalized',
  outcome,source:'Kalshi official results'};
}
test('frozen research limits cannot mutate',()=>{
 assert.ok(Object.isFrozen(REVISED_POLICY));
 assert.ok(Object.isFrozen(REVISED_POLICY.A2_RECOVERY));
});
test('same-tick valid behind-target UP can qualify all three research observations',()=>{
 const r=observe(fixture());
 assert.equal(r.version,SHADOW_QUALITY_VERSION);
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.readOnly,true);
 for(const p of Object.keys(REVISED_POLICY)){
  assert.equal(r.policies[p].status,'QUALIFYING_QUALITY_OBSERVATION',p);
  assert.equal(r.policies[p].executionAuthorized,false);
  assert.equal(r.policies[p].confirmed,false);
  assert.equal(r.policies[p].proposed.targetGapSigned,-1);
 }
 assert.equal(r.policies.C2_EVIDENCE.proposed.affordableAt50c,true);
 assert.equal(r.policies.C2_EVIDENCE.proposed.quantityAt50c,1);
});
test('no mutation of original baseline data, book or A/B/C research',()=>{
 const x=fixture();const before=JSON.stringify(x);
 observe(x);
 assert.equal(JSON.stringify(x),before);
});
test('unverified witness, stale book, unknown mode and already traded fail closed',()=>{
 for(const change of [
  {sourceWitness:{...validWitness(),officialIndexFresh:false}},
  {book:{...fixture().book,receivedAt:at-7000}},
  {riskMode:'HARD'},{alreadyTraded:true}
 ]){
  const r=observe({...fixture(),...change});
  for(const p of Object.values(r.policies))
   assert.equal(p.status,'NO_QUALITY_OBSERVATION');
 }
});
test('A2/B2 require original shadow and conservative baseline WATCH; C2 remains independent',()=>{
 const x=fixture();
 x.originalPolicies={};
 const r=observe(x);
 assert.equal(r.policies.A2_RECOVERY.reason,'ORIGINAL_POLICY_NOT_QUALIFIED');
 assert.equal(r.policies.B2_EXECUTION.reason,'ORIGINAL_POLICY_NOT_QUALIFIED');
 assert.equal(r.policies.C2_EVIDENCE.status,'QUALIFYING_QUALITY_OBSERVATION');
});
test('explicit 3m opposing reversal is not treated as growing recovery',()=>{
 const r=observe(fixture({trend:'DOWN'}));
 for(const p of Object.values(r.policies))
  assert.equal(p.status,'NO_QUALITY_OBSERVATION');
});
test('rising RSI-like momentum cannot substitute for actual directional price change',()=>{
 const r=observe(fixture({delta:-1}));
 for(const p of Object.values(r.policies))
  assert.equal(p.status,'NO_QUALITY_OBSERVATION');
});
test('neutral 3m is allowed with directional 1m recovery evidence, not a mandatory hard veto',()=>{
 const r=observe(fixture({trend:'NEUTRAL'}));
 assert.equal(r.policies.C2_EVIDENCE.status,'QUALIFYING_QUALITY_OBSERVATION');
});
test('premium above 50c can qualify C2 quality but is NOT a 50c sized hypothetical trade',()=>{
 const x=fixture({a:.65,b:.64,qty:4,central:.80,lower:.64});
 const r=observe(x);
 assert.equal(r.policies.C2_EVIDENCE.status,'QUALIFYING_QUALITY_OBSERVATION');
 assert.equal(r.policies.C2_EVIDENCE.proposed.affordableAt50c,false);
 assert.equal(r.policies.C2_EVIDENCE.proposed.quantityAt50c,0);
 assert.equal(r.policies.C2_EVIDENCE.proposed.hypotheticalAllIn50c,null);
});
test('C2 half-dollar hypothesis reduces quantity to book depth instead of falsely rejecting',()=>{
 const x=fixture({a:.15,b:.14,qty:18,central:.42,lower:.28});
 x.book.yesAsk.sizeFp=2;
 x.book.yesBid.sizeFp=2;
 const r=observe(x);
 const candidate=r.policies.C2_EVIDENCE;
 assert.equal(candidate.status,'QUALIFYING_QUALITY_OBSERVATION');
 assert.equal(candidate.proposed.affordableAt50c,true);
 assert.equal(candidate.proposed.quantityAt50c,2);
 assert.ok(candidate.proposed.hypotheticalAllIn50c<=.50);
});
test('A2/B2/C2 confirmation must not straddle different completed three-minute candles',()=>{
 const before=Date.parse('2026-11-23T03:11:50Z');
 const after=before+15000;
 assert.equal(first([pair(before,1749),pair(after,1749.5)]).length,0);
});
test('only two consecutive observations with actual official target progress confirm an against-target recovery',()=>{
 const a=pair(at,1749);
 assert.equal(first([a]).length,0);
 const b=pair(at+15000,1749.40);
 assert.equal(first([b,a]).length,3);
 const s=first([b,a]);
 assert.ok(s.every(x=>x.targetGapAtFirst<0));
 assert.ok(s.every(x=>x.targetGapAtConfirmation>x.targetGapAtFirst));
 assert.ok(s.every(x=>x.firstObservedAt===at+15000));
});
test('same target gap across two ticks is NOT a confirmed reversal',()=>{
 assert.equal(first([pair(at,1749),pair(at+15000,1749)]).length,0);
});
test('moving farther away from target cannot be rescued by a bullish model',()=>{
 assert.equal(first([pair(at,1749),pair(at+15000,1748.7)]).length,0);
});
test('progress below 25c threshold is insufficient with sigma=1',()=>{
 assert.equal(first([pair(at,1749),pair(at+15000,1749.20)]).length,0);
});
test('missed intermediate tick and >35s gap break confirmation',()=>{
 const missing=pair(at+15000,1749.35);
 delete missing.decision.shadowProbe.prospectiveShadow.revised;
 assert.equal(first([pair(at,1749),missing,pair(at+30000,1749.9)]).length,0);
 assert.equal(first([pair(at,1749),pair(at+45000,1749.9)]).length,0);
});
test('invalid future timestamps and old outcomes fail validation',()=>{
 const bad=pair(at+15000,1749.4);
 bad.decision.shadowProbe.prospectiveShadow.revised.policies.A2_RECOVERY
  .observedAt=at+120000;
 assert.equal(first([pair(at,1749),bad]).length,2);
});
test('one first confirmed entry per policy+contract; cannot pick later winning side',()=>{
 const x=first([pair(at,1749),pair(at+15000,1749.5),
  pair(at+30000,1749.8)]);
 assert.equal(x.length,3);
 assert.ok(x.every(s=>s.firstObservedAt===at+15000));
});
test('official outcomes join only after frozen first signals; no inferred fills',()=>{
 const s=first([pair(at,1749),pair(at+15000,1749.5)]);
 const win=join(s,[official('UP')]);
 assert.equal(win.length,3);
 assert.ok(win.every(x=>x.directionCorrect===true));
 assert.ok(win.every(x=>x.actualFillVerified===false));
 assert.ok(win.every(x=>x.hypotheticalHoldToSettlementNet!==null));
 const loss=join(s,[official('DOWN')]);
 assert.ok(loss.every(x=>x.directionCorrect===false));
 const pend={...official(),status:'PENDING'};
 assert.ok(join(s,[pend]).every(x=>x.directionCorrect===null));
});
test('C2 quality-only above 50c has no impossible all-in 50c or monetary P&L',()=>{
 const s=first([pair(at,1749,{ask:.65}),pair(at+15000,1749.5,{ask:.65})]);
 const c=join(s,[official()]).find(x=>x.policy==='C2_EVIDENCE');
 assert.ok(c);
 assert.equal(c.affordableAt50c,false);
 assert.equal(c.quantity,0);
 assert.equal(c.allIn,null);
 assert.equal(c.hypotheticalHoldToSettlementNet,null);
 const stats=summary(join(s,[official()]));
 assert.equal(stats.policies.C2_EVIDENCE.priceCounterfactualsScored,0);
});
