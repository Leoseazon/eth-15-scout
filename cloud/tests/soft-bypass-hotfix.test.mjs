import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDailyRisk, PAPER_POLICY} from '../src/v3-policy.js';
import {freshPaperState, makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';

// Purely synthetic PAPER fixtures. The hotfix does not change live exchange orders.
const strong = {
  last:1795, prev:1794, e8:1794, e8prev:1793, e21:1792,
  rNow:60, rPrev:45, mNow:2, mPrev:-1, sNow:1, sPrev:0,
  three:1, sd:2
};
const six = {...strong, rNow:49, rPrev:40}; // Six, not seven, fast checks.
const slow = {e21:1790, e50:1780, macd:2, signal:1, rsi:60};
function mk(minutes=10, price=.60) {
  return {
    ticker:'KXETH15M-SOFT-BYPASS-UNIT-TEST', status:'active',
    close_time:new Date(Date.now()+minutes*60000).toISOString(),
    floor_strike:'1795',
    yes_ask_dollars:String(price), yes_bid_dollars:String(price-.01),
    no_ask_dollars:String(1-price+.01), no_bid_dollars:String(1-price),
    yes_ask_size_fp:'50', yes_bid_size_fp:'50'
  };
}
function lossState(loss=-12) {
  const s=freshPaperState();
  s.armed=true;
  s.trades=[{ticker:'HISTORICAL-TRADE',exitAt:Date.now(),pnl:loss,confirmed:true}];
  return s;
}
test('temporarily bypasses latched SOFT, while retaining the -12% diagnostic',()=>{
  const r=assessDailyRisk({
    initial:100,realizedToday:-12,previousMode:'SOFT',softGuardEnabled:false
  });
  assert.equal(r.mode,'NORMAL');
  assert.equal(r.canEnter,true);
  assert.equal(r.maxStake,PAPER_POLICY.maxStakeIncludingFees);
  assert.equal(r.softGuardEnabled,false);
  assert.equal(r.softThresholdExceeded,true);
  assert.equal(r.netRiskPnl,-12);
});
test('default behavior still enforces SOFT and is reversible',()=>{
  const original=assessDailyRisk({initial:100,realizedToday:-12});
  assert.equal(original.mode,'SOFT');
  const restored=assessDailyRisk({initial:100,realizedToday:-12,
    softGuardEnabled:true,previousMode:'NORMAL'});
  assert.equal(restored.mode,'SOFT');
  assert.equal(restored.maxStake,1.5);
});
test('six-of-seven entry may qualify in the bypass, without loosening normal gates',()=>{
  const soft=lossState();
  makeV2Engine(soft).step(mk(),six,slow,true,structureFixture());
  assert.equal(soft.dailyRisk.mode,'SOFT');
  assert.equal(soft.open,null);
  const bypass=lossState();
  const oldCash=bypass.cash;
  const historyCount=bypass.trades.length;
  makeV2Engine(bypass,{softGuardEnabled:false})
    .step(mk(),six,slow,true,structureFixture());
  assert.equal(bypass.dailyRisk.mode,'NORMAL');
  assert.equal(bypass.dailyRisk.softGuardEnabled,false);
  assert.ok(bypass.open,'normal reversal guard should permit six-check synthetic setup');
  assert.ok(bypass.open.cost>1.50&&bypass.open.cost<=3);
  assert.equal(bypass.trades.length,historyCount,'historical trades remain unchanged');
  assert.equal(bypass.cash,Number((oldCash-bypass.open.cost).toFixed(2)));
});
test('temporary SOFT bypass does not disable the -20% HARD halt',()=>{
  for(const inputs of [
    {realizedToday:-20},
    {realizedToday:-17,pendingExposure:3},
    {realizedToday:-18,openLoss:-2},
    {realizedToday:0,previousMode:'HARD'}
  ]){
    const r=assessDailyRisk({initial:100,softGuardEnabled:false,...inputs});
    assert.equal(r.mode,'HARD',JSON.stringify(inputs));
    assert.equal(r.canEnter,false);
    assert.equal(r.maxStake,0);
  }
  const s=lossState(-20);
  makeV2Engine(s,{softGuardEnabled:false})
    .step(mk(),strong,slow,true,structureFixture());
  assert.equal(s.dailyRisk.mode,'HARD');
  assert.equal(s.open,null);
});
test('bad daily-risk inputs fail closed even while SOFT is bypassed',()=>{
  const r=assessDailyRisk({initial:100,pendingExposure:NaN,softGuardEnabled:false});
  assert.equal(r.mode,'HARD');
  assert.equal(r.canEnter,false);
});
