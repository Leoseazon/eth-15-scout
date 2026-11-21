import test from 'node:test';
import assert from 'node:assert/strict';
import {assessContractStop,advanceEarlyExitEvidence,FINAL_SIX_SECONDS} from '../src/stop-research.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from '../../tests/fixtures.mjs';

const start=Date.parse('2026-11-21T04:00:00Z');
const ticker='KXETH15M-TEST-V4';
const strong={last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
 rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2};
const slow={e21:1790,e50:1780,macd:2,signal:1,rsi:60};
const contract=(closeAt,ask=.60)=>({
 ticker,status:'active',close_time:new Date(closeAt).toISOString(),
 floor_strike:'1795',yes_ask_dollars:String(ask),
 yes_bid_dollars:String(Number((ask-.01).toFixed(2))),
 no_ask_dollars:String(Number((1-ask+.01).toFixed(2))),
 no_bid_dollars:String(Number((1-ask).toFixed(2))),
 yes_ask_size_fp:'50',yes_bid_size_fp:'50'
});

test('40% price threshold uses integer arithmetic at exact boundary',()=>{
 const args={closeAt:start+10*60000,at:start+5*60000};
 for(const [entry,bid,expected] of [
  [.60,.36,true],[.60,.3601,false],[.45,.27,true],
  [.45,.2701,false],[.83,.498,true],[.83,.4981,false],
  [.50,.21,true]
 ]){
  const r=assessContractStop({...args,entry,bid});
  assert.equal(r.usable,true);
  assert.equal(r.triggered,expected,entry+' to '+bid);
  assert.equal(r.executableFillVerified,false);
 }
});
test('strict final six-minute arming uses whole seconds, not millisecond drift',()=>{
 const close=start+10*60000;
 for(const [deltaMs,expected] of [
  [360000,false],[359999,false],[359001,false],
  [359000,true],[300000,true],[1000,true],[0,false]
 ]){
  const r=assessContractStop({entry:.50,bid:.25,
    closeAt:close,at:close-deltaMs});
  assert.equal(r.triggered,expected,'remaining '+deltaMs+'ms');
 }
 assert.equal(FINAL_SIX_SECONDS,360);
});
test('missing, unrepresentable, or future prices fail closed',()=>{
 const args={entry:.50,bid:.30,closeAt:start+600000,at:start+360000};
 for(const invalid of [NaN,Infinity,-.1,1.01,.300001,null]){
  assert.equal(assessContractStop({...args,bid:invalid}).triggered,false);
 }
 assert.equal(assessContractStop({...args,entry:0}).usable,false);
 assert.equal(assessContractStop({...args,closeAt:NaN}).usable,false);
});
test('two adverse one-minute candles must close entirely AFTER entry and be consecutive',()=>{
 const entryAt=start+10000; // 10 seconds after 4:00
 const firstOpen=start/1000+60;
 const first=advanceEarlyExitEvidence(null,{
  entryAt,candleOpenSeconds:firstOpen,evaluationAt:start+120000,
  adverse:true,structuralConfirm:true});
 assert.equal(first.consecutive,1);
 assert.equal(first.trigger,false);
 const duplicate=advanceEarlyExitEvidence(first,{
  entryAt,candleOpenSeconds:firstOpen,evaluationAt:start+140000,
  adverse:true,structuralConfirm:true});
 assert.equal(duplicate.consecutive,1);
 assert.equal(duplicate.trigger,false);
 const second=advanceEarlyExitEvidence(duplicate,{
  entryAt,candleOpenSeconds:firstOpen+60,evaluationAt:start+180000,
  adverse:true,structuralConfirm:true});
 assert.equal(second.consecutive,2);
 assert.equal(second.trigger,true);
 const reset=advanceEarlyExitEvidence(second,{
  entryAt,candleOpenSeconds:firstOpen+120,evaluationAt:start+240000,
  adverse:false,structuralConfirm:true});
 assert.equal(reset.consecutive,0);
 assert.equal(reset.trigger,false);
 const gap=advanceEarlyExitEvidence(first,{
  entryAt,candleOpenSeconds:firstOpen+120,evaluationAt:start+240000,
  adverse:true,structuralConfirm:true});
 assert.equal(gap.consecutive,1);
});
test('do not count a pre-entry candle, incomplete candle, or missing corroboration',()=>{
 const candidate={entryAt:start+20000,candleOpenSeconds:start/1000,
  evaluationAt:start+61000,adverse:true,structuralConfirm:true};
 assert.equal(advanceEarlyExitEvidence(null,candidate).trigger,false);
 assert.equal(advanceEarlyExitEvidence(null,candidate).consecutive,0);
 const tooSoon={...candidate,candleOpenSeconds:start/1000+60};
 assert.equal(advanceEarlyExitEvidence(null,tooSoon).reason,'NO_COMPLETE_POST_ENTRY_CANDLE');
 const noThreeFive={...tooSoon,evaluationAt:start+120000,structuralConfirm:false};
 assert.equal(advanceEarlyExitEvidence(null,noThreeFive).consecutive,0);
});
test('V4 simulator keeps 40% emergency exit disarmed at exact six minutes',()=>{
 const real=Date.now;
 try{
  let now=start;Date.now=()=>now;
  const close=start+10*60000;
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  const m=contract(close);
  engine.step(m,strong,slow,true,structureFixture());
  assert.ok(s.open);
  const bid=Number((s.open.entry*.6).toFixed(4));
  const near={...m};
  if(s.open.side==='UP')near.yes_bid_dollars=String(bid);
  else near.no_bid_dollars=String(bid);
  now=close-360000;
  engine.step(near,strong,slow,true,structureFixture());
  assert.ok(s.open,'at 6:00 no emergency stop, even with exact -40%');
  now=close-359000;
  engine.step(near,strong,slow,true,structureFixture());
  assert.equal(s.open,null,'inside six minutes with exact -40%');
  assert.equal(s.trades.length,1);
  assert.match(s.trades[0].reason,/40%/);
  assert.equal(s.trades[0].stopAtLastObservation.triggered,true);
 }finally{Date.now=real}
});
