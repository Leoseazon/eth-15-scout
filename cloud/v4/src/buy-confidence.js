/* V4 paper BUY confidence: deterministic 0–100 HEURISTIC INDEX ONLY.
 * This is NOT a calibrated chance of winning at Kalshi settlement.
 * Its numeric value is NEVER a new buy threshold or stake/exit control.
 * Invalid confidence inputs fail closed at paper entry so every recorded
 * simulated BUY carries a valid score. All inputs are contemporaneous.
 */
import {calculateSettlementEvidence} from './settlement-first.js';
export const BUY_CONFIDENCE_VERSION='V4-BUY-CONFIDENCE-HEURISTIC-1';
const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
const signed=(n,direction)=>clamp(n*direction);
export function scoreBuyConfidence({
 side,score,geometry,momentum,structure,familySupport,contradictionReasons,
 spread,indexAgeMs,bookAgeMs
}={}){
 if(!['UP','DOWN'].includes(side)||![
   score,geometry,momentum,structure,spread,indexAgeMs,bookAgeMs
 ].every(Number.isFinite)||!Number.isInteger(familySupport)||
 familySupport<0||familySupport>3||
 !Array.isArray(contradictionReasons)||spread<0||spread>.05||
 indexAgeMs<0||indexAgeMs>15000||bookAgeMs<0||bookAgeMs>5000)
  return null;
 const direction=side==='UP'?1:-1;
 const evidence=signed(score,direction);
 const target=signed(geometry,direction);
 const momentumSupport=signed(momentum,direction);
 const structureSupport=signed(structure,direction);
 const independentStrength=(momentumSupport+structureSupport)/2;
 const independentAgreement=familySupport/3;
 const quoteQuality=clamp((.05-spread)/.05);
 const sourceFreshness=(
   clamp(1-indexAgeMs/15000)+clamp(1-bookAgeMs/5000))/2;
 const penalty=Math.min(.24,contradictionReasons.length*.08);
 // Transparent fixed heuristic weights. No post-hoc fitting or
 // false conversion of raw score into outcome probability.
 const raw=.30*evidence+.25*target+.20*independentStrength+
   .10*independentAgreement+.10*quoteQuality+.05*sourceFreshness-penalty;
 const value=Math.round(100*clamp(raw));
 return {value,scaleMax:100,version:BUY_CONFIDENCE_VERSION,
  kind:'HEURISTIC_DECISION_CONFIDENCE_NOT_WIN_PROBABILITY',
  calibrated:false,winProbability:null,
  components:{targetAlignment:Math.round(100*target),
   compositeEvidence:Math.round(100*evidence),
   independentIndicatorStrength:Math.round(100*independentStrength),
   independentFamilyAgreement:Math.round(100*independentAgreement),
   orderbookSpreadQuality:Math.round(100*quoteQuality),
   feedFreshness:Math.round(100*sourceFreshness),
   contradictionPenaltyPoints:Math.round(100*penalty)}};
}

/* Refresh a held position's conviction without evaluating whether to enter
 * another trade. Source/expiry failures are UNKNOWN, never 0% confidence.
 * Static entry confidence is preserved; this function does not change exits.
 */
export function scoreHeldConfidence({position,index,one,five,context,book,
 now=Date.now()}={}){
 const unavailable=reason=>({status:'UNAVAILABLE',reason,value:null,
  version:BUY_CONFIDENCE_VERSION,calibrated:false,winProbability:null});
 if(!position||!['UP','DOWN'].includes(position.side)||
    !Number.isFinite(position.target)||position.target<=0||
    !Number.isFinite(Date.parse(position.closeTime)))
  return unavailable('HELD_CONTRACT_NOT_VALID');
 const remainingSeconds=(Date.parse(position.closeTime)-now)/1000;
 if(remainingSeconds<=0)return unavailable('MARKET_CLOSED_AWAITING_OFFICIAL_RESULT');
 if(index?.indexId!=='ETHUSD_RTI'||index.validValuesVerified!==true||
    !Number.isFinite(index.price)||index.price<=0||
    !Number.isSafeInteger(index.sourceAt)||index.sourceAt>now+3000||
    now-index.sourceAt>15000)
  return unavailable('OFFICIAL_INDEX_STALE_OR_UNAVAILABLE');
 if(book?.ticker!==position.ticker||
    book?.source!=='KALSHI_WEBSOCKET_ORDERBOOK'||
    book.valid!==true||book.fresh!==true||book.crossed===true||
    !Number.isSafeInteger(book.receivedAt)||
    now-book.receivedAt>5000||book.receivedAt>now+1000)
  return unavailable('KALSHI_WEBSOCKET_BOOK_STALE_OR_UNAVAILABLE');
 const evidence=calculateSettlementEvidence({target:position.target,
  indexValue:index.price,one,five,context,remainingSeconds});
 if(!evidence)return unavailable('CLOSED_CANDLE_INDICATORS_UNAVAILABLE');
 const direction=position.side==='UP'?1:-1;
 const contradictions=[
  evidence.geometry*direction<0?'OFFICIAL_INDEX_OPPOSES_HELD_SIDE':null,
  evidence.momentum*direction<0?'MOMENTUM_OPPOSES_HELD_SIDE':null,
  evidence.contextBias*direction<0?'HIGHER_TIMEFRAME_OPPOSES_HELD_SIDE':null,
  Math.abs(index.price-one.last)>Math.max(3,4*one.sd)?
    'OFFICIAL_INDEX_KRAKEN_BASIS_WIDE':null
 ].filter(Boolean);
 const support=[evidence.geometry,evidence.momentum,evidence.contextBias]
  .filter(x=>x*direction>=.15).length;
 const selected=position.side==='UP'?
  {ask:book.yesAsk,bid:book.yesBid}:
  {ask:book.noAsk,bid:book.noBid};
 const ask=Number(selected.ask?.price),bid=Number(selected.bid?.price);
 if(!Number.isFinite(ask)||!Number.isFinite(bid)||ask<bid||
    ask<=0||ask>1||bid<0||bid>=1)
  return unavailable('HELD_CONTRACT_QUOTES_INVALID');
 const score=scoreBuyConfidence({side:position.side,
  score:evidence.combined,geometry:evidence.geometry,
  momentum:evidence.momentum,structure:evidence.contextBias,
  familySupport:support,contradictionReasons:contradictions,
  spread:ask-bid,indexAgeMs:Math.max(0,now-index.sourceAt),
  bookAgeMs:Math.max(0,now-book.receivedAt)});
 if(!score)return unavailable('HELD_CONFIDENCE_INPUTS_INVALID');
 return {...score,status:'CURRENT',asOf:now,
  sourceIndexAt:index.sourceAt,bookReceivedAt:book.receivedAt,
  contractTicker:position.ticker,side:position.side,
  observedDistance:Number((index.price-position.target).toFixed(5)),
  remainingSeconds,
  modelImpliedSide:evidence.combined>0?'UP':'DOWN',
  latestOpposingEvidence:contradictions,
  caveat:remainingSeconds<=60?
    'Final-minute settlement accumulator unavailable: this score is based on the latest index, not the official final average.':
    'Heuristic decision support, not an estimated probability of winning.'};
}
