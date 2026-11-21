import test from 'node:test';
import assert from 'node:assert/strict';
import {KalshiBookStream} from '../src/kalshi-orderbook.js';
import {hypotheticalTaker,hypotheticalRoundTrip,
  findBudgetedHypotheticalEntry,EXECUTION_ASSUMPTIONS} from '../src/paper-execution-research.js';
const ticker='KXETH15M-26NOV210015-15', now=1795200000000;
function book(){
 const b=new KalshiBookStream();
 b.apply({type:'orderbook_snapshot',sid:1,seq:2,sending_ts_ms:now-10,
  msg:{market_ticker:ticker,clock:22,
   yes_dollars_fp:[['0.3700','2.00'],['0.3500','1.00']],
   no_dollars_fp:[['0.6000','3.00'],['0.5700','1.00']]}},now);
 return b;
}
test('book-walk what-if BUY cost includes fees, does not claim execution',()=>{
 const r=hypotheticalTaker(book(),{ticker,side:'UP',action:'BUY',contracts:2,now});
 assert.equal(r.status,'HYPOTHETICAL');
 assert.equal(r.grossDollars,.8);
 assert.equal(r.feesDollars,.04);
 assert.equal(r.allInCost,.84);
 assert.equal(r.verifiedFill,false);
 assert.equal(r.feeVerified,false);
 assert.equal(r.latencyVerified,false);
});
test('round-trip shown for reference only, returns negative spread+fees',()=>{
 const r=hypotheticalRoundTrip(book(),{ticker,side:'UP',contracts:2,now});
 assert.equal(r.status,'HYPOTHETICAL');
 assert.equal(r.buy.allInCost,.84);
 assert.equal(r.sell.grossDollars,.74);
 assert.equal(r.sell.feesDollars,.04);
 assert.equal(r.sell.netProceeds,.70);
 assert.equal(r.feeAdjustedPnl,-.14);
 assert.equal(r.verifiedFill,false);
});
test('unavailable depth cannot fabricate a 96-cent profit exit',()=>{
 const b=book();
 const r=hypotheticalTaker(b,{ticker,side:'UP',action:'SELL',contracts:4,now});
 assert.equal(r.executable,false);
 assert.equal(r.status,'NO_QUOTE_OR_DEPTH');
 assert.equal(r.verifiedFill,false);
});
test('prospective positions are bounded by $3 ALL-IN, including fees',()=>{
 const r=findBudgetedHypotheticalEntry(book(),{
  ticker,side:'UP',budget:3,now,maxContracts:20});
 assert.equal(r.status,'HYPOTHETICAL');
 assert.ok(r.allInCost<=3);
 assert.ok(r.contracts>=1);
 assert.throws(()=>findBudgetedHypotheticalEntry(book(),{ticker,side:'UP',budget:3.01,now}));
 assert.equal(EXECUTION_ASSUMPTIONS.maxStakeAllIn,3);
});
test('stale book, impossible price and partial liquidity return no hypothetical fill',()=>{
 const b=book();
 assert.equal(hypotheticalTaker(b,{
  ticker,side:'DOWN',action:'BUY',contracts:1,now:now+50001}).status,'NO_QUOTE_OR_DEPTH');
 assert.equal(hypotheticalTaker(b,{
  ticker,side:'UP',action:'BUY',contracts:100,now}).status,'NO_QUOTE_OR_DEPTH');
 assert.throws(()=>hypotheticalTaker(b,{ticker,side:'UP',action:'BUY',contracts:0,now}));
});
