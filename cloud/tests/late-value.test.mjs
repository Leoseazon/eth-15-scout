import test from 'node:test';
import assert from 'node:assert/strict';
import {lateValueGate,LATE_VALUE_POLICY} from '../src/late-value.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';
const strong={last:1798,prev:1794,e8:1794,e8prev:1793,e21:1792,
 rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:4,sd:2};
const slow={e21:1780,e50:1790,macd:-2,signal:-1,rsi:40};
const market=(minutes,price=.85)=>({ticker:'KXETH15M-LATE-VALUE-PAPER',
 status:'active',close_time:new Date(Date.now()+minutes*60000).toISOString(),
 floor_strike:'1795',yes_ask_dollars:String(price),
 yes_bid_dollars:String(Number((price-.01).toFixed(3))),
 no_ask_dollars:String(Number((1-price+.01).toFixed(3))),
 no_bid_dollars:String(Number((1-price).toFixed(3))),
 yes_ask_size_fp:'50',yes_bid_size_fp:'50'});
const proof={side:'UP',price:.85,remaining:7,passed:5,
 families:{price:true,momentum:true,acceleration:true,breadth:3},
 onePrice:1798,strike:1795,volatility:2,threeTrend:'NEUTRAL',
 spread:.01,askSize:50,bidSize:50,expectedQty:1};
test('late-value guard allows 80–89c <=8min with qualifying 5/7 and neutral 3m',()=>{
 assert.equal(LATE_VALUE_POLICY.maxMinutes,8);
 assert.equal(lateValueGate(proof).ok,true);
 assert.equal(lateValueGate({...proof,remaining:8}).ok,true);
 assert.equal(lateValueGate({...proof,remaining:8.01}).ok,false);
 assert.equal(lateValueGate({...proof,remaining:3}).ok,true);
 assert.equal(lateValueGate({...proof,remaining:2.99}).ok,false);
 assert.equal(lateValueGate({...proof,remaining:2.5,passed:6}).ok,true);
 assert.equal(lateValueGate({...proof,remaining:1.49,passed:7}).ok,false);
});
test('late-value requires price plus another family, strike cushion and real depth',()=>{
 for(const change of [{passed:4},{families:{price:false,momentum:true,acceleration:true,breadth:2}},
  {onePrice:1794},{threeTrend:'DOWN'},{spread:.04},
  {askSize:1},{bidSize:1},{expectedQty:0},{riskMode:'SOFT'},
  {price:.90},{price:.79},{onePrice:NaN},{volatility:0}]){
  assert.equal(lateValueGate({...proof,...change}).ok,false,
   'guard fail: '+JSON.stringify(change));
 }
});
test('8m late-value trade can enter with opposing lagging 5m; never bypass 3m opposition',()=>{
 const state=freshPaperState();state.armed=true;
 const ctx=structureFixture();
 ctx.five={...ctx.five,trend:'DOWN'};
 ctx.three={...ctx.three,trend:'NEUTRAL'};
 makeV2Engine(state).step(market(7,.85),strong,slow,true,ctx);
 assert.ok(state.open,'time-aware quote / strike should qualify');
 assert.equal(state.open.strategy,'LATE-VALUE');
 assert.equal(state.open.qty,1);
 assert.ok(state.open.cost<=1.50);
 assert.equal(state.open.strategyVersion,'V3-80C-EIGHTMIN-20261120');
 const state2=freshPaperState();state2.armed=true;
 const reject={...ctx,three:{...ctx.three,trend:'DOWN'}};
 makeV2Engine(state2).step(market(7,.85),strong,slow,true,reject);
 assert.equal(state2.open,null,'strongly opposing 3m cannot be bypassed');
});
