/* V4 RESEARCH ONLY: price-aware risk/reward arithmetic.
 * THIS FILE IS NOT A LIVE OR PAPER BUY GATE. A heuristic score is not a
 * calibrated settlement probability. Keep this module outside the V4
 * execution pipeline until actual-target as-of backtesting and independent
 * price-band calibration have passed.
 * No API requests, storage writes, real orders, or dynamic imports.
 */
export const PRICE_VALUE_RESEARCH_VERSION='V4-PRICE-VALUE-RESEARCH-20261122';
export const PRICE_VALUE_MAX_BUY_ASK=0.87;
const legal=x=>Number.isFinite(x)&&x>=0&&x<=1;
const fixed4=x=>Math.round((x+Number.EPSILON)*10000)/10000;
const ceilCentiCent=x=>Math.ceil(x*10000-1e-10)/10000;

/** General KXETH15M taker-fee research baseline, by ORDER, in DOLLARS.
 * Live source fees may change by series/event/fee tier. Always revalidate
 * the effective source-specific fees before economic implementation.
 */
export function researchTakerFee({ask,quantity,feeMultiplier=1}={}){
 if(!legal(ask)||!Number.isInteger(quantity)||quantity<1||
    !Number.isFinite(feeMultiplier)||feeMultiplier<0)return null;
 return fixed4(ceilCentiCent(.07*feeMultiplier*quantity*ask*(1-ask)));
}

/** Provable arithmetic independent of a directional probability model.
 * This is an economic cost/benefit research ledger, NOT permission to BUY.
 */
export function priceSettlementEconomics({ask,quantity,feeMultiplier=1}={}){
 if(!legal(ask)||ask<=0||ask>=1||
    !Number.isInteger(quantity)||quantity<1||
    !Number.isFinite(feeMultiplier)||feeMultiplier<0)
  return {status:'INVALID_QUOTE',entryEligible:false};
 const fee=researchTakerFee({ask,quantity,feeMultiplier});
 const grossCost=fixed4(quantity*ask);
 const allInCost=fixed4(grossCost+fee);
 const profitIfCorrect=fixed4(quantity-allInCost);
 return {status:'RESEARCH_ONLY_NOT_AN_ENTRY_SIGNAL',
  version:PRICE_VALUE_RESEARCH_VERSION,entryEligible:false,
  absoluteBuyCeilingExceeded:ask>PRICE_VALUE_MAX_BUY_ASK,
  ask,quantity,feeMultiplier,fee,
  grossCost,allInCost,
  maximumLoss:allInCost,
  profitIfCorrect,
  costPerContract:allInCost/quantity,
  breakEvenWinProbability:allInCost/quantity,
  rewardToRiskRatio:profitIfCorrect/allInCost,
  settlementTruth:'ACTUAL_KALSHI_FINALIZED_OUTCOME_ONLY',
  calibratedWinProbability:null,expectedNetProfit:null};
}

/** Scenario analysis with a HYPOTHETICAL p (not from V4 confidence).
 * No trading decision booleans; still entryEligible=false by construction.
 */
export function hypotheticalSettlementValue({ask,quantity,winProbability,feeMultiplier=1}={}){
 const base=priceSettlementEconomics({ask,quantity,feeMultiplier});
 if(base.status!=='RESEARCH_ONLY_NOT_AN_ENTRY_SIGNAL'||!legal(winProbability))
  return {...base,scenarioStatus:'INVALID_PROBABILITY',hypotheticalWinProbability:null};
 return {...base,scenarioStatus:'ILLUSTRATIVE_NOT_CALIBRATED',
  hypotheticalWinProbability:winProbability,
  hypotheticalExpectedProfit:fixed4(quantity*winProbability-base.allInCost),
  hypotheticalEdgePerContract:fixed4(winProbability-base.costPerContract),
  hypotheticalProfitPerDollar:fixed4(
   (quantity*winProbability-base.allInCost)/base.allInCost)};
}
