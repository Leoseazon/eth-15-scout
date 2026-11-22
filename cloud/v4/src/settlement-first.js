/* V4 settlement-first PAPER decision research, isolated from V3.
 * Primary research question: correct side of actual Kalshi KXETH15M opening target
 * at official CF ETHUSD_RTI final-minute average. NO calibrated probability,
 * NO real orders, no learned model, no historical outcomes at decision time.
 */
export const SETTLEMENT_FIRST_VERSION='V4-SETTLEMENT-FIRST-CONTEXT-20261122';
// User's HARD max buy ask, inclusive. 96c is a SELL target, not permission to BUY.
export const MAX_PAPER_ENTRY_ASK=0.85;
const numeric=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const bounded=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const sign=x=>x>0?1:x<0?-1:0;
const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
const tickerOk=t=>/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(t||'');
const watch=(reason,extra={})=>({version:SETTLEMENT_FIRST_VERSION,
 status:'WATCH',side:'PASS',reason,calibratedProbability:null,
 settlementPredictionVerified:false,executionVerified:false,...extra});
// A single source of truth for both entry confidence and confidence changes
// while holding the SAME KXETH15M contract. No future outcome information.
export function calculateSettlementEvidence({target,indexValue,one,five,context,
 remainingSeconds}={}){
 if(!Number.isFinite(target)||!Number.isFinite(indexValue)||
  !Number.isFinite(remainingSeconds)||remainingSeconds<=0||
  !one||!five||!context?.three||!context?.five||
  ![one.sd,one.last,one.e8,one.e21,one.rNow,one.mNow,
    one.sNow,one.three,five.rsi,five.e21,five.e50].every(Number.isFinite)||
  one.sd<=0||!['UP','DOWN','NEUTRAL'].includes(context.three.trend)||
  !['UP','DOWN','NEUTRAL'].includes(context.five.trend))
  return null;
 const remainingMinutes=remainingSeconds/60;
 const delta=indexValue-target;
 const expectedMove=Math.max(0.30,one.sd*Math.sqrt(remainingMinutes));
 const normalizedDistance=bounded(delta/expectedMove,-5,5);
 const geometry=Math.tanh(normalizedDistance/1.5);
 // Correlated EMA, RSI and MACD are one momentum family, NOT seven votes.
 const momentumPart=[
  bounded((one.last-one.e8)/Math.max(.3,one.sd)),
  bounded((one.e8-one.e21)/Math.max(.3,one.sd)),
  bounded((one.rNow-50)/25),
  bounded((one.mNow-one.sNow)/Math.max(.15,one.sd)),
  bounded((one.three)/Math.max(.3,one.sd*2))
 ].map(x=>finite(x));
 const momentum=momentumPart.reduce((a,b)=>a+b,0)/momentumPart.length;
 const three=context.three.trend==='UP'?1:context.three.trend==='DOWN'?-1:0;
 const fiveTrend=context.five.trend==='UP'?1:context.five.trend==='DOWN'?-1:0;
 const structure=(2*three+fiveTrend)/3;
 const fiveBias=(five.e21>five.e50&&five.rsi>52)?1:
   (five.e21<five.e50&&five.rsi<48)?-1:0;
 const contextBias=.6*structure+.4*fiveBias;
 const combined=.65*geometry+.22*momentum+.13*contextBias;
 const side=combined>0?'UP':'DOWN',direction=sign(combined);
 const contradictions=[
  sign(geometry)&&sign(geometry)!==direction?'OFFICIAL_TARGET_CURRENTLY_OPPOSES_DIRECTION':null,
  sign(momentum)&&sign(momentum)!==direction?'MOMENTUM_OPPOSES_DIRECTION':null,
  sign(contextBias)&&sign(contextBias)!==direction?'HIGHER_TIMEFRAME_OPPOSES_DIRECTION':null,
  Math.abs(indexValue-one.last)>Math.max(3,4*one.sd)?
    'KRAKEN_OFFICIAL_INDEX_BASIS_WIDE':null
 ].filter(Boolean);
 const families=[geometry,momentum,contextBias].filter(x=>sign(x)===direction&&Math.abs(x)>=.15).length;
 return {delta,expectedMove,normalizedDistance,geometry,momentum,
  contextBias,combined,side,contradictions,families};
}
export function evaluateSettlementFirst({market,index,one,five,context,book,now=Date.now()}={}){
 if(!market||!tickerOk(market.ticker))return watch('ACTUAL_KALSHI_MARKET_MISSING');
 const closeAt=Date.parse(market.close_time),target=numeric(market.floor_strike);
 if(!Number.isFinite(closeAt)||target===null||target<=0)
  return watch('OFFICIAL_TARGET_OR_CLOSING_TIME_MISSING');
 const remainingSeconds=(closeAt-now)/1000;
 const remainingMinutes=remainingSeconds/60;
 if(!Number.isFinite(remainingSeconds)||remainingSeconds<=90||remainingSeconds>750)
  return watch('OUTSIDE_EARLY_PAPER_ENTRY_WINDOW',{remainingSeconds});
 if(index?.indexId!=='ETHUSD_RTI'||index.validValuesVerified!==true||
    !Number.isSafeInteger(index.sourceAt)||!Number.isFinite(index.price)||
    index.price<=0||index.sourceAt>now+3000||now-index.sourceAt>15000)
  return watch('FRESH_OFFICIAL_ETHUSD_RTI_REQUIRED',{remainingSeconds,target});
 if(!one||!five||!context?.three||!context?.five||
    ![one.sd,one.last,one.e8,one.e21,one.rNow,one.mNow,
      one.sNow,one.three,five.rsi,five.e21,five.e50].every(Number.isFinite)||
    one.sd<=0||
    !['UP','DOWN','NEUTRAL'].includes(context.three.trend)||
    !['UP','DOWN','NEUTRAL'].includes(context.five.trend))
  return watch('COMPLETE_CLOSED_1M_3M_5M_INDICATORS_REQUIRED',{remainingSeconds,target});
 if(book?.source!=='KALSHI_WEBSOCKET_ORDERBOOK'||book.ticker!==market.ticker||
    book.valid!==true||book.fresh!==true||book.crossed===true||
    !Number.isSafeInteger(book.receivedAt)||now-book.receivedAt>5000||
    now<book.receivedAt-1000)
  return watch('FRESH_AUTHENTICATED_KALSHI_BOOK_REQUIRED',{remainingSeconds,target});
 const computed=calculateSettlementEvidence({target,indexValue:index.price,
  one,five,context,remainingSeconds});
 if(!computed)return watch('COMPLETE_CONTEXT_REQUIRED');
 const {delta,expectedMove,normalizedDistance,geometry,momentum,contextBias,
  combined,side,contradictions,families}=computed;
 const observedPrice={UP:{ask:book.yesAsk,bid:book.yesBid},
  DOWN:{ask:book.noAsk,bid:book.noBid}}[side];
 const ask=numeric(observedPrice.ask?.price),bid=numeric(observedPrice.bid?.price);
 const askDepth=numeric(observedPrice.ask?.sizeFp),bidDepth=numeric(observedPrice.bid?.sizeFp);
 const priceSpread=ask!==null&&bid!==null?ask-bid:null;
 const minimumScore=ask!==null&&ask>=.85?.78:ask!==null&&ask>=.65?.62:.43;
 const minimumFamilies=2;
 const insight={target,indexValue:index.price,indexSourceAt:index.sourceAt,
  officialDistance:delta,normalizedDistance,expectedMove,remainingSeconds,
  geometry:Number(geometry.toFixed(5)),momentum:Number(momentum.toFixed(5)),
  structure:Number(contextBias.toFixed(5)),score:Number(combined.toFixed(5)),
  scoreKind:'NON_CALIBRATED_HEURISTIC',familySupport:families,
  contradictionReasons:contradictions,ask,bid,askDepth,bidDepth,
  spread:priceSpread,bookReceiptAt:book.receivedAt};
 // A hard ceiling is independent of model strength, time or confidence.
 if(ask!==null&&ask>MAX_PAPER_ENTRY_ASK)
  return watch('PRICE_ABOVE_85C_HARD_BUY_LIMIT',{...insight,candidateSide:side});
 if(Math.abs(combined)<minimumScore||families<minimumFamilies)
  return watch('WEAK_OR_CONTRADICTED_SETTLEMENT_SIDE_EVIDENCE',
   {...insight,candidateSide:side});
 if(ask===null||bid===null||ask<=0||ask>MAX_PAPER_ENTRY_ASK||bid<0||bid>ask||
   priceSpread===null||priceSpread>.05||
   askDepth===null||askDepth<1||bidDepth===null)
  return watch('KALSHI_ASK_SPREAD_OR_DISPLAYED_DEPTH_UNSUITABLE',
   {...insight,candidateSide:side});
 if(ask>=.85&&remainingMinutes>5)
  return watch('EXPENSIVE_CONTRACT_TOO_EARLY',{...insight,candidateSide:side});
 return {version:SETTLEMENT_FIRST_VERSION,status:'CANDIDATE',side,reason:
  'Official index/target geometry with independent momentum and 3m/5m context',
  ...insight,calibratedProbability:null,settlementPredictionVerified:false,
  executionVerified:false,entryBudgetIncludesFees:true};
}
