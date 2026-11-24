import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {settlementFirstPaperStep} from '../src/settlement-first-paper.js';
import {evaluateConfirmedEarlyExit,CONFIRMED_EARLY_EXIT_VERSION} from '../src/confirmed-early-exit.js';
import {freshPaperState} from '../src/v2.js';

const T=1795320000000;
const ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,close_time:new Date(T+450000).toISOString()};
const entryIndex={indexId:'ETHUSD_RTI',validValuesVerified:true,sourceAt:T-1000,price:1804};
const entryOne={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25,three:2};
const entryFive={rsi:60,e21:1800,e50:1799};
const entryCtx={three:{trend:'UP'},five:{trend:'UP'}};
const entryBook={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,crossed:false,
 receivedAt:T-1000,yesBid:{price:.43,sizeFp:'20.00'},yesAsk:{price:.45,sizeFp:'20.00'},
 noBid:{price:.55,sizeFp:'20.00'},noAsk:{price:.57,sizeFp:'20.00'}};
const setup=()=>({...freshPaperState(),armed:true,monitoring:true,events:[],
 decisions:[],blocked:[],pending:[],trades:[]});
const create=()=>{
 const s=setup();
 const r=settlementFirstPaperStep(s,{market,index:entryIndex,one:entryOne,five:entryFive,
  context:entryCtx,book:entryBook,now:T,onPrediction:()=>{}});
 assert.equal(r.status,'PAPER_BUY');
 assert.equal(s.open.side,'UP');
 return s;
};
const adverseOne={...entryOne,last:1797,e21:1799,rNow:36,mNow:-1,sNow:.2};
const adverseContext={three:{trend:'DOWN'},five:{trend:'NEUTRAL'}};
const quote=(at,overrides={})=>({...entryBook,receivedAt:at-1000,
 yesBid:{price:.24,sizeFp:'20.00'},yesAsk:{price:.27,sizeFp:'20.00'},...overrides});
