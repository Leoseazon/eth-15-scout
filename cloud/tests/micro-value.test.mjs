import test from 'node:test';
import assert from 'node:assert/strict';
import {MICRO_POLICY,microValueGate} from '../src/micro-value.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';
const strong={last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
  rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2};
const slow={e21:1790,e50:1780,macd:2,signal:1,rsi:60};
function market(price=.18,minutes=10,depth=50,spread=.01){
 return {ticker:'KXETH15M-MICROVALUE',status:'active',
   close_time:new Date(Date.now()+minutes*60000).toISOString(),
   floor_strike:'1795',yes_ask_dollars:String(price),
   yes_bid_dollars:String(Number((price-spread).toFixed(3))),
   no_ask_dollars:String(Number((1-price+spread).toFixed(3))),
   no_bid_dollars:String(Number((1-price).toFixed(3))),
   yes_ask_size_fp:String(depth),yes_bid_size_fp:String(depth)};
}
const proof={side:'UP',price:.18,passed:7,slowTrend:true,
  plausible:true,alignment:true,threeTrend:'UP',fiveTrend:'UP',
  structureCaution:false,regimeAgainst:false,strikeReachable:true,
  spread:.01,askSize:50,bidSize:50,qty:2,riskMode:'NORMAL'};
test('under-20c micro-value requires exceptionally convincing 7/7 and 3m/5m agreement',()=>{
 assert.equal(MICRO_POLICY.maxAllInStake,.50);
 assert.equal(MICRO_POLICY.maxAskExclusive,.20);
 assert.equal(microValueGate(proof).ok,true);
 for(const bad of [{passed:6},{slowTrend:false},{plausible:false},
   {alignment:false},{threeTrend:'NEUTRAL'},{fiveTrend:'DOWN'},
   {regimeAgainst:true},{structureCaution:true},{strikeReachable:false},
   {spread:.03},{askSize:3},{bidSize:3},{riskMode:'SOFT'},
   {riskMode:'HARD'},{qty:0},{price:.20},{price:.90}]){
  assert.equal(microValueGate({...proof,...bad}).ok,false,
    JSON.stringify(bad));
 }
});
test('18c BUY is MICRO-VALUE with at most 50c total incl fees and recorded version',()=>{
 const s=freshPaperState();s.armed=true;
 makeV2Engine(s).step(market(.18),strong,slow,true,structureFixture());
 assert.ok(s.open,'exceptionally positive cheap setup should buy');
 assert.equal(s.open.strategy,'MICRO-VALUE');
 assert.equal(s.open.score,7);
 assert.equal(s.open.qty,2);
 assert.ok(s.open.cost<=.50);
 assert.equal(s.open.strategyVersion,'V3-80C-EIGHTMIN-20261120');
 assert.ok(s.events.some(e=>e.type==='PAPER BUY'&&/MICRO-VALUE/.test(e.msg)));
});
test('under-20c does not override 7/7, opposing trend or fee-adjusted exposure',()=>{
 const weak={...strong,rNow:60,rPrev:59}; // RSI direction fails; 6/7
 for(const [one,context,quote] of [
  [weak,structureFixture(),market(.18)],
  [strong,{...structureFixture(),
   three:{...structureFixture().three,trend:'NEUTRAL'}},market(.18)],
  [strong,structureFixture(),market(.18,10,2)],
  [strong,structureFixture(),market(.18,10,50,.03)]
 ]){
   const s=freshPaperState();s.armed=true;
   makeV2Engine(s).step(quote,one,slow,true,context);
   assert.equal(s.open,null,'cheap price must not bypass hard safeguards');
 }
});
test('very cheap 3c entries never spend more than 50c including total fees',()=>{
 const s=freshPaperState();s.armed=true;
 makeV2Engine(s).step(market(.03,10,200,.01),strong,slow,true,structureFixture());
 assert.ok(s.open);
 assert.equal(s.open.strategy,'MICRO-VALUE');
 assert.ok(s.open.qty>2);
 assert.ok(s.open.cost<=.50);
 assert.equal(s.cash,Number((100-s.open.cost).toFixed(2)));
});
test('20c exactly is NOT a micro-value quote, and micro-value never enters under 90s',()=>{
 const normal=freshPaperState();normal.armed=true;
 makeV2Engine(normal).step(market(.20),strong,slow,true,structureFixture());
 assert.ok(normal.open);
 assert.notEqual(normal.open.strategy,'MICRO-VALUE');
 const ending=freshPaperState();ending.armed=true;
 makeV2Engine(ending).step(market(.18,1.25),strong,slow,true,structureFixture());
 assert.equal(ending.open,null);
});
