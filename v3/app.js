'use strict';
/* ETH-15 Scout V3. Read-only UI: no buy/sell calls, no bot controls,
   no untrusted HTML, no third-party scripts or fabricated market data. */
const API='https://eth-15-scout-v3-view.leoseazon.workers.dev/api/v3/dashboard';
const KEY='eth15scout:v3:viewer:session';
const $=id=>document.getElementById(id);
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const money=(v,sign=false)=>n(v)===null?'—':(sign&&v>0?'+':'')+
  (v<0?'−':'')+'$'+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=(v,d=2)=>n(v)===null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const ct=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('en-US',
 {timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})};
const ago=ms=>{if(!Number.isFinite(Number(ms))||!ms)return 'Unknown';const s=Math.round((Date.now()-Number(ms))/1000);if(s<0)return 'Clock mismatch';return s<60?s+'s ago':s<3600?Math.floor(s/60)+'m ago':Math.floor(s/3600)+'h ago'};
const txt=(id,v)=>{const e=$(id);if(e)e.textContent=String(v===undefined||v===null?'—':v)};
const cls=(id,type)=>{const e=$(id);if(!e)return;e.classList.remove('success','warning','danger','neutral');e.classList.add(type||'neutral')};
const trendStyle=t=>t==='UP'?'success':t==='DOWN'?'danger':'neutral';
const regimeName=s=>s==='RISK_ON'?'Risk-on':s==='RISK_OFF'?'Risk-off':s==='MIXED'?'Mixed':'Unavailable';
let token='',lastPayload=null,filter='ALL',tf='m5',busy=false;
try{token=sessionStorage.getItem(KEY)||''}catch{}
function connectMessage(s,bad=false){txt('connect-message',s);$('connect-message').style.color=bad?'#e5a1ab':''}
function connectionVisible(show){$('connect-panel').classList.toggle('hidden',!show)}
function reset(){
 token='';lastPayload=null;try{sessionStorage.removeItem(KEY)}catch{}
 connectionVisible(true);txt('sync-label','Not connected');txt('updated-label','No data loaded');
 txt('mode-badge','Disconnected');cls('mode-badge','neutral');
 connectMessage('Enter your viewing key to connect.');
}
function sanitizeErr(response){
 if(response.status===401)return 'Access key rejected. Check the key generated when deploying the viewer.';
 if(response.status===503)return 'Viewer gateway is not configured yet. Deploy it and set its private secret.';
 if(response.status===403)return 'This dashboard origin is not authorized.';
 return 'Unable to load V3 now (HTTP '+response.status+').';
}
async function load(){
 if(!token||busy)return;
 busy=true;
 txt('sync-label','Refreshing…');
 try{
  const response=await fetch(API,{mode:'cors',headers:{Authorization:'Bearer '+token},cache:'no-store'});
  if(!response.ok)throw new Error(sanitizeErr(response));
  const result=await response.json();
  if(result.paperOnly!==true||result.readOnly!==true)throw new Error('Unexpected response from the read-only viewer.');
  lastPayload=result;
  connectionVisible(false);
  render(result);
 }catch(err){
  const msg=err instanceof TypeError?'Unable to reach the V3 viewer. The gateway may not be deployed yet.':
   String(err?.message||err);
  txt('sync-label','Connection issue');
  if(!lastPayload)connectionVisible(true);
  connectMessage(msg,true);
  if(lastPayload)txt('updated-label','Last successful update '+ago(lastPayload.receivedAt)+' · retrying');
 }finally{busy=false}
}
function markTrend(id,t){txt(id,t==='UP'?'Uptrend':t==='DOWN'?'Downtrend':t==='NEUTRAL'?'Neutral':'Unavailable');cls(id,trendStyle(t))}
function quote(v){const a=n(Number(v));return a===null||a<=0?'—':fmt(a*100,1)+'¢'}
function render(data){
 const s=data.status||{},m=data.market||{},c=m.contract||{},pr=m.primary||{},
  sec=m.secondary||{},three=pr.three,five=pr.five,now=Date.now();
 const recentTick=Number.isFinite(s.lastTick)&&now-s.lastTick<110000;
 const active=s.monitoring&&recentTick;
 txt('sync-label',active?'Feed connected':s.monitoring?'Stale feed':'Offline');
 txt('metric-monitor',s.monitoring?(active?'Online':'Stale'):'Stopped');
 $('metric-monitor').style.color=active?'var(--mint)':s.monitoring?'var(--amber)':'var(--red)';
 txt('metric-monitor-note',active?'Cloud runtime active':'Check last engine tick');
 txt('metric-arm',s.armed?'Enabled':'Paused');
 $('metric-arm').style.color=s.armed?'var(--mint)':'var(--amber)';
 txt('metric-market',s.lastMarket?.split('-')?.[0]||'No contract');
 txt('metric-age',ago(s.lastTick));
 txt('metric-feed',s.lastError?'Last error reported':s.lastFeedOkay?'Kalshi/Kraken tick complete':'Feed status unverified');
 const risk=s.dailyRisk||{},riskMode=risk.mode||'UNKNOWN';
 txt('metric-risk',riskMode==='HARD'?'Hard stop':riskMode==='SOFT'?'Soft mode':riskMode==='NORMAL'?'Normal':'Unknown');
 $('metric-risk').style.color=riskMode==='HARD'?'var(--red)':riskMode==='SOFT'?'var(--amber)':'var(--mint)';
 txt('mode-badge',s.armed&&s.monitoring?'● Paper simulation enabled':s.monitoring?'● Monitoring · paper paused':'● Monitoring stopped');
 cls('mode-badge',s.armed&&s.monitoring?'success':s.monitoring?'warning':'danger');
 txt('updated-label','Last refresh '+ct(data.receivedAt)+' CT · Engine '+ago(s.lastTick));
 txt('spot-price',n(m.spot)!==null?money(m.spot):'—');
 txt('market-feed-status',m?.freshness?.one&&m?.freshness?.five?'Kraken fresh':data.marketError?'Market unavailable':'Reference delayed');
 cls('market-feed-status',m?.freshness?.one&&m?.freshness?.five?'success':data.marketError?'warning':'neutral');
 const ticker=s.lastMarket||c.ticker||'Not available';
 txt('contract-id',ticker);
 txt('contract-time',c.close_time?'Closes '+ct(c.close_time)+' CT · '+remaining(c.close_time):'Latest engine contract');
 txt('contract-strike',n(Number(c.floor_strike))!==null&&c.floor_strike!==undefined?'Target '+money(Number(c.floor_strike)):'Target unavailable');
 txt('up-quote','UP ask '+quote(c.yes_ask_dollars));
 txt('down-quote','DOWN ask '+quote(c.no_ask_dollars));
 const notice=s.lastNotice||'No decision reported yet';
 txt('current-notice',notice);
 txt('notice-time',ct(s.lastTick)+' CT');
 markTrend('sig-5m',five?.trend);
 markTrend('sig-3m',three?.trend);
 txt('sig-levels',five?'S '+(n(five.support?.center)===null?'—':money(five.support.center))+' / R '+
  (n(five.resistance?.center)===null?'—':money(five.resistance.center)):'Unavailable');
 const e21=pr.ema21,e50=pr.ema50;
 const emaStatus=n(e21)===null||n(e50)===null?'Unavailable':e21>e50?'Bullish ↑':e21<e50?'Bearish ↓':'Flat';
 txt('sig-emas',emaStatus);cls('sig-emas',n(e21)===null?'neutral':e21>e50?'success':e21<e50?'danger':'neutral');
 txt('sig-vwap',n(pr.vwap)===null?'—':money(pr.vwap));
 txt('sig-rsi',n(sec.rsi14)===null?'—':fmt(sec.rsi14,1));
 const b=three?.bands;
 let bb='Unavailable';
 if(b&&n(three.price)!==null&&n(b.mid)!==null){
  bb=three.price>b.upper?'Above upper':three.price<b.lower?'Below lower':three.price>=b.mid?'Mid–upper':'Lower–mid';
 }
 txt('sig-bands',bb);cls('sig-bands',bb==='Above upper'||bb==='Below lower'?'warning':'neutral');
 const ad=n(three?.adDelta);
 txt('sig-ad',ad===null?'Unavailable':ad>0?'Positive':ad<0?'Negative':'Neutral');
 cls('sig-ad',ad===null?'neutral':ad>0?'success':ad<0?'danger':'neutral');
 txt('sig-regime',s.dailyRegime?.status==='ready'?regimeName(s.dailyRegime.regime):'Unverified');
 cls('sig-regime',s.dailyRegime?.regime==='RISK_ON'?'success':s.dailyRegime?.regime==='RISK_OFF'?'danger':'neutral');
 txt('cash-value',money(s.cash));
 txt('starting-value',money(s.initial));
 txt('realized-value',money(s.realized,true));
 $('realized-value').style.color=n(s.realized)>0?'var(--mint)':n(s.realized)<0?'var(--red)':'var(--text)';
 txt('unrealized-value',n(s.open?.markPnl)===null?'—':money(s.open.markPnl,true));
 txt('pending-value',n(s.pending)===null?'—':s.pending);
 const trades=data.activity?.trades||[];
 txt('trades-value',Number.isFinite(s.trades)?s.trades:trades.length);
 const wins=trades.filter(t=>t.confirmed&&n(t.pnl)>0).length;
 const completed=trades.filter(t=>t.confirmed&&n(t.pnl)!==null).length;
 txt('win-rate',completed?fmt(wins/completed*100,1)+'%':'—');
 if(s.open){
  txt('open-position-value',String(s.open.side||'')+' · '+(s.open.qty||'?')+
   ' paper contracts · '+quote(s.open.entry)+' entry · '+String(s.open.ticker||''));
 }else{txt('open-position-value','No open position')}
 txt('risk-badge',riskMode);cls('risk-badge',riskMode==='HARD'?'danger':riskMode==='SOFT'?'warning':'success');
 txt('daily-risk-value',n(risk.netRiskPnl)===null?'—':money(risk.netRiskPnl,true));
 txt('max-entry',n(risk.maxStake)===null?'—':money(risk.maxStake));
 const used=n(risk.netRiskPnl)===null?0:Math.min(100,Math.max(0,-risk.netRiskPnl/20*100));
 $('risk-fill').style.width=used+'%';
 txt('risk-help',riskMode==='HARD'?'Hard halt reached: no further paper entries today.':
 riskMode==='SOFT'?'Soft limit reached: maximum $1.50 paper entry, strict 7/7 confirmations.':
 'Normal: max $3 per paper entry; at −$12 stricter rules begin, at −$20 new entries stop.');
 renderFeed(data);drawChart();
}
function remaining(value){
 const d=Date.parse(value),s=Math.ceil((d-Date.now())/1000);
 if(!Number.isFinite(s))return '—';
 if(s<=0)return 'Expired';
 return Math.floor(s/60)+'m '+String(s%60).padStart(2,'0')+'s remaining';
}
function activityRecords(data){
 const s=data.status||{},trades=data.activity?.trades||[],
  decisions=data.activity?.decisions||[];
 const out=[];
 if(s.lastNotice&&s.lastTick){
  let type=/^PAPER SELL/i.test(s.lastNotice)?'PAPER SELL':
   /^SIMULATED BUY|^PAPER BUY/i.test(s.lastNotice)?'PAPER BUY':
   /^PASS/i.test(s.lastNotice)&&!/^PASS \/ WATCH/i.test(s.lastNotice)?'PASS':'WATCH';
  out.push({time:s.lastTick,type,ticker:s.lastMarket||'',details:s.lastNotice});
 }
 for(const d of decisions){out.push({time:d.time||0,type:'PASS',
  ticker:d.ticker||'',details:d.reason||'No qualifying paper setup'})}
 for(const t of trades){
  if(t.exitAt)out.push({time:t.exitAt,type:'PAPER SELL',ticker:t.ticker||'',
   details:(t.side||'')+' '+(t.qty||'')+' × '+quote(t.exitPrice)+
    ' · P/L '+money(t.pnl,true)+' · '+String(t.reason||'Simulated exit')});
  if(t.time)out.push({time:t.time,type:'PAPER BUY',ticker:t.ticker||'',
   details:(t.side||'')+' '+(t.qty||'')+' × '+quote(t.entry)+' · '+money(t.cost)+' spent'});
 }
 if(s.open?.time)out.push({time:s.open.time,type:'PAPER BUY',
  ticker:s.open.ticker||'',details:(s.open.side||'')+' '+(s.open.qty||'')+
  ' paper contracts · still open'});
 out.sort((a,b)=>b.time-a.time);
 const seen=new Set();
 return out.filter(item=>{const k=item.type+':'+item.ticker+':'+Math.floor(item.time/1000);
  if(seen.has(k))return false;seen.add(k);return true}).slice(0,75);
}
function renderFeed(data){
 const root=$('activity-list');root.replaceChildren();
 const rows=activityRecords(data).filter(x=>filter==='ALL'||x.type===filter);
 if(!rows.length){const e=document.createElement('div');e.className='empty-state';
  e.textContent=filter==='ALL'?'No saved paper activity yet. The engine may be monitoring for qualifying setups.':'No '+filter+' events recorded.';root.append(e);return}
 for(const row of rows.slice(0,35)){
  const item=document.createElement('div');item.className='activity-item';
  const time=document.createElement('time');time.textContent=ct(row.time);
  const pillWrap=document.createElement('div'),pill=document.createElement('span');pill.className='event-pill '+
   (row.type==='PAPER BUY'?'buy':row.type==='PAPER SELL'?'sell':row.type==='PASS'?'pass':'watch');
  pill.textContent=row.type;pillWrap.append(pill);
  const ticker=document.createElement('span');ticker.className='ticker';ticker.textContent=row.ticker||'—';
  const desc=document.createElement('span');desc.className='notes';desc.textContent=row.details||'—';
  item.append(time,pillWrap,ticker,desc);root.append(item);
 }
}
function calcEMA(values,length){
 const out=new Array(values.length).fill(null);if(values.length<length)return out;
 let e=values.slice(0,length).reduce((a,b)=>a+b,0)/length;out[length-1]=e;
 for(let i=length;i<values.length;i++){e+=2/(length+1)*(values[i]-e);out[i]=e}
 return out;
}
function drawChart(){
 const canvas=$('price-chart'),ctx=canvas.getContext('2d');
 if(!ctx)return;
 const rows=(lastPayload?.market?.candles?.[tf]||[]).slice(-64);
 const dpr=Math.min(2,window.devicePixelRatio||1),width=Math.max(250,canvas.clientWidth||400),
  height=canvas.clientHeight||275;
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
 if(rows.length<10){$('chart-empty').classList.remove('hidden');return}
 $('chart-empty').classList.add('hidden');
 const closes=rows.map(r=>Number(r[4]));
 const em21=calcEMA(closes,21),em50=calcEMA(closes,50);
 const vals=rows.flatMap(r=>[r[2],r[3]]);
 const ymin=Math.min(...vals),ymax=Math.max(...vals),buffer=Math.max(.02,(ymax-ymin)*.12);
 const low=ymin-buffer,high=ymax+buffer;
 const left=9,top=13,right=65,bottom=30,pw=width-left-right,ph=height-top-bottom;
 const yy=v=>top+(high-v)/(high-low)*ph;
 ctx.strokeStyle='#304051';ctx.lineWidth=.65;ctx.font='10px system-ui';ctx.fillStyle='#8294a7';
 for(let i=0;i<=4;i++){
  const y=top+ph*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right+4,y);ctx.stroke();
  ctx.fillText(fmt(high-(high-low)*i/4,0),width-right+12,y+3);
 }
 const slot=pw/rows.length,bw=Math.min(9,slot*.6);
 rows.forEach((r,i)=>{
  const x=left+slot*(i+.5),up=r[4]>=r[1],color=up?'#7bcbb4':'#d38c97';
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(x,yy(r[2]));ctx.lineTo(x,yy(r[3]));ctx.stroke();
  const yTop=Math.min(yy(r[1]),yy(r[4])),h=Math.max(1,Math.abs(yy(r[4])-yy(r[1])));
  ctx.fillRect(x-bw/2,yTop,bw,h);
 });
 const line=(a,color)=>{
  ctx.lineWidth=1.6;ctx.strokeStyle=color;ctx.beginPath();let started=false;
  a.forEach((v,i)=>{if(n(v)===null)return;const x=left+slot*(i+.5),y=yy(v);
   if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y)});
  if(started)ctx.stroke();
 };
 line(em21,'#c0b3f1');line(em50,'#a6bde4');
 ctx.fillStyle='#8398aa';ctx.font='10px system-ui';
 for(let i=0;i<4;i++){
  const ix=Math.min(rows.length-1,Math.round(i*(rows.length-1)/3));
  const stamp=rows[ix][0]*1000;
  ctx.fillText(new Date(stamp).toLocaleTimeString('en-US',
   {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Chicago'}),
   left+slot*(ix+.5)-14,height-9);
 }
}
$('connect-form').addEventListener('submit',e=>{
 e.preventDefault();
 const value=$('view-key').value.trim();
 if(value.length<24){connectMessage('Viewing key must be at least 24 characters.',true);return}
 token=value;try{sessionStorage.setItem(KEY,token)}catch{}
 $('view-key').value='';load();
});
$('refresh').addEventListener('click',()=>{if(!token){connectionVisible(true);connectMessage('Enter your key to connect.')}else load()});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{
 filter=b.dataset.filter;
 document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));
 if(lastPayload)renderFeed(lastPayload)
}));
document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>{
 tf=b.dataset.tf;
 document.querySelectorAll('[data-tf]').forEach(x=>x.classList.toggle('selected',x===b));
 drawChart();
}));
window.addEventListener('resize',()=>{if(lastPayload)drawChart()});
setInterval(()=>{if(token&&!document.hidden)load()},30000);
setInterval(()=>{if(lastPayload){txt('metric-age',ago(lastPayload.status?.lastTick));
 txt('contract-time',lastPayload.market?.contract?.close_time?
 'Closes '+ct(lastPayload.market.contract.close_time)+' CT · '+remaining(lastPayload.market.contract.close_time):'Latest engine contract')}},15000);
if(token){load()}else{connectionVisible(true)}
