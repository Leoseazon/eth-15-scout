/* Main V4 selectable paper strategy profiles — PAPER ONLY.
 * The profile adjusts proof required to ENTER, never source truth,
 * settlement math, emergency exits, fee charging, bankroll caps or HARD/SOFT
 * daily drawdown brakes. No real Kalshi order API exists.
 * All estimates are UNCALIBRATED scenario outputs, not win probabilities.
 */
export const MAIN_PROFILE_VERSION='V4-MAIN-STRATEGY-PROFILES-20261123-v1';
export const MAIN_STRATEGY_PROFILES=Object.freeze({
 CONSERVATIVE:Object.freeze({id:'CONSERVATIVE',
  label:'Conservative',minCentralEdge:null,minLowerEdge:null,
  reversalMinImprovement:null,reversalSigmaFactor:null,
  requireSame3mDirection:false,description:'Exact legacy V4 entry value'}),
 BALANCED:Object.freeze({id:'BALANCED',label:'Balanced',
  minCentralEdge:0.07,minLowerEdge:-0.04,
  reversalMinImprovement:0.25,reversalSigmaFactor:0.25,
  requireSame3mDirection:true,
  description:'Moderate model uncertainty, completed 3m confirmation and observed official target progress'}),
 OPPORTUNISTIC:Object.freeze({id:'OPPORTUNISTIC',label:'Opportunistic',
  minCentralEdge:0.035,minLowerEdge:-0.12,
  reversalMinImprovement:0.10,reversalSigmaFactor:0.10,
  requireSame3mDirection:false,
  description:'Earlier fee-aware paper opportunities with required progress on against-target reversals'})
});
export function selectMainProfile(id='CONSERVATIVE'){
 return MAIN_STRATEGY_PROFILES[id]||MAIN_STRATEGY_PROFILES.CONSERVATIVE;
}
export function mainProfileIsSupported(id){
 return typeof id==='string'&&Object.hasOwn(MAIN_STRATEGY_PROFILES,id);
}
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const stamp=n=>Number.isSafeInteger(n)&&n>1000000000000;
const sideSign=side=>side==='UP'?1:-1;
/** The SAME required profile decision is used in both:
 * - V4 candidate selection
 * - independent final paper debit validation.
 *
 * Rejects any unsupported scenario/context or "cheap loser" reversal without
 * independently observed progress toward official contract strike.
 * SOFT loss state and premium asks >85c ALWAYS retain original conservative
 * entry hurdles even if the owner selected OPPORTUNISTIC.
 */
export function assessProfileEntry({
 profile='CONSERVATIVE',riskMode='NORMAL',side,ask,
 lowerEdge,centralEdge,legacyRequiredEdge,contextEvidence
}={}){
 const p=selectMainProfile(profile);
 const conservative=()=>({
  ok:lowerEdge+1e-9>=legacyRequiredEdge,
  reason:lowerEdge+1e-9>=legacyRequiredEdge?
   'LEGACY_CONSERVATIVE_VALUE_PASSED':'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
  profile:p.id,effectiveProfile:'CONSERVATIVE',reversal:false,
  requiredEdge:legacyRequiredEdge,centralRequiredEdge:null,
  lowerRequiredEdge:legacyRequiredEdge});
 if(!['UP','DOWN'].includes(side)||![ask,lowerEdge,centralEdge,
   legacyRequiredEdge].every(finite)||
    ask<=0||ask>1||legacyRequiredEdge<0)
  return {ok:false,reason:'INVALID_PROFILE_ENTRY_EVIDENCE',
   profile:p.id,effectiveProfile:'NONE'};
 if(p.id==='CONSERVATIVE'||riskMode!=='NORMAL'||ask>.85)
  return conservative();
 const base={profile:p.id,effectiveProfile:p.id,
  requiredEdge:legacyRequiredEdge,centralRequiredEdge:p.minCentralEdge,
  lowerRequiredEdge:p.minLowerEdge};
 if(centralEdge+1e-9<p.minCentralEdge)return {...base,ok:false,
  reason:'PROFILE_CENTRAL_VALUE_INSUFFICIENT',reversal:false};
 if(lowerEdge+1e-9<p.minLowerEdge)return {...base,ok:false,
  reason:'PROFILE_STRESS_LIMIT_EXCEEDED',reversal:false};
 const e=contextEvidence;
 if(!e||!finite(e.target)||e.target<=0||
    !finite(e.indexValue)||e.indexValue<=0||
    !finite(e.one?.sd)||e.one.sd<=0||
    !finite(e.one?.three)||!stamp(e.now)||
    !['UP','DOWN','NEUTRAL'].includes(e.context?.three?.trend))
  return {...base,ok:false,
   reason:'PROFILE_CURRENT_TECHNICAL_EVIDENCE_MISSING',reversal:false};
 const direction=sideSign(side),gap=direction*(e.indexValue-e.target);
 // In-favor value is allowed without an additional reversal gate; fees,
 // source freshness, uncertainty and max price are validated elsewhere.
 if(gap>=0)return {...base,ok:true,reason:'PROFILE_VALUE_QUALIFIED',
  reversal:false,targetGap:gap};
 const three=e.context.three.trend;
 if(direction*e.one.three<=0||
   (three!=='NEUTRAL'&&three!==side)||
   (p.requireSame3mDirection&&three!==side))
  return {...base,ok:false,reason:'PROFILE_REVERSAL_DIRECTION_NOT_CONFIRMED',
   reversal:true,targetGap:gap};
 const prev=e.priorOfficialIndex;
 if(!prev||prev.ticker!==e.ticker||!finite(prev.target)||
    Math.abs(prev.target-e.target)>0.000001||
    !finite(prev.indexValue)||!stamp(prev.observedAt)||
    !stamp(prev.sourceAt)||!stamp(e.sourceAt)||
    e.sourceAt<=prev.sourceAt||
    e.now-prev.observedAt<10000||
    e.now-prev.observedAt>40000||
    e.now-e.sourceAt>15000)
  return {...base,ok:false,reason:'PROFILE_REVERSAL_PRIOR_INDEX_UNAVAILABLE',
   reversal:true,targetGap:gap};
 const improvement=direction*(e.indexValue-prev.indexValue);
 const required=Math.max(p.reversalMinImprovement,
  p.reversalSigmaFactor*e.one.sd);
 if(improvement+1e-9<required)
  return {...base,ok:false,reason:'PROFILE_REVERSAL_OFFICIAL_PROGRESS_INSUFFICIENT',
   reversal:true,targetGap:gap,improvement,requiredImprovement:required};
 return {...base,ok:true,reason:'PROFILE_RECOVERY_CONFIRMED',
  reversal:true,targetGap:gap,improvement,requiredImprovement:required};
}
