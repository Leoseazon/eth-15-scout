/* Candidate C — prospectively fixed, NON-EXECUTING research policy.
 * NO orders, NO paper cash, NO state mutations, NO APIs, NO lookahead.
 * First confirmed signal requires two CONSECUTIVE qualifying 15s research
 * ticks, same ticker/side, before official settlement is joined offline.
 * A per-tick candidate is NOT an eligible paper trade or verified fill.
 */
export const CANDIDATE_C_SPEC='V4-C-MODERATE-2TICK-20261122-v1';
export const CANDIDATE_C_POLICY='C_MODERATE_CONFIRM';
export const CANDIDATE_C_LIMITS=Object.freeze({
 centralExtra:0.04,minimumLowerEdge:-0.045,
 minAsk:0.20,maxAsk:0.87,maxSpread:0.03,maxAllIn:0.50,
 minRemainingSeconds:150,maxRemainingSeconds:840,
 requiredConsecutiveTicks:2,minGapMs:10000,maxGapMs:35000
});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fee=(p,q)=>Math.ceil(Math.max(0,.07*q*p*(1-p))*100-1e-8)/100;
const fixed=n=>Number(n.toFixed(6));
const refuse=reason=>({version:CANDIDATE_C_SPEC,policy:CANDIDATE_C_POLICY,
 status:'NO_C_OBSERVATION',reason,executionAuthorized:false,
 readOnly:true,calibratedProbability:null});
const tickerOk=t=>typeof t==='string'&&/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(t);
const witnessFields=Object.freeze(['officialIndexFresh',
 'authenticatedBookFresh','sameTickerBook','kraken1mClosed','kraken3mClosed',
 'kraken5mClosed','baselineSpreadDepthAndFeeChecksPassed']);
const currentBook=(side,book)=>{
 const a=side==='UP'?book?.yesAsk:book?.noAsk;
 const b=side==='UP'?book?.yesBid:book?.noBid;
 const ask=Number(a?.price),bid=Number(b?.price);
 const askDepth=Number(a?.sizeFp),bidDepth=Number(b?.sizeFp);
 return {ask,bid,askDepth,bidDepth};
};
/** One honest contemporaneous observation. DOES NOT infer confirmation
 * from elapsed time or prior ticks; chronological offline scorer does that.
 * Only the original baseline scenario rejection is eligible for study.
 */
