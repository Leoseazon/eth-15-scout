/* V4 PAPER-ONLY Kraken feed reliability. No trading, market or risk decisions.
 * Keep the 15s paper engine heartbeat. Cache unchanged COMPLETED 1m and 5m
 * Kraken candles in volatile DO memory only (no database writes).
 * every use is checked against both retrieval age and the most recently closed
 * 5m candle. If source freshness cannot be verified, return missing feed.
 */
import {inspectFeedResults} from './feed-health.js';

// Closed 5m OHLC cannot add a new completed bar before the next 5m boundary.
// Revalidate exact latest-closed 5m candle on EVERY reuse; even a fresh TTL
// must not authorize a stale bar at rollover. Avoid needless minute refreshes.
export const FIVE_CACHE_MAX_AGE_MS=300000;
// Reuse a confirmed *completed* one-minute candle only within the SAME bar.
export const ONE_CACHE_MAX_AGE_MS=55000;
export const FIVE_REFRESH_MIN_GAP_MS=15000;
export const KRAKEN_OHLC_SPACING_MS=1200;
export const FIVE_RATE_LIMIT_BACKOFF_MS=120000;
export const ONE_RATE_LIMIT_BACKOFF_MS=60000;
const CANDLE_FIVE_MS=300000;
// Never assume a just-finished 5m bar is present: fail closed immediately
// at its boundary until Kraken actually reports that bar as completed.
const CANDLE_CLOSE_GRACE_MS=0;
const delayBy=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rateLimited=value=>{
 const detail=Array.isArray(value?.error)?value.error.join(' '):
   String(value?.message||value||'');
 return /too many requests|rate.?limit|\b429\b/i.test(detail);
};
const success=value=>value&&typeof value==='object'&&
 (!Array.isArray(value.error)||value.error.length===0);
const rows=value=>Object.values(value?.result||{}).find(Array.isArray);
export function currentClosedFiveMinuteCandle(value,at){
 if(!success(value)||!Number.isFinite(at))return false;
 const data=rows(value);
 // Preserve the original indicator history; the last API bar is still forming.
 if(!Array.isArray(data)||data.length<60)return false;
 const opened=Number(data[data.length-2]?.[0])*1000;
 if(!Number.isFinite(opened)||opened<=0||opened>at-CANDLE_FIVE_MS+CANDLE_CLOSE_GRACE_MS)
  return false;
 // The latest closed candle must be present, allowing 5s for exchange rollover.
 const expected=Math.floor((at-CANDLE_CLOSE_GRACE_MS)/CANDLE_FIVE_MS)*
   CANDLE_FIVE_MS-CANDLE_FIVE_MS;
 return opened>=expected;
}
// A cached 1m reply may be used only while it contains the latest closed
// 1m candle for *this* tick. The still-forming last Kraken bar is excluded.
// Never extend freshness across a new minute boundary or a DO restart.
export function currentClosedOneMinuteCandle(value,at){
 if(!success(value)||!Number.isFinite(at))return false;
 const data=rows(value);
 if(!Array.isArray(data)||data.length<60)return false;
 const opened=Number(data[data.length-2]?.[0])*1000;
 if(!Number.isFinite(opened)||opened<=0||opened>at)return false;
 const expected=Math.floor(at/60000)*60000-60000;
 return opened===expected;
}
const captured=async task=>{
 try{return {status:'fulfilled',value:await task()}}
 catch(reason){return {status:'rejected',reason}}
};
// Uses a mutable, volatile, V4-only state object. Its loss on a DO restart
// causes a fresh provider fetch rather than reuse of unverified old candles.
export async function collectThrottledMarketFeeds(fetcher,marketUrl,krakenBase,
 at=Date.now(),{state,wait=delayBy}={}){
 if(typeof fetcher!=='function'||typeof wait!=='function'||
   !state||typeof state!=='object'||!Number.isFinite(at))
  throw TypeError('V4 Kraken source scheduler requires fetcher, state and time');
 const marketTask=captured(()=>fetcher(marketUrl));
 const tickerTask=captured(()=>fetcher(krakenBase+'Ticker?pair=ETHUSD'));
 let reusedOne=false;
 const oneTask=captured(async()=>{
  if(at<(state.oneBackoffUntil||0))
   throw Error('Kraken 1m rate-limit cooldown; no fresh candle available');
  const old=state.one;
  if(old&&Number.isFinite(old.at)&&at>=old.at&&
     at-old.at<ONE_CACHE_MAX_AGE_MS&&
     currentClosedOneMinuteCandle(old.value,at)){
   reusedOne=true;
   return old.value;
  }
  state.one=null;
  try{
   const value=await fetcher(krakenBase+'OHLC?pair=ETHUSD&interval=1');
   if(rateLimited(value)){
    state.oneBackoffUntil=at+ONE_RATE_LIMIT_BACKOFF_MS;
    return value;
   }
   if(!currentClosedOneMinuteCandle(value,at))
    throw Error('Kraken 1m latest closed candle unavailable or invalid');
   state.one={at,value};
   return value;
  }catch(e){
   if(rateLimited(e))state.oneBackoffUntil=at+ONE_RATE_LIMIT_BACKOFF_MS;
   throw e;
  }
 });
 let reusedFive=false;
 const fiveTask=captured(async()=>{
  if(at<(state.fiveBackoffUntil||0))
   throw Error('Kraken 5m rate-limit cooldown; no fresh candle available');
  const old=state.five;
  if(old&&Number.isFinite(old.at)&&at>=old.at&&
     at-old.at<FIVE_CACHE_MAX_AGE_MS&&
     currentClosedFiveMinuteCandle(old.value,at)){
   reusedFive=true;
   return old.value;
  }
  if(Number.isFinite(state.lastFiveAttemptAt)&&
     at-state.lastFiveAttemptAt<FIVE_REFRESH_MIN_GAP_MS)
   throw Error('Kraken 5m refresh guarded; awaiting a new valid candle');
  state.lastFiveAttemptAt=at;
  // Stagger the 5m HTTP request start after the 1m request starts;
  // other independent requests run simultaneously. Do not slow exits.
  await wait(KRAKEN_OHLC_SPACING_MS);
  let value;
  try{
   value=await fetcher(krakenBase+'OHLC?pair=ETHUSD&interval=5');
  }catch(e){
   state.five=null;
   if(rateLimited(e))state.fiveBackoffUntil=at+FIVE_RATE_LIMIT_BACKOFF_MS;
   throw e;
  }
  if(rateLimited(value)){
   state.five=null;
   state.fiveBackoffUntil=at+FIVE_RATE_LIMIT_BACKOFF_MS;
   return value; // InspectFeedResults reports provider error, never usable.
  }
  if(!currentClosedFiveMinuteCandle(value,at)){
   state.five=null;
   throw Error('Kraken 5m latest closed candle unavailable or invalid');
  }
  state.five={at,value};
  return value;
 });
 const results=await Promise.all([marketTask,tickerTask,fiveTask,oneTask]);
 const response=inspectFeedResults(results,at);
 response.checks.kraken1m.cached=reusedOne;
 response.checks.kraken1m.sourceRetrievedAt=
  reusedOne?state.one?.at??null:
  response.checks.kraken1m.ok?at:null;
 response.checks.kraken5m.cached=reusedFive;
 response.checks.kraken5m.sourceRetrievedAt=
  reusedFive?state.five?.at??null:
  response.checks.kraken5m.ok?at:null;
 return response;
}
