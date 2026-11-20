import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_POLICY,entryBudget,entryGate,profitExitGate,assessDailyRisk,paperEntryArmed} from '../src/v3-policy.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';

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
  makeV2Engine(s).step(mk(10),strong,slow,true,structureFixture());
  assert.ok(s.open);
  assert.ok(s.open.cost<=3);
  assert.ok(s.open.cost>2); // actually uses the new allowance when quotes permit
});

test('80¢+ quotes are blocked with 3+ minutes remaining',()=>{
  for (const remaining of [3,5,10]){
    assert.equal(entryGate({price:.80,remaining,passed:7,slowTrend:true,
      plausible:true,alignment:true,spread:.01}).ok,false);
    const s=freshPaperState();s.armed=true;
    makeV2Engine(s).step(mk(remaining,.80),strong,slow,true,structureFixture());
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
  makeV2Engine(s).step(mk(2,.83),strong,slow,true,structureFixture());
  assert.ok(s.open);assert.ok(s.open.cost<=3);
});

test('normal 96¢ bid triggers a paper exit if enough time remains',()=>{
  assert.equal(profitExitGate(.959,5),'NONE');
  assert.equal(profitExitGate(.96,5),'SELL');
  const s=freshPaperState();s.armed=true;
  const m=mk(10);
  const engine=makeV2Engine(s);
  engine.step(m,strong,slow,true,structureFixture());
  assert.ok(s.open);
  m.yes_bid_dollars='0.96';
  engine.step(m,strong,slow,true,structureFixture());
  assert.equal(s.open,null);
  assert.equal(s.trades.length,1);
  assert.match(s.trades[0].reason,/96¢/);
  engine.step(m,strong,slow,true,structureFixture());
  assert.equal(s.trades.length,1); // one trade per contract, no duplicate
});

test('inside last 60 seconds a 96¢ bid may be held until official settlement',()=>{
  assert.equal(profitExitGate(.96,.99),'HOLD_PENDING');
  assert.equal(profitExitGate(.96,1),'HOLD_PENDING');
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  engine.step(mk(10),strong,slow,true,structureFixture());
  assert.ok(s.open);
  const late=mk(.5);late.yes_bid_dollars='0.97';
  engine.step(late,strong,slow,true,structureFixture());
  assert.ok(s.open);
  assert.equal(s.trades.length,0);
  // The held position uses the original closeTime captured at entry.
  // Simulate that stored contract actually reaching expiration.
  s.open.closeTime=new Date(Date.now()-1000).toISOString();
  engine.step(null,null,null,false);
  assert.equal(s.open,null);
  assert.equal(s.pending.length,1);
  assert.equal(s.trades.length,0); // no invented Kraken settlement
});

test('PASS / WATCH keeps rescanning the SAME market and finalizes only at expiration',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  const m=mk(10);
  const weak={...strong,rNow:49,rPrev:49,three:0,mNow:-1,sNow:1};
  engine.step(m,weak,slow,true,structureFixture());
  assert.equal(s.open,null);
  assert.equal(s.decisions.length,0);
  assert.equal(s.events.filter(x=>x.type==='WATCH').length,1);
  engine.step(m,weak,slow,true,structureFixture());
  assert.equal(s.events.filter(x=>x.type==='WATCH').length,1);
  engine.step(m,strong,slow,true,structureFixture());
  assert.ok(s.open,'same market can qualify after first WATCH');
  assert.equal(s.decisions.length,0,'WATCH is not final PASS');
});

test('unfilled market PASS is recorded only once after expiration',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);const m=mk(10);
  const weak={...strong,rNow:49,rPrev:49,three:0,mNow:-1,sNow:1};
  engine.step(m,weak,slow,true,structureFixture());
  assert.equal(s.decisions.length,0);
  engine.step(null,null,null,false); // no fresh data alone does not finalize
  assert.equal(s.decisions.length,0);
  s.window.end=Date.now()-1;
  engine.step(null,null,null,false);
  engine.step(null,null,null,false);
  assert.equal(s.decisions.length,1);
  assert.equal(s.decisions[0].status,'PASS');
});

test('12% is a soft threshold with strict setups and a $1.50 inclusive budget',()=>{
  assert.equal(PAPER_POLICY.dailySoftLossFraction,0.12);
  assert.equal(PAPER_POLICY.dailyHardLossFraction,0.20);
  assert.equal(entryBudget(100,3,PAPER_POLICY.softMaxStakeIncludingFees),1.50);
  const atLimit=freshPaperState();atLimit.armed=true;
  atLimit.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
  makeV2Engine(atLimit).step(mk(10),strong,slow,true,structureFixture());
  assert.equal(atLimit.dailyRisk.mode,'SOFT');
  assert.ok(atLimit.open,'strict 7/7 setup should still be eligible at soft threshold');
  assert.ok(atLimit.open.cost<=1.5,'all paper entry fees included');
});

test('net daily loss below $12 permits a qualifying paper entry',()=>{
  const below=freshPaperState();below.armed=true;
  below.trades=[{ticker:'LOSS-1199',exitAt:Date.now(),pnl:-11.99,confirmed:true}];
  makeV2Engine(below).step(mk(10),strong,slow,true,structureFixture());
  assert.ok(below.open,'loss $11.99 should not hit a $12 limit');
  assert.ok(below.open.cost<=3);
});

test('daily safeguard is based on net realized P/L, not gross losing trades',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[
    {ticker:'LOSS-15',exitAt:Date.now(),pnl:-15,confirmed:true},
    {ticker:'WIN-4',exitAt:Date.now(),pnl:4,confirmed:true}
  ];
  makeV2Engine(s).step(mk(10),strong,slow,true,structureFixture());
  assert.ok(s.open,'net -$11 remains above the -$12 threshold');
});

