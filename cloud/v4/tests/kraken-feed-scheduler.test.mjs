import test from 'node:test';
import assert from 'node:assert/strict';
import {collectThrottledMarketFeeds,currentClosedFiveMinuteCandle,
 FIVE_CACHE_MAX_AGE_MS,KRAKEN_OHLC_SPACING_MS,
 FIVE_RATE_LIMIT_BACKOFF_MS,ONE_RATE_LIMIT_BACKOFF_MS} from '../src/kraken-feed-scheduler.js';

const T=Date.parse('2026-11-22T09:36:20.000Z');
const base='https://api.kraken.com/0/public/';
const marketUrl='https://market.example.test/markets';
function five(at,{old=false}={}){
 const window=Math.floor(at/300000)*300000;
 const latestClosed=window-300000-(old?300000:0);
 const candles=Array.from({length:75},(_,i)=>{
  const sec=(latestClosed-(73-i)*300000)/1000;
  return [sec,'1700','1710','1690','1704','1703','100',1];
 });
 return {error:[],result:{XETHZUSD:candles}};
}
const one={error:[],result:{XETHZUSD:[[T/1000,'1700','1710','1690','1704','1703','100',1]]}};
const ticker={error:[],result:{XETHZUSD:{c:['1705']}}};
const market={markets:[],worker_retrieved_at:new Date(T).toISOString()};
function makeFetcher({limit5=false,limit1=false,fiveAt=T,old5=false}={}){
 const calls=[];
 const fetcher=async url=>{
  calls.push(url);
  if(url===marketUrl)return market;
  if(url.includes('Ticker?'))return ticker;
  if(url.includes('interval=1'))return limit1?
   {error:['EGeneral:Too many requests']}:one;
  if(url.includes('interval=5'))return limit5?
   {error:['EGeneral:Too many requests']}:five(fiveAt,{old:old5});
  throw Error('Unrecognized URL: '+url);
 };
 return {calls,fetcher};
}
const count=(a,x)=>a.filter(s=>s.includes(x)).length;
const noWait=async ms=>assert.equal(ms,KRAKEN_OHLC_SPACING_MS);

test('stagger 1m and 5m requests, preserving independent Kalshi and ticker results',async()=>{
 const state={},trace=[];
 const {fetcher}=makeFetcher();
 const result=await collectThrottledMarketFeeds(async url=>{
  trace.push('request '+url);
  return fetcher(url);
 },marketUrl,base,T,{state,wait:async ms=>{
  assert.equal(ms,1200);
  assert.ok(trace.some(s=>s.includes('interval=1')));
  assert.ok(!trace.some(s=>s.includes('interval=5')));
  trace.push('wait');
 }});
 assert.equal(result.checks.kalshi.ok,true);
 assert.equal(result.checks.krakenTicker.ok,true);
 assert.equal(result.checks.kraken1m.ok,true);
 assert.equal(result.checks.kraken5m.ok,true);
 assert.ok(trace.indexOf('wait')<trace.findIndex(s=>s.includes('interval=5')));
 assert.ok(state.five&&state.five.at===T);
 assert.equal(result.checks.kraken5m.cached,false);
});

test('unchanged 5m data is reused under a strict 60s TTL; 1m remains live every tick',async()=>{
 const state={},provider=makeFetcher();
 const first=await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,T,
  {state,wait:noWait});
 assert.equal(first.checks.kraken5m.cached,false);
 for(const elapsed of [15000,30000,45000]){
  const result=await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,T+elapsed,
   {state,wait:noWait});
  assert.equal(result.checks.kraken5m.cached,true);
  assert.equal(result.checks.kraken5m.sourceRetrievedAt,T);
 }
 assert.equal(count(provider.calls,'interval=5'),1);
 assert.equal(count(provider.calls,'interval=1'),4);
 const after=await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,
  T+FIVE_CACHE_MAX_AGE_MS,{state,wait:noWait});
 assert.equal(after.checks.kraken5m.cached,false);
 assert.equal(count(provider.calls,'interval=5'),2);
});

test('five-minute rollover invalidates earlier bars even if cache TTL not expired',async()=>{
 const state={},source=makeFetcher();
 await collectThrottledMarketFeeds(source.fetcher,marketUrl,base,T,
  {state,wait:noWait});
 const rollover=Date.parse('2026-11-22T09:40:08.000Z');
 // Force a recent but obsolete cache to probe the candle-boundary guard.
 state.five.at=rollover-15000;
 assert.equal(currentClosedFiveMinuteCandle(state.five.value,
  Date.parse('2026-11-22T09:40:00.000Z')),false,
  'a new five-minute close invalidates old bars immediately, without grace');
 assert.equal(currentClosedFiveMinuteCandle(state.five.value,rollover),false);
 let roundCalls=0;
 const latest=await collectThrottledMarketFeeds(async url=>{
  if(url.includes('interval=5')){roundCalls++;return five(rollover)}
  return source.fetcher(url);
 },marketUrl,base,rollover,{state,wait:noWait});
 assert.equal(roundCalls,1);
 assert.equal(latest.checks.kraken5m.ok,true);
 assert.equal(latest.checks.kraken5m.cached,false);
 assert.equal(currentClosedFiveMinuteCandle(state.five.value,rollover),true);
});

