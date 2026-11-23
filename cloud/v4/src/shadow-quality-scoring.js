/* Prospective, offline, first-confirmed signal selection for A2/B2/C2.
 * No historical outcome may be referenced before first side/tick is frozen.
 * Repeated tick observations are NOT multiple independent contracts.
 */
import {SHADOW_QUALITY_VERSION,REVISED_POLICY,CONFIRMATION}
 from './shadow-quality-revisions.js';
const ts=n=>Number.isSafeInteger(n)&&n>1000000000000;
const f=n=>typeof n==='number'&&Number.isFinite(n);
const market=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
function evidence(row,policy,notBefore){
 if(row?.paperOnly!==true||row.shadowOnly!==true||
  !ts(row.observedAt)||row.observedAt<notBefore||
  !ts(row.finishedAt)||row.finishedAt<row.observedAt||
  !ts(row.closeAt)||!market.test(row.ticker||'')||
  row.observedAt>=row.closeAt||
  row.observedAt<row.closeAt-900000)return null;
 const top=row.decision?.shadowProbe?.prospectiveShadow?.revised;
 const r=top?.policies?.[policy],p=r?.proposed;
 if(top?.version!==SHADOW_QUALITY_VERSION||top.readOnly!==true||
   top.executionAuthorized!==false||r?.version!==SHADOW_QUALITY_VERSION||
   r.policy!==policy||r.status!=='QUALIFYING_QUALITY_OBSERVATION'||
   r.readOnly!==true||r.executionAuthorized!==false||
   r.outcomeAvailableAtEvaluation!==false||r.calibratedProbability!==null||
   r.ticker!==row.ticker||!ts(r.observedAt)||
   Math.abs(r.observedAt-row.observedAt)>30000||
   r.observedAt>row.finishedAt+2000||r.observedAt>=row.closeAt||
   !p||!['UP','DOWN'].includes(p.side)||
   ![p.ask,p.bid,p.allIn,p.breakEven,p.centralEdge,p.lowerEdge,
     p.target,p.indexValue,p.targetGapSigned,p.oneMinuteSigma,
     p.observedSpread].every(f)||p.ask<=0||p.ask>.87||
   p.allIn<=0||p.allIn>3.000001||
   !Number.isSafeInteger(p.quantity)||p.quantity<1||
   Math.abs(p.allIn/p.quantity-p.breakEven)>1e-5||
   Math.abs((p.indexValue-p.target)*(p.side==='UP'?1:-1)-
     p.targetGapSigned)>1e-4||
   p.oneMinuteSigma<=0||p.actualFillVerified!==false||
   !Number.isSafeInteger(p.threeClosedAt)||
   p.threeClosedAt!==Math.floor(r.observedAt/180000)*180-180||
   p.bid<0||p.bid>p.ask||p.observedSpread<0||
   Math.abs(p.ask-p.bid-p.observedSpread)>1e-5)return null;
 return {policy,ticker:row.ticker,closeAt:row.closeAt,
  at:r.observedAt,side:p.side,ask:p.ask,quantity:p.quantity,
  allIn:p.allIn,breakEven:p.breakEven,
  targetGapSigned:p.targetGapSigned,
  oneMinuteSigma:p.oneMinuteSigma,
  threeMinuteTrend:p.threeMinuteTrend,
  threeClosedAt:p.threeClosedAt,
  affordableAt50c:p.affordableAt50c===true,
  quantityAt50c:p.quantityAt50c,
  hypotheticalAllIn50c:p.hypotheticalAllIn50c,
  sourceTickId:row.id??null};
}
export function selectRevisedFirstConfirmed(researchTicks,{notBefore=0}={}){
 if(!Array.isArray(researchTicks)||
    (notBefore!==0&&!ts(notBefore)))throw new TypeError('Invalid research set');
 const rows=researchTicks.filter(r=>r?.paperOnly===true&&ts(r.observedAt))
  .slice().sort((a,b)=>a.observedAt-b.observedAt||
    (Number(a.id)||0)-(Number(b.id)||0));
 const seen=new Set(),signals=[],prev=Object.fromEntries(
  Object.keys(REVISED_POLICY).map(p=>[p,null]));
 for(const row of rows){
  for(const policy of Object.keys(REVISED_POLICY)){
   const next=evidence(row,policy,notBefore),p=prev[policy];
   const contiguous=next&&p&&
    next.at-p.at>=CONFIRMATION.minGapMs&&
    next.at-p.at<=CONFIRMATION.maxGapMs&&
    next.ticker===p.ticker&&next.closeAt===p.closeAt&&
    next.side===p.side&&
    next.threeClosedAt===p.threeClosedAt;
   const improvement=contiguous?
    next.targetGapSigned-p.targetGapSigned:null;
   const recovery=contiguous&&(p.targetGapSigned<0||
    next.targetGapSigned<0);
   const improved=!recovery||
    improvement+1e-9>=Math.max(CONFIRMATION.minGapImprovementDollar,
       CONFIRMATION.minGapImprovementSigma*next.oneMinuteSigma);
   const key=policy+'|'+next?.ticker;
   if(contiguous&&improved&&!seen.has(key)){
    seen.add(key);
    // PRICE at SECOND tick, never hindsight-select later winners.
    const paperAffordable=policy==='C2_EVIDENCE'?
     next.affordableAt50c:true;
    const quantity=paperAffordable?
     policy==='C2_EVIDENCE'?next.quantityAt50c:next.quantity:0;
    const allIn=paperAffordable?
     policy==='C2_EVIDENCE'?next.hypotheticalAllIn50c:next.allIn:null;
    signals.push({policy,version:SHADOW_QUALITY_VERSION,
     ticker:next.ticker,closeAt:next.closeAt,
     side:next.side,ask:next.ask,
     quantity,allIn,
     qualitySignal:true,affordableAt50c:next.affordableAt50c,
     priceAtConfirmation:next.ask,
     firstQualifyingObservedAt:p.at,firstObservedAt:next.at,
     targetGapAtFirst:p.targetGapSigned,
     targetGapAtConfirmation:next.targetGapSigned,
     requiredGapImprovement:recovery?
       Math.max(CONFIRMATION.minGapImprovementDollar,
        CONFIRMATION.minGapImprovementSigma*next.oneMinuteSigma):0,
     confirmedRecovery:recovery,
     sourceTickId:next.sourceTickId,
     actualFillVerified:false,executionAuthorized:false,
     profitIsCounterfactual:true,
     monetaryCounterfactualAvailable:paperAffordable});
   }
   // A missing/rejected/invalid tick interrupts the sequential check.
   prev[policy]=next;
  }
 }
 return signals.sort((a,b)=>a.firstObservedAt-b.firstObservedAt||
  a.policy.localeCompare(b.policy)||a.ticker.localeCompare(b.ticker));
}
export function joinRevisedOfficialOutcomes(signals,windows){
 if(!Array.isArray(signals)||!Array.isArray(windows))
  throw new TypeError('Invalid outcome evidence');
 const official=new Map();
 for(const w of windows){
  if(!market.test(w?.ticker||'')||
    w.status!=='OFFICIAL_RESULT'||w.exchangeStatus!=='finalized'||
    !['UP','DOWN'].includes(w.outcome)||!ts(w.closeAt)||
    !ts(w.settledAt)||w.settledAt<w.closeAt||
    !w.source?.includes('Kalshi'))continue;
  const old=official.get(w.ticker);
  if(!old||w.settledAt<old.settledAt)official.set(w.ticker,w);
 }
 return signals.map(s=>{
  const w=official.get(s.ticker);
  if(!w||w.closeAt!==s.closeAt||
     s.firstObservedAt>=w.closeAt||w.settledAt<=s.firstObservedAt)
   return {...s,officialOutcome:'UNRESOLVED',
    directionCorrect:null,hypotheticalHoldToSettlementNet:null};
  const correct=s.side===w.outcome;
  const net=s.monetaryCounterfactualAvailable&&
   Number.isSafeInteger(s.quantity)&&s.quantity>0&&f(s.allIn)?
   Number((correct?s.quantity-s.allIn:-s.allIn).toFixed(6)):null;
  return {...s,officialOutcome:w.outcome,officialSettledAt:w.settledAt,
   directionCorrect:correct,hypotheticalHoldToSettlementNet:net};
 });
}
export function summarizeRevisedOutcomes(scored){
 const data={version:SHADOW_QUALITY_VERSION,readOnly:true,
  executionAuthorized:false,realFillsVerified:false,policies:{}};
 for(const policy of Object.keys(REVISED_POLICY)){
  const all=scored.filter(x=>x.policy===policy),
   finalized=all.filter(x=>x.directionCorrect!==null),
   priced=finalized.filter(x=>f(x.hypotheticalHoldToSettlementNet));
  const wins=finalized.filter(x=>x.directionCorrect===true).length;
  data.policies[policy]={uniqueFirstConfirmedContracts:all.length,
   finalized:finalized.length,unresolved:all.length-finalized.length,
   directionCorrect:wins,directionWrong:finalized.length-wins,
   qualitySignalsNotAffordableAt50c:all.filter(x=>!x.affordableAt50c).length,
   priceCounterfactualsScored:priced.length,
   hypotheticalHoldToSettlementNet:priced.length?
    Number(priced.reduce((s,x)=>s+x.hypotheticalHoldToSettlementNet,0).toFixed(4)):null};
 }
 return data;
}
