/* V4 settlement-first chronological replay. No market data fetches,
 * no real orders, no future truth in decision features, no fictitious fills.
 * Consumes already-authorized as-of observations and official finalized results.
 */
import {evaluateSettlementFirst,SETTLEMENT_FIRST_VERSION} from './settlement-first.js';
const ETH=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const n=x=>Number.isFinite(x)?x:null;
const time=t=>Number.isSafeInteger(t)&&t>1000000000000?t:null;
const avg=(a,b)=>b?Number((a/b).toFixed(4)):null;
function snapshotValid(p){
 if(!p||!ETH.test(p.ticker||'')||time(p.at)===null||
    p.market?.ticker!==p.ticker||p.book?.ticker!==p.ticker)return false;
 const closeAt=Date.parse(p.market.close_time||'');
 if(!Number.isFinite(closeAt)||p.at>=closeAt)return false;
 const sourceAt=p.index?.sourceAt;
 // Per-source as-of rule: no historical value, candle or order book from the
 // future of the simulated decision. Missing source clocks => no valid decision.
 if(time(sourceAt)===null||sourceAt>p.at ||
    time(p.book?.receivedAt)===null||p.book.receivedAt>p.at)return false;
 const times=[p.oneObservedAt,p.fiveObservedAt,p.marketObservedAt];
 if(times.some(t=>time(t)===null||t>p.at))return false;
 return true;
}
export function replaySettlementMarkets({snapshots=[],officialWindows=[],startAt,endAt}={}){
 if(time(startAt)===null||time(endAt)===null||startAt>=endAt||
    !Array.isArray(snapshots)||!Array.isArray(officialWindows))
  throw TypeError('Invalid time-ordered backtest window');
 const truth=new Map(),invalidTruth=[];
 for(const w of officialWindows){
  if(!ETH.test(w?.ticker||''))continue;
  const closeAt=time(w.closeAt);
  if(closeAt===null||closeAt<startAt||closeAt>=endAt)continue;
  if(truth.has(w.ticker)){invalidTruth.push(w.ticker);truth.delete(w.ticker);continue}
  if(w.status==='OFFICIAL_RESULT'&&['UP','DOWN'].includes(w.outcome))
   truth.set(w.ticker,{closeAt,outcome:w.outcome});
 }
 const sorted=[...snapshots].sort((a,b)=>(a?.at||0)-(b?.at||0)),predictions=new Map();
 let invalidSnapshots=0,outOfWindow=0,watchDecisions=0;
 for(const p of sorted){
  if(!p||time(p.at)===null||p.at<startAt||p.at>=endAt){outOfWindow++;continue}
  if(!snapshotValid(p)){invalidSnapshots++;continue}
  const final=truth.get(p.ticker);
  if(!final||p.at>=final.closeAt){invalidSnapshots++;continue}
  if(predictions.has(p.ticker))continue;
  const d=evaluateSettlementFirst({market:p.market,index:p.index,one:p.one,
   five:p.five,context:p.context,book:p.book,now:p.at});
  if(d.status!=='CANDIDATE'){watchDecisions++;continue}
  predictions.set(p.ticker,{ticker:p.ticker,at:p.at,side:d.side,
   officialOutcome:final.outcome,directionCorrect:d.side===final.outcome,
   remainingSeconds:d.remainingSeconds,price:d.ask,
   target:d.target,officialIndexAt:p.index.sourceAt});
 }
 let correct=0,upPredictions=0,downPredictions=0;
 for(const p of predictions.values()){
  if(p.directionCorrect)correct++;
  if(p.side==='UP')upPredictions++;else downPredictions++;
 }
 const eligible=truth.size,attempted=predictions.size;
 let alwaysUp=0,alwaysDown=0;
 for(const w of truth.values()){if(w.outcome==='UP')alwaysUp++;else alwaysDown++}
 return {paperOnly:true,replayVersion:SETTLEMENT_FIRST_VERSION,
  startAt,endAt,officialMarkets:eligible,predictions:attempted,
  passedMarkets:Math.max(0,eligible-attempted),
  correct,incorrect:attempted-correct,
  settlementAccuracy:avg(correct,attempted),marketCoverage:avg(attempted,eligible),
  alwaysUpBaseline:avg(alwaysUp,eligible),alwaysDownBaseline:avg(alwaysDown,eligible),
  upPredictions,downPredictions,watchDecisions,invalidSnapshots,outOfWindow,
  duplicateOfficialTickers:invalidTruth.length,
  observationsInput:snapshots.length,
  observationsUsed:sorted.length-invalidSnapshots-outOfWindow,
  results:[...predictions.values()],
  note:'Only actual final outcomes and as-of evidence. No proven fills, executed P&L, or statistical edge inferred.'};
}
