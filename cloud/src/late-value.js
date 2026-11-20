/* ETH-15 Scout guarded high-price paper entry. NOT a probability model.
 * Eight-minute 80–89c experiment with 5/7 or 6/7 fast evidence.
 * Kraken spot is only a proxy for Kalshi's CF RTI settlement benchmark.
 */
export const LATE_VALUE_POLICY=Object.freeze({
  minAsk:.80,maxAskExclusive:.90,minMinutes:1.5,maxMinutes:8,
  transitionMinutes:3,maxSpread:.03,maxStakeWithFees:1.50,
  minDepthMultiple:2,minThreeMinuteMarginRatio:.30,
  finalThreeMinuteMarginRatio:.55,
  minAbsoluteStrikeMargin:0.50
});
export function lateValueGate({
 side,price,remaining,passed,families,onePrice,strike,volatility,
 threeTrend,spread,askSize,bidSize,expectedQty,riskMode='NORMAL',
 highVolRegime=false
}){
 const fail=reason=>({ok:false,reason});
 const p=LATE_VALUE_POLICY;
 if(!['UP','DOWN'].includes(side))return fail('Invalid side');
 if(![price,remaining,spread,passed,onePrice,strike,volatility,
       askSize,bidSize,expectedQty].every(Number.isFinite))
   return fail('Missing strike, volatility or executable quote');
 if(price<p.minAsk||price>=p.maxAskExclusive||remaining<p.minMinutes||
     remaining>p.maxMinutes)return fail('Outside 80–89c / 1.5–8m eligibility');
 if(riskMode!=='NORMAL'||highVolRegime)return fail('Elevated risk mode');
 if(spread<0||spread>p.maxSpread)return fail('80–89c spread exceeds 3c');
 const required=remaining<p.transitionMinutes?6:5;
 if(passed<required||!families?.price||families.breadth<2||
      !(families.momentum||families.acceleration))
   return fail('Insufficient price-direction and momentum evidence');
 if(threeTrend!==side&&threeTrend!=='NEUTRAL')
   return fail('Opposing completed three-minute trend');
 if(volatility<=0||expectedQty<1||
     askSize<p.minDepthMultiple*expectedQty||
     bidSize<p.minDepthMultiple*expectedQty)
   return fail('Missing volatility or 2x executable book depth');
 // Use one-minute volatility * sqrt(remaining) as a conservative, explicit
 // heuristic, not a calibrated distribution or official settlement average.
 const margin=(side==='UP'?1:-1)*(onePrice-strike);
 const ratio=remaining<p.transitionMinutes?
    p.finalThreeMinuteMarginRatio:p.minThreeMinuteMarginRatio;
 const requiredMargin=Math.max(p.minAbsoluteStrikeMargin,
    ratio*volatility*Math.sqrt(remaining));
 if(margin<requiredMargin)
   return fail('Kraken spot is not safely beyond Kalshi strike for this contract');
 return {ok:true,reason:'Guarded late-value setup: distinct fast evidence and strike cushion',
   required,margin,requiredMargin,highestRisk:false};
}
