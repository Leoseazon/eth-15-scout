import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from '../../tests/fixtures.mjs';
const strong={last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
  rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2};
const slow={e21:1790,e50:1780,macd:2,signal:1,rsi:60};
const market=(minutes=10)=>({
  ticker:'KXETH15M-26NOV210015-15',status:'active',
  close_time:new Date(Date.now()+minutes*60000).toISOString(),
  floor_strike:'1795',yes_ask_dollars:'.60',yes_bid_dollars:'.59',
  no_ask_dollars:'.41',no_bid_dollars:'.40',
  yes_ask_size_fp:'50',yes_bid_size_fp:'50'});
test('V4 shadow probe observes baseline setups without arming, spending, creating events or trades',()=>{
 const state=freshPaperState(),before=JSON.stringify(state);
 const engine=makeV2Engine(state);
 const observation=engine.probe(market(),strong,slow,{
   fresh:true,context:structureFixture(),at:Date.now()});
 assert.equal(state.armed,false);
 assert.equal(JSON.stringify(state),before);
 assert.ok(['HEURISTIC_CANDIDATE','WATCH'].includes(observation.status));
 assert.equal(observation.calibratedProbability,null);
 assert.equal(observation.executableFillVerified,false);
 assert.equal(state.open,null);
 if(observation.candidate){
   assert.ok(['UP','DOWN'].includes(observation.candidate.side));
   assert.ok(observation.candidate.signalChecks.length>=7);
 }
});
test('V4 shadow evaluator returns unavailable on stale or missing completed structure',()=>{
 const state=freshPaperState(),engine=makeV2Engine(state);
 for(const context of [null,{three:null,five:null,oneClosedAt:null}]){
  const r=engine.probe(market(),strong,slow,{fresh:true,context});
  assert.equal(r.status,'UNAVAILABLE');
  assert.equal(r.candidate,null);
 }
 const bad=engine.probe(market(),strong,slow,{fresh:false,context:structureFixture()});
 assert.equal(bad.status,'UNAVAILABLE');
});
test('shadow evaluator never recommends or trades within last minute',()=>{
 const state=freshPaperState(),engine=makeV2Engine(state);
 const r=engine.probe(market(.5),strong,slow,{
  fresh:true,context:structureFixture()});
 assert.equal(r.status,'WATCH');
 assert.equal(r.candidate,null);
 assert.equal(state.cash,100);
 assert.equal(state.trades.length,0);
});
