/* ETH-15 Scout V4 EXIT decision research, offline only.
 * Joined to original/revised frozen first entries, never to a fabricated
 * fill. Uses only same-engine-tick authenticated TOP bid samples (15s).
 * No API calls, orders, rule changes, account state or lookahead.
 *
 * Compares baseline V4 deterministic exit with a hypothetical adaptive
 * exit: profit-protect >=78c with trend reversal, or early risk-cut after
 * 2 verified deteriorating snapshots (>=25% price decline; adverse
 * official-target movement and 3m + 1m directional reversal).
 * Market conditions between samples remain UNKNOWN. It does not claim fills.
 */
export const EXIT_RESEARCH_VERSION='V4-EXIT-CF-V1-20261123';
export const EXIT_RESEARCH_POLICY=Object.freeze({
 takeProfitBid:.96,stopDecline:.40,stopArmedSeconds:360,
 finalMinuteSeconds:60,adaptiveProfitBid:.78,
 adaptiveEarlyLossDecline:.25,minimumGapDeteriorationDollar:.25,
 sigmaGapMultiplier:.20,minBidDrop:.015,
 minConsecutiveMs:10000,maxConsecutiveMs:35000
});
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const ms=n=>Number.isSafeInteger(n)&&n>1000000000000;
const round=n=>Number(n.toFixed(6));
const fee=(price,quantity)=>Math.ceil(Math.max(0,.07*quantity*price*(1-price))*100-1e-8)/100;
const ticker=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const resultSign=side=>side==='UP'?1:-1;
const authorized=false;
function look(row,signal){
 if(!row||row.paperOnly!==true||!ms(row.observedAt)||
    !ms(row.finishedAt)||row.finishedAt<row.observedAt||
    row.ticker!==signal.ticker||
    row.closeAt!==signal.closeAt||row.observedAt<=signal.firstObservedAt||
    row.observedAt>=signal.closeAt)return null;
 const b=row.sampledExitBook;
 if(b?.readOnly!==true||b.executionAuthorized!==false||
   b.actualFillVerified!==false||b.ticker!==signal.ticker||
   !ms(b.observedAt)||Math.abs(b.observedAt-row.finishedAt)>2000||
   b.bookState!=='FRESH_SAME_TICK'||!ms(b.bookReceivedAt)||
   b.bookReceivedAt>b.observedAt||b.observedAt-b.bookReceivedAt>5000)return null;
 const q=signal.side==='UP'?b.upBid:b.downBid;
 if(!valid(q?.price)||q.price<=0||q.price>=1||
   !valid(q?.depth)||q.depth<signal.quantity)return null;
 const ix=b.indexState==='OFFICIAL_FRESH'&&valid(b.indexPrice)&&
  valid(b.officialTarget)&&b.officialTarget>0&&
  ms(b.indexSourceAt)&&b.indexSourceAt<=b.observedAt+3000&&
  b.observedAt-b.indexSourceAt<=15000?
   (b.indexPrice-b.officialTarget)*resultSign(signal.side):null;
 const trend=row.kraken?.threeStructure?.trend;
 const one=row.kraken?.one;
 return {time:row.observedAt,bid:q.price,
  targetGap:ix,trend:['UP','DOWN','NEUTRAL'].includes(trend)?trend:null,
  momentum:valid(one?.three)?one.three*resultSign(signal.side):null,
  sigma:valid(one?.sd)&&one.sd>0?one.sd:null,
  bookTime:b.bookReceivedAt};
}
function evaluateExit({signal,mark,previous,variant}){
 const L=EXIT_RESEARCH_POLICY;
 const remaining=(signal.closeAt-mark.time)/1000;
 const decline=(signal.ask-mark.bid)/signal.ask;
 if(remaining>60&&mark.bid>=L.takeProfitBid)
  return {type:'TAKE_PROFIT_96C',reason:'BASELINE_96C'};
 if(remaining<=L.stopArmedSeconds&&decline>=L.stopDecline)
  return {type:'EMERGENCY_STOP_40PCT',reason:'BASELINE_LAST_6M'};
 if(variant==='BASELINE_EXIT')return null;
 // An adverse target reversal requires TWO consecutive independently fresh
 // official-index + authenticated-book snapshots, no missing interval.
 if(!previous||mark.time-previous.time<L.minConsecutiveMs||
    mark.time-previous.time>L.maxConsecutiveMs||
    !valid(mark.targetGap)||!valid(previous.targetGap)||
    !valid(mark.momentum)||!valid(mark.sigma)||
    mark.trend===null)return null;
 const adverseGap=previous.targetGap-mark.targetGap;
 const adverseTarget=adverseGap>=Math.max(
   L.minimumGapDeteriorationDollar,L.sigmaGapMultiplier*mark.sigma);
 const opposing=mark.trend!=='NEUTRAL'&&mark.trend!==signal.side&&
  mark.momentum<0;
 const fallingBid=previous.bid-mark.bid>=L.minBidDrop;
 const hypotheticalProceeds=signal.quantity*mark.bid-fee(mark.bid,signal.quantity);
 const net=hypotheticalProceeds-signal.allIn;
 if(remaining>60&&mark.bid>=L.adaptiveProfitBid&&
   net>0&&adverseTarget&&fallingBid&&opposing)
  return {type:'PROFIT_PROTECT_78C_REVERSAL',reason:'TWO_TICK_TARGET_AND_TECH_REVERSAL'};
 if(remaining>60&&decline>=L.adaptiveEarlyLossDecline&&
   adverseTarget&&fallingBid&&opposing)
  return {type:'EARLY_RISK_CUT_25PCT_REVERSAL',reason:'TWO_TICK_TARGET_AND_TECH_REVERSAL'};
 return null;
}
function safeSignal(s){
 return !!s&&ticker.test(s.ticker||'')&&['UP','DOWN'].includes(s.side)&&
  ms(s.firstObservedAt)&&ms(s.closeAt)&&s.firstObservedAt<s.closeAt&&
  s.firstObservedAt>=s.closeAt-900000&&valid(s.ask)&&s.ask>0&&s.ask<=.87&&
  Number.isSafeInteger(s.quantity)&&s.quantity>0&&
  valid(s.allIn)&&s.allIn>0&&s.allIn<=3.00001&&
  s.allIn+1e-9>=s.quantity*s.ask&&s.actualFillVerified===false;
}
/** Per first-signal, two INDEPENDENT hypothetical exit policies. */
export function replayExitDecisionStudies(firstSignals,researchTicks){
 if(!Array.isArray(firstSignals)||!Array.isArray(researchTicks))
  throw new TypeError('Signal & research array required');
 const sorted=[...researchTicks].filter(r=>r?.paperOnly===true&&ms(r.observedAt))
  .sort((a,b)=>a.observedAt-b.observedAt||
    (Number(a.id)||0)-(Number(b.id)||0));
 const out=[];
 for(const s of firstSignals){
  if(!safeSignal(s)){
   out.push({policy:s?.policy??'UNKNOWN',ticker:s?.ticker??null,
    side:s?.side??null,reason:'NO_INTEGER_FEE_SIZED_HYPOTHESIS',
    status:'UNSCORABLE',actualFillVerified:false,executionAuthorized:false});
   continue;
  }
  const p={version:EXIT_RESEARCH_VERSION,
   policy:s.policy,ticker:s.ticker,side:s.side,
   closeAt:s.closeAt,firstObservedAt:s.firstObservedAt,
   entryAsk:s.ask,entryAllIn:s.allIn,quantity:s.quantity,
   actualFillVerified:false,executionAuthorized:false,
   note:'Neither entry nor bid-based exits were verified fills.'};
  const rows=sorted.filter(r=>r.ticker===s.ticker&&
   r.observedAt>s.firstObservedAt&&r.observedAt<s.closeAt);
  for(const variant of ['BASELINE_EXIT','ADAPTIVE_EXIT']){
   let last=null,selected=null,ready=0,unusable=0,maxBid=null,minBid=null;
   const reasons={BOOK_UNVERIFIED:0,VALID_MARK:0};
   for(const row of rows){
    if(selected)break;
    const q=look(row,s);
    if(!q){unusable++;reasons.BOOK_UNVERIFIED++;last=null;continue;}
    ready++;reasons.VALID_MARK++;
    maxBid=maxBid===null?q.bid:Math.max(maxBid,q.bid);
    minBid=minBid===null?q.bid:Math.min(minBid,q.bid);
    const trig=evaluateExit({signal:s,mark:q,previous:last,variant});
    if(trig){
     const sellFee=fee(q.bid,s.quantity);
     selected={kind:trig.type,reason:trig.reason,
      observedAt:q.time,remainingSeconds:round((s.closeAt-q.time)/1000),
      observedBid:q.bid,sellFee:round(sellFee),
      hypotheticalProceeds:round(s.quantity*q.bid-sellFee),
      hypotheticalNet:round(s.quantity*q.bid-sellFee-s.allIn),
      fillVerified:false};
    }
    last=q;
   }
   out.push({...p,variant,status:selected?'HYPOTHETICAL_EARLY_EXIT':'AWAIT_OFFICIAL_SETTLEMENT',
    firstObservedExit:selected,qualifiedBidSnapshots:ready,
    excludedSnapshots:unusable,observedMaxBid:maxBid,
    observedMinBid:minBid,exitReasonCounts:reasons,
    settlementNetIfCorrect:round(s.quantity-s.allIn),
    settlementNetIfIncorrect:round(-s.allIn)});
  }
 }
 return out;
}
export function finalizeExitStudies(replay,windows){
 if(!Array.isArray(replay)||!Array.isArray(windows))
  throw new TypeError('Replay and windows required');
 const official=new Map();
 for(const w of windows){
  if(!ticker.test(w?.ticker||'')||
     w.status!=='OFFICIAL_RESULT'||w.exchangeStatus!=='finalized'||
     !['UP','DOWN'].includes(w.outcome)||!ms(w.closeAt)||
     !ms(w.settledAt)||w.settledAt<w.closeAt||
     !w.source?.includes('Kalshi'))continue;
  const old=official.get(w.ticker);
  if(!old||w.settledAt<old.settledAt)official.set(w.ticker,w);
 }
 return replay.map(r=>{
  const w=official.get(r.ticker);
  if(!w||w.closeAt!==r.closeAt||w.settledAt<=r.firstObservedAt||
    !['UP','DOWN'].includes(r.side))
   return {...r,officialOutcome:'UNRESOLVED',directionCorrect:null,
    hypotheticalPolicyNet:null};
  const correct=w.outcome===r.side;
  const net=r.firstObservedExit?.hypotheticalNet;
  return {...r,officialOutcome:w.outcome,directionCorrect:correct,
   hypotheticalPolicyNet:valid(net)?net:
    (r.status==='AWAIT_OFFICIAL_SETTLEMENT'?
    (correct?r.settlementNetIfCorrect:r.settlementNetIfIncorrect):null),
   reportedAccounting:'Hypothetical quoted BID or final payout ONLY, not verified fills'};
 });
}
export function summarizeExitStudies(records){
 if(!Array.isArray(records))throw new TypeError('Studies required');
 const aggregate={version:EXIT_RESEARCH_VERSION,
  paperOnly:true,actualFillsVerified:false,executionAuthorized:authorized,
  policyComparison:{}};
 for(const x of records){
  const key=(x.policy||'UNKNOWN')+'|'+(x.variant||'UNSCORABLE');
  const g=aggregate.policyComparison[key]??={signals:0,finalized:0,
   correctDirection:0,earlyExitSignals:0,bookSampleTicks:0,
   excludedBookTicks:0,unscorable:0,hypotheticalNet:0};
  g.signals++;
  if(x.status==='UNSCORABLE')g.unscorable++;
  if(x.firstObservedExit)g.earlyExitSignals++;
  g.bookSampleTicks+=(x.qualifiedBidSnapshots||0);
  g.excludedBookTicks+=(x.excludedSnapshots||0);
  if(x.directionCorrect!==null){
   g.finalized++;
   if(x.directionCorrect===true)g.correctDirection++;
   if(valid(x.hypotheticalPolicyNet))g.hypotheticalNet+=x.hypotheticalPolicyNet;
  }
 }
 for(const v of Object.values(aggregate.policyComparison))
  v.hypotheticalNet=round(v.hypotheticalNet);
 return aggregate;
}
