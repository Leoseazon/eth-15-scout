import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';
import {inspectFeedResults,collectMarketFeeds,validateKalshiSnapshot} from '../src/feed-health.js';
import {PAPER_POLICY,entryGate} from '../src/v3-policy.js';

const strong={last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
 rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2};
const honeySignal={last:1799,prev:1797,e8:1798,e8prev:1799,e21:1800,
 rNow:52,rPrev:51,mNow:.4,mPrev:.3,sNow:.5,sPrev:.5,three:2,sd:2};
const slow={e21:1790,e50:1780,macd:2,signal:1,rsi:60};
function mk(minutes=10,price=.60,ticker='KXETH15M-PHASE1',strike=1795){
 return {ticker,status:'active',close_time:new Date(Date.now()+minutes*60000).toISOString(),
 floor_strike:String(strike),yes_ask_dollars:String(price),
 yes_bid_dollars:String(Number((price-.01).toFixed(3))),
 no_ask_dollars:String(Number((1-price+.01).toFixed(3))),
 no_bid_dollars:String(Number((1-price).toFixed(3))),
 yes_ask_size_fp:'50',yes_bid_size_fp:'50'};
}
function entered(minutes=10,price=.60,one=strong){
 const s=freshPaperState();s.armed=true;
 const engine=makeV2Engine(s);
 engine.step(mk(minutes,price,'KXETH15M-PHASE1',one===honeySignal?1795:1795),
   one,slow,true,structureFixture());
 assert.ok(s.open,'fixture must create a valid paper position');
 return {s,engine};
}
function exitQuote(minutes,bid,s){
 const q=mk(minutes,s.open.entry,s.open.ticker,Number(s.open.target));
 const key=s.open.side==='UP'?'yes_bid_dollars':'no_bid_dollars';
 q[key]=String(bid);
 return q;
}

