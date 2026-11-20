/* V3 paper-only early recognition and fair-value safeguards.
 * No forecast probability: these are transparent observable eligibility
 * checks, not claims of positive expected value.
 */
export const EARLY_POLICY=Object.freeze({
  minRemainingMinutes:7,
  maxRemainingMinutes:12.5,
  minEntryPrice:0.35,
  maxEntryPrice:0.68,
  maxSpread:0.03,
  minIndependentFamilies:3,
  minFastChecks:5,
  maxStakeIncludingFees:1.50,
  minDepthMultiple:2,
  minNetSettlementReward:0.08
});
// The individual indicators are all calculated from prices, and these
// groups are NOT genuinely statistically independent. Counting a group
// only once limits duplicated votes from closely related calculations.
const signalFamilyNames=Object.freeze({
  price:['1m price vs EMA8','1m EMA8 vs EMA21','1m 3-candle move'],
  momentum:['1m RSI9 direction','1m RSI9 side of 50'],
  acceleration:['1m MACD vs signal','1m MACD acceleration']
});
export function signalFamilies(checks){
  const rows=Array.isArray(checks)?checks:[];
  const ok=new Set(rows.filter(r=>r?.ok===true).map(r=>r.name));
  const out=Object.fromEntries(Object.entries(signalFamilyNames)
    .map(([group,names])=>[group,names.some(name=>ok.has(name))]));
  return {...out,breadth:Object.values(out).filter(Boolean).length};
}
export function settlementRewardQuality({price,entryFeePerContract,remaining}){
  if(![price,entryFeePerContract,remaining].every(Number.isFinite)||
      !(price>0&&price<1)||entryFeePerContract<0||remaining<=0)
    return {ok:false,reason:'Missing price/fee/time'};
  const cost=Number((price+entryFeePerContract).toFixed(4));
  const reward=1-cost;
  const rewardToCost=reward/cost;
  return {ok:reward>=EARLY_POLICY.minNetSettlementReward,
    cost,reward,rewardToCost,breakEvenProbability:cost,
    reason:reward>=EARLY_POLICY.minNetSettlementReward?
      'Reward remaining after entry fee':'Settlement upside too small after fees'};
}
export function earlyCountertrendGate({
  side,price,remaining,spread,fastChecks,turned,families,
  threeTrend,fiveTrend,strikePlausible,directionReachable,
  sufficientDepth,secondaryCaution=false,macroAgainst=false
}){
  const fail=reason=>({ok:false,reason});
  if(!['UP','DOWN'].includes(side))return fail('Invalid side');
  if(!Number.isFinite(price)||!Number.isFinite(remaining)||
     !Number.isFinite(spread))return fail('Missing quote or time');
  if(remaining<EARLY_POLICY.minRemainingMinutes ||
     remaining>EARLY_POLICY.maxRemainingMinutes)
    return fail('Outside early-recognition time window');
  if(price<EARLY_POLICY.minEntryPrice||price>EARLY_POLICY.maxEntryPrice)
    return fail('Outside affordable early-entry range');
  if(spread<0||spread>EARLY_POLICY.maxSpread)
    return fail('Early exception requires a tight quote');
  if(!(threeTrend===side||threeTrend==='NEUTRAL') ||
     !(fiveTrend==='UP'||fiveTrend==='DOWN')||fiveTrend===side)
    return fail('Not a lagging-five-minute-trend reversal');
  if(!turned||fastChecks<EARLY_POLICY.minFastChecks||
     families?.breadth<EARLY_POLICY.minIndependentFamilies)
    return fail('Early exception lacks diversified reversal evidence');
  if(!strikePlausible||!directionReachable)
    return fail('Strike too distant for early countertrend risk');
  if(!sufficientDepth||secondaryCaution||macroAgainst)
    return fail('Early exception blocked by liquidity, structure or regime caution');
  return {ok:true,reason:'Guarded early countertrend reversal'};
}
// A transparent rank, never a modeled probability. Indicator check count
// now has less influence than family diversity and fees/reward. Prefer
// genuinely early, affordable entries only when structural gates also pass.
export function opportunityScore({
  passed,families,turned,strategy,spread,quality,remaining,price,
  strikeDirectionFavorable=false
}){
  if(![passed,spread,remaining,price].every(Number.isFinite)||
     !quality?.ok||!Number.isFinite(quality.rewardToCost))return -Infinity;
  const earlyValue=remaining>=7&&remaining<=12.5&&price<=0.68?5:0;
  return families.breadth*7+passed*2+(turned?4:0)+
    Math.min(12,quality.rewardToCost*12)+earlyValue-
    spread*150+(strikeDirectionFavorable?2:0)+
    (strategy==='EARLY-REVERSAL'?1:0);
}
