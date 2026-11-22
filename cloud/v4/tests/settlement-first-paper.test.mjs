import test from 'node:test';
import assert from 'node:assert/strict';
import {settlementFirstPaperStep} from '../src/settlement-first-paper.js';
import {freshPaperState} from '../src/v2.js';
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,close_time:new Date(T+450000).toISOString()};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,sourceAt:T-1000,price:1804};
const one={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
 crossed:false,receivedAt:T-1000,yesBid:{price:.43,sizeFp:'20.00'},
 yesAsk:{price:.45,sizeFp:'20.00'},noBid:{price:.55,sizeFp:'20.00'},
 noAsk:{price:.57,sizeFp:'20.00'}};
const args={market,index,one,five,context,book,now:T,onPrediction:()=>{}};
const setup=()=>({...freshPaperState(),armed:true,monitoring:true,events:[],
 decisions:[],blocked:[],pending:[],trades:[]});
test('paper buys actual target side, fee-inclusive <=$3, unique ticker and journal before cash debit',()=>{
 const s=setup(),records=[];
 const step=settlementFirstPaperStep(s,{...args,onPrediction:p=>records.push(p)});
 assert.equal(step.status,'PAPER_BUY',step.notice);
 assert.equal(records.length,1);assert.equal(s.open.side,'UP');
 assert.equal(s.open.target,1800);assert.equal(s.open.indexValue,1804);
 assert.ok(s.open.qty>=1);
 assert.ok(s.open.cost<=3);
 assert.ok(s.open.entryFee>0);
 assert.equal(s.cash,Number((100-s.open.cost).toFixed(2)));
 assert.equal(s.blocked.length,1);
 assert.equal(s.open.fillVerified,false);
 assert.equal(settlementFirstPaperStep(s,{...args,now:T+2000,book:{...book,receivedAt:T+1000}}).status,'HOLD');
});
test('cannot debit cash or create position when required forecast journal fails',()=>{
 const s=setup(),r=settlementFirstPaperStep(s,{...args,
  onPrediction:()=>{throw Error('database down')}});
 assert.equal(r.status,'WATCH');assert.equal(s.cash,100);
 assert.equal(s.open,null);assert.equal(s.blocked.length,0);
});
test('96 cent displayed BID takes profit before final minute, remains separate from settlement accuracy',()=>{
 const s=setup();settlementFirstPaperStep(s,args);
 const r=settlementFirstPaperStep(s,{...args,now:T+150000,
  book:{...book,receivedAt:T+149000,yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(r.status,'PAPER_SELL');assert.equal(s.open,null);
 assert.equal(s.trades.length,1);assert.equal(s.trades[0].exitType,'EARLY SALE');
 assert.equal(s.trades[0].directionCorrect,null);
 assert.equal(s.trades[0].fillVerified,false);
 const again=settlementFirstPaperStep(s,{...args,now:T+151000,
  book:{...book,receivedAt:T+150000}});
 assert.equal(again.status,'WATCH');assert.equal(s.blocked.length,1);
});
test('96c BID during final minute is held, unless separate stop triggers',()=>{
 const s=setup();settlementFirstPaperStep(s,args);
 const r=settlementFirstPaperStep(s,{...args,now:T+410000,
  book:{...book,receivedAt:T+409000,yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(r.status,'HOLD');
 assert.equal(s.trades.length,0);assert.ok(s.open);
});
test('last-six-minute 40% stop only uses fresh displayed bid and actual capacity',()=>{
 const s=setup();settlementFirstPaperStep(s,args);
 const early=settlementFirstPaperStep(s,{...args,now:T+10000,
  book:{...book,receivedAt:T+9000,yesBid:{price:.24,sizeFp:'20.00'}}});
 assert.equal(early.status,'HOLD');
 const stale=settlementFirstPaperStep(s,{...args,now:T+200000,
  book:{...book,receivedAt:T+10000,yesBid:{price:.24,sizeFp:'20.00'}}});
 assert.equal(stale.status,'HOLD');
 const stopped=settlementFirstPaperStep(s,{...args,now:T+201000,
  book:{...book,receivedAt:T+200000,yesBid:{price:.24,sizeFp:'20.00'}}});
 assert.equal(stopped.status,'PAPER_SELL');assert.match(s.trades[0].reason,/40%/);
});
test('no guessed settlement: expired holding becomes pending before official result',()=>{
 const s=setup();settlementFirstPaperStep(s,args);
 const r=settlementFirstPaperStep(s,{...args,now:T+450100,market:null,book:null});
 assert.equal(r.status,'WATCH');assert.equal(s.open,null);
 assert.equal(s.pending.length,1);assert.equal(s.pending[0].status,'PENDING_OFFICIAL_KALSHI');
 assert.equal(s.trades.length,0);
});
test('unarmed cannot buy, bad book/target/official source WATCH but never debit cash',()=>{
 const s=setup();s.armed=false;
 assert.equal(settlementFirstPaperStep(s,args).status,'DISABLED');
 s.armed=true;
 assert.equal(settlementFirstPaperStep(s,{...args,index:null}).status,'WATCH');
 assert.equal(settlementFirstPaperStep(s,{...args,book:{...book,fresh:false}}).status,'WATCH');
 assert.equal(s.cash,100);
});

test('soft daily-loss mode refuses normal-grade setup rather than reusing legacy 7/7 checkboxes',()=>{
 const s=setup();
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(T));
 s.dailyRisk={day,mode:'SOFT'};
 const moderate={...args,index:{...index,price:1801.2}};
 const normal=settlementFirstPaperStep(setup(),moderate);
 assert.equal(normal.status,'PAPER_BUY','Moderate signal must be eligible in normal risk mode');
 const r=settlementFirstPaperStep(s,moderate);
 assert.equal(r.status,'WATCH');
 assert.equal(s.cash,100);
 assert.equal(s.open,null);
 assert.match(r.notice,/NO_RISK_ADJUSTED_VALUE|SOFT risk/);
});
test('V4 exit survives disarm and rejects non-WS sources even at a profitable price',()=>{
 const s=setup();settlementFirstPaperStep(s,args);
 s.armed=false;
 const falsePrice=settlementFirstPaperStep(s,{...args,now:T+150000,
  book:{...book,receivedAt:T+149000,source:'KALSHI_REST',yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(falsePrice.status,'HOLD');
 assert.ok(s.open);
 const validBook=settlementFirstPaperStep(s,{...args,now:T+151000,
  book:{...book,receivedAt:T+150000,yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(validBook.status,'PAPER_SELL');
 assert.equal(s.open,null);
 assert.equal(s.trades.length,1);
});

test('missing required persistence callback cannot create a paper trade',()=>{
 const s=setup(),data={...args};
 delete data.onPrediction;
 const r=settlementFirstPaperStep(s,data);
 assert.equal(r.status,'WATCH');
 assert.equal(s.cash,100);assert.equal(s.open,null);
});
test('a seemingly favorable ask without matching exit-side bid depth must PASS',()=>{
 const s=setup();
 const r=settlementFirstPaperStep(s,{...args,book:{
  ...book,yesBid:{price:.43,sizeFp:'0.00'}
 }});
 assert.equal(r.status,'WATCH');
 assert.equal(s.open,null);assert.equal(s.cash,100);
});

test('conditional buys through 87c, hard >87c block and 96c SELL remain separate',()=>{
 const strong={...args,index:{...index,price:1808},
  one:{...one,last:1808,e8:1805,e21:1802},
  market:{...market,close_time:new Date(T+4*60000).toISOString()}};
 for(const ask of [.8501,.86,.87]){
  const s=setup();
  const result=settlementFirstPaperStep(s,{...strong,book:{...book,
   yesBid:{price:.84,sizeFp:'20.00'},
   yesAsk:{price:ask,sizeFp:'20.00'}}});
  assert.equal(result.status,'PAPER_BUY',ask+' '+result.notice);
  assert.equal(s.open.entry,ask);
  assert.ok(s.open.cost<=3);
 }
 for(const ask of [.8701,.88,.90,.95,.99]){
  const s=setup();
  const result=settlementFirstPaperStep(s,{...strong,book:{...book,
   yesBid:{price:.84,sizeFp:'20.00'},
   yesAsk:{price:ask,sizeFp:'20.00'}}});
  assert.equal(result.status,'WATCH','ask '+ask);
  assert.equal(s.open,null);assert.equal(s.cash,100);
  assert.equal(s.blocked.length,0);
 }
 const s=setup();
 assert.equal(settlementFirstPaperStep(s,args).status,'PAPER_BUY');
 const sold=settlementFirstPaperStep(s,{...args,now:T+150000,
  book:{...book,receivedAt:T+149000,yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(sold.status,'PAPER_SELL');
});

test('first eligible lower-priced quote BUYs immediately without waiting for 85c',()=>{
 // A 10-minute-left window: a valid cheaper setup must not wait for
 // the >=85c five-minute entry gate or an arbitrary premium-price target.
 for(const ask of [.20,.35,.45,.55,.65]){
  const s=setup();
  const result=settlementFirstPaperStep(s,{...args,
   market:{...market,close_time:new Date(T+10*60000).toISOString()},
   book:{...book,
    yesBid:{price:Number((ask-.02).toFixed(2)),sizeFp:'20.00'},
    yesAsk:{price:ask,sizeFp:'20.00'}}});
  assert.equal(result.status,'PAPER_BUY','ask '+ask+' '+result.notice);
  assert.equal(s.open?.entry,ask);
  assert.ok(s.open.cost<=3);
 }
 // No premium chase: the same early-minute conditions at 85c must WATCH.
 const s=setup();
 const early=settlementFirstPaperStep(s,{...args,
  market:{...market,close_time:new Date(T+10*60000).toISOString()},
  book:{...book,yesBid:{price:.83,sizeFp:'20.00'},
   yesAsk:{price:.85,sizeFp:'20.00'}}});
 assert.equal(early.status,'WATCH');
 assert.equal(s.open,null);
});

test('temporary missing ticker before close does NOT record a final ROUND PASS',()=>{
 const s=setup();
 const noIndex=settlementFirstPaperStep(s,{...args,index:null});
 assert.equal(noIndex.status,'WATCH');
 assert.equal(s.decisions.length,0);
 assert.equal(s.window.ticker,ticker);
 const dropped=settlementFirstPaperStep(s,{...args,market:null,index:null,
  book:null,now:T+120000});
 assert.equal(dropped.status,'WATCH');
 assert.equal(s.decisions.length,0,'a temporary market-data outage is not a final PASS');
 assert.equal(s.window.ticker,ticker,'the same round remains eligible for later entry');
 const returned=settlementFirstPaperStep(s,{...args,
  now:T+121000,index:{...index,sourceAt:T+120000},
  book:{...book,receivedAt:T+120000}});
 assert.equal(returned.status,'PAPER_BUY','bot must retain its same-round opportunity');
 assert.equal(s.decisions.length,0,'a traded round must never count as a PASS');
});

test('an untraded window becomes exactly one final PASS at its actual close',()=>{
 const s=setup();
 const watching=settlementFirstPaperStep(s,{...args,index:null});
 assert.equal(watching.status,'WATCH');
 const stillOpen=settlementFirstPaperStep(s,{...args,market:null,index:null,
  book:null,now:T+449999});
 assert.equal(stillOpen.status,'WATCH');
 assert.equal(s.decisions.length,0);
 const expired=settlementFirstPaperStep(s,{...args,market:null,index:null,
  book:null,now:T+450000});
 assert.equal(expired.status,'WATCH');
 assert.equal(s.decisions.length,1);
 assert.equal(s.decisions[0].status,'PASS');
 assert.equal(s.decisions[0].ticker,ticker);
 assert.equal(s.decisions[0].time,T+450000);
 settlementFirstPaperStep(s,{...args,market:null,index:null,
  book:null,now:T+451000});
 assert.equal(s.decisions.length,1,'no repeated PASS for the same completed round');
});
