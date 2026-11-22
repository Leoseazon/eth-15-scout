import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSettlementFirst,SETTLEMENT_FIRST_VERSION} from '../src/settlement-first.js';
const T=1795320000000;
const ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,close_time:new Date(T+7.5*60000).toISOString()};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
 crossed:false,receivedAt:T-1000,yesBid:{price:.43,sizeFp:'15.00'},
 yesAsk:{price:.45,sizeFp:'20.00'},noBid:{price:.55,sizeFp:'20.00'},
 noAsk:{price:.57,sizeFp:'15.00'}};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,sourceAt:T-1000,price:1804};
const one={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,mNow:1,
 sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const input={market,index,one,five,context,book,now:T};
test('correct side of REAL target first, no seven-vote pass or fabricated probability',()=>{
 const r=evaluateSettlementFirst(input);
 assert.equal(r.status,'CANDIDATE',JSON.stringify(r));
 assert.equal(r.side,'UP');assert.equal(r.ask,.45);
 assert.ok(r.officialDistance>0);
 assert.ok(r.normalizedDistance>0);
 assert.equal(r.calibratedProbability,null);
 assert.equal(r.scoreKind,'NON_CALIBRATED_HEURISTIC');
 assert.equal(r.version,SETTLEMENT_FIRST_VERSION);
 assert.equal(r.settlementPredictionVerified,false);
 assert.equal(r.executionVerified,false);
});
test('opposite actual index target with opposite aligned structure gives DOWN',()=>{
 const r=evaluateSettlementFirst({...input,index:{...index,price:1796},
  one:{...one,last:1796,e8:1798,e21:1801,rNow:35,mNow:-.8,sNow:-.1,three:-2},
  five:{rsi:40,e21:1800,e50:1802},
  context:{three:{trend:'DOWN'},five:{trend:'DOWN'}}});
 assert.equal(r.status,'CANDIDATE',JSON.stringify(r));
 assert.equal(r.side,'DOWN');assert.equal(r.ask,.57);
});
test('target/price contradicted by momentum and higher structure can PASS',()=>{
 const r=evaluateSettlementFirst({...input,
  index:{...index,price:1800.2},one:{...one,last:1799,e8:1802,e21:1803,rNow:42,
    mNow:-.8,sNow:0,three:-1},
  five:{rsi:45,e21:1799,e50:1801},
  context:{three:{trend:'DOWN'},five:{trend:'DOWN'}}});
 assert.equal(r.side,'PASS',JSON.stringify(r));
 assert.equal(r.status,'WATCH');
 assert.equal(r.calibratedProbability,null);
});
test('missing official strike or official index never substituted with Kraken',()=>{
 assert.equal(evaluateSettlementFirst({...input,market:{...market,floor_strike:null}}).side,'PASS');
 assert.equal(evaluateSettlementFirst({...input,index:null}).side,'PASS');
 assert.equal(evaluateSettlementFirst({...input,index:{...index,sourceAt:T-20000}}).side,'PASS');
});
test('WebSocket top of book must be usable; REST quotes never treated as fills',()=>{
 assert.equal(evaluateSettlementFirst({...input,book:{...book,source:'KALSHI_REST'}}).side,'PASS');
 assert.equal(evaluateSettlementFirst({...input,book:{...book,receivedAt:T-10000,fresh:true}}).side,'PASS');
 assert.equal(evaluateSettlementFirst({...input,book:{...book,yesAsk:{price:.45,sizeFp:'0.00'}}}).side,'PASS');
});
test('no new entry in final minute, no entry beyond explicit 12.5m',()=>{
 assert.equal(evaluateSettlementFirst({...input,market:{...market,
  close_time:new Date(T+40000).toISOString()}}).side,'PASS');
 assert.equal(evaluateSettlementFirst({...input,market:{...market,
  close_time:new Date(T+13*60000).toISOString()}}).side,'PASS');
});
test('no apparent 90c+ safe bet mechanically overrides economic/time gates',()=>{
 const r=evaluateSettlementFirst({...input,book:{...book,
 yesAsk:{price:.93,sizeFp:'20.00'},yesBid:{price:.90,sizeFp:'20.00'}}});
 assert.equal(r.status,'WATCH');
 assert.equal(r.side,'PASS');
});
