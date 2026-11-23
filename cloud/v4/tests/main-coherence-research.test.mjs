import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMainDecisionCoherence as audit,assessMainHeldExitCoherence as held,
 MAIN_COHERENCE_RESEARCH_VERSION} from '../src/main-coherence-research.js';
const ticker='KXETH15M-26NOV222015-15';
const now=Date.parse('2026-11-23T02:10:00Z');
const market={ticker};
const side=(s,over={})=>s==='UP'?{
 side:'UP',status:'REJECT',reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
 ask:.30,bid:.29,quantity:9,allIn:2.84,breakEven:2.84/9,
 lowerScenario:.28,centralScenario:.42,requiredEdge:.035,...over}:{
 side:'DOWN',status:'REJECT',reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
 ask:.72,bid:.70,quantity:4,allIn:2.94,breakEven:.735,
 lowerScenario:.59,centralScenario:.80,requiredEdge:.035,...over};
const candidate=(over={})=>({
 status:'WATCH',reason:'NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK',
 score:-.35,geometry:-.5,momentum:.22,structure:-.3,
 officialDistance:-1.2,remainingSeconds:300,
 consideredSideValues:[side('UP'),side('DOWN')],
 contradictionReasons:['MOMENTUM_OPPOSES_DIRECTION'],...over});
const context=(three='UP',five='DOWN')=>({
 three:{trend:three},five:{trend:five}});
const full=(three='UP',five='UP')=>({
 three:{trend:three,price:1700,range:5,tolerance:2,prevClose:1698,
  adDelta:10,bands:{lower:1680,upper:1720},support:null,resistance:null},
 five:{trend:five,price:1700,tolerance:3,
  support:null,resistance:null}
});
const options=(c,ctx)=>audit({market,candidate:c,context:ctx,at:now});

test('research-only output never authorizes BUY, SELL or paper cash mutation',()=>{
 const input={market,candidate:candidate(),context:context(),at:now};
 const before=JSON.stringify(input);
 const r=audit(input);
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.simulatedOrderAuthorized,false);
 assert.equal(r.readOnly,true);
 assert.equal(r.calibratedProbability,null);
 assert.equal(r.tradingRuleChanges,0);
 assert.equal(JSON.stringify(input),before);
});
test('WATCH central margin ranking can differ from composite without allowing a trade',()=>{
 const r=options(candidate(),context());
 assert.equal(r.status,'EVIDENCE_RECONCILED');
 assert.equal(r.baselineDecision,'WATCH');
 assert.equal(r.technical.technicalPreferredSide,'DOWN');
 assert.equal(r.value.side,'UP');
 assert.equal(r.value.status,'UNQUALIFIED_CENTRAL_RANKING');
 assert.equal(r.value.hypotheticalCentralRankingOnly,true);
 assert.equal(r.value.currentlyEligibleBaselineSide,null);
 assert.equal(r.concordance.classification,'PRICE_VALUE_AND_TECHNICAL_DISAGREE');
 assert.equal(r.concordance.selectedSideCountedAsTrade,false);
});
test('for a qualified price-value trade, preserve the actual side, not central heuristic winner',()=>{
 const c=candidate({status:'CANDIDATE',side:'DOWN',
 consideredSideValues:[side('UP'),side('DOWN',{status:'QUALIFIED'})]});
 const r=options(c,context('UP','UP'));
 assert.equal(r.value.side,'DOWN');
 assert.equal(r.value.hypotheticalCentralRankingOnly,false);
 assert.equal(r.value.currentlyEligibleBaselineSide,'DOWN');
 assert.equal(r.technical.technicalPreferredSide,'DOWN');
 assert.ok(r.concordance.flags.includes('CLOSED_3M_TREND_OPPOSES_VALUE_SIDE'));
 assert.equal(r.executionAuthorized,false);
});
test('composite/value alignment and 3m contradiction are different facts',()=>{
 const c=candidate({status:'CANDIDATE',side:'DOWN',
 consideredSideValues:[side('UP'),side('DOWN',{status:'QUALIFIED'})]});
 const r=options(c,context('UP','DOWN'));
 assert.equal(r.concordance.scoreAndValueAgree,true);
 assert.equal(r.concordance.classification,'COMPOSITE_ALIGNED_BUT_CLOSED_TREND_OPPOSED');
});
test('signaled families are correlated: never count EMA RSI MACD as independent votes',()=>{
 const r=options(candidate(),context());
 assert.equal(r.familyCountAsIndependentVotes,false);
 assert.ok(r.concordance.flags.includes('MOMENTUM_OPPOSES_VALUE_SIDE')===false);
 assert.ok(r.concordance.flags.includes('HIGHER_TIMEFRAME_OPPOSES_VALUE_SIDE'));
});
test('incomplete scenario evidence cannot invent a preferred value side',()=>{
 const c=candidate({consideredSideValues:[]});
 const r=options(c,context());
 assert.equal(r.value.side,null);
 assert.equal(r.value.status,'NO_COMPARABLE_SIDE');
 assert.equal(r.concordance.classification,'NO_COMPARABLE_VALUE_SIDE');
});
test('missing candidate score fails transparently, not as evidence of a bad forecast',()=>{
 const c=candidate({score:null});
 const r=options(c,context());
 assert.equal(r.status,'NOT_ASSESSABLE');
 assert.equal(r.tradingRuleChanges,0);
});
test('stale archived structural excerpts are marked incomplete, never treated as a veto',()=>{
 const r=options(candidate(),context());
 assert.equal(r.legacyStructure.status,'NOT_RECONSTRUCTABLE');
 assert.ok(!r.concordance.flags.includes('LEGACY_STRUCTURE_GATE_WOULD_RESTRICT'));
});
test('actual complete support/resistance check is labeled as legacy comparison only',()=>{
 const ctx=full('UP','UP');
 ctx.five.resistance={lower:1699,upper:1703,center:1701,touches:3};
 const r=options(candidate(),ctx);
 assert.equal(r.legacyStructure.status,'LEGACY_STRUCTURE_WOULD_VETO');
 assert.ok(r.concordance.flags.includes('LEGACY_STRUCTURE_GATE_WOULD_RESTRICT'));
 assert.equal(r.executionAuthorized,false);
});
test('full 3m/5m clean trend is not double-counted as 3 extra indicator votes',()=>{
 const c=candidate({status:'CANDIDATE',side:'UP',score:.55,
  geometry:.2,momentum:.1,structure:.8,officialDistance:2,
  consideredSideValues:[side('UP',{status:'QUALIFIED'}),side('DOWN')]});
 const r=options(c,full('UP','UP'));
 assert.equal(r.concordance.classification,'PRICE_VALUE_AND_TECHNICAL_ALIGNED');
 assert.equal(r.legacyStructure.status,'AVAILABLE_AS_CONTEXT');
 assert.equal(r.familyCountAsIndependentVotes,false);
});
const pos=(entry=.5)=>({ticker,side:'UP',entry,qty:2,target:1700,
 closeTime:'2026-11-23T02:15:00Z'});