export function evaluateCandidateCObservation({market,report,book,context,
 sourceWitness,riskMode='UNKNOWN',alreadyTraded=false,now}={}){
 const L=CANDIDATE_C_LIMITS;
 if(!Number.isSafeInteger(now)||now<1000000000000||
    !tickerOk(market?.ticker)||!Number.isFinite(Date.parse(market?.close_time)))
  return refuse('MARKET_OR_TIME_UNVERIFIED');
 if(riskMode!=='NORMAL'||alreadyTraded)return refuse('RISK_OR_ALREADY_TRADED');
 const remaining=(Date.parse(market.close_time)-now)/1000;
 if(remaining<=L.minRemainingSeconds||remaining>L.maxRemainingSeconds)
  return refuse('OUTSIDE_PRESERVED_ENTRY_WINDOW');
 if(!sourceWitness||witnessFields.some(k=>sourceWitness[k]!==true))
  return refuse('SAME_TICK_SOURCE_UNVERIFIED');
 if(report?.status!=='WATCH'||!Array.isArray(report?.candidate?.consideredSideValues))
  return refuse('BASELINE_NOT_CONSERVATIVE_WATCH');
 if(!book||book.ticker!==market.ticker||
    book.source!=='KALSHI_WEBSOCKET_ORDERBOOK'||
    book.valid!==true||book.fresh!==true||book.crossed===true||
    !Number.isSafeInteger(book.receivedAt)||book.receivedAt>now||
    now-book.receivedAt>5000)return refuse('AUTHENTICATED_BOOK_UNVERIFIED');
 const trend=context?.three?.trend;
 if(!['UP','DOWN'].includes(trend))return refuse('THREE_MIN_TREND_UNCONFIRMED');
 const qualified=[];
 for(const x of report.candidate.consideredSideValues){
  if(!x||x.status!=='REJECT'||
     x.reason!=='CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT'||
     !['UP','DOWN'].includes(x.side)||x.side!==trend)continue;
  const fields=['ask','bid','spread','quantity','allIn','breakEven',
   'centralScenario','lowerScenario','requiredEdge'];
  if(fields.some(k=>!finite(x[k]))||!Number.isSafeInteger(x.quantity)||
     x.quantity<1||x.lowerScenario<0||x.centralScenario>1||
     x.centralScenario<x.lowerScenario||
     x.requiredEdge<0||x.requiredEdge>0.2)continue;
  const q=currentBook(x.side,book);
  if(![q.ask,q.bid,q.askDepth,q.bidDepth].every(finite)||
     q.ask<L.minAsk||q.ask>L.maxAsk||q.bid<0||q.bid>q.ask||
     Math.abs(q.ask-x.ask)>1e-6||Math.abs(q.bid-x.bid)>1e-6||
     Math.abs((q.ask-q.bid)-x.spread)>1e-6||
     q.ask-q.bid>L.maxSpread+1e-9||
     x.allIn>x.quantity*x.ask+0.5||
     Math.abs(x.breakEven-x.allIn/x.quantity)>1e-5)continue;
  // Independent fee-aware half-dollar paper *research* size, NOT the
  // original baseline $3 size. Reject a quote that cannot afford 1 contract.
  let qty=Math.floor((L.maxAllIn+1e-9)/q.ask);
  while(qty>0&&qty*q.ask+fee(q.ask,qty)>L.maxAllIn+1e-9)qty--;
  if(qty<1||q.askDepth<qty||q.bidDepth<qty)continue;
  const entryFee=fee(q.ask,qty),allIn=qty*q.ask+entryFee;
  const breakEven=allIn/qty;
  const centralEdge=x.centralScenario-breakEven;
  const lowerEdge=x.lowerScenario-breakEven;
  // Moderate relaxation vs baseline: central must be especially strong;
  // lower stress case can dip at most 4.5 percentage points below
  // fee-adjusted break-even. This is uncalibrated scenario math.
  if(centralEdge+1e-9<x.requiredEdge+L.centralExtra||
     lowerEdge+1e-9<L.minimumLowerEdge)continue;
  qualified.push({side:x.side,ask:fixed(q.ask),bid:fixed(q.bid),
   observedSpread:fixed(q.ask-q.bid),quantity:qty,entryFee:fixed(entryFee),
   allIn:fixed(allIn),breakEven:fixed(breakEven),
   centralEdge:fixed(centralEdge),lowerEdge:fixed(lowerEdge),
   baselineRequiredEdge:fixed(x.requiredEdge),
   centralScenario:fixed(x.centralScenario),
   lowerScenario:fixed(x.lowerScenario),
   threeMinuteTrend:trend,
   threeClosedAt:context.three.closedAt,
   observedBookAt:book.receivedAt,
   actualFillVerified:false,
   hypotheticalSettleNetIfCorrect:fixed(qty-allIn),
   hypotheticalSettleNetIfWrong:fixed(-allIn)});
 }
 if(!qualified.length)return refuse('NO_MODERATE_VALUE_WITH_3M_CONFIRMATION');
 qualified.sort((a,b)=>b.centralEdge-a.centralEdge||
  b.lowerEdge-a.lowerEdge||a.side.localeCompare(b.side));
 return {version:CANDIDATE_C_SPEC,policy:CANDIDATE_C_POLICY,
  status:'QUALIFYING_OBSERVATION',readOnly:true,executionAuthorized:false,
  calibratedProbability:null,outcomeAvailableAtEvaluation:false,
  ticker:market.ticker,observedAt:now,
  confirmationRequired:L.requiredConsecutiveTicks,
  confirmationStatus:'PENDING_NEXT_CONSECUTIVE_OBSERVATION',
  proposed:qualified[0],
  note:'Research only. Neither this observation nor a later offline confirmation is a paper BUY.'};
}
