import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIN_STRATEGY_PROFILES,selectMainProfile,assessProfileEntry,
 mainProfileIsSupported} from '../src/main-strategy-profiles.js';
import {settlementFirstPaperStep} from '../src/settlement-first-paper.js';
import {freshPaperState} from '../src/v2.js';
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,
 close_time:new Date(T+450000).toISOString()};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,
 sourceAt:T-1000,price:1804};
const one={sd:1.2,last:1804,e8:1802,e21:1800,
 rNow:65,mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
 valid:true,fresh:true,crossed:false,receivedAt:T-1000,
 yesBid:{price:.43,sizeFp:'20.00'},
 yesAsk:{price:.45,sizeFp:'20.00'},
 noBid:{price:.55,sizeFp:'20.00'},
 noAsk:{price:.57,sizeFp:'20.00'}};
const args={market,index,one,five,context,book,now:T,onPrediction:()=>{}};
const setup=()=>({...freshPaperState(),armed:true,monitoring:true});
const assess=(profile,rest={})=>assessProfileEntry({
 profile,riskMode:'NORMAL',side:'UP',ask:.3,
 lowerEdge:-.075,centralEdge:.09,legacyRequiredEdge:.035,
 contextEvidence:{target:1800,indexValue:1802,one,context,now:T,
  ticker,sourceAt:T-1000},...rest});
test('exactly three frozen deploy-selectable profiles, unknown fails safely to Conservative',()=>{
 assert.deepEqual(Object.keys(MAIN_STRATEGY_PROFILES),
  ['CONSERVATIVE','BALANCED','OPPORTUNISTIC']);
 assert.ok(Object.values(MAIN_STRATEGY_PROFILES).every(Object.isFrozen));
 assert.equal(mainProfileIsSupported('OPPORTUNISTIC'),true);
 assert.equal(mainProfileIsSupported('foo'),false);
 assert.equal(selectMainProfile('foo').id,'CONSERVATIVE');
});
test('Conservative lower-risk hurdle stays exactly as old model',()=>{
 assert.equal(assess('CONSERVATIVE',{lowerEdge:.034}).ok,false);
 assert.equal(assess('CONSERVATIVE',{lowerEdge:.035}).ok,true);
 assert.equal(assess('CONSERVATIVE',{lowerEdge:-.075}).ok,false);
});
test('opportunistic can accept an IN-TARGET quote with 9pp central and negative 7.5pp lower',()=>{
 assert.equal(assess('OPPORTUNISTIC').ok,true);
 assert.equal(assess('BALANCED').ok,false);
 assert.equal(assess('OPPORTUNISTIC').effectiveProfile,'OPPORTUNISTIC');
});
test('opportunistic refuses near-zero central edge and downside worse than its own cap',()=>{
 assert.equal(assess('OPPORTUNISTIC',{centralEdge:.03}).ok,false);
 assert.equal(assess('OPPORTUNISTIC',{lowerEdge:-.121}).ok,false);
 assert.equal(assess('OPPORTUNISTIC',{lowerEdge:-.12}).ok,true);
});
test('soft/hard risk and premium 85-87c retain original conservative hurdle',()=>{
 for(const riskMode of ['SOFT','HARD','UNKNOWN'])
  assert.equal(assess('OPPORTUNISTIC',{riskMode}).ok,false);
 assert.equal(assess('OPPORTUNISTIC',{ask:.86,lowerEdge:.05,
  legacyRequiredEdge:.07}).ok,false);
});
test('against-target recovery needs current 1m momentum and 3m structure',()=>{
 const base={target:1800,indexValue:1799,one,
  context,now:T,ticker,sourceAt:T-1000};
 assert.equal(assess('OPPORTUNISTIC',{contextEvidence:base}).reason,
  'PROFILE_REVERSAL_PRIOR_INDEX_UNAVAILABLE');
 assert.equal(assess('OPPORTUNISTIC',{contextEvidence:{
  ...base,context:{three:{trend:'DOWN'}}}}).reason,
  'PROFILE_REVERSAL_DIRECTION_NOT_CONFIRMED');
 assert.equal(assess('BALANCED',{contextEvidence:{
  ...base,context:{three:{trend:'NEUTRAL'}}}}).reason,
  'PROFILE_REVERSAL_DIRECTION_NOT_CONFIRMED');
});
test('against-target recovery requires previous genuine official sample moving toward target',()=>{
 const current={target:1800,indexValue:1799,one,context,
  now:T,ticker,sourceAt:T-1000};
 const prior={ticker,target:1800,indexValue:1798.6,
  sourceAt:T-17000,observedAt:T-15000};
 assert.equal(assess('OPPORTUNISTIC',{contextEvidence:{
  ...current,priorOfficialIndex:prior}}).ok,true);
 assert.equal(assess('OPPORTUNISTIC',{contextEvidence:{
  ...current,priorOfficialIndex:{...prior,indexValue:1799.5}}}).ok,false);
 assert.equal(assess('OPPORTUNISTIC',{contextEvidence:{
  ...current,priorOfficialIndex:{...prior,ticker:'KXETH15M-OTHER'}}}).ok,false);
 assert.equal(assess('OPPORTUNISTIC',{contextEvidence:{
  ...current,priorOfficialIndex:{...prior,sourceAt:T-1000}}}).ok,false);
});
test('original default and explicit Conservative paper BUY produce same quantity/cash/side',()=>{
 const a=setup(),b=setup();
 const x=settlementFirstPaperStep(a,args);
 const y=settlementFirstPaperStep(b,{...args,profile:'CONSERVATIVE'});
 assert.equal(x.status,y.status);
 assert.equal(a.cash,b.cash);assert.equal(a.open?.side,b.open?.side);
 assert.equal(a.open?.qty,b.open?.qty);
 assert.equal(a.open?.entry,b.open?.entry);
});
test('all profiles retain 87c cap, stale book and one-buy-per-contract',()=>{
 for(const profile of Object.keys(MAIN_STRATEGY_PROFILES)){
  const s=setup(),high=settlementFirstPaperStep(s,{
   ...args,profile,book:{...book,
    yesAsk:{price:.88,sizeFp:'20.00'},yesBid:{price:.86,sizeFp:'20.00'}}});
  assert.equal(high.status,'WATCH');
  assert.equal(s.cash,100);
  const stale=settlementFirstPaperStep(s,{...args,profile,
   book:{...book,receivedAt:T-9000}});
  assert.equal(stale.status,'WATCH');
  assert.equal(s.cash,100);
 }
});
test('main 96c profit SELL unchanged by selected profile',()=>{
 const s=setup(),buy=settlementFirstPaperStep(s,{
  ...args,profile:'OPPORTUNISTIC'});
 assert.equal(buy.status,'PAPER_BUY');
 const sold=settlementFirstPaperStep(s,{
  ...args,now:T+150000,profile:'OPPORTUNISTIC',
  book:{...book,receivedAt:T+149000,
   yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(sold.status,'PAPER_SELL');
 assert.equal(s.open,null);
});
