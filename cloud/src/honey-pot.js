/* One-contract PAPER-ONLY final-90-second honey-pot hypothesis.
 * Never infer Kalshi CF Benchmarks index settlement from Kraken spot.
 * No 1m RSI/MACD/EMA or 3m/5m trend confirmation is required.
 * EXECUTION and margin-to-strike safety checks are still mandatory.
 */
export const HONEY_POLICY=Object.freeze({
  minSecondsRemaining:60, // NEVER enter inside official final RTI minute
  maxSecondsRemaining:90, // only final 60-90 seconds
  minAsk:.80,maxAsk:.85,
  maxSpread:.02,minDepth:2,
  minAbsoluteStrikeMargin:2.50,
  minVolatilityMultiple:1.25,
  maxAllInStake:.90
});
export function honeyPotGate({
 side,price,secondsRemaining,spread,askSize,bidSize,
 krakenPrice,strike,oneMinuteVolatility,riskMode='NORMAL'
}){
 const p=HONEY_POLICY;
 const fail=reason=>({ok:false,reason});
 if(side!=='UP'&&side!=='DOWN')return fail('Invalid side');
 if(![price,secondsRemaining,spread,askSize,bidSize,krakenPrice,strike,
   oneMinuteVolatility].every(Number.isFinite))
   return fail('Stale or incomplete price, depth, strike or volatility');
 if(secondsRemaining<=p.minSecondsRemaining||
    secondsRemaining>=p.maxSecondsRemaining)
   return fail('Honey-pot only between 60 and 90 seconds before expiry');
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
 return {ok:true,reason:'Paper-only late honey-pot experiment; official RTI unknown',
   margin,requiredMargin};
}
