import test from 'node:test';
import assert from 'node:assert/strict';
import {observeProspectiveShadow} from '../src/shadow-research-observer.js';

const at=Date.parse('2026-11-22T18:11:00.000Z');
const market={ticker:'KXETH15M-26NOV221215-15',
 close_time:'2026-11-22T18:15:00.000Z',floor_strike:'1780'};
const candle=seconds=>Math.floor(at/(seconds*1000))*seconds-seconds;
const rejected=(more={})=>({side:'UP',status:'REJECT',
 reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
 ask:.55,bid:.54,spread:.01,quantity:5,allIn:2.83,breakEven:.566,
 lowerScenario:.51,centralScenario:.70,requiredEdge:.035,...more});
const input=(changes={})=>({now:at,market,report:{
 status:'WATCH',notice:'PASS / WATCH: NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK',
 candidate:{consideredSideValues:[rejected()]}},
 index:{indexId:'ETHUSD_RTI',validValuesVerified:true,
 sourceAt:at-3000,price:1781},
 book:{ticker:market.ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
 valid:true,fresh:true,crossed:false,receivedAt:at-2000},
 one:{sd:1},five:{rsi:50},
 context:{oneClosedAt:candle(60),
  three:{closedAt:candle(180)},five:{closedAt:candle(300)}},
 feedChecks:{kraken1m:{ok:true},kraken5m:{ok:true}},
 streamStatus:{connected:true,targetTicker:market.ticker},
 riskMode:'NORMAL',blocked:[],...changes});
const run=x=>observeProspectiveShadow(input(x));
const candidate=result=>{
 assert.equal(result.executionAuthorized,false);
 assert.equal(result.readOnly,true);
 assert.equal(result.calibratedProbability,null);
 assert.equal(result.outcomeAvailableAtEvaluation,false);
 assert.equal(result.policies.A_STRESS_RELAXED.status,'SHADOW_RESEARCH_CANDIDATE');
 assert.equal(result.policies.B_EXECUTION_FILTERED.status,'SHADOW_RESEARCH_CANDIDATE');
 assert.ok(!('order' in result));
};
const noSignal=(r,reason)=>{
 for(const p of Object.values(r.policies)){
  assert.equal(p.status,'NO_SHADOW_SIGNAL');
  assert.equal(p.executionAuthorized,false);
  if(reason)assert.equal(p.reason,reason);
 }
};

test('both frozen research policies can observe one same-tick conservative rejection without authorization',()=>{
 const r=run();candidate(r);
 assert.equal(r.firstPerTickerSelection,'DEFERRED_TO_CHRONOLOGICAL_SCORER');
});
test('observer never mutates market, report, book, index, bankroll or risk inputs',()=>{
 const i=input(),before=JSON.stringify(i);
 candidate(observeProspectiveShadow(i));
 assert.equal(JSON.stringify(i),before);
});
test('a disconnected authenticated websocket vetoes both policies',()=>{
 noSignal(run({streamStatus:{connected:false,targetTicker:market.ticker}}),
  'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('an invalid or stale book vetoes both policies',()=>{
 for(const book of [
  {...input().book,fresh:false},
  {...input().book,valid:false},
  {...input().book,receivedAt:at-6000},
  {...input().book,source:'KALSHI_OFFICIAL_REST_ORDERBOOK'}
 ])noSignal(run({book}),'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('a mismatched ticker or crossed book vetoes both policies',()=>{
 noSignal(run({book:{...input().book,ticker:'KXETH15M-OTHER'}}),
  'REQUIRED_VERIFIED_SOURCE_MISSING');
 noSignal(run({book:{...input().book,crossed:true}}),
  'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('official index missing, stale, wrong ID or unverified vetoes both',()=>{
 for(const index of [
  {...input().index,sourceAt:at-20000},
  {...input().index,indexId:'OTHER'},
  {...input().index,validValuesVerified:false},
  null
 ])noSignal(run({index}),'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('only exactly latest completed 1m, 3m and 5m structures count as valid',()=>{
 const c=input().context;
 for(const context of [
  {...c,oneClosedAt:c.oneClosedAt-60},
  {...c,three:{closedAt:c.three.closedAt-180}},
  {...c,five:{closedAt:c.five.closedAt-300}}
 ])noSignal(run({context}),'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('a failed Kraken 1m or 5m source vetoes both',()=>{
 for(const feedChecks of [
  {...input().feedChecks,kraken1m:{ok:false}},
  {...input().feedChecks,kraken5m:{ok:false}}
 ])noSignal(run({feedChecks}),'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('a non-conservative baseline reason or already-approved baseline trade cannot signal',()=>{
 noSignal(run({report:{status:'WATCH',candidate:{
  consideredSideValues:[rejected({reason:'SPREAD_TOO_WIDE'})]}}}),
  'REQUIRED_VERIFIED_SOURCE_MISSING');
 noSignal(run({report:{status:'PAPER_BUY',candidate:{
  consideredSideValues:[rejected()]}}}),
  'BASELINE_NOT_WATCHING');
});
test('an already-traded ticker cannot receive a second shadow signal',()=>{
 noSignal(run({blocked:[market.ticker]}),'TRADED_OR_RISK_MODE');
});
test('risk modes SOFT and HARD remain non-qualifying',()=>{
 for(const riskMode of ['SOFT','HARD','UNKNOWN'])
  noSignal(run({riskMode}),'TRADED_OR_RISK_MODE');
});
test('opening buffer and final cutoff are preserved for both policies',()=>{
 noSignal(run({now:Date.parse('2026-11-22T18:00:20.000Z')}),
  'OUTSIDE_PRESERVED_ENTRY_WINDOW');
 noSignal(run({now:Date.parse('2026-11-22T18:14:00.000Z')}),
  'OUTSIDE_PRESERVED_ENTRY_WINDOW');
});
test('valid source witness is mandatory even if central scenarios look attractive',()=>{
 const r=run({streamStatus:{connected:true,targetTicker:market.ticker},
  book:{...input().book,receivedAt:at-5500}});
 noSignal(r,'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('frozen reader has zero new APIs, durable writes, or execution hooks',()=>{
 const r=run();
 assert.ok(Object.values(r.policies).every(x=>x.executionAuthorized===false));
 assert.ok(!('paperBuy' in r)&&!('paperSell' in r));
});
