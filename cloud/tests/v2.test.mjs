import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPaperState,makeV2Engine} from '../src/v2.js';

test('new cloud paper bot starts disarmed',()=>{
  const s=freshPaperState(); assert.equal(s.armed,false);
  assert.equal(s.cash,100); assert.equal(s.risk,2);
  assert.equal(s.trades.length,0); assert.equal(s.open,null);
});
test('no trade without fresh market data',()=>{
  const s=freshPaperState(); s.armed=true;
  const response=makeV2Engine(s).step(null,null,null,false);
  assert.match(response.notice,/fresh/);
  assert.equal(s.open,null); assert.equal(s.trades.length,0);
});

function fakeMarket(minutes=10){
  return {
    ticker:'KXETH15M-TEST-01',status:'open',close_time:new Date(Date.now()+minutes*60000).toISOString(),
    floor_strike:'1795',yes_ask_dollars:'0.60',yes_bid_dollars:'0.59',
    no_ask_dollars:'0.41',no_bid_dollars:'0.40',
    yes_ask_size_fp:'100',yes_bid_size_fp:'100'
  };
}
const one={
  last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
  rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2
};
const five={e21:1790,e50:1780,macd:2,signal:1,rsi:60};

test('V2 paper logic remains paused unless armed, even with qualifying signals',()=>{
  const s=freshPaperState();makeV2Engine(s).step(fakeMarket(10),one,five,true);
  assert.equal(s.open,null);assert.equal(s.armed,false);
});
test('V2 still blocks opening a position before its 12.5 minute entry gate',()=>{
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(fakeMarket(14),one,five,true);
  assert.equal(s.open,null);
});
test('V2 permits a single qualified simulated entry within 2.5–12.5 minutes',()=>{
  const s=freshPaperState();s.armed=true;
  const market=fakeMarket(10);
  const engine=makeV2Engine(s);engine.step(market,one,five,true);
  assert.ok(s.open);assert.equal(s.open.side,'UP');
  assert.ok(s.open.cost<=2);assert.equal(s.events.filter(e=>e.type==='PAPER BUY').length,1);
  s.open=null;engine.step(market,one,five,true);
  assert.equal(s.open,null);
  assert.equal(s.events.filter(e=>e.type==='PAPER BUY').length,1);
});
test('V2 only records final PASS after expiry and does not duplicate a pass',()=>{
  const s=freshPaperState();s.armed=true;
  s.window={ticker:'TEST-PASS',end:Date.now()-1000,entered:false,seenArmed:true,reason:'No qualified setup'};
  const engine=makeV2Engine(s);engine.step(null,null,null,false);
  engine.step(null,null,null,false);
  assert.equal(s.decisions.length,1);
  assert.equal(s.decisions[0].status,'PASS');
});
