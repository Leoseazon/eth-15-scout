import test from 'node:test';
import assert from 'node:assert/strict';
import {HONEY_POLICY,honeyPotGate,honeyStopTriggered} from '../src/honey-pot.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';
// Exactly 4 of 7 fast UP checks: EMA8 price, RSI>50,
// positive 3-candle move, MACD acceleration. Others intentionally fail.
const four={last:1799,prev:1797,e8:1798,e8prev:1799,e21:1800,
 rNow:52,rPrev:51,mNow:.4,mPrev:.3,sNow:.5,sPrev:.5,three:2,sd:2};
const three={...four,three:-2};
const slow={e21:1790,e50:1800,macd:-2,signal:-1,rsi:40};
const market=(minutes=1.25,price=.85)=>({
 ticker:'KXETH15M-HONEY-PAPER',status:'active',
 close_time:new Date(Date.now()+minutes*60000).toISOString(),
 floor_strike:'1795',yes_ask_dollars:String(price),
 yes_bid_dollars:String(Number((price-.01).toFixed(3))),
 no_ask_dollars:String(Number((1-price+.01).toFixed(3))),
 no_bid_dollars:String(Number((1-price).toFixed(3))),
 yes_ask_size_fp:'50',yes_bid_size_fp:'50'
});
const proof={side:'UP',price:.85,secondsRemaining:75,
 spread:.01,askSize:50,bidSize:50,krakenPrice:1799,strike:1795,
 oneMinuteVolatility:2,fastChecks:4};
test('honey-pot 4-of-7 gate is STRICTLY under 90 seconds and not in final RTI minute',()=>{
 assert.equal(HONEY_POLICY.minFastChecks,4);
 assert.equal(HONEY_POLICY.maxSecondsRemaining,90);
 assert.equal(HONEY_POLICY.minSecondsRemaining,60);
 assert.equal(honeyPotGate(proof).ok,true);
 assert.equal(honeyPotGate({...proof,fastChecks:3}).ok,false);
 assert.equal(honeyPotGate({...proof,fastChecks:5}).ok,true);
 assert.equal(honeyPotGate({...proof,fastChecks:8}).ok,false);
 for(const sec of [90,90.01,60,59,0,-2])
  assert.equal(honeyPotGate({...proof,secondsRemaining:sec}).ok,false,
   'not eligible '+sec+'s');
 assert.equal(honeyPotGate({...proof,secondsRemaining:89.5}).ok,true);
 assert.equal(honeyPotGate({...proof,secondsRemaining:60.5}).ok,true);
});
test('four fast checks never waive price range, stake, spread, liquidity and strike cushion',()=>{
 for(const change of [{price:.86},{price:.79},{spread:.021},
  {askSize:1},{bidSize:1},{krakenPrice:1795},
  {oneMinuteVolatility:0},{riskMode:'SOFT'},
  {riskMode:'HARD'},{fastChecks:NaN}]){
  assert.equal(honeyPotGate({...proof,...change}).ok,false,
   JSON.stringify(change));
 }
});
test('85c qualifying honey-pot uses actual 4/7 judge and just one paper contract',()=>{
 const s=freshPaperState();s.armed=true;
 const ctx=structureFixture();
 ctx.three={...ctx.three,trend:'DOWN'};
 ctx.five={...ctx.five,trend:'DOWN'};
 makeV2Engine(s).step(market(1.25,.85),four,slow,true,ctx);
 assert.ok(s.open,'should enter only if actual 4/7 strong price evidence present');
 assert.equal(s.open.strategy,'HONEY-POT');
 assert.equal(s.open.score,4);
 assert.equal(s.open.checks.filter(c=>c[1]).length,4);
 assert.equal(s.open.qty,1);
 assert.ok(s.open.cost<=.90);
 assert.equal(s.open.strategyVersion,'V3-80C-EIGHTMIN-20261120');
 assert.ok(s.open.remainingSecondsAtEntry>60&&s.open.remainingSecondsAtEntry<90);
});
test('three fast checks or before 90s or during final 60s cannot use honey-pot',()=>{
 for(const [min,one] of [[1.25,three],[1.50,four],[1.501,four],[.95,four]]){
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(market(min,.85),one,slow,true,structureFixture());
  assert.equal(s.open,null,'incorrect honey-pot buy at '+min+' min');
 }
});
test('honey-pot stop uses 10 percent RELATIVE entry price, on executable bid',()=>{
 assert.equal(HONEY_POLICY.stopLossFraction,.10);
 // 85c x 0.90 = 76.5c. One-cent bids make 76c the first trigger.
 assert.equal(honeyStopTriggered(.85,.77),false);
 assert.equal(honeyStopTriggered(.85,.765),true);
 assert.equal(honeyStopTriggered(.85,.76),true);
 assert.equal(honeyStopTriggered(.85,.75),true);
 // 80c x 0.90 = 72c. This is a 8c drop, not the old 10c rule.
 assert.equal(honeyStopTriggered(.80,.73),false);
 assert.equal(honeyStopTriggered(.80,.72),true);
 assert.equal(honeyStopTriggered(.80,.71),true);
 assert.equal(honeyStopTriggered(.85,NaN),false);
 assert.equal(honeyStopTriggered(.85,-.01),false);
 const s=freshPaperState();s.armed=true;
 const eng=makeV2Engine(s);eng.step(market(1.25,.85),four,slow,true,structureFixture());
 assert.ok(s.open);
 const q=market(1.10,.85);q.yes_bid_dollars='0.76';
 eng.step(q,four,slow,true,structureFixture());
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
 assert.match(s.trades[0].reason,/HONEY-POT stop/);
 assert.match(s.trades[0].reason,/10%/);
 assert.equal(s.trades[0].exitPrice,.76);
 assert.ok(s.trades[0].pnl<0);
 assert.ok(s.events.some(e=>e.type==='PAPER SELL'&&/HONEY-POT stop/.test(e.msg)));
});
test('honey-pot 10 percent stop does NOT sell at a smaller relative drawdown',()=>{
 const s=freshPaperState();s.armed=true;
 const eng=makeV2Engine(s);
 eng.step(market(1.25,.85),four,slow,true,structureFixture());
 assert.ok(s.open);
 const q=market(1.10,.85);q.yes_bid_dollars='0.77';
 eng.step(q,four,slow,true,structureFixture());
 assert.ok(s.open);
 assert.equal(s.trades.length,0);
});
test('10% honey-pot stop overrides final-minute settlement hold when bid remains executable',()=>{
 const s=freshPaperState();s.armed=true;
 const engine=makeV2Engine(s);
 engine.step(market(1.25,.85),four,slow,true,structureFixture());
 assert.equal(s.open?.strategy,'HONEY-POT');
 const quote=market(.75,.85);quote.yes_bid_dollars='0.76';
 engine.step(quote,four,slow,true,structureFixture());
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
 assert.match(s.trades[0].reason,/10%/);
 assert.ok(s.trades[0].remainingSecondsAtExit<=60);
 assert.equal(s.pending.length,0);
});
test('honey-pot avoids invented stop fill when quote depth disappears',()=>{
 const s=freshPaperState();s.armed=true;const eng=makeV2Engine(s);
 eng.step(market(1.25,.85),four,slow,true,structureFixture());
 assert.ok(s.open);
 const quote=market(1.10,.85);
 quote.yes_bid_dollars='0.70';
 quote.yes_bid_size_fp='0';
 eng.step(quote,four,slow,true,structureFixture());
 assert.ok(s.open,'cannot claim paper sale when no executable quote depth');
 assert.equal(s.trades.length,0);
});
