'use strict';
/* V4 FEED DIAGNOSTIC — observational only; never makes network calls.
 * Uses EXISTING 15s authenticated dashboard-health events, keeps at most
 * 180 distinct-engine-tick samples in volatile browser memory and can
 * export ONLY sanitized reason codes (no tokens, order prices, or keys).
 * It does not enable/disable paper trading or change any price freshness gate.
 */
(function(){
 const root=document.getElementById('v4-feed-diagnostics');
 if(!root)return;
 const field=id=>document.getElementById('v4-feed-diag-'+id);
 const put=(id,value)=>{const el=field(id);if(el)el.textContent=String(value)};
 const MAX=180,MAX_AGE=60000,BOOK_MAX_AGE=5000;
 let samples=[],lastTick=0,viewerUnavailable=false;
 const validMs=n=>Number.isSafeInteger(n)&&n>1000000000000;
 const age=(at,now)=>validMs(at)?now-at:null;
 const safeCode=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,59}$/.test(v)?v:'UNKNOWN';
 const faultCode=e=>{
  const x=String(e||'');
  if(/too many requests|rate.?limit|\b429\b/i.test(x))return 'RATE_LIMIT';
  if(/cooldown|cooling.down/i.test(x))return 'COOLDOWN';
  if(/latest closed candle|stale|freshness|timestamp/i.test(x))return 'CANDLE_STALE';
  if(/unavailable|missing|invalid|incomplete/i.test(x))return 'INVALID_DATA';
  if(/HTTP [1-5][0-9][0-9]/i.test(x))return 'PROVIDER_HTTP_ERROR';
  return 'FEED_ERROR';
 };
 function kraken(check,now){
  const delta=age(check?.checkedAt,now);
  if(delta===null||delta< -5000||delta>MAX_AGE)return 'CHECK_UNAVAILABLE';
  if(check.ok===true)return 'READY';
  if(check.ok===false)return faultCode(check.error);
  return 'CHECK_UNVERIFIED';
 }
 function kalshi(s,now){
  if(s.streamCaptureEnabled!==true)return {code:'STREAM_DISABLED',ageSec:null};
  const ws=s.streamConnection||{},q=ws.quote||{};
  const liveTicker=s.lastMarket||s.open?.ticker||null;
  if(!liveTicker)return {code:'NO_ACTIVE_MARKET',ageSec:null};
  if(ws.connected!==true)return {code:'WS_DISCONNECTED',ageSec:null,
   lastFailure:safeCode(ws.lastFailure)};
  if(ws.targetTicker!==liveTicker)return {code:'MARKET_SUBSCRIPTION_SWITCH',ageSec:null};
  if(ws.needResync===true)return {code:'SEQUENCE_RESYNC_REQUIRED',ageSec:null};
  if(q.valid!==true)return {code:'BOOK_INVALID_OR_MISSING',ageSec:null,
   reason:safeCode(q.reason)};
  if(q.reason==='LOCKED_OR_CROSSED')return {code:'BOOK_CROSSED',ageSec:null};
  const delta=age(q.receivedAt,now);
  if(delta===null||delta< -5000)return {code:'BOOK_CLOCK_UNVERIFIED',ageSec:null};
  const ageSec=Math.round(delta/1000);
  if(q.fresh!==true)return {code:'BOOK_STALE_AT_ENGINE',ageSec,
   reason:safeCode(q.reason)};
  if(delta>BOOK_MAX_AGE)return {code:'BOOK_AGED_DURING_VIEWER_POLL',ageSec};
  return {code:'READY',ageSec};
 }
 function officialIndex(s,now){
  const x=s.officialIndexFeedCheck||{},delta=age(x.at,now);
  if(delta===null||delta< -5000||delta>MAX_AGE)return 'NOT_VERIFIED_RECENTLY';
  if(x.fresh===true)return 'READY';
  if(x.state==='SKIPPED_NO_FRESH_WS_BOOK')return 'SKIPPED_BOOK_GATE';
  if(x.state==='SKIPPED_OTHER_ENTRY_PREREQUISITE')return 'SKIPPED_OTHER_GATE';
  if(x.state==='NOT_YET_CHECKED')return 'NOT_CHECKED';
  return 'UNAVAILABLE_OR_STALE';
 }
 function classify(data,now){
  const s=data.status||{},tick=age(s.lastTick,now);
  const engine=tick===null||tick< -5000||tick>MAX_AGE?'TICK_STALE':
   s.monitoring===true?'RUNNING':'MONITORING_PAUSED';
  return {at:now,engineTickAt:validMs(s.lastTick)?s.lastTick:null,
   engine,book:kalshi(s,now),
   kraken1m:kraken(s.feedChecks?.kraken1m,now),
   kraken5m:kraken(s.feedChecks?.kraken5m,now),
   index:officialIndex(s,now),
   engineBuyDataReady:s.paperFeedHealth?.liveSourcesReady===true,
   indexNote:'SKIPPED_* is a prerequisite gate, not proof of index outage'};
 }
 function count(key,value){return samples.reduce((n,s)=>n+(key==='book'?s.book.code===value:s[key]===value?1:0),0)}
 function show(row){
  put('book',row.book.code.replaceAll('_',' ')+
   (row.book.ageSec!==null?' · last update ~'+row.book.ageSec+'s ago':'')+
   (row.book.lastFailure&&row.book.lastFailure!=='UNKNOWN'?' · '+row.book.lastFailure:''));
  put('kraken','1m '+row.kraken1m.replaceAll('_',' ')+' · 5m '+row.kraken5m.replaceAll('_',' '));
  put('index',row.index.replaceAll('_',' '));
  put('latest',row.engine==='RUNNING'?'Engine reporting · '+(row.engineBuyDataReady?'all required entry sources reported ready':'entry sources not fully verified'):
   row.engine.replaceAll('_',' '));
  const bookReady=count('book','READY'),r1=count('kraken1m','READY'),r5=count('kraken5m','READY');
  put('coverage',samples.length+' distinct engine ticks · book fresh on '+bookReady+
   ', Kraken 1m ready on '+r1+', Kraken 5m ready on '+r5+
   ' · local observations only, not unique trading rounds');
  const btn=field('export');
  if(btn)btn.disabled=samples.length===0;
 }
 function reset(){
  samples=[];lastTick=0;viewerUnavailable=false;
  for(const id of ['book','kraken','index','latest','coverage'])put(id,'Waiting for authenticated dashboard data');
  const btn=field('export');if(btn)btn.disabled=true;
 }
 function exportFile(){
  if(!samples.length)return;
  const payload={format:'ETH-15 Scout V4 browser feed diagnostic',version:1,
   generatedAt:new Date().toISOString(),readOnly:true,paperOnly:true,
   sources:'Existing authenticated dashboard refresh only; no additional market requests',
   retention:'Last 180 distinct observed engine ticks while this page remained open; not continuous server history',
   timestamps:'observedAt is browser clock; engineTickAt is server clock; neither proves exchange event time',
   sampleCount:samples.length,observations:samples};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='ETH15-V4-Feed-Diagnostics-'+
   new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),2000);
 }
 const button=field('export');if(button)button.addEventListener('click',exportFile);
 document.addEventListener('v4:dashboard-health',ev=>{
  const data=ev.detail;
  if(data?.paperOnly!==true||data?.readOnly!==true)return;
  const now=Date.now(),row=classify(data,now),tick=row.engineTickAt;
  viewerUnavailable=false;
  if(tick!==null&&row.engine!=='TICK_STALE'&&tick>lastTick){
   lastTick=tick;
   samples.push(row);
   if(samples.length>MAX)samples.shift();
  }
  show(row);
 });
 document.addEventListener('v4:dashboard-error',()=>{
  viewerUnavailable=true;
  put('latest','Viewer refresh unavailable · previously sampled data not live');
 });
 document.addEventListener('v4:dashboard-reset',reset);
 reset();
})();