test('Kraken transport failure preserves usable Kalshi market as independent result',async()=>{
 const market={worker_retrieved_at:new Date().toISOString(),markets:[mk(5)]};
 const fetched=await collectMarketFeeds(async url=>{
   if(url.includes('markets'))return market;
   if(url.includes('Ticker'))throw Error('Data provider HTTP 429');
   if(url.includes('interval=5'))return {error:['EGeneral:Temporary lockout']};
   return {result:{ETHUSD:[]},error:[]};
 },'https://market.test/markets','https://kraken.test/',Date.now());
 assert.equal(fetched.payloads.kalshi,market);
 assert.equal(fetched.checks.kalshi.ok,true);
 assert.equal(fetched.checks.krakenTicker.ok,false);
 assert.match(fetched.checks.krakenTicker.error,/429/);
 assert.equal(fetched.checks.kraken5m.ok,false);
 assert.equal(fetched.checks.kraken1m.ok,true);
 assert.equal(fetched.failures.length,2);
});
test('Kalshi quote timestamps fail closed when missing, old or future-dated',()=>{
 const now=Date.now();
 assert.equal(validateKalshiSnapshot({worker_retrieved_at:new Date(now-89000).toISOString()},now).ok,true);
 assert.equal(validateKalshiSnapshot({worker_retrieved_at:new Date(now-91000).toISOString()},now).ok,false);
 assert.equal(validateKalshiSnapshot({worker_retrieved_at:new Date(now+6100).toISOString()},now).ok,false);
 assert.equal(validateKalshiSnapshot({},now).ok,false);
 assert.equal(validateKalshiSnapshot({worker_retrieved_at:'not a time'},now).ok,false);
});
test('regular 40% paper stop still exits on fresh executable Kalshi bid when Kraken is offline',()=>{
 const {s,engine}=entered();
 const before=s.cash,entry=s.open.entry;
 const result=engine.step(exitQuote(5,.30,s),null,null,false,null);
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
 assert.match(s.trades[0].reason,/40%/);
 assert.equal(s.trades[0].exitPrice,.30);
 assert.ok(s.realized<0);
 assert.ok(s.cash>before,'proceeds credited to paper cash');
 assert.equal(entry,.60);
 assert.match(result.notice,/PAPER SELL/);
});
test('regular 96c profit-taking remains operational during Kraken failure',()=>{
 const {s,engine}=entered();
 engine.step(exitQuote(4,.96,s),null,null,false,null);
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
 assert.match(s.trades[0].reason,/96/);
 assert.ok(s.trades[0].pnl>0);
});
test('honey-pot 10% contract drawdown still exits with 1m/5m unavailable',()=>{
 const {s,engine}=entered(1.25,.85,honeySignal);
 assert.equal(s.open?.strategy,'HONEY-POT');
 assert.equal(s.open.qty,1);
 engine.step(exitQuote(1.1,.76,s),null,null,false,null);
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
 assert.match(s.trades[0].reason,/10%/);
 assert.equal(s.trades[0].exitPrice,.76);
});
test('final-minute 96c hold exception remains unchanged during Kraken failure',()=>{
 const {s,engine}=entered(1.25,.85,honeySignal);
 engine.step(exitQuote(.75,.96,s),null,null,false,null);
 assert.equal(s.trades.length,0);
 assert.equal(s.open?.strategy,'HONEY-POT');
});
test('missing Kalshi quote does not invent a fill; EXIT RISK is deduplicated',()=>{
 const {s,engine}=entered();
 const cash=s.cash,realized=s.realized;
 const r1=engine.step(null,null,null,false,null);
 const r2=engine.step(null,null,null,false,null);
 assert.ok(s.open);
 assert.equal(s.trades.length,0);
 assert.equal(s.cash,cash);
 assert.equal(s.realized,realized);
 assert.match(r1.notice,/EXIT RISK/);
 assert.match(r2.notice,/EXIT RISK/);
 assert.equal(s.events.filter(e=>e.type==='EXIT RISK').length,1);
 engine.step(exitQuote(5,.30,s),null,null,false,null);
 assert.equal(s.open,null);
 assert.ok(s.events.some(e=>e.type==='EXIT FEED RECOVERED'));
 assert.equal(s.trades.length,1);
});
test('unavailable or insufficient bid depth produces warning and NO fictitious sale',()=>{
 const {s,engine}=entered();
 const q=exitQuote(5,.30,s);
 q.yes_bid_size_fp='0';
 engine.step(q,null,null,false,null);
 assert.ok(s.open);
 assert.equal(s.trades.length,0);
 assert.equal(s.realized,0);
 assert.ok(s.events.some(e=>e.type==='EXIT RISK'));
 q.yes_bid_size_fp=String(s.open.qty);
 engine.step(q,null,null,false,null);
 assert.equal(s.trades.length,1);
});
test('a Kalshi quote for a DIFFERENT ticker never closes the open ticker',()=>{
 const {s,engine}=entered();
 const cash=s.cash;
 const other=mk(5,.60,'KXETH15M-OTHER');
 other.yes_bid_dollars='0.25';
 engine.step(other,null,null,false,null);
 assert.ok(s.open);
 assert.equal(s.cash,cash);
 assert.equal(s.trades.length,0);
 assert.ok(s.events.some(e=>e.type==='EXIT RISK'));
});
test('expiry with no market quote becomes pending, without claiming an official win',()=>{
 const {s,engine}=entered();
 s.open.closeTime=new Date(Date.now()-2000).toISOString();
 engine.step(null,null,null,false,null);
 assert.equal(s.open,null);
 assert.equal(s.pending.length,1);
 assert.equal(s.trades.length,0);
 assert.equal(s.realized,0);
});
test('missing Kraken data never authorizes any NEW paper position',()=>{
 const s=freshPaperState();s.armed=true;
 makeV2Engine(s).step(mk(10),strong,null,false,structureFixture());
 assert.equal(s.open,null);
 assert.equal(s.trades.length,0);
});
test('pure Phase 1 safety patch preserves existing indicator and 40% stop thresholds',()=>{
 assert.equal(PAPER_POLICY.contractStopLossFraction,.40);
 assert.equal(PAPER_POLICY.stopLossArmedMinutes,6);
 assert.equal(PAPER_POLICY.lateValueEarlierChecks,5);
 assert.equal(PAPER_POLICY.lateValueFinalChecks,6);
 const base={price:.75,remaining:2.5,passed:5,
  slowTrend:true,plausible:true,alignment:true,spread:.01};
 assert.equal(entryGate(base).ok,true);
 assert.equal(entryGate({...base,price:.69}).ok,false);
});
