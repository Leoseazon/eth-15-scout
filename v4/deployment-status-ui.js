'use strict';
/* V4 deployment visibility: display only, no fetch, no auth changes, no writes.
 * Consumes the existing v4:dashboard-health event and fails closed.
 * Deployment identifiers/times must come from authenticated, authoritative
 * Cloudflare release metadata; contextual activation markers are NOT releases.
 */
(function(){
 const root=document.getElementById('v4-deployment-status');
 if(!root)return;
 const field=id=>document.getElementById('v4-deploy-'+id);
 const set=(id,value)=>{const el=field(id);if(el)el.textContent=value};
 const safeMs=value=>{
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>1e12)return value;
  if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)){
   const n=Date.parse(value);return Number.isFinite(n)?n:null;
  }
  return null;
 };
 const localTime=ms=>new Date(ms).toLocaleString('en-US',{
  timeZone:'America/Chicago',year:'numeric',month:'short',day:'numeric',
  hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'
 });
 const age=(ms,now)=>{const delta=now-ms;
  if(delta< -5000)return 'clock mismatch';
  if(delta<0)return 'just now';
  if(delta<60000)return Math.floor(delta/1000)+'s ago';
  if(delta<3600000)return Math.floor(delta/60000)+'m ago';
  return Math.floor(delta/3600000)+'h ago';
 };
 const unverified='Unavailable — not verified from Cloudflare';
 // Only explicitly marked Cloudflare metadata may fill these fields.
 // The existing V4 viewer currently does not supply this; do not hardcode IDs.
 const verifiedRelease=(record)=>{
  if(!record||record.source!=='cloudflare_deployments_api'||record.verified!==true)
   return null;
  if(typeof record.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.id))
   return null;
  const deployedAt=safeMs(record.deployedAt);
  return deployedAt?{id:record.id,deployedAt}:null;
 };
 const release=(kind,record)=>{
  const r=verifiedRelease(record);
  set(kind+'-id',r?r.id:unverified);
  set(kind+'-time',r?localTime(r.deployedAt):unverified);
 };
 const feed=(name,check,now)=>{
  const at=safeMs(check?.checkedAt);
  const current=at!==null&&now-at>=-5000&&now-at<=110000;
  if(!current){set(name,'Unknown — no recent verified check');return}
  const state=check.ok===true?'OK':check.ok===false?'UNHEALTHY':'Unknown';
  const details=[];
  if(check.cached===true)details.push('cached');
  if(check.cooldown===true||check.coolingDown===true||check.rateLimited===true)
   details.push('cooldown / rate limit');
  if(typeof check.error==='string'&&check.error.trim())
   details.push(check.error.trim().slice(0,110));
  set(name,state+' · checked '+age(at,now)+(details.length?' · '+details.join(' · '):''));
 };
 function render(data){
  const now=Date.now(),s=data?.status||{};
  // No Cloudflare metadata in the existing viewer response: show unavailable.
  // Never derive it from releaseMarkers, modelVersion, or dashboard refresh.
  release('engine',data?.deploymentMetadata?.engine);
  release('viewer',data?.deploymentMetadata?.viewer);
  const tick=safeMs(s.lastTick),tickAge=tick===null?Infinity:now-tick;
  const successful=tick!==null&&tickAge>=-5000&&tickAge<=110000&&
   s.monitoring===true&&s.lastFeedOkay===true&&
   (s.lastError===null||s.lastError===undefined||s.lastError==='');
  set('tick',successful?localTime(tick)+' · '+age(tick,now):
   'Not verified on latest tick');
  set('tick-note',successful?'Latest tick reported successful; not proof every required entry source was ready.':
   'Heartbeat alone is not a successful feed check; previous successful tick unavailable.');
  const checks=s.feedChecks||{};
  feed('kraken1m',checks.kraken1m,now);
  feed('kraken5m',checks.kraken5m,now);
  const errors=[s.lastError,checks.kraken1m?.error,checks.kraken5m?.error]
   .filter(x=>typeof x==='string'&&x.trim());
  set('error',errors.length?[...new Set(errors)].join(' · ').slice(0,280):
   'No current reported Kraken/engine error');
  root.dataset.health=checks.kraken1m?.ok===false||checks.kraken5m?.ok===false||
   errors.length?'warning':'neutral';
 }
 function reset(){
  for(const kind of ['engine','viewer'])release(kind,null);
  set('tick','Unavailable — sign in to verify');
  set('tick-note','No authenticated engine status loaded');
  for(const key of ['kraken1m','kraken5m','error'])set(key,'Unavailable');
  root.dataset.health='neutral';
 }
 document.addEventListener('v4:dashboard-health',event=>render(event.detail));
 document.addEventListener('v4:dashboard-reset',reset);
 document.addEventListener('v4:dashboard-error',()=>{
  set('tick-note','Dashboard refresh failed — prior values may be stale');
  root.dataset.health='warning';
 });
 reset();
})();
