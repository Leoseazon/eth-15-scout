import test from 'node:test';
import assert from 'node:assert/strict';
import {paperTradeOutcome,buildPaperSettlement,PAPER_TRADE_KINDS} from '../src/settlement-accounting.js';
const pos={ticker:'KXETH15M-TEST',side:'DOWN',qty:4,entry:0.63,
  entryFee:0.07,cost:2.59,time:1000,closeTime:'2026-11-20T06:00:00Z'};
const finalized={ticker:pos.ticker,exchangeStatus:'finalized',
  status:'OFFICIAL_RESULT',outcome:'DOWN',reportedDirection:'DOWN',
  officialResult:'no',settledAt:2000};
test('official winning settlement pays qty in dollars once, entry fee already charged',()=>{
  const t=buildPaperSettlement(pos,finalized,3000);
  assert.equal(t.proceeds,4);
  assert.equal(t.pnl,1.41);
  assert.equal(t.status,'WIN');
  assert.equal(t.exitType,PAPER_TRADE_KINDS.SETTLED);
  assert.equal(t.confirmed,true);
  assert.equal(t.settlementFee,0);
  assert.equal(t.exitAt,2000);
});
test('official losing settlement realizes full stake but never makes guessed sale proceeds',()=>{
  const t=buildPaperSettlement(pos,{...finalized,outcome:'UP',
    reportedDirection:'UP',officialResult:'yes'},3000);
  assert.equal(t.proceeds,0);
  assert.equal(t.pnl,-2.59);
  assert.equal(t.status,'LOSS');
});
test('denies provisional, reported, closed, wrong market, mismatched result, and malformed stakes',()=>{
  for(const fields of [
    {status:'REPORTED'},
    {exchangeStatus:'determined'},
    {exchangeStatus:'settled'},
    {status:'PENDING'},
    {status:'VOID'},
    {ticker:'OTHER'},
    {officialResult:'yes'},
    {reportedDirection:'UP'},
    {outcome:'UP'},
  ])assert.equal(buildPaperSettlement(pos,{...finalized,...fields},3000),null,
    JSON.stringify(fields));
  assert.equal(buildPaperSettlement({...pos,qty:0},finalized,3000),null);
  assert.equal(buildPaperSettlement({...pos,cost:NaN},finalized,3000),null);
});
test('an early-cashed-out trade counts by realized pnl irrespective of later outcome',()=>{
  const early={...pos,confirmed:true,exitAt:1800,exitType:'EARLY SALE',
    status:'WIN',pnl:1.23};
  assert.equal(paperTradeOutcome(early),'WIN');
  // Even an official market UP result does not alter this realized cash-out.
  const opposingMarket={...finalized,outcome:'UP',reportedDirection:'UP',
    officialResult:'yes'};
  assert.equal(paperTradeOutcome(early),'WIN');
  assert.notEqual(buildPaperSettlement(pos,opposingMarket,3000)?.pnl,early.pnl);
});
test('unresolved, unconfirmed, or zero outcomes never count as a win',()=>{
  assert.equal(paperTradeOutcome({...pos,pnl:3,exitAt:2000}),null);
  assert.equal(paperTradeOutcome({...pos,confirmed:true,pnl:NaN,exitAt:2000}),null);
  assert.equal(paperTradeOutcome({...pos,confirmed:true,pnl:0,exitAt:2000}),'FLAT');
  assert.equal(paperTradeOutcome({...pos,confirmed:true,pnl:-1,exitAt:2000}),'LOSS');
});
