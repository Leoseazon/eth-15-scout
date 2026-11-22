import test from 'node:test';
import assert from 'node:assert/strict';
import {priceSettlementEconomics,researchTakerFee,hypotheticalSettlementValue,
 PRICE_VALUE_MAX_BUY_ASK} from '../src/price-value-research.js';

test('research break-even must include accurate order-level centicent taker fees',()=>{
 const expectations=[
  [.05,.01,.06],[.15,.01,.16],[.35,.02,.37],
  [.45,.02,.47],[.65,.02,.67],
  [.85,.01,.86],[.87,.01,.88]];
 for(const [ask,fee,breakeven] of expectations){
  const r=priceSettlementEconomics({ask,quantity:1});
  assert.equal(r.fee,fee,'fee at '+ask);
  assert.ok(Math.abs(r.breakEvenWinProbability-breakeven)<1e-10,'break-even at '+ask);
  assert.equal(r.maximumLoss,r.allInCost);
  assert.ok(Math.abs(r.profitIfCorrect+r.allInCost-1)<1e-10);
  assert.equal(r.entryEligible,false);
  assert.equal(r.calibratedWinProbability,null);
  assert.equal(r.expectedNetProfit,null);
 }
 assert.equal(researchTakerFee({ask:.15,quantity:3}),.03);
 assert.equal(researchTakerFee({ask:.15,quantity:1,feeMultiplier:0}),0);
 assert.equal(priceSettlementEconomics({ask:.87,quantity:1}).absoluteBuyCeilingExceeded,false);
 assert.equal(priceSettlementEconomics({ask:.8701,quantity:1}).absoluteBuyCeilingExceeded,true);
 assert.equal(PRICE_VALUE_MAX_BUY_ASK,.87);
});

test('illustrative EV exposes why low ask and high win rate alone are not edge',()=>{
 const cases=[
  [.05,.03,-.03], // longshot: maximum upside but still negative EV
  [.15,.25,.09], // winning more often than net cost implies possible edge
  [.45,.60,.13],
  [.85,.90,.04], // higher win probability, smaller expected profit
  [.87,.87,-.01] // ignoring fee invents a false break-even
 ];
 for(const [ask,p,ev] of cases){
  const r=hypotheticalSettlementValue({ask,quantity:1,winProbability:p});
  assert.equal(r.scenarioStatus,'ILLUSTRATIVE_NOT_CALIBRATED');
  assert.ok(Math.abs(r.hypotheticalExpectedProfit-ev)<1e-10);
  assert.equal(r.entryEligible,false);
  assert.equal(r.expectedNetProfit,null);
 }
});

test('unavailable or invented probability cannot become a trading authorization',()=>{
 for(const p of [null,undefined,NaN,-.01,1.01,Infinity]){
  const r=hypotheticalSettlementValue({ask:.45,quantity:1,winProbability:p});
  // Note: null is NOT an accepted 0% probability. A valid 0 must be numeric.
  assert.notEqual(r.scenarioStatus,'LIVE_BUY');
  assert.equal(r.entryEligible,false);
 }
 for(const bad of [0,-.15,1,1.2,NaN,Infinity]){
  assert.equal(priceSettlementEconomics({ask:bad,quantity:1}).entryEligible,false);
 }
 assert.equal(priceSettlementEconomics({ask:.45,quantity:0}).entryEligible,false);
});
