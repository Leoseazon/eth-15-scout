/* Public KXETH15M historical outcome coverage audit.
 * NO trading/account APIs; NO persistence of raw licensed market records.
 * Returns aggregated counts only. One bounded CLI run for research availability.
 */
export const DAY=86400000;
export const API='https://external-api.kalshi.com/trade-api/v2';
const ETH=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const num=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const stamp=x=>{const t=Date.parse(x||'');return Number.isFinite(t)?t:null};
export function classifyHistoricalMarket(m,startAt,endAt){
 const closeAt=stamp(m?.close_time);
 if(!ETH.test(m?.ticker||'')||closeAt===null||closeAt<startAt||closeAt>=endAt)return null;
 const openAt=stamp(m.open_time),strike=num(m.floor_strike);
 const status=String(m.status||'').toLowerCase();
 const finalized=status==='finalized'&&m.is_provisional!==true;
 const result=finalized&&['yes','no'].includes(m.result)?m.result:null;
 return {ticker:m.ticker,closeAt,openAt,strike,hasTarget:strike!==null&&strike>0,
  result,resultKnown:!!result,rulePresent:typeof m.rules_primary==='string'&&m.rules_primary.length>0,
  status,explicitlyProvisional:m.is_provisional===true,expValue:num(m.expiration_value),
  hasExpirationValue:num(m.expiration_value)!==null};
}
const zero=()=>({markets:0,unique:0,finalized:0,up:0,down:0,
 targetPresent:0,missingTargets:0,rulesPresent:0,expirationValuePresent:0,
 pendingOrUnusable:0,duplicateTickers:0,provisional:0,earliestAt:null,latestAt:null});
export function summarizeMarkets(rows,{startAt,endAt}){
 const out=zero(),seen=new Map();
 for(const m of rows||[]){
  const r=classifyHistoricalMarket(m,startAt,endAt);
  if(!r)continue;out.markets++;
  const prior=seen.get(r.ticker);
  if(prior){
   out.duplicateTickers++;
   // Prefer finalized truth to a provisional/live snapshot, never double count.
   if(!prior.resultKnown&&r.resultKnown)seen.set(r.ticker,r);
  }else seen.set(r.ticker,r);
 }
 out.unique=seen.size;
 for(const r of seen.values()){
  if(r.resultKnown){out.finalized++;out[r.result==='yes'?'up':'down']++}
  else out.pendingOrUnusable++;
  if(r.hasTarget)out.targetPresent++;else out.missingTargets++;
  if(r.rulePresent)out.rulesPresent++;
  if(r.hasExpirationValue)out.expirationValuePresent++;
  if(r.explicitlyProvisional)out.provisional++;
  out.earliestAt=out.earliestAt===null?r.closeAt:Math.min(out.earliestAt,r.closeAt);
  out.latestAt=out.latestAt===null?r.closeAt:Math.max(out.latestAt,r.closeAt);
 }
 return out;
}
export async function fetchJson(url,{fetcher=fetch,timeoutMs=12000}={}){
 const r=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},
  signal:AbortSignal.timeout(timeoutMs)});
 if(!r.ok)throw Error('KALSHI_PUBLIC_HTTP_'+r.status);
 const len=r.headers?.get?.('content-length');
 if(len&&Number(len)>10_000_000)throw Error('RESPONSE_EXCEEDS_BOUND');
 return await r.json();
}
export async function auditHistorical90Days({fetcher=fetch,now=Date.now(),
 days=90,maxPages=32,maxRecords=32000}={}){
 if(!Number.isInteger(days)||days<1||days>90||maxPages<1||maxPages>40)
  throw TypeError('Out of range audit settings');
 const startAt=now-days*DAY,errors=[],rows=[],tiers=[];
 let cutoff=null;
 try{
  const c=await fetchJson(API+'/historical/cutoff',{fetcher});
  cutoff=stamp(c.market_settled_ts);
 }catch(e){errors.push('CUTOFF:'+String(e.message||e).slice(0,70))}
 // Historical markets have cursor pagination but no date filter documented.
 // Bound requests and stop only AFTER the API proves oldest-first coverage;
 // no assumption that a page is ordered. Use upper page cap and report truncation.
 for(const [tier,endpoint] of [
  ['historical','/historical/markets?series_ticker=KXETH15M&limit=1000'],
  ['live','/markets?series_ticker=KXETH15M&status=settled&mve_filter=exclude&limit=1000']
 ]){
  let cursor='',pages=0,fetched=0,stoppedByCap=false,complete=false;
  let observedDescending=true,previousMinClose=null,timeBoundaryReached=false;
  const cursorSeen=new Set();
  while(pages<maxPages&&rows.length<maxRecords){
   const url=new URL(API+endpoint);
   if(cursor)url.searchParams.set('cursor',cursor);
   let response,requestError=null;
   for(let attempt=0;attempt<3;attempt++){
    try{response=await fetchJson(url.href,{fetcher});requestError=null;break}
    catch(e){
     requestError=e;
     if(!/HTTP_429/.test(String(e.message||e))||attempt===2)break;
     await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
    }
   }
   if(requestError){errors.push(tier+':'+String(requestError.message||requestError).slice(0,70));break}
   if(!Array.isArray(response.markets)){errors.push(tier+':INVALID_MARKET_PAGE');break}
   fetched+=response.markets.length;pages++;
   rows.push(...response.markets);
   const ts=response.markets.map(m=>stamp(m.close_time));
   if(ts.some(t=>t===null))observedDescending=false;
   for(let i=1;i<ts.length;i++)if(ts[i]>ts[i-1])observedDescending=false;
   if(previousMinClose!==null&&ts.length&&ts[0]>previousMinClose)
    observedDescending=false;
   if(ts.length)previousMinClose=Math.min(...ts);
   // Kalshi historical listing does not document ordering guarantees. An
   // observed time boundary short-circuits API volume, but NEVER proves that
   // the remaining cursor pages have no matching markets.
   if(tier==='historical'&&observedDescending&&
      previousMinClose!==null&&previousMinClose<startAt){
    timeBoundaryReached=true;break;
   }
   const next=typeof response.cursor==='string'?response.cursor:'';
   if(!next||response.markets.length===0){complete=true;break}
   if(cursorSeen.has(next)){errors.push(tier+':CURSOR_LOOP');break}
   cursorSeen.add(next);cursor=next;
   if(tier==='historical')
    await new Promise(resolve=>setTimeout(resolve,260));
  }
  if(!complete&&pages>=maxPages)stoppedByCap=true;
  tiers.push({tier,pages,recordsScanned:fetched,completedPagination:complete,
   timeBoundaryReached,observedDescending,truncated:stoppedByCap||
    (rows.length>=maxRecords&&!timeBoundaryReached)});

 }
 const stats=summarizeMarkets(rows,{startAt,endAt:now});
 return {study:'KXETH15M_90_DAY_MARKET_TRUTH_COVERAGE',researchOnly:true,
  sampledAt:now,rangeStart:startAt,rangeEnd:now,days,
  historicalCutoffAt:cutoff,tiers,errors,
  ...stats,upRate:stats.finalized?Number((stats.up/stats.finalized).toFixed(4)):null,
  completenessVerified:tiers.every(x=>x.completedPagination&&!x.truncated)&&errors.length===0,
  source:'KALSHI_PUBLIC_MARKET_METADATA_ONLY',
  warning:'Market outcomes and targets only; NO time-aligned price path, fill, stop, or strategy backtest validated.'};
}