test('20% hard stop forbids new entries even on excellent signals',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[{ticker:'LOSS-20',exitAt:Date.now(),pnl:-20,confirmed:true}];
  makeV2Engine(s).step(mk(10),strong,slow,true,structureFixture());
  assert.equal(s.dailyRisk.mode,'HARD');
  assert.equal(s.open,null);
  assert.ok(s.events.some(e=>/20% paper risk hard stop/i.test(e.msg)));
});

test('at -$19.99 strict paper entries remain possible at $1.50 or less',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[{ticker:'LOSS-1999',exitAt:Date.now(),pnl:-19.99,confirmed:true}];
  makeV2Engine(s).step(mk(10),strong,slow,true,structureFixture());
  assert.equal(s.dailyRisk.mode,'SOFT');
  assert.ok(s.open);
  assert.ok(s.open.cost<=1.5);
});

test('soft mode rejects six-of-seven signals despite valid trend and quote',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
  // RSI9 side of 50 fails, but bullish fast signals otherwise remain strong.
  const six={...strong,rNow:49,rPrev:40};
  makeV2Engine(s).step(mk(10),six,slow,true,structureFixture());
  assert.equal(s.dailyRisk.mode,'SOFT');
  assert.equal(s.open,null);
});

test('soft mode rejects neutral 3m structure, cautious zones and thin liquidity',()=>{
  const base=structureFixture();
  const neutral=freshPaperState();neutral.armed=true;
  neutral.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
  makeV2Engine(neutral).step(mk(10),strong,slow,true,{
    ...base,three:{...base.three,trend:'NEUTRAL'}
  });
  assert.equal(neutral.open,null);

  const cautious=freshPaperState();cautious.armed=true;
  cautious.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
  makeV2Engine(cautious).step(mk(10),strong,slow,true,{
    ...base,three:{...base.three,resistance:{
      center:1796,lower:1795.5,upper:1796.5,touches:2
    }}
  });
  assert.equal(cautious.open,null);

  const thin=freshPaperState();thin.armed=true;
  thin.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
  const noDepth=mk(10);
  noDepth.yes_bid_size_fp='1';
  makeV2Engine(thin).step(noDepth,strong,slow,true,base);
  assert.equal(thin.open,null);
});

test('soft mode requires tighter spreads and preserves the hard protection',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
  const wide=mk(10);
  wide.yes_bid_dollars='0.56'; // 4c spread, still passes normal quote filter
  makeV2Engine(s).step(wide,strong,slow,true,structureFixture());
  assert.equal(s.open,null);
  assert.equal(s.dailyRisk.mode,'SOFT');
});

test('open unrealized losses and unsettled exposure count towards hard risk',()=>{
  const marked=assessDailyRisk({initial:100,realizedToday:-18,openLoss:-2});
  assert.equal(marked.mode,'HARD');
  const pending=assessDailyRisk({initial:100,realizedToday:-17,pendingExposure:3});
  assert.equal(pending.mode,'HARD');
  assert.equal(pending.realizedToday,-17,'pending paper trades are not labeled realized');
  const neg=assessDailyRisk({initial:100,realizedToday:5,openLoss:-4});
  assert.equal(neg.mode,'NORMAL','net P/L includes gains');
});

test('20% hard halt latches for the day even if marked losses recover',()=>{
  const s=freshPaperState();s.armed=true;
  s.trades=[{ticker:'LOSS-1810',exitAt:Date.now(),pnl:-18.1,confirmed:true}];
  s.open={ticker:'KXETH15M-OTHER',cost:3,time:Date.now(),
    closeTime:new Date(Date.now()+1200000).toISOString(),markPnl:-2};
  const engine=makeV2Engine(s);
  engine.step(null,null,null,false);
  assert.equal(s.dailyRisk.mode,'HARD');
  s.open.markPnl=-0.20;
  engine.step(null,null,null,false);
  assert.equal(s.dailyRisk.mode,'HARD','rebound cannot reset the day halt');
  s.open=null;
  engine.step(mk(10),strong,slow,true,structureFixture());
  assert.equal(s.open,null,'no re-entry after an intraday hard risk breach');
});

test('hard halt resets when the Houston trading day changes',()=>{
  const r=assessDailyRisk({initial:100,realizedToday:0,
    openLoss:0,pendingExposure:0,previousMode:'NORMAL'});
  assert.equal(r.mode,'NORMAL');
  const sameDay=assessDailyRisk({initial:100,realizedToday:0,
    previousMode:'HARD'});
  assert.equal(sameDay.mode,'HARD');
});

test('existing 96c profit and hard stop logic are not altered by daily loss limits',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  engine.step(mk(10),strong,slow,true,structureFixture());
  assert.ok(s.open);
  s.dailyRisk={day:new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date()),mode:'HARD'};
  const quote=mk(6);quote.yes_bid_dollars='0.96';
  engine.step(quote,strong,slow,true,structureFixture());
  assert.equal(s.open,null);
  assert.match(s.trades[0].reason,/96¢/);
});

test('V3 simulation requires an explicit enabled flag AND active monitoring',()=>{
  assert.equal(paperEntryArmed(undefined,true),false);
  assert.equal(paperEntryArmed('disabled',true),false);
  assert.equal(paperEntryArmed('true',true),false);
  assert.equal(paperEntryArmed('enabled',false),false);
  assert.equal(paperEntryArmed('enabled',true),true);
});
