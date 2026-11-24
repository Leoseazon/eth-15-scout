/* CANDIDATE ONLY: signal-confirmed early PAPER exit research.
 * Fail closed on missing/stale inputs. Never generates a real order.
 * The caller must explicitly enable this experimental rule.
 * Uses already-obtained closed Kraken structure, official Kalshi ETHUSD_RTI
 * and fresh authenticated Kalshi WebSocket book; ZERO additional requests.
 */
export const CONFIRMED_EARLY_EXIT_VERSION='V4-CONFIRMED-ADVERSE-EXIT-20261124-CANDIDATE';
const valid=Number.isFinite;
const clear=reason=>({status:'NO_EXIT',reason,next:null});
export function evaluateConfirmedEarlyExit({
 position,index,one,five,context,book,bid,now=Date.now(),
 previous=null,stopLossArmedMinutes=6
}={}){
 if(!position||!['UP','DOWN'].includes(position.side)||
  !valid(position.entry)||position.entry<=0||position.entry>=1||
  !valid(position.target)||position.target<=0||
  !Number.isSafeInteger(position.time)||!valid(bid)||bid<=0||bid>=1||
  !Number.isSafeInteger(now))
  return clear('INVALID_POSITION_OR_PRICE');
 const closeAt=Date.parse(position.closeTime);
 const remaining=(closeAt-now)/60000;
 if(!valid(remaining)||remaining<=stopLossArmedMinutes||
  !valid(position.time)||now-position.time<15000)
  return clear('EARLY_CONFIRMATION_WINDOW_NOT_ELIGIBLE');
 if((position.entry-bid)/position.entry<.40)
  return clear('LOSS_NOT_CONFIRMED_AT_40_PERCENT');
 if(book?.ticker!==position.ticker||
  book?.source!=='KALSHI_WEBSOCKET_ORDERBOOK'||
  book.valid!==true||book.fresh!==true||book.crossed===true||
  !Number.isSafeInteger(book.receivedAt)||book.receivedAt>now||
  now-book.receivedAt>5000)
  return clear('KALSHI_WS_BOOK_NOT_FRESH');
 const selected=position.side==='UP'?
  {ask:book.yesAsk,bid:book.yesBid}:
  {ask:book.noAsk,bid:book.noBid};
 const ask=Number(selected.ask?.price);
 if(!valid(ask)||ask<bid||ask>1||ask-bid>.08)
  return clear('WIDE_OR_INVALID_LIVE_SPREAD');
 if(index?.indexId!=='ETHUSD_RTI'||index.validValuesVerified!==true||
  !valid(index.price)||index.price<=0||
  !Number.isSafeInteger(index.sourceAt)||
  index.sourceAt>now||now-index.sourceAt>15000)
  return clear('OFFICIAL_INDEX_NOT_FRESH');
 if(!one||!five||!context?.three||!context?.five||
  ![one.sd,one.last,one.e21,one.rNow,one.mNow,one.sNow,
    five.rsi,five.e21,five.e50].every(valid)||
  one.sd<=0||
  !['UP','DOWN','NEUTRAL'].includes(context.three.trend)||
  !['UP','DOWN','NEUTRAL'].includes(context.five.trend))
  return clear('CLOSED_KRAKEN_STRUCTURE_NOT_AVAILABLE');
 // A reverse RTI gap PLUS closed 3m structure PLUS adverse 1m momentum.
 // The 5m trend cannot be affirmatively supporting the original side.
 const direction=position.side==='UP'?1:-1;
 const adverseIndex=(index.price-position.target)*direction<
  -Math.max(.30,.25*one.sd);
 const adverse3m=context.three.trend===(position.side==='UP'?'DOWN':'UP');
 const adverse5m=context.five.trend!==position.side;
 const adverse1m=position.side==='UP'?
  (one.last<one.e21&&one.rNow<48&&one.mNow<one.sNow):
  (one.last>one.e21&&one.rNow>52&&one.mNow>one.sNow);
 if(!adverseIndex||!adverse3m||!adverse5m||!adverse1m)
  return clear('INDEPENDENT_ADVERSE_SIGNALS_NOT_ALIGNED');
 const observation={ticker:position.ticker,side:position.side,
  firstAt:now,bookAt:book.receivedAt,indexAt:index.sourceAt};
 // Never count a replayed book or index observation twice.
 if(previous?.ticker===observation.ticker&&
  previous?.side===observation.side&&
  Number.isSafeInteger(previous.firstAt)&&
  now-previous.firstAt>=15000&&now-previous.firstAt<=90000&&
  book.receivedAt>previous.bookAt&&index.sourceAt>previous.indexAt){
  return {status:'CONFIRMED',
   reason:'EARLY_40_PERCENT_LOSS_AND_INDEPENDENT_ADVERSE_SIGNAL_CONFIRMATION',
   next:null,version:CONFIRMED_EARLY_EXIT_VERSION};
 }
 // The first event is not a SELL. Require a genuinely new pair of fresh
 // price/evidence observations, observed at least 15 seconds apart.
 if(previous?.ticker===observation.ticker&&
  previous?.side===observation.side&&
  Number.isSafeInteger(previous.firstAt)&&
  now-previous.firstAt<15000&&
  now-previous.firstAt>=0)
  return {status:'TRACKING',reason:'SECOND_DISTINCT_OBSERVATION_REQUIRED',
   next:previous,version:CONFIRMED_EARLY_EXIT_VERSION};
 return {status:'TRACKING',reason:'FIRST_ADVERSE_OBSERVATION',
  next:observation,version:CONFIRMED_EARLY_EXIT_VERSION};
}