const book=(bid=.8,at=now)=>({
 ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
 valid:true,fresh:true,receivedAt:at,
 yesBid:{price:bid,sizeFp:9},noBid:{price:.19,sizeFp:9}
});
test('at 96c with >1m remain original take-profit is reported, but no sell is authorized',()=>{
 const r=held({position:pos(),book:book(.96),now});
 assert.equal(r.status,'EXIT_EVIDENCE_RECONCILED');
 assert.equal(r.originalExit,'BASELINE_96C_TAKE_PROFIT');
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.wouldChangeExit,false);
});
test('a 40% decline inside final 6m takes precedence over any profit exit research',()=>{
 const r=held({position:pos(),book:book(.30),now});
 assert.equal(r.originalExit,'BASELINE_EMERGENCY_STOP');
 assert.equal(r.contractPriceDecline,.4);
});
test('96c inside final minute does not prematurely create an early profit exit',()=>{
 const at=Date.parse('2026-11-23T02:14:20Z');
 const r=held({position:pos(),book:book(.97,at),now:at});
 assert.equal(r.originalExit,'BASELINE_HOLD_OR_WAIT_SETTLEMENT');
});
test('a 40% stop can remain active within the final minute',()=>{
 const at=Date.parse('2026-11-23T02:14:20Z');
 const r=held({position:pos(),book:book(.30,at),now:at});
 assert.equal(r.originalExit,'BASELINE_EMERGENCY_STOP');
});
test('no fresh authenticated price or too little depth means no paper exit is assumed',()=>{
 const bad=book(.96,now-7000);
 assert.equal(held({position:pos(),book:bad,now}).status,'NO_VERIFIED_EXIT_BOOK');
 const shallow=book(.96);shallow.yesBid.sizeFp=1;
 assert.equal(held({position:pos(),book:shallow,now}).status,
  'NO_EXECUTABLE_DEPTH_EVIDENCE');
});
test('after contract closes, scoring waits for official settlement rather than guessing',()=>{
 const at=Date.parse('2026-11-23T02:15:30Z');
 const r=held({position:pos(),book:book(.96,at),now:at});
 assert.equal(r.status,'AWAIT_OFFICIAL_RESULT');
});
test('technical opposition can be annotated without becoming a new early exit',()=>{
 const idx={indexId:'ETHUSD_RTI',validValuesVerified:true,
  sourceAt:now-1000,price:1694};
 const one={sd:1,last:1693,e8:1695,e21:1697,rNow:35,
  mNow:-.4,sNow:.1,three:-6};
 const five={rsi:35,e21:1695,e50:1702};
 const r=held({position:pos(),book:book(.77),now,index:idx,one,five,
  context:full('DOWN','DOWN')});
 assert.equal(r.status,'EXIT_EVIDENCE_RECONCILED');
 assert.ok(r.flags.includes('HELD_SIDE_OPPOSED_BY_COMPOSITE'));
 assert.equal(r.originalExit,'BASELINE_HOLD_OR_WAIT_SETTLEMENT');
 assert.equal(r.wouldChangeExit,false);
});
