'use strict';
/* V4-only storage METADATA inventory, clicked explicitly. Do not read raw
 * market observations, modify databases, auto-purge, or expose private tokens.
 */
(function(){
 const button=document.getElementById('v4-storage-inventory-check');
 const status=document.getElementById('v4-storage-status');
 const display=document.getElementById('v4-storage-inventory-results');
 if(!button||!status||!display)return;
 const key='eth15scout:v4:login-session';
 function tokenFromSession(){
  for(const store of [sessionStorage,localStorage]){
   try{
    const entry=JSON.parse(store.getItem(key)||'null');
    if(typeof entry?.token==='string'&&entry.token.length>=50&&
      Number.isFinite(entry.expiresAt)&&entry.expiresAt>Date.now())return entry.token;
   }catch{}
  }
  return null;
 }
 const date=at=>Number.isSafeInteger(at)&&at>=1000000000000?
  new Date(at).toLocaleString():'No stored record';
 button.addEventListener('click',async()=>{
  const token=tokenFromSession();
  if(!token){status.textContent='Sign in to V4 first.';return}
  button.disabled=true;status.textContent='Checking storage metadata, no records will be deleted…';
  display.replaceChildren();
  try{
   const response=await fetch('https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/storage-inventory',{
    headers:{Authorization:'Bearer '+token},cache:'no-store',mode:'cors',
    signal:AbortSignal.timeout(18000)});
   if(!response.ok)throw Error('Inventory endpoint HTTP '+response.status);
   const r=await response.json();
   if(r.readOnly!==true||r.paperOnly!==true||
     r.autoDeletionConfigured!==false||r.retentionPeriodDays!==null||
     !Array.isArray(r.datasets))throw Error('Unexpected storage metadata response');
   status.textContent='No automatic expiration is configured. Data remains until deleted or unavailable due to platform/account limits.';
   const header=document.createElement('p');
   const size=Number.isSafeInteger(r.databaseBytes)?
    (r.databaseBytes/1024/1024).toFixed(2)+' MiB':'size unavailable';
   header.textContent='Cloudflare database size: '+size+
    ' (includes internal tables, indexes, and other storage). Rows listed below.';
   display.append(header);
   const report=document.createElement('ul');
   for(const item of r.datasets){
    const li=document.createElement('li');
    const name=String(item.table||'unknown');
    li.textContent=name+': '+Number(item.records||0).toLocaleString()+
     ' rows; earliest '+date(item.earliestAt)+'; latest '+date(item.latestAt);
    report.append(li);
   }
   display.append(report);
  }catch(e){status.textContent='Storage inventory unavailable: '+String(e?.message||e)}
  finally{button.disabled=false}
 });
})();
