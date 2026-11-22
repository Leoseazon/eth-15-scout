/* V4 offline-only stop-out audit for complete research JSON exports.
 * Evaluates observed quotes AFTER exit. NEVER claims a fill, profit or
 * executable recovery and NEVER changes trading decisions.
 */
(function(root){
'use strict';
const horizons=[30,60,120];
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const tickerRe=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
function stopped(t){
 return t&&typeof t.reason==='string'&&/40%|−40%/.test(t.reason)&&
  valid(t.exitAt)&&['UP','DOWN'].includes(t.side)&&tickerRe.test(t.ticker||'');
}
function analyzeStopHistory(trades,quotes,windows=[]){
 if(!Array.isArray(trades)||!Array.isArray(quotes)||!Array.isArray(windows))
  throw new TypeError('Invalid stopped-trade research arrays');
 const byTicker=new Map();
 for(const raw of quotes){
  if(!tickerRe.test(raw?.ticker||'')||!valid(raw.observed_at))continue;
  const list=byTicker.get(raw.ticker)||[];
  list.push(raw);byTicker.set(raw.ticker,list);
 }
 for(const list of byTicker.values())list.sort((a,b)=>a.observed_at-b.observed_at);
 const results=[],settlements=new Map(windows.filter(w=>tickerRe.test(w?.ticker||''))
  .map(w=>[w.ticker,w]));
 for(const trade of trades.filter(stopped)){
  const seq=byTicker.get(trade.ticker)||[];
  const entry=valid(trade.entry)?trade.entry:null;
  const exitBid=valid(trade.exitPrice)?trade.exitPrice:null;
  const window=settlements.get(trade.ticker);
  const outcome=window?.status==='OFFICIAL_RESULT'?
   (window.outcome==='UP'||window.outcome==='DOWN'?window.outcome:null):null;
  const closeAt=valid(window?.closeAt)?window.closeAt:
    (trade.closeTime?Date.parse(trade.closeTime):NaN);
  const observation={ticker:trade.ticker,side:trade.side,exitAt:trade.exitAt,
   entry,exitBid,cost:valid(trade.cost)?trade.cost:null,
   netRealizedPnl:valid(trade.pnl)?trade.pnl:null,
   exitSecondsRemaining:valid(trade.remainingSecondsAtExit)?
    trade.remainingSecondsAtExit:null,
   officialOutcome:outcome,
   settlementDirectionCorrect:outcome?outcome===trade.side:null,
   recoveredToEntryObserved:false,postExitQuotesFound:0,
   horizons:[]};
  for(const seconds of horizons){
   const target=trade.exitAt+seconds*1000;
   let result={seconds,status:'UNAVAILABLE',bid:null,observedAt:null,
     deltaFromExitCents:null,reachedEntryPrice:null,
     verifiedFill:false,quoteSource:'Kalshi REST proxy (possibly cached)'};
   if(valid(closeAt)&&target>=closeAt)result.status='CONTRACT_EXPIRED';
   else{
    const field=trade.side==='UP'?'yes_bid':'no_bid';
    // First observation after the horizon, no later than +20s.
    // Do NOT interpolate or reuse a preceding quote.
    const q=seq.find(x=>x.observed_at>=target &&
      x.observed_at<=target+20000 &&(!valid(closeAt)||x.observed_at<closeAt)&&
      valid(x[field])&&x[field]>=0&&x[field]<=1);
    if(q){
     const bid=q[field];result={...result,
       status:'OBSERVED_REST_UNVERIFIED_EXECUTION',bid,observedAt:q.observed_at,
       deltaFromExitCents:exitBid===null?null:Math.round((bid-exitBid)*10000)/100,
       reachedEntryPrice:entry===null?null:bid>=entry};
     observation.postExitQuotesFound++;
     if(result.reachedEntryPrice===true)observation.recoveredToEntryObserved=true;
    }
   }
   observation.horizons.push(result);
  }
  results.push(observation);
 }
 results.sort((a,b)=>b.exitAt-a.exitAt);
 const losses=results.filter(x=>valid(x.netRealizedPnl)&&x.netRealizedPnl<0);
 const netStopPnl=results.reduce((s,r)=>s+(valid(r.netRealizedPnl)?r.netRealizedPnl:0),0);
 return {version:1,source:'POST-EXIT_OBSERVATIONS_NOT_EXECUTIONS',
  horizonsSeconds:horizons,stoppedTrades:results.length,
  realizedStopNetPnl:Number(netStopPnl.toFixed(2)),
  realizedLosingStops:losses.length,
  observedQuoteRecoveries:results.filter(x=>x.recoveredToEntryObserved).length,
  noObservedRecoveryProvesOutcome:false,
  officialDirectionCorrectCount:results.filter(x=>x.settlementDirectionCorrect===true).length,
  stops:results,
  warnings:[
   'A later winning settlement does not prove a profitable resale was executable.',
   'An observed later bid is not proof of a sell fill, depth or fees.',
   'Historical REST quotes may be cached, sparse or stale.',
   'If a 30/60/120-second observation is missing, outcome is UNAVAILABLE, never assumed.'
  ]};
}
root.ScoutStopAudit=Object.freeze({analyzeStopHistory});
})(globalThis);
