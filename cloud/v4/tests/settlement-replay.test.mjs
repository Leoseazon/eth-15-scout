import test from 'node:test';
import assert from 'node:assert/strict';
import {replaySettlementMarkets} from '../src/settlement-replay.js';
const T=1795320000000;
const ticker='KXETH15M-26NOV211800-00';
const closeTime=new Date(T+7.5*60000).toISOString();
const market={ticker,floor_strike:1800,close_time:closeTime};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,price:1804,sourceAt:T-1000};
const one={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
 crossed:false,receivedAt:T-1000,
 yesBid:{price:.43,sizeFp:'20.00'},yesAsk:{price:.45,sizeFp:'20.00'},
 noBid:{price:.55,sizeFp:'20.00'},noAsk:{price:.57,sizeFp:'20.00'}};
const sample={at:T,ticker,market,index,one,five,context,book,
 oneObservedAt:T-1000,fiveObservedAt:T-1000,marketObservedAt:T-1000};
const truth={ticker,closeAt:Date.parse(closeTime),outcome:'UP',status:'OFFICIAL_RESULT'};
test('actual finalized Kalshi target is scored once, even with many later candidate snapshots',()=>{
 const r=replaySettlementMarkets({snapshots:[sample,{...sample,at:T+1000,
  index:{...index,sourceAt:T},book:{...book,receivedAt:T}}],
  officialWindows:[truth],startAt:T-60000,endAt:T+900000});
 assert.equal(r.officialMarkets,1);assert.equal(r.predictions,1);
 assert.equal(r.correct,1);assert.equal(r.settlementAccuracy,1);
 assert.equal(r.marketCoverage,1);assert.equal(r.alwaysUpBaseline,1);
 assert.equal(r.alwaysDownBaseline,0);
 assert.equal(r.results[0].target,1800);
});
test('forecast on the wrong side has independent incorrect-settlement score',()=>{
 const r=replaySettlementMarkets({snapshots:[sample],
  officialWindows:[{...truth,outcome:'DOWN'}],startAt:T-60000,endAt:T+900000});
 assert.equal(r.predictions,1);assert.equal(r.correct,0);
 assert.equal(r.incorrect,1);assert.equal(r.settlementAccuracy,0);
});
test('future timestamp from any market source is rejected and cannot leak official result',()=>{
 const contaminated=[
 {...sample,index:{...index,sourceAt:T+1}},
 {...sample,oneObservedAt:T+1},
 {...sample,book:{...book,receivedAt:T+1}},
 {...sample,marketObservedAt:null}
 ];
 const r=replaySettlementMarkets({snapshots:contaminated,officialWindows:[truth],
  startAt:T-60000,endAt:T+900000});
 assert.equal(r.invalidSnapshots,4);assert.equal(r.predictions,0);
 assert.equal(r.settlementAccuracy,null);assert.equal(r.passedMarkets,1);
});
test('provisional or nonfinal official result never gets scored',()=>{
 const r=replaySettlementMarkets({snapshots:[sample],
  officialWindows:[{...truth,status:'determined'}],startAt:T-60000,endAt:T+900000});
 assert.equal(r.officialMarkets,0);assert.equal(r.predictions,0);
});
