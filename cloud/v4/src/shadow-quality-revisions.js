/* V4 shadow QUALITY REVISIONS — frozen NEW prospective hypotheses.
 * A, B, C original experiments are IMMUTABLE CONTROLS and untouched.
 * A2/B2/C2 are NOT BUY/SELL instructions. Source fields are from the
 * same already-verified settlement-first paper tick, with no new API calls.
 * Their 2-tick progress test is applied prospectively OFFLINE before outcome.
 */
export const SHADOW_QUALITY_VERSION='V4-ABC-QUALITY-V2-20261123';
export const REVISED_POLICY=Object.freeze({
 A2_RECOVERY:Object.freeze({source:'A_STRESS_RELAXED',minAsk:.15,maxSpread:.03,
  minTime:180,minimumLowerEdge:-.045,centralExtra:.03,maxAllIn:3}),
 B2_EXECUTION:Object.freeze({source:'B_EXECUTION_FILTERED',minAsk:.20,maxSpread:.02,
  minTime:210,minimumLowerEdge:-.05,centralExtra:.04,maxAllIn:3}),
 C2_EVIDENCE:Object.freeze({source:'BASELINE_WATCH',minAsk:.15,maxSpread:.03,
  minTime:150,minimumLowerEdge:-.06,centralExtra:.025,maxAllIn:3})
});
export const CONFIRMATION=Object.freeze({minGapMs:10000,maxGapMs:35000,
 minGapImprovementDollar:.25,minGapImprovementSigma:.2,afterTickCount:2,
 cPaperCap:0.50});
const f=n=>typeof n==='number'&&Number.isFinite(n);
const ms=n=>Number.isSafeInteger(n)&&n>1000000000000;
const money=n=>Number(n.toFixed(6));
const fee=(p,q)=>Math.ceil(Math.max(0,.07*q*p*(1-p))*100-1e-8)/100;
const validTicker=t=>typeof t==='string'&&/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(t);
const requiredWitness=['officialIndexFresh','authenticatedBookFresh',
 'sameTickerBook','kraken1mClosed','kraken3mClosed','kraken5mClosed',
 'baselineSpreadDepthAndFeeChecksPassed'];
const result=(policy,reason)=>({version:SHADOW_QUALITY_VERSION,policy,
 status:'NO_QUALITY_OBSERVATION',reason,readOnly:true,
 executionAuthorized:false,calibratedProbability:null});
function halfDollar(ask,depth){
 // Whole contract sizing must honor BOTH fee-inclusive dollars and
 // displayed top-of-book depth. If the quoted book holds 2 rather than 3
 // contracts, reduce to 2; do not call the setup unaffordable.
 if(!f(ask)||ask<=0||!f(depth)||depth<1)return {
  affordableAt50c:false,quantityAt50c:0,hypotheticalAllIn50c:null};
 let q=Math.min(Math.floor((CONFIRMATION.cPaperCap+1e-9)/ask),
  Math.floor(depth));
 while(q>0&&q*ask+fee(ask,q)>CONFIRMATION.cPaperCap+1e-9)q--;
 return {affordableAt50c:q>0,quantityAt50c:q,
  hypotheticalAllIn50c:q>0?money(q*ask+fee(ask,q)):null};
}
/** Per-tick quality evidence only. The FOLLOWING research tick must verify
 * target gap progress if this side is currently behind the official target.
 * Never infer progress from RSI, bid prices or future official settlement.
 */
