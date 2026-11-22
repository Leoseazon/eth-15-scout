/* ETH-15 V4 prospective research only. This file has NO Worker integration,
 * storage writes, market fetches, order submission, or paper-account mutations.
 * FROZEN before acquiring the prospective evaluation cohort.
 * All candidate probabilities are scenario sensitivities, not calibrated odds.
 */
export const SHADOW_SPEC_VERSION='V4-SHADOW-PREREG-20261122-v1';
export const SHADOW_POLICIES=Object.freeze({
  // Stress-window exploration: asks more from the central scenario before
  // allowing a bounded stressed-side shortfall. These are hypotheses, not EV.
  A_STRESS_RELAXED:Object.freeze({
    id:'A_STRESS_RELAXED',centralExtra:0.02,minConservativeEdge:-0.075,
    minAsk:0.005,maxSpread:0.05,minRemainingSeconds:90
  }),
  // Execution-quality hypothesis, DISTINCT from the retrospective 50c--87c
  // outcome-selected price probe; avoid ultra-cheap reversal bets in this cohort.
  B_EXECUTION_FILTERED:Object.freeze({
    id:'B_EXECUTION_FILTERED',centralExtra:0.04,minConservativeEdge:-0.10,
    minAsk:0.20,maxSpread:0.02,minRemainingSeconds:150
  })
});
const isNumber=n=>typeof n==='number'&&Number.isFinite(n);
const truthSet=Object.freeze([
 'officialIndexFresh','authenticatedBookFresh','sameTickerBook',
 'kraken1mClosed','kraken3mClosed','kraken5mClosed',
 'baselineSpreadDepthAndFeeChecksPassed'
]);
const nonqualifying=(policy,reason)=>({
  version:SHADOW_SPEC_VERSION,policy,status:'NO_SHADOW_SIGNAL',reason,
  executionAuthorized:false,calibratedProbability:null
});
const priceEdge=(s,key)=>s[key]-s.breakEven;
/** No decision to trade. A source witness must be supplied by an isolated,
 * side-effect-free reader of the SAME eligible tick, never reconstructed by
 * joining unsynchronized archives. The live V4 bot must not import this file.
 */
export function evaluateShadowPolicy({policy,ticker,remainingSeconds,
 sourceWitness,riskMode='NORMAL',alreadyTraded=false,
 baselineStatus,consideredSideValues}={}){
 const policyDef=SHADOW_POLICIES[policy];
 if(!policyDef)return nonqualifying(policy||'UNKNOWN','UNKNOWN_PREREG_POLICY');
 if(!/^KXETH15M-[A-Z0-9-]+$/.test(ticker||''))
  return nonqualifying(policy,'INVALID_TICKER');
 if(alreadyTraded||riskMode!=='NORMAL')
  return nonqualifying(policy,'TRADED_OR_RISK_MODE');
 if(!isNumber(remainingSeconds)||remainingSeconds<=policyDef.minRemainingSeconds||
    remainingSeconds>840)
  return nonqualifying(policy,'OUTSIDE_PRESERVED_ENTRY_WINDOW');
 if(!sourceWitness||truthSet.some(k=>sourceWitness[k]!==true))
  return nonqualifying(policy,'REQUIRED_VERIFIED_SOURCE_MISSING');
 // Independent shadow study of rejected baseline signals ONLY, not new BUYs.
 if(baselineStatus!=='WATCH'||!Array.isArray(consideredSideValues))
  return nonqualifying(policy,'BASELINE_NOT_WATCHING');
 const candidates=[];
 for(const s of consideredSideValues){
  if(!['UP','DOWN'].includes(s?.side)||s?.status!=='REJECT'||
      s?.reason!=='CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT')continue;
  const fields=['ask','bid','spread','quantity','allIn','breakEven',
    'centralScenario','lowerScenario','requiredEdge'];
  if(fields.some(key=>!isNumber(s[key])))continue;
  if(!Number.isSafeInteger(s.quantity)||s.quantity<1||
    s.ask<policyDef.minAsk||s.ask>0.87||s.ask<=0||
    s.bid<0||s.bid>s.ask||s.spread<0||
    s.spread>policyDef.maxSpread+1e-9||
    s.allIn<=0||s.allIn>3.00000001||
    (s.ask<0.20&&s.allIn>0.50000001)||
    s.breakEven<0||s.breakEven>1||
    s.lowerScenario<0||s.lowerScenario>1||
    s.centralScenario<0||s.centralScenario>1||
    s.lowerScenario>s.centralScenario||
    s.requiredEdge<0||s.requiredEdge>0.20)continue;
  const centralEdge=priceEdge(s,'centralScenario');
  const lowerEdge=priceEdge(s,'lowerScenario');
  if(centralEdge+1e-9<s.requiredEdge+policyDef.centralExtra||
     lowerEdge+1e-9<policyDef.minConservativeEdge)continue;
  candidates.push({side:s.side,ask:s.ask,quantity:s.quantity,allIn:s.allIn,
   observedBid:s.bid,observedSpread:s.spread,centralEdge:+centralEdge.toFixed(6),
   lowerEdge:+lowerEdge.toFixed(6),uncalibratedCentralScenario:s.centralScenario,
   hypotheticalSettleNetIfCorrect:+(s.quantity-s.allIn).toFixed(6),
   hypotheticalSettleNetIfWrong:-s.allIn});
 }
 if(!candidates.length)return nonqualifying(policy,'NO_POLICY_CANDIDATE');
 // deterministic rank; chosen once per ticker by the future experiment harness
 candidates.sort((a,b)=>b.centralEdge-a.centralEdge||
   b.lowerEdge-a.lowerEdge||a.side.localeCompare(b.side));
 return {version:SHADOW_SPEC_VERSION,policy,status:'SHADOW_RESEARCH_CANDIDATE',
  executionAuthorized:false,calibratedProbability:null,
  ticker,proposed:candidates[0],alternativesEvaluated:candidates.length,
  note:'Counterfactual only. No orders, cash changes, or fabricated fills.'};
}
export function evaluateBothShadowPolicies(input){
 return Object.fromEntries(Object.keys(SHADOW_POLICIES).map(k=>
  [k,evaluateShadowPolicy({...input,policy:k})]));
}
