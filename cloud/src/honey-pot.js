/* One-contract PAPER-ONLY final-90-second honey-pot hypothesis.
 * Never infer Kalshi CF Benchmarks index settlement from Kraken spot.
 * At least FOUR of the seven fresh 1m indicator checks are mandatory.
 * Completed 3m/5m TREND ALIGNMENT is not a honey-pot requirement.
 * EXECUTION and margin-to-strike safety checks are still mandatory.
 */
export const HONEY_POLICY=Object.freeze({
  minSecondsRemaining:60, // no new buys during official final RTI minute
  maxSecondsRemaining:90, // strictly under 1m30s, and >1m
  minAsk:.80,maxAsk:.85,
  minFastChecks:4, // require 4/7; no universal 7/7 rule
  maxSpread:.02,minDepth:2,
  minAbsoluteStrikeMargin:2.50,
  minVolatilityMultiple:1.25,
  maxAllInStake:.90,
  stopLossFraction:.10 // 10% relative to the actual entry contract price
});
export function honeyPotGate({
 side,price,secondsRemaining,spread,askSize,bidSize,
 krakenPrice,strike,oneMinuteVolatility,fastChecks,riskMode='NORMAL'
}){
 const p=HONEY_POLICY;
 const fail=reason=>({ok:false,reason});
 if(side!=='UP'&&side!=='DOWN')return fail('Invalid side');
 if(![price,secondsRemaining,spread,askSize,bidSize,krakenPrice,strike,
   oneMinuteVolatility,fastChecks].every(Number.isFinite))
   return fail('Stale or incomplete price, depth, strike or volatility');
 if(secondsRemaining<=p.minSecondsRemaining||
    secondsRemaining>=p.maxSecondsRemaining)
   return fail('Honey-pot only between 60 and 90 seconds before expiry');
 if(!Number.isInteger(fastChecks)||fastChecks<p.minFastChecks||fastChecks>7)
   return fail('Honey-pot requires at least 4 of 7 fresh one-minute checks');
 if(price<p.minAsk||price>p.maxAsk)
   return fail('Honey-pot requires an 80–85c ask, never higher');
 if(riskMode!=='NORMAL')return fail('Honey-pot disabled in soft/hard daily risk');
 if(spread<0||spread>p.maxSpread||askSize<p.minDepth||bidSize<p.minDepth)
   return fail('Honey-pot requires <=2c spread and 2x book depth');
 if(oneMinuteVolatility<=0)return fail('Volatility unavailable');
 // Proxy safety only. Official RTI data are not received live.
 const margin=(side==='UP'?1:-1)*(krakenPrice-strike);
 const requiredMargin=Math.max(p.minAbsoluteStrikeMargin,
     p.minVolatilityMultiple*oneMinuteVolatility);
 if(margin<requiredMargin)
   return fail('Kraken price not sufficiently beyond Kalshi strike');
 return {ok:true,reason:'Paper-only late honey-pot; >=4/7 fast checks; official RTI unknown',
   fastChecks,margin,requiredMargin};
}

// STOP uses actual executable BID; if the bid declines >=10% relative
// to the contract's entry ASK, attempt paper exit (subject to bid depth).
// 85c entry: threshold 76.5c; a quoted 76c bid triggers, 77c does not.
// 80c entry: threshold 72c. No inferred fill with an unavailable bid.
export function honeyStopTriggered(entryPrice,executableBid){
  return Number.isFinite(entryPrice)&&Number.isFinite(executableBid)&&
    entryPrice>0&&entryPrice<1&&
    executableBid>=0&&executableBid<=1&&
    executableBid <= entryPrice*(1-HONEY_POLICY.stopLossFraction)+1e-9;
}

// Audit-only formatting; same conditions apply to UP and DOWN.
// Keep each side short so BOTH sides fit the 300-character WATCH cap.
export function honeyAuditReason(side,price,fastChecks,gateReason=''){
 const ask=Number.isFinite(price)?(price*100).toFixed(1)+'c':'n/a';
 const score=Number.isFinite(fastChecks)?fastChecks+'/7':'n/a';
 const fail=[];
 if(!Number.isFinite(price)||price<HONEY_POLICY.minAsk||price>HONEY_POLICY.maxAsk)
   fail.push('price');
 if(!Number.isInteger(fastChecks)||fastChecks<HONEY_POLICY.minFastChecks)
   fail.push('score');
 if(!fail.length&&gateReason)fail.push(gateReason);
 return side+' HONEY [ask 80-85c, >=4/7]: observed '+ask+', '+score+
   '; fails '+(fail.join('+')||'other');
}
