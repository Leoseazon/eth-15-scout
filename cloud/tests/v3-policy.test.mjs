import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_POLICY,entryBudget,entryGate,profitExitGate,assessDailyRisk,paperEntryArmed,settlementClockPhase} from '../src/v3-policy.js';
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

test('Kalshi final 60 seconds are recognized as UNVERIFIED CF RTI averaging, not spot settlement',()=>{
 const close='2026-11-20T06:15:00Z';
 const base=Date.parse(close);
 assert.equal(settlementClockPhase(close,base-60001),'PRE_SETTLEMENT_AVERAGING');
 assert.equal(settlementClockPhase(close,base-60000),'RTI_60_SECOND_AVERAGING_UNVERIFIED');
 assert.equal(settlementClockPhase(close,base-1000),'RTI_60_SECOND_AVERAGING_UNVERIFIED');
 assert.equal(settlementClockPhase(close,base),'AWAITING_OFFICIAL_RESULT');
 assert.equal(settlementClockPhase(close,base+1000),'AWAITING_OFFICIAL_RESULT');
 assert.equal(settlementClockPhase('',base),'UNKNOWN');
 assert.equal(entryGate({price:.65,remaining:.99,passed:7,
   slowTrend:true,plausible:true,alignment:true,spread:.01}).ok,false,
   'No new paper entries during the actual settlement averaging minute');
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

test('80–89c late-entry is gated at EIGHT minutes with 5/7 or 6/7 and independent proof',()=>{
 const strict={price:.85,passed:5,slowTrend:false,
   plausible:true,alignment:false,spread:.01,lateValueVerified:true};
 for(const remaining of [12,10,8.001])
   assert.equal(entryGate({...strict,remaining}).ok,false,
     '80–89c too early at '+remaining+'m');
 for(const remaining of [8,7.99,5,3])
   assert.equal(entryGate({...strict,remaining}).ok,true,
     'guarded 5/7 eligible at '+remaining+'m');
 assert.equal(entryGate({...strict,remaining:2.99}).ok,false,
   '5/7 is insufficient below three minutes');
 assert.equal(entryGate({...strict,passed:6,remaining:2.99}).ok,true);
 assert.equal(entryGate({...strict,passed:6,remaining:1.5}).ok,true);
 assert.equal(entryGate({...strict,passed:6,remaining:1.49}).ok,false);
 assert.equal(entryGate({...strict,lateValueVerified:false,remaining:6}).ok,false);
 assert.equal(entryGate({...strict,passed:4,remaining:6}).ok,false);
 assert.equal(entryGate({...strict,spread:.04,remaining:6}).ok,false);
 assert.equal(entryGate({...strict,plausible:false,remaining:6}).ok,false);
 assert.equal(entryGate({...strict,price:.90,remaining:6}).ok,false,
   '90c+ still ineligible before five minutes');
 assert.equal(entryGate({...strict,price:.96,remaining:3}).ok,false);
});
test('90c+ entries remain strict with seven checks and five-minute deadline',()=>{
 const proof={price:.91,remaining:4,passed:7,slowTrend:true,
   plausible:true,alignment:true,spread:.02};
 assert.equal(entryGate(proof).ok,true);
 for(const changed of [{remaining:5.01},{passed:6},{slowTrend:false},
   {plausible:false},{alignment:false},{spread:.04},{price:.96}])
   assert.equal(entryGate({...proof,...changed}).ok,false,
     JSON.stringify(changed));
});
test('final three minutes: 20–69c requires 7/7, but 70–79c requires 5/7',()=>{
 const base={remaining:2.5,slowTrend:true,plausible:true,
   alignment:true,spread:.01,lateValueVerified:false};
 assert.equal(PAPER_POLICY.finalThreeLowPriceChecks,7);
 assert.equal(PAPER_POLICY.finalThreeMidPriceChecks,5);
 for(const price of [.20,.35,.69]){
   assert.equal(entryGate({...base,price,passed:6}).ok,false,
     '6/7 must be insufficient at '+price);
   assert.equal(entryGate({...base,price,passed:7}).ok,true,
     '7/7 should be eligible at '+price);
 }
 for(const price of [.70,.75,.79]){
   assert.equal(entryGate({...base,price,passed:4}).ok,false,
     '4/7 must be insufficient at '+price);
   assert.equal(entryGate({...base,price,passed:5}).ok,true,
     '5/7 should be eligible at '+price);
   for(const override of [{slowTrend:false},{plausible:false},
     {alignment:false},{spread:.031}]){
     assert.equal(entryGate({...base,price,passed:5,...override}).ok,false,
       '5/7 must not waive '+JSON.stringify(override));
   }
 }
 assert.equal(entryGate({...base,price:.69,passed:6,remaining:3}).ok,true,
   'three-minute strict rule activates only below 3m');
 assert.equal(entryGate({...base,price:.79,passed:5,remaining:1.5}).ok,true);
 assert.equal(entryGate({...base,price:.79,passed:5,remaining:1.49}).ok,false);
 // 80c+ retains the separately guarded 6/7 rule inside 3 minutes.
 assert.equal(entryGate({...base,price:.80,passed:5,lateValueVerified:true}).ok,false);
 assert.equal(entryGate({...base,price:.80,passed:6,lateValueVerified:true}).ok,true);
 // Sub-20c still requires 7/7 (and the separate MICRO-VALUE gate).
 assert.equal(entryGate({...base,price:.19,passed:6}).ok,false);
 assert.equal(entryGate({...base,price:.19,passed:7}).ok,true);
});
test('engine requires an actual 5-of-7 directional setup for final-3m 70–79c buys',()=>{
 const five={...strong,rPrev:59,mPrev:1.8};
 const sixtyNine=freshPaperState();sixtyNine.armed=true;
 makeV2Engine(sixtyNine).step(mk(2.5,.69),five,slow,true,structureFixture());
 assert.equal(sixtyNine.open,null,'69c final-3m 5/7 must be rejected');
 const seventy=freshPaperState();seventy.armed=true;
 makeV2Engine(seventy).step(mk(2.5,.70),five,slow,true,structureFixture());
 assert.ok(seventy.open,'70c final-3m 5/7 should qualify with full other protections');
 assert.equal(seventy.open.score,5);
 assert.ok(seventy.open.cost<=3);
 const seventyNine=freshPaperState();seventyNine.armed=true;
 makeV2Engine(seventyNine).step(mk(2.5,.79),five,slow,true,structureFixture());
 assert.ok(seventyNine.open,'79c final-3m 5/7 should qualify');
 assert.equal(seventyNine.open.score,5);
 const seven=freshPaperState();seven.armed=true;
 makeV2Engine(seven).step(mk(2.5,.69),strong,slow,true,structureFixture());
 assert.ok(seven.open,'69c final-3m 7/7 must remain eligible');
});
test('40 percent downside stop only activates strictly INSIDE final six minutes',()=>{
  assert.equal(PAPER_POLICY.contractStopLossFraction,0.40);
  assert.equal(PAPER_POLICY.stopLossArmedMinutes,6);
  for(const minutes of [10,6,5.9,3,0.5]){
    const s=freshPaperState();s.armed=true;
    const engine=makeV2Engine(s),m=mk(10);
    engine.step(m,strong,slow,true,structureFixture());
    assert.ok(s.open);
    // Simulate DOWN or UP contract's own executable bid falling 50%.
    // This tests stop timing without a guessed exchange settlement.
    const open=s.open;
    const q=mk(minutes);
    const exitBid=String(Number((open.entry*0.5).toFixed(3)));
    if(open.side==='UP')q.yes_bid_dollars=exitBid;
    else q.no_bid_dollars=exitBid;
    // Prevent the structural exit from masking the stop rule in the fixture.
    engine.step(q,strong,slow,true,structureFixture());
    if(minutes<6){
      assert.equal(s.open,null,'must stop after threshold at '+minutes+'m');
      assert.equal(s.trades.length,1);
      assert.match(s.trades[0].reason,/40%/);
    }else{
      assert.ok(s.open,'must not trigger fixed 40% stop at '+minutes+'m');
      assert.equal(s.trades.length,0);
    }
  }
});

test('BUY and early SELL permanently capture seconds remaining in paper events and trade data',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s),m=mk(10);
  engine.step(m,strong,slow,true,structureFixture());
  assert.ok(s.open);
  const entry=s.events.find(e=>e.type==='PAPER BUY');
  assert.ok(Number.isInteger(entry.remainingSeconds)&&entry.remainingSeconds>0);
  assert.equal(s.open.remainingSecondsAtEntry,entry.remainingSeconds);
  assert.match(entry.msg,/remaining/);
  if(s.open.side==='UP')m.yes_bid_dollars='0.96';
  else m.no_bid_dollars='0.96';
  engine.step(m,strong,slow,true,structureFixture());
  const sale=s.events.find(e=>e.type==='PAPER SELL');
  assert.ok(sale);
  assert.ok(Number.isInteger(sale.remainingSeconds)&&sale.remainingSeconds>0);
  assert.equal(s.trades[0].remainingSecondsAtExit,sale.remainingSeconds);
  assert.match(sale.msg,/remaining/);
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