export function observeQualityRevisions({market,index,one,context,book,
 sourceWitness,report,originalPolicies,riskMode='UNKNOWN',
 alreadyTraded=false,now}={}){
 const output={};
 const target=Number(market?.floor_strike),indexPrice=index?.price;
 const close=Date.parse(market?.close_time||'');
 const reasons=report?.candidate?.consideredSideValues;
 const allowed=validTicker(market?.ticker)&&ms(now)&&f(close)&&
  f(target)&&target>0&&f(indexPrice)&&indexPrice>0&&
  index?.indexId==='ETHUSD_RTI'&&index.validValuesVerified===true&&
  ms(index.sourceAt)&&index.sourceAt<=now+3000&&now-index.sourceAt<=15000&&
  f(one?.sd)&&one.sd>0&&f(one?.three)&&
  ['UP','DOWN','NEUTRAL'].includes(context?.three?.trend)&&
  Array.isArray(reasons)&&report?.status==='WATCH'&&
  riskMode==='NORMAL'&&!alreadyTraded&&
  requiredWitness.every(k=>sourceWitness?.[k]===true)&&
  book?.ticker===market.ticker&&book?.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&
  book?.valid===true&&book?.fresh===true&&book?.crossed!==true&&
  ms(book.receivedAt)&&book.receivedAt<=now&&now-book.receivedAt<=5000;
 for(const [policy,L] of Object.entries(REVISED_POLICY)){
  if(!allowed){output[policy]=result(policy,'SAME_TICK_INPUTS_UNVERIFIED');continue;}
  const remaining=(close-now)/1000;
  if(remaining<=L.minTime||remaining>840){
   output[policy]=result(policy,'OUTSIDE_REVISED_ENTRY_WINDOW');continue;
  }
  const prior=L.source==='BASELINE_WATCH'?null:originalPolicies?.[L.source];
  if(L.source!=='BASELINE_WATCH'&&
    (prior?.status!=='SHADOW_RESEARCH_CANDIDATE'||
      !['UP','DOWN'].includes(prior.proposed?.side))){
    output[policy]=result(policy,'ORIGINAL_POLICY_NOT_QUALIFIED');continue;
  }
  const options=[];
  for(const s of reasons){
   if(s?.status!=='REJECT'||
      s.reason!=='CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT'||
      !['UP','DOWN'].includes(s.side)||
      (prior&&s.side!==prior.proposed.side))continue;
   if(![s.ask,s.bid,s.spread,s.allIn,s.breakEven,
      s.centralScenario,s.lowerScenario,s.requiredEdge].every(f)||
      !Number.isSafeInteger(s.quantity)||s.quantity<1||
      s.lowerScenario<0||s.centralScenario>1||
      s.centralScenario<s.lowerScenario||
      s.requiredEdge<0||s.requiredEdge>.20)continue;
   const askQ=s.side==='UP'?book.yesAsk:book.noAsk;
   const bidQ=s.side==='UP'?book.yesBid:book.noBid;
   const a=Number(askQ?.price),b=Number(bidQ?.price);
   const ad=Number(askQ?.sizeFp),bd=Number(bidQ?.sizeFp);
   if(![a,b,ad,bd].every(f)||a<L.minAsk||a>.87||
      b<0||b>a||ad<1||bd<1||
      Math.abs(a-s.ask)>1e-6||Math.abs(b-s.bid)>1e-6||
      Math.abs(a-b-s.spread)>1e-6||a-b>L.maxSpread+1e-9||
      s.allIn<=0||s.allIn>L.maxAllIn+1e-9||
      Math.abs(s.allIn-(s.quantity*a+fee(a,s.quantity)))>1e-5||
      Math.abs(s.breakEven-s.allIn/s.quantity)>1e-5)continue;
   const centralEdge=s.centralScenario-s.breakEven;
   const lowerEdge=s.lowerScenario-s.breakEven;
   if(centralEdge+1e-9<s.requiredEdge+L.centralExtra||
      lowerEdge+1e-9<L.minimumLowerEdge)continue;
   const direction=s.side==='UP'?1:-1;
   const gap=direction*(indexPrice-target);
   // This ONLY applies to bets currently on the wrong side of target.
   // A true reversal must have directional 1m momentum and a supportive
   // or neutral 3m structure BEFORE the offline progress confirmation.
   const trend=context.three.trend;
   if(gap<0&&(direction*one.three<=0||
      (trend!=='NEUTRAL'&&trend!==s.side)||
      !f(report.candidate.momentum)||
      direction*report.candidate.momentum<=0))continue;
   if(policy==='C2_EVIDENCE'&&trend!=='NEUTRAL'&&trend!==s.side)
     continue;
   const half=halfDollar(a,Math.min(ad,bd));
   options.push({side:s.side,ask:money(a),bid:money(b),
    observedSpread:money(a-b),quantity:s.quantity,
    allIn:money(s.allIn),breakEven:money(s.breakEven),
    centralScenario:money(s.centralScenario),
    lowerScenario:money(s.lowerScenario),
    centralEdge:money(centralEdge),lowerEdge:money(lowerEdge),
    requiredEdge:money(s.requiredEdge),
    targetGapSigned:money(gap),target:money(target),
    indexValue:money(indexPrice),oneMinuteSigma:money(one.sd),
    oneMinuteThreeBarChange:money(one.three),
    threeMinuteTrend:trend,
    threeClosedAt:context.three.closedAt,
    observedBookAt:book.receivedAt,actualFillVerified:false,
    ...half});
  }
  if(!options.length){
   output[policy]=result(policy,'NO_REVISED_QUALITY_SETUP');continue;
  }
  options.sort((a,b)=>b.centralEdge-a.centralEdge||
    b.lowerEdge-a.lowerEdge||a.side.localeCompare(b.side));
  output[policy]={version:SHADOW_QUALITY_VERSION,policy,
   status:'QUALIFYING_QUALITY_OBSERVATION',readOnly:true,
   executionAuthorized:false,calibratedProbability:null,
   outcomeAvailableAtEvaluation:false,
   confirmed:false,
   confirmationStatus:'WAITING_FOR_SECOND_TICK_AND_OFFICIAL_TARGET_PROGRESS',
   ticker:market.ticker,observedAt:now,proposed:options[0],
   note:'No paper order. For against-target entries require >=2 sequential verified observations and measurable official target-gap improvement. The 50c sizing status is reported separately.'};
 }
 return {version:SHADOW_QUALITY_VERSION,readOnly:true,
  executionAuthorized:false,calibratedProbability:null,policies:output};
}