test('provider does not offer newly closed 5m candle: fail closed, never cache stale data',async()=>{
 const state={},timestamp=Date.parse('2026-11-22T09:40:10Z');
 const provider=makeFetcher({fiveAt:timestamp,old5:true});
 const response=await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,
  timestamp,{state,wait:noWait});
 assert.equal(response.checks.kalshi.ok,true);
 assert.equal(response.checks.kraken1m.ok,true);
 assert.equal(response.checks.kraken5m.ok,false);
 assert.equal(response.payloads.kraken5m,undefined);
 assert.equal(state.five,null);
 const next=await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,
  timestamp+7000,{state,wait:noWait});
 assert.equal(next.checks.kraken5m.ok,false,'minimum retry interval enforced');
 assert.equal(count(provider.calls,'interval=5'),1);
});

test('5m 429 clears cache, backs off and never authorizes entries from old bars',async()=>{
 const state={},provider=makeFetcher();
 await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,T,
  {state,wait:noWait});
 const at=T+FIVE_CACHE_MAX_AGE_MS;
 const failing=makeFetcher({limit5:true});
 const refused=await collectThrottledMarketFeeds(failing.fetcher,marketUrl,base,at,
  {state,wait:noWait});
 assert.equal(refused.checks.kraken5m.ok,false);
 assert.match(refused.failures.join(' '),/too many requests/i);
 assert.equal(state.five,null);
 assert.equal(state.fiveBackoffUntil,at+FIVE_RATE_LIMIT_BACKOFF_MS);
 const until=await collectThrottledMarketFeeds(failing.fetcher,marketUrl,base,at+15000,
  {state,wait:noWait});
 assert.equal(until.checks.kraken5m.ok,false);
 assert.match(until.failures.join(' '),/cooldown/i);
 assert.equal(count(failing.calls,'interval=5'),1,'no rapid 5m retry');
 const recovered=makeFetcher({fiveAt:at+FIVE_RATE_LIMIT_BACKOFF_MS});
 const result=await collectThrottledMarketFeeds(recovered.fetcher,marketUrl,base,
  at+FIVE_RATE_LIMIT_BACKOFF_MS,{state,wait:noWait});
 assert.equal(result.checks.kraken5m.ok,true);
});

test('1m rate limit also causes a bounded cooldown, without reusing stale 1m data',async()=>{
 const state={},bad=makeFetcher({limit1:true});
 const first=await collectThrottledMarketFeeds(bad.fetcher,marketUrl,base,T,
  {state,wait:noWait});
 assert.equal(first.checks.kraken1m.ok,false);
 assert.equal(state.oneBackoffUntil,T+ONE_RATE_LIMIT_BACKOFF_MS);
 const next=await collectThrottledMarketFeeds(bad.fetcher,marketUrl,base,T+15000,
  {state,wait:noWait});
 assert.equal(next.checks.kraken1m.ok,false);
 assert.equal(next.payloads.kraken1m,undefined);
 assert.equal(count(bad.calls,'interval=1'),1,'1m not requested while cooling down');
 const ok=makeFetcher({fiveAt:T+ONE_RATE_LIMIT_BACKOFF_MS});
 const restored=await collectThrottledMarketFeeds(ok.fetcher,marketUrl,base,
  T+ONE_RATE_LIMIT_BACKOFF_MS,{state,wait:noWait});
 assert.equal(restored.checks.kraken1m.ok,true);
});

test('malformed cache, future timestamps and warm-restart loss cannot become fresh feeds',async()=>{
 const state={five:{at:T+99999,value:five(T)}},provider=makeFetcher();
 const recovered=await collectThrottledMarketFeeds(provider.fetcher,marketUrl,base,T,
  {state,wait:noWait});
 assert.equal(recovered.checks.kraken5m.cached,false);
 assert.equal(recovered.checks.kraken5m.ok,true);
 assert.equal(currentClosedFiveMinuteCandle({result:{}},T),false);
 assert.equal(currentClosedFiveMinuteCandle(five(T),T+15*60000),false);
 const cold=makeFetcher();
 const coldState={};
 await collectThrottledMarketFeeds(cold.fetcher,marketUrl,base,T,
  {state:coldState,wait:noWait});
 assert.equal(count(cold.calls,'interval=5'),1,'DO restart refetches provider');
});
