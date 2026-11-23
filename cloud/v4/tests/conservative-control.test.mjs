import test from 'node:test';
import assert from 'node:assert/strict';
import {CONSERVATIVE_CONTROL_VERSION,CONSERVATIVE_CONTROL_STORAGE_KEY,
 newConservativePortfolio,loadConservativePortfolio,prepareConservativePortfolio,
 evaluateConservativePortfolio,settleConservativePortfolio,
 conservativePortfolioSummary,saveConservativePortfolio}
 from '../src/conservative-control.js';
import {settlementFirstPaperStep} from '../src/settlement-first-paper.js';
import {freshPaperState} from '../src/v2.js';
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,
 close_time:new Date(T+450000).toISOString()};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,
 sourceAt:T-1000,price:1804};
const one={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,
 mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
 valid:true,fresh:true,crossed:false,receivedAt:T-1000,
 yesBid:{price:.43,sizeFp:'20.00'},
 yesAsk:{price:.45,sizeFp:'20.00'},
 noBid:{price:.55,sizeFp:'20.00'},
 noAsk:{price:.57,sizeFp:'20.00'}};
const args={market,index,one,five,context,book,now:T};
function memory(){const map=new Map();return {
 get:k=>map.get(k),put:(k,v)=>map.set(k,structuredClone(v)),
 force:(k,v)=>map.set(k,v)
}}
const newControl=()=>prepareConservativePortfolio(newConservativePortfolio(T));
test('control initialization is independent $100 paper cash, not main balance',()=>{
 const main={...freshPaperState(),cash:106.14,realized:6.14};
 const c=newControl();
 assert.equal(c.cash,100);assert.equal(c.realized,0);
 assert.equal(c.armed,true);assert.equal(c.version,CONSERVATIVE_CONTROL_VERSION);
 c.cash=40;
 assert.equal(main.cash,106.14);
});
test('control independent onPrediction journal, bankroll and first purchase',()=>{
 const main={...freshPaperState(),armed:true,monitoring:true};
 const before=JSON.stringify(main);
 const old=newControl();
 const baseline=JSON.stringify(old);
 const first=evaluateConservativePortfolio(old,args);
 assert.equal(first.report.status,'PAPER_BUY');
 assert.equal(first.next.entries,1);
 assert.ok(first.next.open);
 assert.equal(first.next.cash,Number((100-first.next.open.cost).toFixed(2)));
 assert.equal(JSON.stringify(main),before);
 assert.equal(JSON.stringify(old),baseline);
 assert.equal(first.next.blocked.length,1);
 assert.equal(first.summary.executionAuthorized,false);
});
test('main Opportunistic BUY cannot block independently generated Conservative BUY',()=>{
 const main={...freshPaperState(),armed:true,monitoring:true};
 const first=settlementFirstPaperStep(main,{
  ...args,profile:'OPPORTUNISTIC',onPrediction:()=>{}});
 assert.equal(first.status,'PAPER_BUY');
 const separate=evaluateConservativePortfolio(newControl(),args);
 assert.equal(separate.report.status,'PAPER_BUY');
 assert.equal(separate.next.open.ticker,main.open.ticker);
 assert.equal(separate.next.cash,Number((100-separate.next.open.cost).toFixed(2)));
 assert.equal(main.blocked.length,1);
 assert.equal(separate.next.blocked.length,1);
 assert.notStrictEqual(main.blocked,separate.next.blocked);
});
test('control duplicates forbidden within same ticker, but MAIN paper unaffected',()=>{
 const a=evaluateConservativePortfolio(newControl(),args);
 const b=evaluateConservativePortfolio(a.next,{
  ...args,now:T+15000,book:{...book,receivedAt:T+14000},
  index:{...index,sourceAt:T+14000}});
 assert.equal(b.report.status,'HOLD');
 assert.equal(b.next.entries,1);
 assert.equal(b.next.open.ticker,ticker);
});
test('fresh 96c BID exits control independently and records simulated fees',()=>{
 const a=evaluateConservativePortfolio(newControl(),args);
 const b=evaluateConservativePortfolio(a.next,{
  ...args,now:T+150000,book:{...book,receivedAt:T+149000,
  yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(b.report.status,'PAPER_SELL');
 assert.equal(b.next.exits,1);
 assert.equal(b.next.trades[0].exitType,'EARLY SALE');
 assert.equal(b.next.trades[0].fillVerified,false);
 assert.equal(b.next.open,null);
});
test('no Kalshi official result leaves control pending and uncredited',()=>{
 const a=evaluateConservativePortfolio(newControl(),args);
 const exp=evaluateConservativePortfolio(a.next,{
  ...args,now:T+450500,market:null,index:null,book:null});
 assert.equal(exp.next.pending.length,1);
 const sql={exec:()=>({toArray:()=>[]})};
 const p=settleConservativePortfolio(exp.next,sql,T+480000);
 assert.equal(p.finalized,0);
 assert.equal(p.next.pending.length,1);
 assert.equal(p.next.cash,exp.next.cash);
});
test('official finalized result credits only isolated CONTROL cash and never main',()=>{
 const a=evaluateConservativePortfolio(newControl(),args);
 const exp=evaluateConservativePortfolio(a.next,{
  ...args,now:T+450500,market:null,index:null,book:null});
 const official={ticker,status:'OFFICIAL_RESULT',exchangeStatus:'finalized',
  officialResult:'yes',reportedDirection:'UP',outcome:'UP',
  settledAt:T+451000};
 const sql={exec:(_query,asked)=>({
  toArray:()=>asked===ticker?[{status:'OFFICIAL_RESULT',data:JSON.stringify(official)}]:[]})};
 const main={cash:97.16,pending:[{ticker}]},before=JSON.stringify(main);
 const done=settleConservativePortfolio(exp.next,sql,T+460000);
 assert.equal(done.finalized,1);
 assert.equal(done.next.officialSettlements,1);
 assert.equal(done.next.pending.length,0);
 assert.equal(done.next.trades[0].officialOutcome,'UP');
 assert.equal(done.next.trades[0].fillVerified,false);
 assert.equal(JSON.stringify(main),before);
});
test('control state persists to unique key and reloads without sharing object references',()=>{
 const s=memory();
 const first=evaluateConservativePortfolio(newControl(),args);
 saveConservativePortfolio(s,first.next);
 assert.equal(s.get('runtime'),undefined);
 const v=loadConservativePortfolio(s);
 assert.ok(v.open);
 v.cash=0;v.blocked.push('X');
 assert.notEqual(s.get(CONSERVATIVE_CONTROL_STORAGE_KEY).cash,0);
 assert.equal(s.get(CONSERVATIVE_CONTROL_STORAGE_KEY).blocked.includes('X'),false);
});
test('corrupted control state fails closed, never silently resets portfolio',()=>{
 const s=memory();
 s.force(CONSERVATIVE_CONTROL_STORAGE_KEY,{
  ...newConservativePortfolio(T),cash:NaN});
 assert.throws(()=>loadConservativePortfolio(s),/CONTROL_STATE_INVALID/);
});
test('unarmed control cannot BUY, but may SELL existing position',()=>{
 const idle=prepareConservativePortfolio(newConservativePortfolio(T),{
  enabled:false});
 assert.equal(evaluateConservativePortfolio(idle,args).report.status,'DISABLED');
 const existing=evaluateConservativePortfolio(newControl(),args);
 const paused=prepareConservativePortfolio(existing.next,{enabled:false});
 const sale=evaluateConservativePortfolio(paused,{
  ...args,now:T+150000,book:{...book,receivedAt:T+149000,
   yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(sale.report.status,'PAPER_SELL');
});
