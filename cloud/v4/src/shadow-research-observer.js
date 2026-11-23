/* V4 research-only bridge from an existing verified settlement-first paper
 * evaluation to frozen prospective policies. This never calls the live paper
 * entry/exit function, mutates state, makes network requests, or writes data.
 *
 * IMPORTANT: Presence of a research candidate is NOT permission to BUY.
 * It is not a calibrated probability or a verified executable fill.
 */
import {evaluateBothShadowPolicies,SHADOW_SPEC_VERSION}
 from './shadow-opportunity-policies.js';
const ms=n=>Number.isSafeInteger(n)&&n>1000000000000;
const completed=(startSeconds,periodSeconds,at)=>{
 const expected=Math.floor(at/(periodSeconds*1000))*periodSeconds-periodSeconds;
 return Number.isSafeInteger(startSeconds)&&startSeconds===expected;
};
const bookFresh=(book,market,streamStatus,at)=>
 streamStatus?.connected===true&&streamStatus?.targetTicker===market?.ticker&&
 book?.ticker===market?.ticker&&
 book?.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&
 book?.valid===true&&book?.fresh===true&&book?.crossed!==true&&
 ms(book.receivedAt)&&at>=book.receivedAt&&at-book.receivedAt<=5000;
const indexFresh=(index,at)=>
 index?.indexId==='ETHUSD_RTI'&&index.validValuesVerified===true&&
 Number.isFinite(index.price)&&index.price>0&&
 ms(index.sourceAt)&&index.sourceAt<=at+3000&&at-index.sourceAt<=15000;

/** Only the original per-tick report and the same tick's verified sources
 * are inspected. Source witnesses are NOT constructed by joining archives
 * retrospectively or assuming a REST book represents a Kalshi WebSocket.
 * First signal per ticker/policy must be deduplicated by the separate
 * chronological research scorer, before joining official outcomes.
 */
export function observeProspectiveShadow({market,report,index,book,one,five,
 context,feedChecks,streamStatus,riskMode='UNKNOWN',blocked=[],now}={}){
 if(!ms(now))throw new TypeError('A verified observation timestamp is required');
 const remainingSeconds=Date.parse(market?.close_time||'')-now;
 const observations=report?.candidate?.consideredSideValues;
 const hasConservativeRejection=Array.isArray(observations)&&
  observations.some(x=>x?.status==='REJECT'&&
    x.reason==='CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT');
 const witness={
  officialIndexFresh:indexFresh(index,now),
  authenticatedBookFresh:bookFresh(book,market,streamStatus,now),
  sameTickerBook:book?.ticker===market?.ticker&&
   typeof market?.ticker==='string'&&market.ticker.startsWith('KXETH15M-'),
  kraken1mClosed:feedChecks?.kraken1m?.ok===true&&!!one&&
   completed(context?.oneClosedAt,60,now),
  kraken3mClosed:!!context?.three&&completed(context.three.closedAt,180,now),
  kraken5mClosed:feedChecks?.kraken5m?.ok===true&&!!five&&
   completed(context?.five?.closedAt,300,now),
  baselineSpreadDepthAndFeeChecksPassed:hasConservativeRejection
 };
 const out=evaluateBothShadowPolicies({
  ticker:market?.ticker,remainingSeconds:remainingSeconds/1000,
  sourceWitness:witness,riskMode,
  alreadyTraded:Array.isArray(blocked)&&blocked.includes(market?.ticker),
  baselineStatus:report?.status,consideredSideValues:observations
 });
 const sourceStates=Object.fromEntries(Object.entries(witness).map(([k,v])=>[k,!!v]));
 return {version:SHADOW_SPEC_VERSION,observedAt:now,
  executionAuthorized:false,readOnly:true,calibratedProbability:null,
  outcomeAvailableAtEvaluation:false,firstPerTickerSelection:'DEFERRED_TO_CHRONOLOGICAL_SCORER',
  baselineStatus:report?.status||'UNAVAILABLE',
  sourceWitness:sourceStates,policies:out};
}
