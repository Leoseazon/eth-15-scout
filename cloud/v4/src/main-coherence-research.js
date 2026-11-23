/* ETH-15 Scout V4 MAIN STRATEGY coherence audit — RESEARCH ONLY.
 *
 * A single point-in-time evidence reconciliation for the EXISTING baseline:
 * technical composite, official-target geometry, momentum, 3m/5m trend,
 * fee-aware UP/DOWN value and legacy structural cautions are described
 * together, without adding a buy gate, scoring a future outcome or trading.
 *
 * Key design: a VALUE selection can legitimately differ from the heuristic
 * technical side. Do not silently veto, harmonize by changing values or
 * treat duplicate correlated indicators as independent votes.
 */
import {structuralEntry,structuralExit} from './structure.js';
import {calculateSettlementEvidence} from './settlement-first.js';

export const MAIN_COHERENCE_RESEARCH_VERSION='V4-MAIN-COHERENCE-R1-20261122';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sign=n=>finite(n)?n>0?'UP':n<0?'DOWN':'NEUTRAL':'UNAVAILABLE';
const trend=x=>['UP','DOWN','NEUTRAL'].includes(x)?x:'UNAVAILABLE';
const round=n=>finite(n)?Number(n.toFixed(6)):null;
const tickerOk=t=>typeof t==='string'&&/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(t);
const noAction=Object.freeze({executionAuthorized:false,readOnly:true,
 simulatedOrderAuthorized:false,calibratedProbability:null});
function statusForSide(s){
 if(!s||!['UP','DOWN'].includes(s.side))return null;
 const qty=s.quantity??s.qty;
 if(!Number.isSafeInteger(qty)||qty<1||
    !['UP','DOWN'].includes(s.side)||![s.ask,s.bid,s.allIn,
      s.breakEven,s.lowerScenario,s.centralScenario].every(finite)||
    s.ask<=0||s.ask>1||s.bid<0||s.bid>s.ask||
    s.allIn<=0||s.allIn>3.00001||
    Math.abs(s.allIn/qty-s.breakEven)>0.0001||
    s.lowerScenario<0||s.lowerScenario>1||
    s.centralScenario<0||s.centralScenario>1)return null;
 return {side:s.side,status:s.status,
  ask:round(s.ask),bid:round(s.bid),quantity:qty,
  feeInclusiveCost:round(s.allIn),breakEven:round(s.breakEven),
  central:round(s.centralScenario),lower:round(s.lowerScenario),
  centralEdge:round(s.centralScenario-s.breakEven),
  lowerEdge:round(s.lowerScenario-s.breakEven),
  requiredEdge:finite(s.requiredEdge)?round(s.requiredEdge):null};
}
function structuralComplete(t,f){
 return !!t&&!!f&&
 ['price','range','tolerance','prevClose','adDelta'].every(k=>finite(t[k]))&&
 ['price','tolerance'].every(k=>finite(f[k]))&&
 !!t.bands&&finite(t.bands.upper)&&finite(t.bands.lower)&&
 ['UP','DOWN','NEUTRAL'].includes(t.trend)&&
 ['UP','DOWN','NEUTRAL'].includes(f.trend);
}
function cautionForSide(side,context){
 if(!['UP','DOWN'].includes(side))return {status:'NOT_EVALUATED',
  reason:'No defined research side'};
 const t=context?.three,f=context?.five;
 if(!structuralComplete(t,f))return {status:'NOT_RECONSTRUCTABLE',
  reason:'Complete 3m/5m historical barrier state not available'};
 const x=structuralEntry(side,t,f);
 return {status:x.ok?'AVAILABLE_AS_CONTEXT':'LEGACY_STRUCTURE_WOULD_VETO',
  legacyEntryResult:x.ok===true,secondaryCaution:x.secondaryCaution===true,
  reason:x.reason||null};
}
/** Reads the exact active settlement evaluator result and the SAME tick's
 * completed structure. Never recomputes entry feasibility from REST quotes.
 * In WATCH mode, ranking the 2 central margins is a RESEARCH ranking only.
 */
