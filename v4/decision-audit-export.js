'use strict';
/* V4 decision-audit export. Dashboard-only, read-only and paper-only.
 * Deliberately excludes the enormous WebSocket book archive. That archive
 * remains available through its existing authenticated cursor API.
 */
(function(){
 const API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/';
 const SESSION_KEY='eth15scout:v4:login-session';
 const LIMIT=100,RETRYABLE=new Set([429,500,502,503,504]);
 const progress=msg=>{
  const el=document.getElementById('research-message');
  if(el)el.textContent=msg;
 };
 function sessionToken(){
  for(const store of [sessionStorage,localStorage]){
   try{
    const value=JSON.parse(store.getItem(SESSION_KEY)||'null');
    if(typeof value?.token==='string'&&value.token.length>=50&&
       Number.isSafeInteger(value.expiresAt)&&value.expiresAt>Date.now())
      return value.token;
   }catch{}
  }
  return null;
 }
 const safeInt=n=>Number.isSafeInteger(n)&&n>=0;
 async function page(path,params,token){
  const url=new URL(API+path);
  for(const [key,value] of Object.entries(params))
   if(value!==null&&value!==undefined)url.searchParams.set(key,String(value));
  let lastError='Network request unavailable';
  for(let attempt=0;attempt<3;attempt++){
   let retriable=true;
   try{
    const r=await fetch(url.toString(),{method:'GET',mode:'cors',cache:'no-store',
     headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
    if(!r.ok){
     lastError='HTTP '+r.status;
     retriable=RETRYABLE.has(r.status);
     if(!retriable)throw Error(lastError);
    }else{
     const data=await r.json();
     if(data?.paperOnly!==true||data?.readOnly!==true)
      throw Error('Archive integrity check failed');
     return data;
    }
   }catch(e){
    lastError=String(e?.message||e);
    if(/^HTTP (400|401|403|404)\b/.test(lastError)||
       /integrity check/.test(lastError))retriable=false;
   }
   if(!retriable||attempt===2)throw Error(path+': '+lastError);
   await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  throw Error(path+': retries exhausted');
 }
 async function indexedArchive(path,key,token){
  let anchor=null,total=null,offset=0;
  const items=[];
  for(;;){
   const p=await page(path,{limit:LIMIT,offset,anchor},token);
   if(!safeInt(p.anchor)||!safeInt(p.total)||!Array.isArray(p[key]))
    throw Error(path+': malformed pagination');
   if(anchor===null){anchor=p.anchor;total=p.total;
    if(total>30000)throw Error(path+': '+total+' rows exceed safe decision-audit size');
   }else if(p.anchor!==anchor||p.total!==total)
    throw Error(path+': anchor or total changed');
   if(!p[key].length&&offset<total)throw Error(path+': missing page');
   items.push(...p[key]);offset+=p[key].length;
   progress('Exporting '+key+'… '+Math.min(offset,total).toLocaleString()+
    ' / '+total.toLocaleString());
   if(offset>=total){
    if(offset!==total)throw Error(path+': row count mismatch');
    return {anchor,total,records:items};
   }
  }
 }
 async function journal(token){
  let anchor=null,counts=null,pending=[];
  const lists={events:[],trades:[],decisions:[],windows:[]};
  for(let offset=0;;offset+=LIMIT){
   const p=await page('journal',{limit:LIMIT,offset,anchor},token);
   if(!safeInt(p.anchor)||!p.totals||
      !Object.keys(lists).every(k=>safeInt(p.totals[k])&&Array.isArray(p[k])))
    throw Error('journal: malformed pagination');
   if(anchor===null){anchor=p.anchor;counts=p.totals;
    pending=Array.isArray(p.pending)?p.pending:[];
    if(Math.max(...Object.keys(lists).map(k=>counts[k]))>30000)
     throw Error('journal: too many rows for a browser audit');
   }else if(anchor!==p.anchor||
     Object.keys(lists).some(k=>counts[k]!==p.totals[k]))
    throw Error('journal: snapshot counts changed');
   for(const key of Object.keys(lists))lists[key].push(...p[key]);
   const biggest=Math.max(...Object.keys(lists).map(k=>counts[k]));
   progress('Exporting paper journal… '+Math.min(offset+LIMIT,biggest)+
     ' / '+biggest);
   if(offset+LIMIT>=biggest){
    if(Object.keys(lists).some(k=>lists[k].length!==counts[k]))
     throw Error('journal: missing records');
    return {anchor,totals:counts,...lists,pending};
   }
  }
 }
 async function restBook(token){
  let anchor=null,total=null,before=null;
  const items=[];
  for(;;){
   const p=await page('rest-book',{limit:LIMIT,anchor,before},token);
   if(!safeInt(p.anchor)||!safeInt(p.total)||!Array.isArray(p.items)||
      p.source!=='KALSHI_OFFICIAL_REST_ORDERBOOK'||p.isWebSocket!==false)
    throw Error('rest-book: incorrect source or pagination');
   if(anchor===null){anchor=p.anchor;total=p.total;
    if(total>30000)throw Error('rest-book: too many rows for a browser audit');
   }else if(anchor!==p.anchor||p.total!==total)
    throw Error('rest-book: snapshot changed');
   items.push(...p.items);
   progress('Exporting REST book evidence… '+Math.min(items.length,total)+' / '+total);
   if(items.length>=total){
    if(items.length!==total)throw Error('rest-book: row count mismatch');
    return {anchor,total,records:items};
   }
   if(!p.items.length||!safeInt(p.nextBefore)||p.nextBefore===before)
    throw Error('rest-book: missing cursor');
   before=p.nextBefore;
  }
 }
 function download(payload){
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='ETH-15-Scout-V4-Decision-Audit-'+
    new Date().toISOString().slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 async function run(button){
  const token=sessionToken();
  if(!token){progress('Sign in to V4 first.');return;}
  button.disabled=true;
  try{
   const j=await journal(token);
   const t=await indexedArchive('research','ticks',token);
   const q=await indexedArchive('quote-archive','quotes',token);
   const b=await restBook(token);
   const exportedAt=new Date().toISOString();
   download({format:'ETH-15 Scout V4 decision audit evidence',version:1,
    exportedAt,paperOnly:true,readOnly:true,
    completeness:'Complete for included records through each independent anchored source; WebSocket archive EXCLUDED',
    excluded:['High-volume authenticated Kalshi WebSocket book archive (retained on Cloudflare; separate cursor/chunk backup required)','Raw full-book frames (recording disabled)'],
    provenance:{research:'Durable V4 per-tick snapshots',
     journal:'Durable V4 paper events/trades/decisions and official Kalshi outcomes',
     quoteArchive:'Kalshi REST proxy observations; timestamps are receipt-only and may reflect cached quotes',
     restBook:'Kalshi official REST depth; receipt-only, not verified fills'},
    warnings:['Independent source snapshots have different anchors/times; never assume synchronized samples.',
     'Displayed quotes are not actual executions; Kraken spot is not the official Kalshi index.',
     'Scenario estimates are uncalibrated; official results are only knowable after finalization.'],
    anchors:{journal:j.anchor,research:t.anchor,quotes:q.anchor,restBook:b.anchor},
    totals:{...j.totals,researchTicks:t.total,restQuotes:q.total,restBookSamples:b.total},
    journal:j,researchTicks:t.records,restQuoteArchive:q.records,
    officialRestBookArchive:b.records});
   progress('Decision audit downloaded: '+t.total.toLocaleString()+' research ticks, '+
    q.total.toLocaleString()+' quote records, '+b.total.toLocaleString()+
    ' REST-book snapshots and complete paper journal. High-volume WebSocket archive excluded.');
  }catch(e){
   progress('Decision audit INCOMPLETE; no file claimed: '+String(e?.message||e));
  }finally{button.disabled=false;}
 }
 function init(){
  const prior=document.getElementById('research-export');
  if(!prior)return;
  // The legacy all-in-one export unconditionally rejects archives >50k WS rows.
  // Replace its click handler and label, retaining the existing DOM ID so
  // V4 app.js continues controlling enabled/disabled state after login.
  const button=prior.cloneNode(true);
  button.textContent='Export decision audit JSON';
  button.title='Full journal, decision ticks and REST quote evidence. Excludes large Kalshi WebSocket archive.';
  prior.replaceWith(button);
  button.addEventListener('click',()=>run(button));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
