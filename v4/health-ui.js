'use strict';
/* V4 lightweight private status strip. Consumes the EXISTING authenticated
 * dashboard poll; ZERO extra HTTP/Cloudflare API requests or write operations.
 * Checks operational availability, not statistical forecast correctness.
 */
(function(){
 const $=id=>document.getElementById(id);
 const bar=$('v4-health'),state=$('v4-health-state'),
  message=$('v4-health-message'),age=$('v4-health-age'),
  detail=$('v4-health-detail'),list=$('v4-health-list'),
  toggle=$('v4-health-details');
 if(!bar||!state||!message||!age||!detail||!list||!toggle)return;
 let lastData=null,lastFetchedAt=0,networkFailureAt=null;
 const firstFault=new Map();
 const maxAge=60000,grace=30000;
 const time=x=>Number.isSafeInteger(x)&&x>1000000000000?x:null;
 const activeAge=(x,now)=>{const t=time(x);return t===null?null:now-t};
 const issue=(code,severity,text,fix,{delay=false}={})=>
  ({code,severity,text,fix,delay});
 const fault=(code,now)=>{
  if(!firstFault.has(code))firstFault.set(code,now);
  return now-firstFault.get(code);
 };
 const add=(issues,item,now)=>{
  if(item.delay){
   const howLong=fault(item.code,now);
   issues.push({...item,severity:howLong>=grace?'error':'warning'});
  }else issues.push(item);
 };
 function evaluate(data,now){
  const s=data?.status||{},issues=[];
  const running=s.monitoring===true,paper=s.paperMode==='enabled'||
    s.settlementPaperAllowed===true,open=s.open?.strategy==='V4_SETTLEMENT_FIRST';
  const liveMarket=s.lastMarket||s.open?.ticker||null;
  const tickAge=activeAge(s.lastTick,now);
  const feed=s.paperFeedHealth||{},socket=s.streamConnection||{};
  const sockQuote=socket.quote||{};
  const hasActiveMarket=typeof liveMarket==='string'&&
    liveMarket.startsWith('KXETH15M-');
  if(networkFailureAt!==null&&lastFetchedAt<=networkFailureAt){
   add(issues,issue('DASHBOARD_LINK','error',
    'Dashboard connection lost; displayed market information may be old.',
    'Check internet/Cloudflare viewer; refresh and sign in again.'),now);
  }
  if(running){
   if(tickAge===null){
    add(issues,issue('ENGINE_NO_TICK','warning',
      'Bot has not reported a processing tick.',
      'Check V4 Durable Object alarms and deployment.',{delay:true}),now);
   }else if(tickAge>maxAge||tickAge< -5000){
    add(issues,issue('ENGINE_STALLED','error',
      'Engine heartbeat is stale; current trade decisions are not verified.',
      'Check V4 Worker alarms, logs and deployment.'),now);
   }
   if(tickAge!==null&&tickAge<=maxAge&&tickAge>=0&&
      typeof s.lastError==='string'&&s.lastError.trim()){
    add(issues,issue('ENGINE_ERROR','error',
      'Engine reported a processing/feed error on its latest cycle.',
      'Check V4 Worker logs and the feed checks below.'),now);
   }
  }
  // Only check REQUIRED live-paper inputs when a paper engine is running.
  // Optional research archives are intentionally off and are NOT failures.
  if(running&&paper&&hasActiveMarket&&tickAge!==null&&tickAge>=0&&tickAge<=maxAge){
   if(socket.needResync===true){
    add(issues,issue('BOOK_SEQUENCE','error',
      'Kalshi book lost sequence continuity; paper prices are not trustworthy.',
      'Check book resynchronization and WebSocket connection.'),now);
   }else if(socket.connected!==true||
     socket.targetTicker!==liveMarket||
     sockQuote.fresh!==true||sockQuote.valid!==true||
     activeAge(sockQuote.receivedAt,now)===null||
     activeAge(sockQuote.receivedAt,now)>5000){
    add(issues,issue('KALSHI_BOOK','warning',
      'Live Kalshi order book is missing, delayed or reconnecting.',
      'Check authenticated WebSocket, ticker and latest book receipt.',{delay:true}),now);
   }
   const checks=s.feedChecks||{};
   const names=[['kalshi','Kalshi market/target'],
     ['kraken1m','Kraken 1-minute candles'],
     ['kraken5m','Kraken 5-minute candles'],
     ['krakenTicker','Kraken ETH price']];
   for(const [key,label] of names){
    const c=checks[key],ageCheck=activeAge(c?.checkedAt,now);
    if(c&&c.ok===false&&ageCheck!==null&&ageCheck<=maxAge){
     add(issues,issue('FEED_'+key,'warning',label+' feed failed validation.',
       'Inspect source freshness and V4 feed logs.',{delay:true}),now);
    }
   }
   const index=s.officialIndexFeedCheck||{};
   const recentIndex=activeAge(index.at,now);
   if(recentIndex!==null&&recentIndex>=0&&recentIndex<=maxAge&&
      typeof index.state==='string'&&
      (/^HTTP_/.test(index.state)||index.state==='CREDENTIALS_NOT_CONFIGURED')&&
      index.fresh===false){
    add(issues,issue('OFFICIAL_INDEX','warning',
      'Official ETHUSD_RTI index is unavailable or stale.',
      'Check Kalshi index access, authentication and source timestamp.',{delay:true}),now);
   }
   if(open&&s.open?.liveConfidence?.status==='UNAVAILABLE'){
    add(issues,issue('CONFIDENCE_UNAVAILABLE','warning',
      'Held-position confidence cannot be updated from valid sources.',
      'Check index, Kraken candles and Kalshi book freshness.'),now);
   }
  }
  // Verification/research failures are informative but do not imply a failed
  // BUY/SELL: the actual paper ledger is kept separately.
  if(running&&typeof s.lastResearchError==='string'&&
      s.lastResearchError.length>0&&tickAge!==null&&tickAge<=maxAge){
    add(issues,issue('RESEARCH_JOURNAL','warning',
      'Supplementary research logging reported an error.',
      'Check V4 SQLite research journal and Worker logs.'),now);
  }
  if(running&&typeof s.lastWindowScanError==='string'&&
      s.lastWindowScanError.length>0&&open){
    add(issues,issue('SETTLEMENT_SCAN','warning',
      'Official outcome verification is temporarily unavailable.',
      'Check Kalshi result endpoint; unsettled paper positions remain pending.'),now);
  }
  // Forget recovered fault timers. Temporary 15m rollover/reconnect
  // should clear on the next verified healthy snapshot, not stay red forever.
  const activeCodes=new Set(issues.map(x=>x.code));
  for(const key of firstFault.keys())if(!activeCodes.has(key))firstFault.delete(key);
  issues.sort((a,b)=>Number(b.severity==='error')-Number(a.severity==='error'));
  let mode='healthy',title='No detected system issues';
  if(issues.some(x=>x.severity==='error')){
   mode='error';title='System issue detected';
  }else if(issues.length){
   mode='warning';title='System needs attention';
  }else if(!running){
   mode='idle';title=paper?'Paper monitoring paused':'Paper simulator not active';
  }else if(!paper){
   mode='idle';title='Research monitoring active · paper disabled';
  }
  return {mode,title,issues,at:now,running,paper,tickAge};
 }
 function render(){
  if(!lastData){
   bar.dataset.level='idle';
   state.textContent=networkFailureAt!==null?'Connection unavailable':'Waiting for dashboard';
   message.textContent=networkFailureAt!==null?
    'Unable to reach the private viewer. Sign in or check the connection.':
    'Sign in to verify engine and feed health.';
   age.textContent='—';
   list.replaceChildren();
   toggle.hidden=true;
   return;
  }
  const now=Date.now(),result=evaluate(lastData,now);
  bar.dataset.level=result.mode;
  state.textContent=result.title;
  message.textContent=result.issues.length?
   result.issues[0].text+(result.issues.length>1?
    ' · +'+(result.issues.length-1)+' more':''):
   result.mode==='healthy'?'Engine is reporting; no monitored error is active.':
    result.mode==='idle'?'No paper entries expected in this mode.':
    'Monitoring continues with reduced data availability.';
  age.textContent=result.tickAge===null?'Tick unknown':
   result.tickAge<0?'Clock mismatch':
   'Last engine tick '+Math.round(result.tickAge/1000)+'s ago';
  list.replaceChildren();
  for(const x of result.issues.slice(0,6)){
   const li=document.createElement('li');
   const name=document.createElement('strong');
   name.textContent=x.code.replace(/_/g,' ');
   const description=document.createElement('span');
   description.textContent=x.text+' '+x.fix;
   li.append(name,description);list.append(li);
  }
  toggle.hidden=result.issues.length===0;
  if(result.issues.length===0)toggle.open=false;
 }
 document.addEventListener('v4:dashboard-health',e=>{
  if(e?.detail?.paperOnly!==true||e.detail.readOnly!==true)return;
  lastData=e.detail;lastFetchedAt=Date.now();networkFailureAt=null;render();
 });
 document.addEventListener('v4:dashboard-error',()=>{
  if(networkFailureAt===null)networkFailureAt=Date.now();
  render();
 });
 document.addEventListener('v4:dashboard-reset',()=>{
  lastData=null;lastFetchedAt=0;networkFailureAt=null;
  firstFault.clear();render();
 });
 // Only local clock / UI freshness updates, never an additional network poll.
 setInterval(()=>{if(!document.hidden)render()},15000);
 render();
})();
