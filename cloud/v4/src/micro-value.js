/* Strict sub-20c paper research entry. Cheap price alone is NOT an edge.
 * $0.50 is the MAXIMUM TOTAL PAPER COST INCLUDING entry fees, not per contract.
 * No privilege to bypass ordinary 1.5m entry cutoff, barriers or daily risk.
 */
export const MICRO_POLICY=Object.freeze({
  maxAskExclusive:0.20,
  maxAllInStake:0.50,
  requiredFastChecks:7,
  maxSpread:0.02,
  minDepthMultiple:2
});
export function microValueGate({
  price,passed,slowTrend,plausible,alignment,
  threeTrend,fiveTrend,side,structureCaution,regimeAgainst,
  strikeReachable,spread,askSize,bidSize,qty,
  riskMode='NORMAL'
}){
  const fail=reason=>({ok:false,reason});
  if(![price,passed,spread,askSize,bidSize,qty].every(Number.isFinite))
    return fail('Incomplete low-price quote or liquidity');
  if(price<=0||price>=MICRO_POLICY.maxAskExclusive)
    return fail('Micro-value applies ONLY below 20c');
  if(riskMode!=='NORMAL')return fail('No low-price risk taking during soft/hard daily loss');
  if(passed<MICRO_POLICY.requiredFastChecks||!slowTrend||!plausible||!alignment)
    return fail('Under-20c price requires all 7 one-minute checks and validated slow trend');
  if(!['UP','DOWN'].includes(side)||threeTrend!==side||fiveTrend!==side)
    return fail('Under-20c price requires fully aligned completed 3m and 5m trend');
  if(structureCaution||regimeAgainst||!strikeReachable)
    return fail('Under-20c blocked by structure, regime or unreachable strike');
  if(spread<0||spread>MICRO_POLICY.maxSpread)
    return fail('Under-20c bid/ask spread exceeds 2c');
  if(qty<1||!Number.isInteger(qty)||
     askSize<MICRO_POLICY.minDepthMultiple*qty||
     bidSize<MICRO_POLICY.minDepthMultiple*qty)
    return fail('Under-20c requires 2x actual quoted book depth');
  return {ok:true,reason:'Exceptional 7/7 corroborated micro-value paper setup'};
}
