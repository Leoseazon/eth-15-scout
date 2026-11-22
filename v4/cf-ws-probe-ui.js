'use strict';
/* V4-only, same-origin, one-time CF benchmark WebSocket diagnostic UI.
 * Reads existing short-lived V4 viewer login session; never logs tokens,
 * stores index values, starts WebSocket streams or touches trading controls.
 */
(function(){
 const button=document.getElementById('cf-ws-probe-button');
 const status=document.getElementById('cf-ws-probe-status');
 if(!button||!status)return;
 const api='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/cf-ws-verify';
 const key='eth15scout:v4:login-session';
 function viewerToken(){
  for(const store of [sessionStorage,localStorage]){
   try{
    const entry=JSON.parse(store.getItem(key)||'null');
    if(typeof entry?.token==='string'&&entry.token.length>=50&&
      Number.isFinite(entry.expiresAt)&&entry.expiresAt>Date.now())
     return entry.token;
   }catch{}
  }
  return null;
 }
 button.addEventListener('click',async()=>{
  const token=viewerToken();
  if(!token){status.textContent='Sign in to V4 first.';return}
  button.disabled=true;
  status.textContent='Checking a temporary authenticated ETHUSD_RTI WebSocket…';
  try{
   const response=await fetch(api,{method:'GET',cache:'no-store',mode:'cors',
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(22000)});
   if(!response.ok)throw Error('Diagnostic request HTTP '+response.status);
   const result=await response.json();
   if(result?.readOnly!==true||result?.paperOnly!==true||result?.archived!==false)
    throw Error('Unexpected diagnostic safety response');
   const state=String(result.state||'UNKNOWN');
   if(state==='WS_ETH_INDEX_VERIFIED'&&result.websocketVerified===true){
    status.textContent='Verified: ETHUSD_RTI indexlist and a fresh live WebSocket reading (USD '+
     Number(result.value).toFixed(2)+', source age '+
     String(result.sourceAgeSeconds)+'s). The temporary socket closed; no market data was archived.';
   }else if(state==='WS_PROBE_COOLDOWN'){
    status.textContent='A diagnostic was recently run. Please retry after the 90-second cooldown.';
   }else{
    status.textContent='Live WebSocket check: '+state+
     '. Subscribed: '+String(result.subscribed===true)+
     '; ETH index listed: '+String(result.indexAvailable===true)+
     '; fresh value confirmed: '+String(result.validValueReceived===true)+
     '. Continuous recording remains disabled.';
   }
  }catch(error){
   status.textContent='Live verification unavailable: '+String(error?.message||error);
  }finally{button.disabled=false}
 });
})();
