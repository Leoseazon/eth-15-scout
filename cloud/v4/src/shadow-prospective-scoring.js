/* Prospective V4 experiment scoring: OFFLINE and read-only, no feed requests.
 * Extract the first authenticated, research-only shadow candidate per POLICY
 * and TICKER in chronological signal order BEFORE joining any official results.
 * Quotes are displays only; post-settlement outcome is not an actual fill.
 * Every output remains explicitly counterfactual and uncalibrated.
 */
import {SHADOW_POLICIES,SHADOW_SPEC_VERSION} from './shadow-opportunity-policies.js';
const isTs=n=>Number.isSafeInteger(n)&&n>1000000000000;
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const policies=new Set(Object.keys(SHADOW_POLICIES));
const tickerPattern=/^KXETH15M-[A-Z0-9-]{5,80}$/;
/** chronology and source sanity are enforced independently from candidate metrics */
export function selectFirstShadowSignals(researchTicks,{notBefore=0}={}){
 if(!Array.isArray(researchTicks))throw new TypeError('researchTicks must be an array');
 if(notBefore!==0&&!isTs(notBefore))throw new TypeError('Invalid prospective start timestamp');
 const events=[];
 for(const row of researchTicks){
  if(!row||row.paperOnly!==true)continue;
  const shadow=row.decision?.shadowProbe?.prospectiveShadow;
  if(!shadow||shadow.version!==SHADOW_SPEC_VERSION||
     shadow.readOnly!==true||shadow.executionAuthorized!==false||
     shadow.outcomeAvailableAtEvaluation!==false)continue;
  const at=shadow.observedAt;
  if(!isTs(at)||at<notBefore||!isTs(row.observedAt)||
     Math.abs(at-row.observedAt)>30000||at>row.finishedAt+2000||
     !tickerPattern.test(row.ticker||''))continue;
  const marketClose=isTs(row.closeAt)?row.closeAt:null;
  if(!marketClose||at>=marketClose||at<marketClose-900000)continue;
  for(const policy of policies){
   const x=shadow.policies?.[policy],p=x?.proposed;
   if(x?.status!=='SHADOW_RESEARCH_CANDIDATE'||
      x.executionAuthorized!==false||x.calibratedProbability!==null||
      x.version!==SHADOW_SPEC_VERSION||x.policy!==policy||
      x.ticker!==row.ticker||!p||!['UP','DOWN'].includes(p.side)||
      !Number.isSafeInteger(p.quantity)||p.quantity<1||
      ![p.ask,p.allIn,p.centralEdge,p.lowerEdge].every(valid)||
      p.ask<=0||p.ask>0.87||p.allIn<=0||p.allIn>3.000001||
      p.allIn+1e-9<p.ask*p.quantity)continue;
   events.push({ticker:row.ticker,policy,firstObservedAt:at,
    sourceTickId:row.id??null,closeAt:marketClose,
    side:p.side,ask:p.ask,quantity:p.quantity,allIn:p.allIn,
    estimatedFeeInclusiveBreakeven:+(p.allIn/p.quantity).toFixed(6),
    uncalibratedCentralEdge:p.centralEdge,
    uncalibratedLowerEdge:p.lowerEdge,
    dataEligibleAtObservation:true,actualFillVerified:false,
    executeAuthorized:false,profitIsCounterfactual:true});
  }
 }
 events.sort((a,b)=>a.firstObservedAt-b.firstObservedAt||
   a.policy.localeCompare(b.policy)||a.ticker.localeCompare(b.ticker));
 const selected=new Map();
 for(const event of events){
  const key=event.policy+'|'+event.ticker;
  if(!selected.has(key))selected.set(key,event);
 }
 return [...selected.values()];
}
export function joinFinalizedOfficialOutcomes(firstSignals,windows){
 if(!Array.isArray(firstSignals)||!Array.isArray(windows))
  throw new TypeError('Signals and official outcomes must be arrays');
 // Choose the earliest timestamped official finalized result for each ticker,
 // never a pending, estimated, reverse-engineered or non-exchange outcome.
 const outcomes=new Map();
 for(const w of windows){
  if(!tickerPattern.test(w?.ticker||'')||
     w?.status!=='OFFICIAL_RESULT'||w.exchangeStatus!=='finalized'||
     !['UP','DOWN'].includes(w.outcome)||
     !isTs(w.closeAt)||!isTs(w.settledAt)||
     w.settledAt<w.closeAt||!w.source?.includes('Kalshi'))continue;
  const old=outcomes.get(w.ticker);
  if(!old||w.settledAt<old.settledAt)outcomes.set(w.ticker,w);
 }
 return firstSignals.map(signal=>{
  const w=outcomes.get(signal.ticker);
  if(!w||w.closeAt!==signal.closeAt||signal.firstObservedAt>=w.closeAt||
     w.settledAt<=signal.firstObservedAt){
   return {...signal,officialOutcome:'UNRESOLVED',
    directionCorrect:null,hypotheticalHoldToSettlementNet:null};
  }
  const correct=signal.side===w.outcome;
  return {...signal,officialOutcome:w.outcome,
   officialSettledAt:w.settledAt,directionCorrect:correct,
   hypotheticalHoldToSettlementNet:+(correct?
    signal.quantity-signal.allIn:-signal.allIn).toFixed(6),
   note:'Hypothetical hold to official settlement at observed ASK only, assuming a fill of displayed quantity. No real fill or exit-path replay.'};
 });
}
export function summarizeFirstSignals(scored){
 if(!Array.isArray(scored))throw new TypeError('Scored first signals required');
 const report={specVersion:SHADOW_SPEC_VERSION,
  methodology:'Chronological first signal per policy + ticker; official outcome joined after close; no hindsight selection',
  tradingAuthorized:false,calibratedProbabilities:false,actualFillsVerified:false,
  policies:{}};
 for(const p of policies){
  const s=scored.filter(x=>x.policy===p);
  const finished=s.filter(x=>x.directionCorrect!==null);
  const wins=finished.filter(x=>x.directionCorrect===true).length;
  report.policies[p]={firstRoundSignals:s.length,
   unresolved:s.length-finished.length,officiallyResolved:finished.length,
   directionCorrect:wins,directionIncorrect:finished.length-wins,
   correctRate:finished.length?+(wins/finished.length).toFixed(5):null,
   hypotheticalHoldToSettlementNet:finished.length?
    +finished.reduce((sum,x)=>sum+x.hypotheticalHoldToSettlementNet,0).toFixed(4):null,
   warning:'Exploratory, uncalibrated, no verified fills, sample size can be misleading'};
 }
 return report;
}