const adverse=(at,overrides={})=>({
 market,index:{...entryIndex,sourceAt:at-1000,price:1798},
 one:adverseOne,five:entryFive,context:adverseContext,book:quote(at),
 now:at,confirmedEarlyExitEnabled:true,...overrides
});
const review=(at,overrides={})=>evaluateConfirmedEarlyExit({
 position:{ticker,side:'UP',entry:.45,target:1800,closeTime:market.close_time,time:T},
 book:quote(at),bid:.24,index:{...entryIndex,sourceAt:at-1000,price:1798},
 one:adverseOne,five:entryFive,context:adverseContext,now:at,...overrides
});
test('CANDIDATE is OFF by default even when 40% loss and reversal evidence align',()=>{
 const s=create();
 for(const at of [T+60000,T+80000]){
  const options=adverse(at);delete options.confirmedEarlyExitEnabled;
  assert.equal(settlementFirstPaperStep(s,options).status,'HOLD');
 }
 assert.equal(s.trades.length,0);
 assert.equal(s.open.confirmedEarlyExitWatch,undefined);
});
test('two fresh 15-second-separated adverse RTI/book confirmations allow early paper sale >6 minutes out',()=>{
 const s=create();
 assert.equal(settlementFirstPaperStep(s,adverse(T+60000)).status,'HOLD');
 assert.equal(s.trades.length,0);
 assert.equal(s.open.confirmedEarlyExitWatch.ticker,ticker);
 const r=settlementFirstPaperStep(s,adverse(T+80000));
 assert.equal(r.status,'PAPER_SELL');
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
 assert.match(s.trades[0].reason,/Early confirmed adverse-direction exit/);
 assert.equal(s.trades[0].fillVerified,false);
 assert.equal(s.trades[0].directionCorrect,null);
 assert.ok(s.trades[0].remainingSecondsAtExit>360);
 assert.equal(s.pending.length,0);
});
test('fast-path missing official RTI cannot cast a confirmation or accidentally reset pending evidence',()=>{
 const s=create();
 settlementFirstPaperStep(s,adverse(T+60000));
 const mid=settlementFirstPaperStep(s,{market,book:quote(T+70000),now:T+70000});
 assert.equal(mid.status,'HOLD');
 assert.equal(s.open.confirmedEarlyExitWatch.firstAt,T+60000);
 assert.equal(settlementFirstPaperStep(s,adverse(T+80000)).status,'PAPER_SELL',
  'only the second valid RTI/book observation confirms the early exit');
});
test('opposite official RTI, adverse 3m structure and adverse closed 1m momentum are ALL mandatory',()=>{
 const base=review(T+60000);
 assert.equal(base.status,'TRACKING');
 assert.equal(review(T+80000,{previous:base.next,
  index:{...entryIndex,sourceAt:T+79000,price:1801}}).status,'NO_EXIT');
 assert.equal(review(T+80000,{previous:base.next,
  context:entryCtx}).status,'NO_EXIT');
 assert.equal(review(T+80000,{previous:base.next,
  one:entryOne}).status,'NO_EXIT');
});
test('duplicate/stale WebSocket book or stale RTI never confirms loss exit',()=>{
 const first=review(T+60000);
 assert.equal(review(T+80000,{previous:first.next,
  book:quote(T+80000,{receivedAt:T+60000})}).status,'NO_EXIT');
 assert.equal(review(T+80000,{previous:first.next,
  index:{...entryIndex,sourceAt:T+60000,price:1798}}).status,'NO_EXIT');
 assert.equal(review(T+80000,{previous:first.next,
  book:quote(T+80000,{crossed:true})}).status,'NO_EXIT');
 assert.equal(review(T+80000,{previous:first.next,
  book:quote(T+80000,{yesAsk:{price:.5,sizeFp:'20.00'}})}).status,'NO_EXIT');
});
test('signal recovery clears candidate and demands two NEW confirmations',()=>{
 const s=create();
 assert.equal(settlementFirstPaperStep(s,adverse(T+60000)).status,'HOLD');
 assert.equal(settlementFirstPaperStep(s,adverse(T+70000,{
  index:{...entryIndex,sourceAt:T+69000,price:1802}})).status,'HOLD');
 assert.equal(s.open.confirmedEarlyExitWatch,null);
 assert.equal(settlementFirstPaperStep(s,adverse(T+80000)).status,'HOLD');
});
test('unchanged 40% last-six-minute paper emergency stop also works without index and with opt-in true',()=>{
 const s=create();
 const r=settlementFirstPaperStep(s,{market,book:quote(T+91000),
  now:T+91000,confirmedEarlyExitEnabled:true});
 assert.equal(r.status,'PAPER_SELL');
 assert.match(s.trades[0].reason,/40% contract-price emergency stop/);
});
test('96c profit exit remains immediate, never waits on early-loss confirmation',()=>{
 const s=create();
 const r=settlementFirstPaperStep(s,{market,now:T+60000,
  book:quote(T+60000,{yesBid:{price:.96,sizeFp:'20.00'},
    yesAsk:{price:.97,sizeFp:'20.00'}}),
  confirmedEarlyExitEnabled:true});
 assert.equal(r.status,'PAPER_SELL');
 assert.match(s.trades[0].reason,/96c/);
});
test('no early sale on insufficient displayed depth; paper cash remains unmodified',()=>{
 const s=create();
 const cash=s.cash;
 const first=settlementFirstPaperStep(s,adverse(T+60000));
 assert.equal(first.status,'HOLD');
 const second=settlementFirstPaperStep(s,adverse(T+80000,{
  book:quote(T+80000,{yesBid:{price:.24,sizeFp:'0.00'}})}));
 assert.equal(second.status,'HOLD');
 assert.equal(s.trades.length,0);
 assert.equal(s.cash,cash);
});
test('candidate config defaults OFF; original Worker2 cannot be changed by candidate MAIN code',()=>{
 const config=fs.readFileSync(new URL('../../wrangler.v4paper.toml',import.meta.url),'utf8');
 const research=fs.readFileSync(new URL('../../wrangler.v4controls.toml',import.meta.url),'utf8');
 const main=fs.readFileSync(new URL('../src/main-only-worker.js',import.meta.url),'utf8');
 assert.match(config,/V4_CONFIRMED_EARLY_EXIT_ENABLED = "false"/);
 assert.match(config,/V4_MAIN_PROFILE = "OPPORTUNISTIC"/);
 assert.match(research,/name = "eth-15-scout-v4-controls"/);
 assert.doesNotMatch(research,/V4_CONFIRMED_EARLY_EXIT_ENABLED/);
 assert.match(main,/confirmedEarlyExitEnabled=env.V4_CONFIRMED_EARLY_EXIT_ENABLED==='true'/);
 assert.ok(main.includes('confirmedEarlyExitEnabled:this.confirmedEarlyExitEnabled'));
 assert.ok(CONFIRMED_EARLY_EXIT_VERSION.includes('CANDIDATE'));
});
