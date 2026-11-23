/* Candidate C chronology-only confirmation / post-finalization scoring.
 * STRICT research-only: no orders, account writes, new APIs or fill claims.
 * The first signal is the SECOND of two consecutive independently eligible
 * research ticks in the SAME market, side and closed 3-minute structure.
 * The outcome is never inspected until after first signals are frozen.
 */
import {CANDIDATE_C_SPEC,CANDIDATE_C_POLICY,CANDIDATE_C_LIMITS}
 from './candidate-c-observer.js';
import {joinFinalizedOfficialOutcomes} from './shadow-prospective-scoring.js';
const isTime=n=>Number.isSafeInteger(n)&&n>1000000000000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const tickerOk=x=>typeof x==='string'&&/^KXETH15M-[A-Z0-9-]{5,80}$/.test(x);
const validObservation=(row,notBefore)=>{
 if(row?.paperOnly!==true||!isTime(row.observedAt)||
    row.observedAt<notBefore||!isTime(row.finishedAt)||
    row.finishedAt<row.observedAt||!tickerOk(row.ticker)||
    !isTime(row.closeAt)||row.observedAt>=row.closeAt||
    row.observedAt<row.closeAt-900000)return null;
 const c=row.decision?.shadowProbe?.prospectiveShadow?.candidateC;
 const p=c?.proposed;
 if(!c||c.version!==CANDIDATE_C_SPEC||c.policy!==CANDIDATE_C_POLICY||
    c.status!=='QUALIFYING_OBSERVATION'||c.executionAuthorized!==false||
    c.readOnly!==true||c.outcomeAvailableAtEvaluation!==false||
    c.calibratedProbability!==null||c.ticker!==row.ticker||
    !isTime(c.observedAt)||c.observedAt<notBefore||
    Math.abs(c.observedAt-row.observedAt)>30000||
    c.observedAt>row.finishedAt+2000||
    c.observedAt>=row.closeAt||!p||!['UP','DOWN'].includes(p.side)||
    p.threeMinuteTrend!==p.side||!Number.isSafeInteger(p.threeClosedAt)||
    !Number.isSafeInteger(p.quantity)||p.quantity<1||
    ![p.ask,p.bid,p.observedSpread,p.entryFee,p.allIn,p.breakEven,
       p.centralEdge,p.lowerEdge,p.centralScenario,p.lowerScenario].every(finite)||
    p.ask<CANDIDATE_C_LIMITS.minAsk||p.ask>CANDIDATE_C_LIMITS.maxAsk||
    p.allIn<=0||p.allIn>CANDIDATE_C_LIMITS.maxAllIn+1e-9||
    p.bid<0||p.bid>p.ask||p.observedSpread>CANDIDATE_C_LIMITS.maxSpread+1e-9||
    Math.abs(p.ask-p.bid-p.observedSpread)>1e-6||
    Math.abs(p.breakEven-p.allIn/p.quantity)>1e-5||
    p.actualFillVerified!==false)return null;
 return {ticker:row.ticker,closeAt:row.closeAt,at:c.observedAt,
  side:p.side,threeMinuteTrend:p.threeMinuteTrend,
  threeClosedAt:p.threeClosedAt,
  ask:p.ask,quantity:p.quantity,allIn:p.allIn,
  breakEven:p.breakEven,centralEdge:p.centralEdge,
  lowerEdge:p.lowerEdge,sourceTickId:row.id??null};
};
export function selectCandidateCFirstConfirmed(researchTicks,{notBefore=0}={}){
 if(!Array.isArray(researchTicks))throw new TypeError('Research rows required');
 if(notBefore!==0&&!isTime(notBefore))throw new TypeError('Invalid research start');
 // Sort ALL recorded paper observations, including ineligible ticks.
 // A failed/missing quote, out-of-window tick or a direction flip breaks
 // confirmation; skipped rows never count as consecutive confirmations.
 const ticks=researchTicks.filter(x=>x&&isTime(x.observedAt)&&x.paperOnly===true)
  .slice().sort((a,b)=>a.observedAt-b.observedAt||
     (Number(a.id)||0)-(Number(b.id)||0));
 const seen=new Set(),out=[];
 let prev=null,lastAt=null;
 for(const row of ticks){
  const next=validObservation(row,notBefore);
  const consecutive=next&&prev&&lastAt!==null&&
   next.at-lastAt>=CANDIDATE_C_LIMITS.minGapMs&&
   next.at-lastAt<=CANDIDATE_C_LIMITS.maxGapMs&&
   next.ticker===prev.ticker&&next.closeAt===prev.closeAt&&
   next.side===prev.side&&
   next.threeMinuteTrend===prev.threeMinuteTrend&&
   next.threeClosedAt===prev.threeClosedAt;
  if(consecutive&&!seen.has(next.ticker)){
   seen.add(next.ticker);
   out.push({policy:CANDIDATE_C_POLICY,version:CANDIDATE_C_SPEC,
    ticker:next.ticker,closeAt:next.closeAt,
    side:next.side,ask:next.ask,quantity:next.quantity,allIn:next.allIn,
    estimatedFeeInclusiveBreakeven:next.breakEven,
    uncalibratedCentralEdge:next.centralEdge,
    uncalibratedLowerEdge:next.lowerEdge,
    confirmationCount:2,firstQualifyingObservedAt:prev.at,
    firstObservedAt:next.at,sourceTickId:next.sourceTickId,
    activeThreeMinuteTrend:next.threeMinuteTrend,
    actualFillVerified:false,executeAuthorized:false,
    profitIsCounterfactual:true});
  }
  prev=next;lastAt=next?.at??row.observedAt;
 }
 return out.sort((a,b)=>a.firstObservedAt-b.firstObservedAt||
  a.ticker.localeCompare(b.ticker));
}
export function scoreCandidateCConfirmed(firstSignals,officialWindows){
 if(!Array.isArray(firstSignals))throw new TypeError('First signals required');
 return joinFinalizedOfficialOutcomes(firstSignals,officialWindows);
}
export function summarizeCandidateC(scored){
 if(!Array.isArray(scored))throw new TypeError('Scored signals required');
 const results=scored.filter(s=>s.policy===CANDIDATE_C_POLICY);
 const finalized=results.filter(s=>s.directionCorrect!==null);
 const correct=finalized.filter(s=>s.directionCorrect===true).length;
 return {policy:CANDIDATE_C_POLICY,version:CANDIDATE_C_SPEC,
  readOnly:true,executionAuthorized:false,realFillsVerified:false,
  uniqueConfirmedContracts:results.length,
  finalized:finalized.length,unresolved:results.length-finalized.length,
  directionCorrect:correct,directionWrong:finalized.length-correct,
  correctRate:finalized.length?Number((correct/finalized.length).toFixed(5)):null,
  hypotheticalHoldToSettlementNet:finalized.length?
   Number(finalized.reduce((v,s)=>v+s.hypotheticalHoldToSettlementNet,0).toFixed(4)):null,
  warning:'Uncalibrated scenarios and displayed quotes only. 2-hour observation is a functionality check, not proof of edge.'};
}
