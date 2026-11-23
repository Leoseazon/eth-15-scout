'use strict';
/* V4-only primary goal reporting: official Kalshi settlement-side prediction
 * accuracy; separate from profitable paper exits and ALWAYS read-only.
 */
(function(){
 const button=document.getElementById('v4-settlement-score-refresh');
 const line=document.getElementById('v4-settlement-paper-status');
 const detail=document.getElementById('v4-settlement-paper-detail');
 if(!button||!line||!detail)return;
 const url='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/dashboard';
 const key='eth15scout:v4:login-session';
 function token(){
  for(const store of [sessionStorage,localStorage]){
   try{
    const saved=JSON.parse(store.getItem(key)||'null');
    if(typeof saved?.token==='string'&&saved.token.length>=50&&
       Number.isSafeInteger(saved.expiresAt)&&saved.expiresAt>Date.now())
     return saved.token;
   }catch{}
  }
  return null;
 }
 button.addEventListener('click',async()=>{
  const auth=token();
  if(!auth){line.textContent='Sign in to V4 first.';return}
  button.disabled=true;line.textContent='Checking official finalized-round forecasts…';
  try{
   const response=await fetch(url,{cache:'no-store',headers:{
    Authorization:'Bearer '+auth},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Read-only dashboard HTTP '+response.status);
   const data=await response.json();
   if(data?.paperOnly!==true||data?.readOnly!==true)throw Error('Unexpected response type');
   const s=data.status||{},a=s.settlementPredictionStats;
   if(!a)throw Error('Settlement-first forecast code not deployed yet');
   const verified=Number(a.verified)||0,total=Number(a.totalPredictions)||0;
   line.textContent=s.settlementPaperAllowed===true?
     'Experimental V4 paper simulation enabled. No real orders.':
     'Experimental V4 paper simulation disabled. No real orders.';
   detail.replaceChildren();
   const selected=s.mainStrategyProfile?.active||'Conservative (profile not reported)';
   const profile=document.createElement('p');
   profile.textContent='MAIN paper strategy: '+String(selected)+
    ' · Available: Conservative / Balanced / Opportunistic'+
    ' · Active mode is fixed by authenticated Cloudflare deployment, NOT changed here.'+
    ' Conservative has a separately simulated control account; A/B/C/A2/B2/C2 remain research-only.';
   detail.append(profile);
   const control=s.conservativeControl;
   if(control?.researchControl===true){
    const controlLine=document.createElement('p');
    controlLine.textContent='Independent Conservative control: '+
     String(control.status||'UNKNOWN')+
     ' · entries '+String(control.entries??'n/a')+
     ' · completed '+String(control.completed??'n/a')+
     ' · hypothetical realized 
   const rate=verified?((Number(a.correct)||0)/verified*100).toFixed(1)+'%':'not yet available';
   item.textContent='Correct official settlement side: '+rate+
    ' · verified '+verified+' / '+total+' predictions · correct '+(Number(a.correct)||0)+
    ' · incorrect '+(Number(a.incorrect)||0)+
    '. Open/early-sold paper returns are NOT counted as correct unless official settlement agrees.';
   detail.append(item);
   const info=document.createElement('p');
   info.textContent='Current model: '+String(s.settlementModelVersion||'unknown')+
    ' · last research decision: '+String(s.latestSettlementDecision?.status||'none')+
    ' · explanation: '+String(s.latestSettlementDecision?.reason||'n/a');
   detail.append(info);
  }catch(error){line.textContent='Read-only paper score unavailable: '+String(error?.message||error)}
  finally{button.disabled=false}
 });
})();
+
      (Number.isFinite(control.realized)?control.realized.toFixed(2):'n/a');
    detail.append(controlLine);
   }
   const item=document.createElement('p');
   const rate=verified?((Number(a.correct)||0)/verified*100).toFixed(1)+'%':'not yet available';
   item.textContent='Correct official settlement side: '+rate+
    ' · verified '+verified+' / '+total+' predictions · correct '+(Number(a.correct)||0)+
    ' · incorrect '+(Number(a.incorrect)||0)+
    '. Open/early-sold paper returns are NOT counted as correct unless official settlement agrees.';
   detail.append(item);
   const info=document.createElement('p');
   info.textContent='Current model: '+String(s.settlementModelVersion||'unknown')+
    ' · last research decision: '+String(s.latestSettlementDecision?.status||'none')+
    ' · explanation: '+String(s.latestSettlementDecision?.reason||'n/a');
   detail.append(info);
  }catch(error){line.textContent='Read-only paper score unavailable: '+String(error?.message||error)}
  finally{button.disabled=false}
 });
})();
