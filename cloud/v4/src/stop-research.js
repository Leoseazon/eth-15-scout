/*
 * V4 contract-stop arithmetic + early-exit experiment diagnostics.
 * V3 stays unchanged. Exact prices in 1/10,000 dollars (up to 4dp).
 * A stop signal is NOT proof of executable fill.
 */
export const STOP_EXPERIMENT_VERSION='V4-STOP-RESEARCH-20261121';
export const FINAL_SIX_SECONDS=360;
const asTicks=value=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return null;
 const scaled=value*10000,rounded=Math.round(scaled);
 return Math.abs(scaled-rounded)<1e-6?rounded:null;
};
export function assessContractStop({entry,bid,closeAt,at,armSeconds=FINAL_SIX_SECONDS}){
 const e=asTicks(entry),b=asTicks(bid);
 const validClock=Number.isSafeInteger(closeAt)&&closeAt>0&&
   Number.isSafeInteger(at)&&at>0;
 if(!validClock||!Number.isSafeInteger(armSeconds)||armSeconds<1||
   e===null||e===0||b===null)
   return Object.freeze({usable:false,armed:false,triggered:false,
     declinePct:null,wholeSecondsRemaining:null,thresholdBid:null,
     cause:'INVALID_PRICE_OR_TIME'});
 // Ceil removes sub-second drift when a test fixture is constructed at
 // exactly 6:00 and the engine evaluates it a few milliseconds later.
 const wholeSecondsRemaining=Math.ceil((closeAt-at)/1000);
 const armed=wholeSecondsRemaining>0&&wholeSecondsRemaining<armSeconds;
 // 100*b <= 60*entry: inclusive 40% loss, entirely integer arithmetic.
 const thresholdHit=5*b<=3*e;
 const result={
  usable:true,armed,triggered:armed&&thresholdHit,
  thresholdHit,wholeSecondsRemaining,
  thresholdBid:Math.floor(3*e/5)/10000,
  declinePct:Math.round((e-b)/e*10000)/100,
  cause:!armed?'OUTSIDE_ARMING_WINDOW':thresholdHit?'FORTY_PERCENT_DRAWDOWN':'ABOVE_STOP_THRESHOLD',
  executableFillVerified:false
 };
 return Object.freeze(result);
}
/*
 * Reversal tracking for V4: TWO distinct, CONSECUTIVE fully post-entry
 * CLOSED one-minute bars + independently confirmed 3m/5m deterioration.
 * Never repeat a candle or count a partially pre-entry candle.
 * This is an experimental gate; historical data must establish usefulness.
 */
export function advanceEarlyExitEvidence(previous,{entryAt,candleOpenSeconds,
  evaluationAt,adverse,structuralConfirm}){
 const prior=previous&&typeof previous==='object'?previous:null;
 const blank={lastCandleOpenSeconds:null,consecutive:0,trigger:false,
   reason:'NOT_EVALUATED',evaluatedAt:evaluationAt||null};
 if(!Number.isSafeInteger(entryAt)||entryAt<=0||
   !Number.isSafeInteger(candleOpenSeconds)||candleOpenSeconds<=0||
   !Number.isSafeInteger(evaluationAt)||evaluationAt<=0||
   candleOpenSeconds*1000<entryAt||
   candleOpenSeconds*1000+60000>evaluationAt)
   return {...(prior||blank),trigger:false,reason:'NO_COMPLETE_POST_ENTRY_CANDLE'};
 if(prior?.lastCandleOpenSeconds===candleOpenSeconds)
   return {...prior,trigger:false,reason:'SAME_CLOSED_CANDLE'};
 if(!adverse||!structuralConfirm)return {
  lastCandleOpenSeconds:candleOpenSeconds,consecutive:0,
  trigger:false,reason:'NO_CONFIRMED_ADVERSITY',evaluatedAt:evaluationAt};
 const consecutive=prior?.lastCandleOpenSeconds===candleOpenSeconds-60?
   Math.min(2,(prior.consecutive||0)+1):1;
 return {lastCandleOpenSeconds:candleOpenSeconds,
  consecutive,trigger:consecutive>=2,
  reason:consecutive>=2?'TWO_CONSECUTIVE_POST_ENTRY_ADVERSE_CANDLES':'ONE_ADVERSE_CANDLE',
  evaluatedAt:evaluationAt};
}
