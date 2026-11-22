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
 const r=settlementFirstPaperStep(s,args);
 assert.equal(r.status,'WATCH');
 assert.equal(s.cash,100);
 assert.equal(s.open,null);
 assert.match(r.notice,/SOFT risk/);
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
