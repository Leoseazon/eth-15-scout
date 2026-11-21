/* PHASE 1 — independent Kalshi exit-quote and Kraken indicator-feed health.
 * Pure, paper-only diagnostics. No credentials, live orders or broker access.
 * One failed Kraken request MUST NOT discard a valid Kalshi market response.
 */
export const FEED_KEYS=Object.freeze(['kalshi','krakenTicker','kraken5m','kraken1m']);

const clean=reason=>String(reason?.message||reason||'Unknown provider error')
  .replace(/[\r\n\t]+/g,' ').slice(0,160);

export function inspectFeedResults(settled,at=Date.now()){
 const payloads={};const checks={};const failures=[];
 for(let i=0;i<FEED_KEYS.length;i++){
   const source=FEED_KEYS[i],result=settled?.[i];
   let reason=null;
   if(!result)reason='Provider response missing';
   else if(result.status==='rejected')reason=clean(result.reason);
   else if(result.status!=='fulfilled')reason='Invalid provider response state';
   else if(!result.value||typeof result.value!=='object')reason='Provider payload missing';
   else if(Array.isArray(result.value.error)&&result.value.error.length)
     reason='Provider API: '+clean(result.value.error[0]);
   else payloads[source]=result.value;
   checks[source]={ok:!reason,checkedAt:at,...(reason?{error:reason}:{})};
   if(reason)failures.push(source+': '+reason);
 }
 return {payloads,checks,failures};
}

export async function collectMarketFeeds(fetcher,marketUrl,krakenApiBase,at=Date.now()){
 if(typeof fetcher!=='function')throw TypeError('A market fetcher is required');
 const urls=[
   marketUrl,
   krakenApiBase+'Ticker?pair=ETHUSD',
   krakenApiBase+'OHLC?pair=ETHUSD&interval=5',
   krakenApiBase+'OHLC?pair=ETHUSD&interval=1'
 ];
 // Promise wrappers also capture synchronous fetcher failures as rejected results.
 const settled=await Promise.allSettled(urls.map(url=>Promise.resolve().then(()=>fetcher(url))));
 return inspectFeedResults(settled,at);
}

export function validateKalshiSnapshot(snapshot,at=Date.now(),maxAgeMs=90000){
 const ts=Date.parse(snapshot?.worker_retrieved_at);
 if(!Number.isFinite(ts))return {ok:false,retrievedAt:null,ageMs:null,
   reason:'Kalshi quote missing a valid retrieval timestamp'};
 const ageMs=at-ts;
 if(!Number.isFinite(ageMs)||ageMs< -5000||ageMs>maxAgeMs)
   return {ok:false,retrievedAt:ts,ageMs,
     reason:'Kalshi quote timestamp outside verified freshness window'};
 return {ok:true,retrievedAt:ts,ageMs};
}
