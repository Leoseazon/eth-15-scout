/* Export standalone CONTROLS Worker journal and ticks.
 * Run LOCALLY on user's trusted machine; no credentials printed, no writes
 * to Worker. Requires:
 * V4_CONTROLS_API_URL=https://eth-15-scout-v4-controls.<account>.workers.dev
 * V4_CONTROLS_ADMIN_TOKEN=(separate controls-only Bearer secret)
 * node cloud/v4/tools/export-v4-controls.mjs [output.json]
 */
import fs from 'node:fs';
const urlText=process.env.V4_CONTROLS_API_URL;
const token=process.env.V4_CONTROLS_ADMIN_TOKEN;
if(!urlText||!token||token.length<40)
 throw Error('Missing separate CONTROLS endpoint or admin bearer secret');
const base=new URL(urlText);
if(base.protocol!=='https:'||base.username||base.password||
 !/^eth-15-scout-v4-controls\.[a-z0-9-]+\.workers\.dev$/i.test(base.hostname)||
 base.pathname!=='/'||base.search||base.hash)
 throw Error('Controls-only HTTPS workers.dev address required');
async function page(path){
 const u=new URL(path,base);
 const res=await fetch(u,{headers:{
  Authorization:'Bearer '+token,Accept:'application/json'
 },redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw Error('Controls API returned '+res.status+' for '+u.pathname);
 return res.json();
}
const status=await page('/v1/status');
if(status.paperOnly!==true||status.researchWorkerRole!=='CONTROLS_ONLY'||
 status.researchControlsAllowed!==true||status.mainTradingDisabledByCode!==true||
 status.armed!==false||status.settlementPaperAllowed!==false)
 throw Error('Controls Worker role/disarm assertions failed; export refused');
async function journal(){
 let offset=0,anchor=null,totals=null,
  events=[],trades=[],decisions=[],windows=[],pending=[],control=null;
 for(let n=0;n<200;n++){
  const query=new URLSearchParams({offset:String(offset),limit:'100'});
  if(anchor!==null)query.set('anchor',String(anchor));
  const j=await page('/v1/journal?'+query);
  if(j.paperOnly!==true||j.readOnly!==true||
   !Array.isArray(j.events)||!Array.isArray(j.trades)||
   !Array.isArray(j.decisions)||!Array.isArray(j.windows)||
   !Number.isSafeInteger(j.anchor))
   throw Error('Unverified controls journal page');
  if(anchor===null){anchor=j.anchor;totals=j.totals;
    pending=j.pending||[];control=j.conservativeControlJournal||null;
  }else if(j.anchor!==anchor)throw Error('Journal anchor changed');
  events.push(...j.events);trades.push(...j.trades);
  decisions.push(...j.decisions);windows.push(...j.windows);
  offset+=100;
  if(offset>=Math.max(totals.events||0,totals.trades||0,
    totals.decisions||0,totals.windows||0)){
   return {anchor,totals,events,trades,decisions,windows,pending,
    conservativeControlJournal:control};
  }
 }
 throw Error('Controls journal exceeds export safety limit');
}
async function research(){
 let anchor=null,offset=0,total=null,ticks=[];
 for(let n=0;n<200;n++){
  const query=new URLSearchParams({offset:String(offset),limit:'100'});
  if(anchor!==null)query.set('anchor',String(anchor));
  const r=await page('/v1/research?'+query);
  if(r.readOnly!==true||r.paperOnly!==true||!Array.isArray(r.ticks)||
   !Number.isSafeInteger(r.anchor)||!Number.isSafeInteger(r.total))
   throw Error('Invalid controls research page');
  if(anchor===null){anchor=r.anchor;total=r.total}
  else if(r.anchor!==anchor||r.total!==total)
   throw Error('Controls research anchor changed');
  ticks.push(...r.ticks);offset+=r.ticks.length;
  if(ticks.length>=total)return {anchor,total,ticks};
  if(r.ticks.length<1)throw Error('Controls research page missing');
 }
 throw Error('Controls research exceeds export safety limit');
}
const [j,r]=await Promise.all([journal(),research()]);
const out={format:'ETH-15 Scout V4 controls-only evidence',paperOnly:true,
 readOnly:true,workerRole:'CONTROLS_ONLY',engineMainTradingDisabled:true,
 exportedAt:new Date().toISOString(),
 snapshot:{workerName:'eth-15-scout-v4-controls',status,anchorJournal:j.anchor,
  anchorResearch:r.anchor,totalResearchTicks:r.total,totals:j.totals},
 journal:j,researchTicks:r.ticks,
 warnings:['Private control-only engine: not the active main portfolio',
  'All entry/exit fills are SIMULATED; Kalshi book sizes are not confirmations',
  'Each strategy shares official market outcomes but not a market data timestamp',
  'Only Kalshi finalized exchange outcomes resolve hypothetical settlements']};
const output=process.argv[2]||'ETH-15-V4-Controls-Evidence-'+
 new Date().toISOString().slice(0,10)+'.json';
fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n',{
 encoding:'utf8',flag:'wx',mode:0o600});
process.stdout.write('Validated controls-only evidence saved: '+output+
 '\nResearch ticks: '+r.ticks.length+
 ' | Official windows: '+j.windows.length+
 ' | Conservative completed: '+(j.conservativeControlJournal?.trades?.length??'unavailable')+
 '\n');
