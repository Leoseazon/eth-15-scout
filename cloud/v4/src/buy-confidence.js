/* V4 paper BUY confidence: deterministic 0–100 HEURISTIC INDEX ONLY.
 * This is NOT a calibrated chance of winning at Kalshi settlement.
 * Never drives, gates or scales simulated order size. All evidence is
 * contemporaneous and derives from the same already-eligible V4 candidate.
 */
export const BUY_CONFIDENCE_VERSION='V4-BUY-CONFIDENCE-HEURISTIC-1';
const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
const signed=(n,direction)=>clamp(n*direction);
export function scoreBuyConfidence({
 side,score,geometry,momentum,structure,familySupport,contradictionReasons,
 spread,indexAgeMs,bookAgeMs
}={}){
 if(!['UP','DOWN'].includes(side)||![
   score,geometry,momentum,structure,spread,indexAgeMs,bookAgeMs
 ].every(Number.isFinite)||!Number.isInteger(familySupport)||
 familySupport<0||familySupport>3||
 !Array.isArray(contradictionReasons)||spread<0||spread>.05||
 indexAgeMs<0||indexAgeMs>15000||bookAgeMs<0||bookAgeMs>5000)
  return null;
 const direction=side==='UP'?1:-1;
 const evidence=clamp(Math.abs(score));
 const target=signed(geometry,direction);
 const momentumSupport=signed(momentum,direction);
 const structureSupport=signed(structure,direction);
 const independentStrength=(momentumSupport+structureSupport)/2;
 const independentAgreement=familySupport/3;
 const quoteQuality=clamp((.05-spread)/.05);
 const sourceFreshness=(
   clamp(1-indexAgeMs/15000)+clamp(1-bookAgeMs/5000))/2;
 const penalty=Math.min(.24,contradictionReasons.length*.08);
 // Transparent fixed heuristic weights. No post-hoc fitting or
 // false conversion of raw score into outcome probability.
 const raw=.30*evidence+.25*target+.20*independentStrength+
   .10*independentAgreement+.10*quoteQuality+.05*sourceFreshness-penalty;
 const value=Math.round(100*clamp(raw));
 return {value,scaleMax:100,version:BUY_CONFIDENCE_VERSION,
  kind:'HEURISTIC_DECISION_CONFIDENCE_NOT_WIN_PROBABILITY',
  calibrated:false,winProbability:null,
  components:{targetAlignment:Math.round(100*target),
   compositeEvidence:Math.round(100*evidence),
   independentIndicatorStrength:Math.round(100*independentStrength),
   independentFamilyAgreement:Math.round(100*independentAgreement),
   orderbookSpreadQuality:Math.round(100*quoteQuality),
   feedFreshness:Math.round(100*sourceFreshness),
   contradictionPenaltyPoints:Math.round(100*penalty)}};
}