export function assessMainDecisionCoherence({market,candidate,context,
 at=null}={}){
 const info={version:MAIN_COHERENCE_RESEARCH_VERSION,
  ...noAction,
  ticker:tickerOk(market?.ticker)?market.ticker:null,
  observedAt:Number.isSafeInteger(at)&&at>1e12?at:null,
  baselineDecision:candidate?.status||'UNAVAILABLE',
  baselineReason:candidate?.reason||'UNAVAILABLE',
  tradingRuleChanges:0,
  familyCountAsIndependentVotes:false,
  primaryAuthority:'Existing V4 fee-adjusted scenario decision unchanged'};
 if(!['WATCH','CANDIDATE'].includes(candidate?.status)||
    !finite(candidate?.score)||!finite(candidate?.geometry)||
    !finite(candidate?.momentum)||!finite(candidate?.structure)){
  return {...info,status:'NOT_ASSESSABLE',
   reason:'Main V4 candidate or independent model components unavailable'};
 }
 const technical=sign(candidate.score);
 const target=sign(candidate.officialDistance);
 const components={
  technicalComposite:round(candidate.score),
  technicalPreferredSide:technical,
  currentTargetSide:target,
  targetGeometry:round(candidate.geometry),
  momentum:round(candidate.momentum),
  higherTimeframeContext:round(candidate.structure),
  targetGeometrySide:sign(candidate.geometry),
  momentumSide:sign(candidate.momentum),
  higherTimeframeSide:sign(candidate.structure),
  threeMinuteSide:trend(context?.three?.trend),
  fiveMinuteSide:trend(context?.five?.trend),
  technicalContradictions:Array.isArray(candidate.contradictionReasons)?
   candidate.contradictionReasons.filter(x=>typeof x==='string').slice(0,6):[]
 };
 const options=Array.isArray(candidate.consideredSideValues)?
  candidate.consideredSideValues.map(statusForSide).filter(Boolean):[];
 const bySide=Object.fromEntries(options.map(o=>[o.side,o]));
 const selected=candidate.status==='CANDIDATE'&&
  ['UP','DOWN'].includes(candidate.side)?candidate.side:null;
 const sorted=[...options].sort((a,b)=>b.centralEdge-a.centralEdge||
   b.lowerEdge-a.lowerEdge||a.side.localeCompare(b.side));
 const researchOnlyCentralSide=!selected&&
  bySide.UP&&bySide.DOWN&&
  Math.abs(bySide.UP.centralEdge-bySide.DOWN.centralEdge)>1e-9?
   sorted[0].side:null;
 const valueSide=selected||researchOnlyCentralSide;
 const researchOnly=!selected;
 const value= {status:selected?'BASELINE_QUALIFIED':
    researchOnlyCentralSide?'UNQUALIFIED_CENTRAL_RANKING':'NO_COMPARABLE_SIDE',
  side:valueSide,
  hypotheticalCentralRankingOnly:researchOnly,
  currentlyEligibleBaselineSide:selected,
  sides:{UP:bySide.UP||null,DOWN:bySide.DOWN||null}};
 const flags=[];
 const flag=(condition,code)=>{if(condition)flags.push(code)};
 if(valueSide){
  flag(technical!=='UNAVAILABLE'&&technical!=='NEUTRAL'&&
   technical!==valueSide,'TECHNICAL_COMPOSITE_OPPOSES_VALUE_SIDE');
  flag(target!=='UNAVAILABLE'&&target!=='NEUTRAL'&&
   target!==valueSide,'CURRENT_OFFICIAL_TARGET_OPPOSES_VALUE_SIDE');
  flag(components.momentumSide!=='NEUTRAL'&&
   components.momentumSide!==valueSide,'MOMENTUM_OPPOSES_VALUE_SIDE');
  flag(components.higherTimeframeSide!=='NEUTRAL'&&
   components.higherTimeframeSide!==valueSide,'HIGHER_TIMEFRAME_OPPOSES_VALUE_SIDE');
  flag(components.threeMinuteSide!=='NEUTRAL'&&
   components.threeMinuteSide!=='UNAVAILABLE'&&
   components.threeMinuteSide!==valueSide,'CLOSED_3M_TREND_OPPOSES_VALUE_SIDE');
  flag(components.fiveMinuteSide!=='NEUTRAL'&&
   components.fiveMinuteSide!=='UNAVAILABLE'&&
   components.fiveMinuteSide!==valueSide,'CLOSED_5M_TREND_OPPOSES_VALUE_SIDE');
 }
 const legacyStructure=cautionForSide(valueSide,context);
 if(legacyStructure.status==='LEGACY_STRUCTURE_WOULD_VETO')
  flags.push('LEGACY_STRUCTURE_GATE_WOULD_RESTRICT');
 if(legacyStructure.secondaryCaution)
  flags.push('SECONDARY_STRUCTURE_CAUTION');
 const type=!valueSide?'NO_COMPARABLE_VALUE_SIDE':
  technical==='NEUTRAL'?'TECHNICAL_NEUTRAL':
  technical!==valueSide?'PRICE_VALUE_AND_TECHNICAL_DISAGREE':
  flags.includes('CLOSED_3M_TREND_OPPOSES_VALUE_SIDE')||
  flags.includes('CLOSED_5M_TREND_OPPOSES_VALUE_SIDE')?
   'COMPOSITE_ALIGNED_BUT_CLOSED_TREND_OPPOSED':'PRICE_VALUE_AND_TECHNICAL_ALIGNED';
 return {...info,status:'EVIDENCE_RECONCILED',
  technical:components,value,
  concordance:{classification:type,flags,
   scoreAndValueAgree:!!valueSide&&technical===valueSide,
   selectedSideCountedAsTrade:false},
  legacyStructure,
  timeRemainingSeconds:finite(candidate.remainingSeconds)?
   candidate.remainingSeconds:null,
  experimentalExitAction:'NONE',
  note:'No BUY/PASS/SELL veto. Unqualified central ranking has NO trading authority.'};
}
/** Existing deterministic exit triggers are reported along with non-authorized
 * 3m/5m reversal research. Missing/old book -> no assumed exit fill.
 * This is not called by the live Worker, and it never modifies position.
 */
