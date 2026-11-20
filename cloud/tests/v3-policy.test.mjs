import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_POLICY,entryBudget,entryGate,profitExitGate} from '../src/v3-policy.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';

const strong = {
  last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
  rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2
};
const slow = {e21:1790,e50:1780,macd:2,signal:1,rsi:60};
const mk = (minutes, price=.60) => ({
  ticker:'KXETH15M-TEST-V3',status:'active',
  close_time:new Date(Date.now()+minutes*60_000).toISOString(),
  floor_strike:'1795',yes_ask_dollars:String(price),
  yes_bid_dollars:String(Number((price-.01).toFixed(2))),
  no_ask_dollars:String(Number((1-price+.01).toFixed(2))),
  no_bid_dollars:String(Number((1-price).toFixed(2))),
  yes_ask_size_fp:'50',yes_bid_size_fp:'50'
});

test('maximum entry cost includes fees and never exceeds $3',()=>{
  assert.equal(PAPER_POLICY.maxStakeIncludingFees,3);
  assert.equal(entryBudget(100,3),3);
  assert.equal(entryBudget(25,3),0.75);
  assert.equal(entryBudget(1000,100),3);
  assert.equal(entryBudget(-1,3),0);
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(mk(10),strong,slow,true);
  assert.ok(s.open);
  assert.ok(s.open.cost<=3);
  assert.ok(s.open.cost>2); // actually uses the new allowance when quotes permit
});

test('80¢+ quotes are blocked with 3+ minutes remaining',()=>{
  for (const remaining of [3,5,10]){
    assert.equal(entryGate({price:.80,remaining,passed:7,slowTrend:true,
      plausible:true,alignment:true,spread:.01}).ok,false);
    const s=freshPaperState();s.armed=true;
    makeV2Engine(s).step(mk(remaining,.80),strong,slow,true);
    assert.equal(s.open,null);
  }
});

test('the final 1.5–3 minutes demand exceptionally strong 7/7 evidence',()=>{
  const opts={price:.83,remaining:2,passed:7,slowTrend:true,
    plausible:true,alignment:true,spread:.02};
  assert.equal(entryGate(opts).ok,true);
  assert.equal(entryGate({...opts,passed:6}).ok,false);
  assert.equal(entryGate({...opts,slowTrend:false}).ok,false);
  assert.equal(entryGate({...opts,spread:.04}).ok,false);
  assert.equal(entryGate({...opts,remaining:1.3}).ok,false);
  assert.equal(entryGate({...opts,price:.96}).ok,false);
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(mk(2,.83),strong,slow,true);
  assert.ok(s.open);assert.ok(s.open.cost<=3);
});

test('normal 96¢ bid triggers a paper exit if enough time remains',()=>{
  assert.equal(profitExitGate(.959,5),'NONE');
  assert.equal(profitExitGate(.96,5),'SELL');
  const s=freshPaperState();s.armed=true;
  const m=mk(10);
  const engine=makeV2Engine(s);
  engine.step(m,strong,slow,true);
  assert.ok(s.open);
  m.yes_bid_dollars='0.96';
  engine.step(m,strong,slow,true);
  assert.equal(s.open,null);
  assert.equal(s.trades.length,1);
  assert.match(s.trades[0].reason,/96¢/);
  engine.step(m,strong,slow,true);
  assert.equal(s.trades.length,1); // one trade per contract, no duplicate
});

test('inside last 60 seconds a 96¢ bid may be held until official settlement',()=>{
  assert.equal(profitExitGate(.96,.99),'HOLD_PENDING');
  assert.equal(profitExitGate(.96,1),'HOLD_PENDING');
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  engine.step(mk(10),strong,slow,true);
  assert.ok(s.open);
  const late=mk(.5);late.yes_bid_dollars='0.97';
  engine.step(late,strong,slow,true);
  assert.ok(s.open);
  assert.equal(s.trades.length,0);
  const expired=mk(-.1);
  engine.step(expired,strong,slow,true);
  assert.equal(s.open,null);
  assert.equal(s.pending.length,1);
  assert.equal(s.trades.length,0); // no invented Kraken settlement
});

test('PASS / WATCH keeps rescanning the SAME market and finalizes only at expiration',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  const m=mk(10);
  const weak={...strong,rNow:49,rPrev:49,three:0,mNow:-1,sNow:1};
  engine.step(m,weak,slow,true);
  assert.equal(s.open,null);
  assert.equal(s.decisions.length,0);
  assert.equal(s.events.filter(x=>x.type==='WATCH').length,1);
  engine.step(m,weak,slow,true);
  assert.equal(s.events.filter(x=>x.type==='WATCH').length,1);
  engine.step(m,strong,slow,true);
  assert.ok(s.open,'same market can qualify after first WATCH');
  assert.equal(s.decisions.length,0,'WATCH is not final PASS');
});

test('unfilled market PASS is recorded only once after expiration',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);const m=mk(10);
  const weak={...strong,rNow:49,rPrev:49,three:0,mNow:-1,sNow:1};
  engine.step(m,weak,slow,true);
  assert.equal(s.decisions.length,0);
  engine.step(null,null,null,false); // no fresh data alone does not finalize
  assert.equal(s.decisions.length,0);
  s.window.end=Date.now()-1;
  engine.step(null,null,null,false);
  engine.step(null,null,null,false);
  assert.equal(s.decisions.length,1);
  assert.equal(s.decisions[0].status,'PASS');
});

test('daily 4% paper realized loss cap still prevents entry',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[{ticker:'LOSS-1',exitAt:Date.now(),pnl:-4.5,confirmed:true}];
  makeV2Engine(s).step(mk(10),strong,slow,true);
  assert.equal(s.open,null);
});
