import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCandidateCObservation as C,CANDIDATE_C_LIMITS,
 CANDIDATE_C_POLICY,CANDIDATE_C_SPEC} from '../src/candidate-c-observer.js';
const now=Date.parse('2026-11-22T18:11:00Z');
const ticker='KXETH15M-26NOV221215-15';
const allWitness=()=>Object.fromEntries(['officialIndexFresh',
 'authenticatedBookFresh','sameTickerBook','kraken1mClosed',
 'kraken3mClosed','kraken5mClosed',
 'baselineSpreadDepthAndFeeChecksPassed'].map(k=>[k,true]));
const rejected=(o={})=>({side:'UP',status:'REJECT',
 reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
 ask:.30,bid:.29,spread:.01,quantity:9,allIn:2.84,
 breakEven:2.84/9,centralScenario:.42,lowerScenario:.285,
 requiredEdge:.035,...o});
const args=(over={})=>({
 market:{ticker,close_time:'2026-11-22T18:15:00.000Z'},
 report:{status:'WATCH',candidate:{consideredSideValues:[rejected()]}},
 book:{ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
  crossed:false,receivedAt:now-2000,
  yesAsk:{price:.30,sizeFp:12},yesBid:{price:.29,sizeFp:12},
  noAsk:{price:.72,sizeFp:10},noBid:{price:.69,sizeFp:10}},
 context:{three:{trend:'UP',closedAt:Math.floor(now/180000)*180-180}},
 sourceWitness:allWitness(),riskMode:'NORMAL',alreadyTraded:false,now,...over});