export function assessMainHeldExitCoherence({position,index,book,one,five,
 context,now}={}){
 const result={version:MAIN_COHERENCE_RESEARCH_VERSION,
  ...noAction,status:'NOT_ASSESSABLE',
  originalExitRulesPreserved:true,officialSettlementUsedForExit:false};
 if(!position||!tickerOk(position.ticker)||
  !['UP','DOWN'].includes(position.side)||
  !finite(position.entry)||position.entry<=0||position.entry>=1||
  !Number.isSafeInteger(position.qty)||position.qty<1||
  !Number.isSafeInteger(now)||now<1e12||
  !Number.isFinite(Date.parse(position.closeTime)))
  return {...result,reason:'Position/time source incomplete'};
 const remainingSeconds=(Date.parse(position.closeTime)-now)/1000;
 if(remainingSeconds<=0)return {...result,status:'AWAIT_OFFICIAL_RESULT',
  remainingSeconds};
 if(!book||book.ticker!==position.ticker||
  book.source!=='KALSHI_WEBSOCKET_ORDERBOOK'||
  book.valid!==true||book.fresh!==true||
  !Number.isSafeInteger(book.receivedAt)||book.receivedAt>now||
  now-book.receivedAt>5000)
  return {...result,status:'NO_VERIFIED_EXIT_BOOK',remainingSeconds};
 const b=position.side==='UP'?book.yesBid:book.noBid;
 const bid=Number(b?.price),depth=Number(b?.sizeFp);
 if(!finite(bid)||bid<=0||bid>=1||!finite(depth)||depth<position.qty)
  return {...result,status:'NO_EXECUTABLE_DEPTH_EVIDENCE',
   remainingSeconds};
 const decline=(position.entry-bid)/position.entry;
 const originalExit=remainingSeconds<=360&&decline>=.40?
  'BASELINE_EMERGENCY_STOP':bid>=.96&&remainingSeconds>60?
  'BASELINE_96C_TAKE_PROFIT':'BASELINE_HOLD_OR_WAIT_SETTLEMENT';
 const evidence=(index?.indexId==='ETHUSD_RTI'&&
  index.validValuesVerified===true&&finite(index.price)&&
  Number.isSafeInteger(index.sourceAt)&&
  index.sourceAt<=now+3000&&now-index.sourceAt<=15000)?
   calculateSettlementEvidence({target:position.target,indexValue:index.price,
    one,five,context,remainingSeconds}):null;
 const technicalSide=evidence?sign(evidence.combined):'UNAVAILABLE';
 const structural=structuralComplete(context?.three,context?.five)?
  structuralExit(position.side,context.three,context.five):null;
 const flags=[];
 if(technicalSide!=='UNAVAILABLE'&&technicalSide!=='NEUTRAL'&&
    technicalSide!==position.side)flags.push('HELD_SIDE_OPPOSED_BY_COMPOSITE');
 if(structural?.confirm)flags.push('LEGACY_STRUCTURE_CONFIRMS_REVERSAL');
 return {...result,status:'EXIT_EVIDENCE_RECONCILED',
  ticker:position.ticker,side:position.side,
  remainingSeconds:round(remainingSeconds),
  lastVerifiedBid:round(bid),
  displayedBidDepth:depth,
  entryPrice:round(position.entry),
  contractPriceDecline:round(decline),
  originalExit,
  technicalSide,
  structuralExitConfirm:structural?.confirm===true,
  flags,
  wouldChangeExit:false,
  hypotheticalReversalExitNotAuthorized:true,
  note:'Technical reversal alerts are descriptive only. Do not infer a market fill or replace actual V4 96c/40% exits.'};
}