const status=(over={})=>C(args(over));
test('preregistered moderate thresholds stay explicit and frozen',()=>{
 assert.equal(CANDIDATE_C_LIMITS.centralExtra,.04);
 assert.equal(CANDIDATE_C_LIMITS.minimumLowerEdge,-.045);
 assert.equal(CANDIDATE_C_LIMITS.maxAllIn,.50);
 assert.equal(CANDIDATE_C_LIMITS.maxSpread,.03);
 assert.equal(CANDIDATE_C_LIMITS.requiredConsecutiveTicks,2);
 assert.equal(Object.isFrozen(CANDIDATE_C_LIMITS),true);
});
test('a genuine conservative WATCH can produce research observation, never a paper BUY',()=>{
 const result=status();
 assert.equal(result.status,'QUALIFYING_OBSERVATION');
 assert.equal(result.policy,CANDIDATE_C_POLICY);
 assert.equal(result.version,CANDIDATE_C_SPEC);
 assert.equal(result.readOnly,true);
 assert.equal(result.executionAuthorized,false);
 assert.equal(result.calibratedProbability,null);
 assert.equal(result.confirmationStatus,'PENDING_NEXT_CONSECUTIVE_OBSERVATION');
 assert.equal(result.proposed.ask,.30);
 assert.equal(result.proposed.quantity,1);
 assert.equal(result.proposed.entryFee,.02);
 assert.equal(result.proposed.allIn,.32);
 assert.equal(result.proposed.breakEven,.32);
 assert.equal(result.proposed.lowerEdge,-.035);
 assert.equal(result.proposed.centralEdge,.10);
 assert.equal(result.proposed.actualFillVerified,false);
});
test('source object is not mutated or charged',()=>{
 const original=args(),s=JSON.stringify(original);
 status(original);
 assert.equal(JSON.stringify(original),s);
});
test('a 3m UP trend will not approve a DOWN reversal despite strong central model',()=>{
 const change=args();
 change.report.candidate.consideredSideValues=[rejected({side:'DOWN',
  ask:.30,bid:.29,spread:.01,quantity:9,allIn:2.84,breakEven:2.84/9})];
 assert.equal(status(change).status,'NO_C_OBSERVATION');
});
test('neutral 3m structure must wait, not infer direction',()=>{
 assert.equal(status({context:{three:{trend:'NEUTRAL',closedAt:300}}}).reason,
  'THREE_MIN_TREND_UNCONFIRMED');
});
test('stale Kalshi book or REST depth proxy cannot qualify',()=>{
 for(const book of [
  {...args().book,fresh:false},
  {...args().book,receivedAt:now-7000},
  {...args().book,source:'KALSHI_OFFICIAL_REST_ORDERBOOK'},
  {...args().book,ticker:'KXETH15M-DIFFERENT'},
  {...args().book,crossed:true},
  {...args().book,valid:false}
 ])assert.equal(status({book}).status,'NO_C_OBSERVATION');
});
test('any unverified prerequisite blocks C without mutating A/B',()=>{
 for(const key of Object.keys(allWitness())){
  assert.equal(status({sourceWitness:{...allWitness(),[key]:false}}).reason,
   'SAME_TICK_SOURCE_UNVERIFIED');
 }
});
test('SOFT/HARD risk and already-traded contract both veto',()=>{
 for(const riskMode of ['SOFT','HARD','UNKNOWN'])
  assert.equal(status({riskMode}).reason,'RISK_OR_ALREADY_TRADED');
 assert.equal(status({alreadyTraded:true}).reason,'RISK_OR_ALREADY_TRADED');
});
test('a baseline paper BUY and non-conservative WATCH cannot be repurposed',()=>{
 assert.equal(status({report:{status:'PAPER_BUY',candidate:{
  consideredSideValues:[rejected()]}}}).status,'NO_C_OBSERVATION');
 assert.equal(status({report:{status:'WATCH',candidate:{
  consideredSideValues:[rejected({reason:'PRICE_TOO_HIGH'})]}}}).status,'NO_C_OBSERVATION');
});
test('central evidence must improve beyond baseline margin after resized fees',()=>{
 const r=args();
 r.report.candidate.consideredSideValues=[rejected({centralScenario:.39})];
 assert.equal(status(r).status,'NO_C_OBSERVATION');
});
test('stress scenario cannot drop more than 4.5 points below resized breakeven',()=>{
 const r=args();
 r.report.candidate.consideredSideValues=[rejected({lowerScenario:.26})];
 assert.equal(status(r).status,'NO_C_OBSERVATION');
});
test('no quote above 50c can be represented as an actual 50c capped paper entry',()=>{
 const r=args();
 r.report.candidate.consideredSideValues=[rejected({ask:.55,bid:.54,
  spread:.01,quantity:5,allIn:2.84,breakEven:2.84/5,
  centralScenario:.75,lowerScenario:.55})];
 r.book.yesAsk.price=.55;r.book.yesBid.price=.54;
 assert.equal(status(r).status,'NO_C_OBSERVATION');
});
test('bid/ask integrity and book depth cannot be bypassed',()=>{
 for(const book of [
  {...args().book,yesAsk:{price:.32,sizeFp:10}},
  {...args().book,yesBid:{price:.27,sizeFp:10}},
  {...args().book,yesAsk:{price:.30,sizeFp:0}},
  {...args().book,yesBid:{price:.29,sizeFp:0}}
 ])assert.equal(status({book}).status,'NO_C_OBSERVATION');
});
test('no low-priced sub-20c untested reversal is admitted',()=>{
 const o=args();
 o.report.candidate.consideredSideValues=[rejected({ask:.19,bid:.18,quantity:2,
  allIn:.39,breakEven:.195,centralScenario:.35,lowerScenario:.19})];
 o.book.yesAsk.price=.19;o.book.yesBid.price=.18;
 assert.equal(status(o).status,'NO_C_OBSERVATION');
});
test('required opening and final buffers are retained',()=>{
 assert.equal(status({now:Date.parse('2026-11-22T18:00:10Z')}).status,'NO_C_OBSERVATION');
 assert.equal(status({now:Date.parse('2026-11-22T18:14:00Z')}).status,'NO_C_OBSERVATION');
});
