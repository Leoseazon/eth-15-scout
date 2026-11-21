'use strict';
/* ETH-15 Scout V4. Read-only UI: no buy/sell calls, no bot controls,
   no untrusted HTML, no third-party scripts or fabricated market data. */
const API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/dashboard';
const LOGIN_API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/login';
const JOURNAL_API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/journal';
const RESEARCH_API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/research';
const QUOTE_ARCHIVE_API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/quote-archive';
const REST_BOOK_ARCHIVE_API='https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/rest-book';
const KEY='eth15scout:v4:login-session';
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
let token='',expiresAt=0,lastPayload=null,filter='ALL',tf='m5',busy=false,signingIn=false;
let journalState={ready:false,anchor:null,offset:0,events:[],windows:[],totals:null};
let researchState={ready:false,anchor:null,offset:0,rows:[],anchorTotal:0,currentTotal:0};
function storeSession(result,remember){
 token=result.token;expiresAt=result.expiresAt;
 const destination=remember?localStorage:sessionStorage;
 try{localStorage.removeItem(KEY);sessionStorage.removeItem(KEY);
   destination.setItem(KEY,JSON.stringify({token,expiresAt}));}catch{}
}
function restoreSession(){
 for(const storage of [localStorage,sessionStorage]){
  try{
   const record=JSON.parse(storage.getItem(KEY)||'null');
   if(record&&typeof record.token==='string'&&record.token.length>=50&&
     Number.isFinite(record.expiresAt)&&record.expiresAt>Date.now()){
      token=record.token;expiresAt=record.expiresAt;return;
   }
   storage.removeItem(KEY);
  }catch{}
 }
}
restoreSession();
function connectMessage(s,bad=false){txt('connect-message',s);$('connect-message').style.color=bad?'#e5a1ab':''}
function connectionVisible(show){
 $('connect-panel').classList.toggle('hidden',!show);
 document.body.classList.toggle('unauthenticated',show);
 $('sign-out').hidden=show;
}
function reset(message='You have signed out. Use your same username and password to sign in again.'){
 token='';expiresAt=0;lastPayload=null;busy=false;
 journalState={ready:false,anchor:null,offset:0,events:[],windows:[],totals:null};
 researchState={ready:false,anchor:null,offset:0,rows:[],anchorTotal:0,currentTotal:0};
 try{sessionStorage.removeItem(KEY);localStorage.removeItem(KEY)}catch{}
 connectionVisible(true);txt('sync-label','Not connected');txt('updated-label','No data loaded');
 txt('mode-badge','Disconnected');cls('mode-badge','neutral');
 connectMessage(message);
}
function sanitizeErr(response){
 if(response.status===401)return 'Your session expired. Please sign in again using the same username and password.';
 if(response.status===429)return 'Too many sign-in attempts. Please try again shortly.';
 if(response.status===503)return 'The Cloudflare viewer login has not been activated yet.';
 if(response.status===403)return 'This website is not authorized to connect to the viewer.';
 return 'Unable to load V4 now (HTTP '+response.status+').';
}
async function login(){
 if(signingIn)return;
 const username=$('login-user').value.trim(),password=$('login-password').value;
 const remember=$('remember-device').checked;
 if(username.length<3||password.length<16){connectMessage('Enter your username and password (password minimum 16 characters).',true);return}
 signingIn=true;
 const btn=document.querySelector('.login-submit');btn.disabled=true;
 connectMessage('Checking your credentials…');
 try{
  const response=await fetch(LOGIN_API,{method:'POST',mode:'cors',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({username,password,remember})});
  if(!response.ok)throw new Error(response.status===401?'Incorrect username or password.':sanitizeErr(response));
  const result=await response.json();
  if(result.ok!==true||result.readOnly!==true||typeof result.token!=='string'||
     !Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())
    throw new Error('Invalid login response.');
  storeSession(result,remember);
  $('login-password').value='';
  connectMessage('Connected to the private V4 paper viewer.');
  await load();
 }catch(err){
  connectMessage(err instanceof TypeError?'Viewer is not connected to Cloudflare yet.':
   String(err.message||err),true);
 }finally{signingIn=false;btn.disabled=false}
}
async function load(){
 if(!token||busy)return;
 if(expiresAt<=Date.now()){reset('Your remembered session expired. Sign in again with your same username and password.');return}
 busy=true;txt('sync-label','Refreshing…');
 try{
  const response=await fetch(API,{mode:'cors',headers:{Authorization:'Bearer '+token},cache:'no-store'});
  if(response.status===401){reset('Session expired. Please sign in again using your same username and password.');return}
  if(!response.ok)throw new Error(sanitizeErr(response));
  const result=await response.json();
  if(result.paperOnly!==true||result.readOnly!==true)throw new Error('Unexpected response from the read-only viewer.');
  synchronizeJournal(result);
  synchronizeResearch(result);
  if(window.ScoutSounds)window.ScoutSounds.observe(result.activity?.events||[]);
  lastPayload=result;connectionVisible(false);render(result);
 }catch(err){
  const msg=err instanceof TypeError?'Unable to reach the V4 viewer. The Cloudflare gateway may not be deployed yet.':
   String(err?.message||err);
  txt('sync-label','Connection issue');
  if(!lastPayload)connectionVisible(true);
  connectMessage(msg,true);
  if(lastPayload)txt('updated-label','Last successful update '+ago(lastPayload.receivedAt)+' · retrying');
 }finally{busy=false}
}
function markTrend(id,t){txt(id,t==='UP'?'Uptrend':t==='DOWN'?'Downtrend':t==='NEUTRAL'?'Neutral':'Unavailable');cls(id,trendStyle(t))}
function quote(v){const a=n(Number(v));return a===null||a<=0?'—':fmt(a*100,1)+'¢'}
function latestPaperExecution(data){
 const s=data.status||{},candidates=[];
 const evs=Array.isArray(data.activity?.events)?data.activity.events:[];
 for(const e of evs){
  if(!['PAPER BUY','PAPER SELL'].includes(e.type))continue;
  const at=n(e.time)??n(e.at);
  if(at!==null)candidates.push({at,type:e.type,
   side:typeof e.msg==='string'?e.msg.match(/\b(UP|DOWN)\b/)?.[1]||'':null,
   ticker:e.ticker||'',message:e.msg||''});
 }
 const trades=Array.isArray(data.activity?.trades)?data.activity.trades:[];
 for(const t of trades){
  if(n(t.time)!==null)candidates.push({at:t.time,type:'PAPER BUY',
   side:t.side,ticker:t.ticker,message:'Entry '+quote(t.entry)+' · '+money(t.cost)+' spent'});
  if(n(t.exitAt)!==null)candidates.push({at:t.exitAt,type:'PAPER SELL',
   side:t.side,ticker:t.ticker,message:'Exit '+quote(t.exitPrice)+' · '+money(t.pnl,true)});
 }
 if(s.open&&n(s.open.time)!==null)candidates.push({at:s.open.time,type:'PAPER BUY',
   side:s.open.side,ticker:s.open.ticker,
   message:'Entry '+quote(s.open.entry)+' · '+money(s.open.cost)+' spent'});
 candidates.sort((a,b)=>b.at-a.at);
 return candidates[0]||null;
}
function renderObservationCohort(data){
 const markers=Array.isArray(data.activity?.releaseMarkers)?data.activity.releaseMarkers:[];
 const original=markers.find(x=>x.tag==='V4-OBSERVATION-50-100-20261119');
 const revised=markers.find(x=>x.tag==='V4-TIME40-6M-20261120');
 const latest=markers.find(x=>x.tag==='V4-80C-EIGHTMIN-20261120');
 const first=Number(original?.first_engine_tick_at);
 const prior=Number(revised?.first_engine_tick_at);
 const current=Number(latest?.first_engine_tick_at);
 const date=x=>new Date(x).toLocaleString('en-US',{timeZone:'America/Chicago',
  month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+' CT';
 txt('release-first-tick',Number.isFinite(first)&&first>0?date(first):'Awaiting original release');
 txt('revised-first-tick',Number.isFinite(prior)&&prior>0?date(prior):'Awaiting prior revision');
 txt('latest-first-tick',Number.isFinite(current)&&current>0?date(current):
   'Awaiting 8-min and honey-pot rule deployment');
 const feedTick=Number(markers.find(x=>x.tag==='V4-PHASE1-FEED-RELIABILITY-20261120')?.first_engine_tick_at);
 txt('feed-first-tick',Number.isFinite(feedTick)&&feedTick>0?date(feedTick):'Awaiting patch marker');
 const stats=data.status?.paperResults||{};
 const nLatest=stats.latestCohort;
 const nPrior=stats.revisedCohort;
 txt('observation-progress',Number.isFinite(nLatest)&&current>0?
  nLatest+' / 50–100 new-rule early paper exits · earlier trades separate':
  Number.isFinite(nPrior)&&prior>0?
   nPrior+' prior-rule early exits · new build not yet live':
   'Not started · awaiting confirmed strategy version');
}
function renderLiveAction(data){
 const s=data?.status||{},m=data?.market||{},open=s.open||null;
 const tickAge=Date.now()-Number(s.lastTick);
 const fresh=Number.isFinite(tickAge)&&tickAge>=0&&tickAge<=110000;
 const ticker=open?.ticker||s.lastMarket||m.contract?.ticker||null;
 const closeTime=open?.closeTime||
  (ticker===m.contract?.ticker?m.contract?.close_time:null);
 const last=latestPaperExecution(data),isLive=!!s.monitoring&&fresh;
 const riskMode=s.dailyRisk?.mode;
 let title='WATCHING FOR SETUP',side=null,state='watch';
 let desc=s.lastNotice||'Waiting for a qualifying V4 paper-trade setup.';
 if(!isLive){
  title='DATA NOT LIVE';state='stale';
  desc=s.monitoring?'Last bot report is stale. Do not treat an old signal as current.':
   'Bot monitoring is stopped. No new paper signals are being evaluated.';
 }else if(open){
  title='PAPER POSITION OPEN';side=open.side||null;state='buy';
  desc=s.lastNotice||'An actual V4 simulated position is open. Watch the close and bid quotes.';
 }else if(riskMode==='HARD'){
  title='NEW ENTRIES HALTED';state='stale';
  desc='Daily hard risk limit reached. Existing paper positions are still managed.';
 }else if(!s.armed){
  title='PAPER ENTRIES PAUSED';state='stale';
  desc='Monitoring is on but the V4 paper bot is not armed for simulated buys.';
 }else if(/^PAPER SELL\b/.test(s.lastNotice||'')){
  title='PAPER SELL RECORDED';state='sell';
 }else if(/^PASS\b(?!\s*\/\s*WATCH)/.test(s.lastNotice||'')){
  title='PASS — NO ENTRY';state='watch';
 }
 const target=$('live-action');
 target.dataset.state=state;
 txt('live-primary',title);
 txt('live-side',side||'—');
 $('live-side').hidden=!side;
 if(side)cls('live-side',side==='UP'?'success':'danger');
 txt('live-decision',desc);
 txt('live-contract-id',ticker||'No market reported');
 txt('live-freshness',isLive?'● LIVE BOT FEED':s.monitoring?'● STALE':'● OFFLINE');
 cls('live-freshness',isLive?'success':'warning');
 txt('live-asof',s.lastTick?'Last tick '+ago(s.lastTick):'No engine timestamp');
 const quoteAt=n(s.lastQuoteRetrievedAt);
 const quoteAge=quoteAt!==null?Date.now()-quoteAt:null;
 txt('live-proxy-age',quoteAge!==null&&quoteAge>=0?
  'Bot Kalshi quote '+ago(quoteAt):'Bot quote age unavailable');
 $('live-proxy-age').style.color=quoteAge!==null&&quoteAge>45000?
  'var(--amber)':'var(--sub)';
 if(open){
  txt('live-position-state',String(open.side||'')+' · '+String(open.qty||'—')+' contracts');
  txt('live-position-detail','Simulated entry '+ct(open.time)+' CT · '+String(open.ticker||''));
  txt('live-entry',quote(open.entry)+' / '+money(open.cost));
  txt('live-mark-pnl',n(open.markPnl)!==null?money(open.markPnl,true):'Not quotable');
  $('live-mark-pnl').style.color=n(open.markPnl)>0?'var(--mint)':
    n(open.markPnl)<0?'var(--red)':'var(--text)';
 }else{
  txt('live-position-state','NONE');
  txt('live-position-detail','No active simulated position on the bot');
  txt('live-entry','—');
  txt('live-mark-pnl','—');
  $('live-mark-pnl').style.color='var(--text)';
 }
 txt('live-countdown',closeTime?remaining(closeTime):'—');
 txt('live-close-label',closeTime?'Ends '+ct(closeTime)+' CT':'Close time unavailable');
 txt('live-last-trade',last?(last.type==='PAPER BUY'?'BUY':'SELL')+
  ' '+String(last.side||'').trim()+' · '+String(last.ticker||''):'No paper trade recorded');
 txt('live-last-trade-at',last?ct(last.at)+' CT · '+last.message:'—');
}
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
 const strike=c.floor_strike!==null&&c.floor_strike!==undefined&&c.floor_strike!==''?
  n(Number(c.floor_strike)):null;
 txt('contract-strike',strike!==null?money(strike):'Target unavailable');
 const quoteTime=n(c.quoteObservedAt)??n(m.asOf);
 const quoteFresh=quoteTime!==null&&now-quoteTime<45000&&now-quoteTime>=-5000;
 const contractCurrent=c.ticker===ticker&&Date.parse(c.close_time)>now;
 const quotesUsable=active&&contractCurrent&&quoteFresh;
 const yesAsk=quotesUsable?quote(c.yes_ask_dollars):'—';
 const noAsk=quotesUsable?quote(c.no_ask_dollars):'—';
 txt('up-quote',yesAsk);
 txt('down-quote',noAsk);
 txt('up-bid','Bid '+(quotesUsable?quote(c.yes_bid_dollars):'—'));
 txt('down-bid','Bid '+(quotesUsable?quote(c.no_bid_dollars):'—'));
 $('up-quote').parentElement.classList.toggle('missing',yesAsk==='—');
 $('down-quote').parentElement.classList.toggle('missing',noAsk==='—');
 const phase=s.settlementPhase;
 txt('settlement-phase',phase==='RTI_60_SECOND_AVERAGING_UNVERIFIED'?
  'FINAL 60s · CF RTI averaging underway · official samples unavailable':
  phase==='AWAITING_OFFICIAL_RESULT'?
  'Closed · awaiting finalized Kalshi exchange outcome':
  phase==='PRE_SETTLEMENT_AVERAGING'?
  'Official CF RTI 60-second average begins in the final minute':
  'CF RTI settlement status unavailable');
 txt('quote-freshness',quotesUsable?
  'Kalshi quote checked '+ago(quoteTime)+' · '+String(c.quoteSource||'Bot market snapshot'):
  !active?'Engine feed is stale · quotes hidden':
  'Quote unavailable or older than 45s · prices hidden');
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
 const unsettled=Array.isArray(data.activity?.pending)?data.activity.pending:[];
 const pendingCost=unsettled.reduce((sum,p)=>sum+(n(p.cost)??0),0);
 txt('pending-stake-value',unsettled.length?money(pendingCost):
   n(s.pending)===0?'$0.00':'Awaiting detailed journal');
 // Full SQLite ledger only: exchange outcome never rewrites early-sale P/L.
 const results=s.paperResults||data.activity?.journalTotals?.paperResults||null;
 const wins=n(results?.wins),losses=n(results?.losses),flats=n(results?.flats);
 txt('trades-value',n(results?.completed)===null?'—':results.completed);
 txt('wins-count',wins===null?'—':wins);
 txt('losses-count',losses===null?'—':losses);
 txt('win-rate',wins!==null&&losses!==null&&(wins+losses)>0?
  fmt(wins/(wins+losses)*100,1)+'%':'—');
 $('win-rate').title=flats!==null&&flats>0?
  flats+' flat paper trade(s) excluded from win rate':'Realized fee-adjusted paper trades';
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
 renderLiveAction(data);renderObservationCohort(data);renderFeed(data);renderOutcomes(data);updateJournalControls(data);renderResearch();renderStreamHealth(data);drawChart();drawQuoteChart();
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
 if(journalState.ready){
  const events=journalState.events;
  for(const e of events){
   if(!e?.type)continue;
   out.push({id:e.id,time:e.time||e.at||0,type:e.type,
     ticker:e.ticker||'',details:e.msg||'—'});
  }
  if(s.lastNotice&&s.lastTick){
   const duplicate=events.some(e=>e.msg===s.lastNotice&&e.ticker===s.lastMarket&&
      Math.abs((e.time||0)-s.lastTick)<90000);
   if(!duplicate){
    const type=/^PAPER SELL/i.test(s.lastNotice)?'PAPER SELL':
      /^SIMULATED BUY|^PAPER BUY/i.test(s.lastNotice)?'PAPER BUY':
      /^PASS(?! \/ WATCH)/i.test(s.lastNotice)?'PASS':'WATCH';
    // A bot-status line is NOT a validated trade event: do not create fake
    // buys/sells from status text and never use it for audio notifications.
    if(type==='WATCH')out.push({time:s.lastTick,type:'WATCH',ticker:s.lastMarket||'',
      details:s.lastNotice});
   }
  }
 }else{
  if(s.lastNotice&&s.lastTick){
   const type=/^PAPER SELL/i.test(s.lastNotice)?'PAPER SELL':
     /^SIMULATED BUY|^PAPER BUY/i.test(s.lastNotice)?'PAPER BUY':
     /^PASS(?! \/ WATCH)/i.test(s.lastNotice)?'PASS':'WATCH';
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
 }
 // Reconstruct older paper BUY/SELL time-left labels only when both
 // original event timestamp and contract close time are preserved.
 const known=new Map();
 for(const position of [...(data.activity?.trades||[]),
    ...(data.activity?.pending||[]),...(s.open?[s.open]:[])]){
   if(position?.ticker&&position.closeTime)known.set(position.ticker,position.closeTime);
 }
 for(const item of out){
   if(!['PAPER BUY','PAPER SELL'].includes(item.type))continue;
   if(/\b\d+m\s+\d+s remaining\b/.test(item.details||''))continue;
   const close=Date.parse(known.get(item.ticker)||'');
   const at=n(item.time);
   if(Number.isFinite(close)&&at!==null&&at<=close){
     const secs=Math.max(0,Math.ceil((close-at)/1000));
     item.details+=' · '+Math.floor(secs/60)+'m '+String(secs%60).padStart(2,'0')+'s remaining';
   }
 }
 out.sort((a,b)=>b.time-a.time);
 const seen=new Set();
 return out.filter(item=>{const k=item.id||item.type+':'+item.ticker+':'+Math.floor(item.time/1000);
  if(seen.has(k))return false;seen.add(k);return true});
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
function synchronizeJournal(result){
 const activity=result.activity||{};
 if(!activity.journalAvailable)return;
 const events=Array.isArray(activity.events)?activity.events:[];
 const windows=Array.isArray(activity.windows)?activity.windows:[];
 if(!journalState.ready){
  journalState={ready:true,anchor:activity.journalAnchor,
   offset:Math.max(events.length,windows.length),events:[...events],
   windows:[...windows],totals:activity.journalTotals||null};
 }else{
  const seen=new Set(journalState.events.map(x=>x.id||[x.time,x.type,x.ticker,x.msg].join('|')));
  for(const e of events){
   const key=e.id||[e.time,e.type,e.ticker,e.msg].join('|');
   if(!seen.has(key)){journalState.events.push(e);seen.add(key)}
  }
  const ids=new Map(journalState.windows.map(w=>[w.ticker,w]));
  for(const w of windows)if(w?.ticker)ids.set(w.ticker,w);
  journalState.windows=[...ids.values()];
 }
 journalState.events.sort((a,b)=>(b.time||b.at||0)-(a.time||a.at||0));
 journalState.windows.sort((a,b)=>(b.closeAt||0)-(a.closeAt||0));
}
function updateJournalControls(data){
 const totals=journalState.totals,ready=journalState.ready;
 $('older-events').disabled=!ready||journalState.offset>=Math.max(
   Number(totals?.events||0),Number(totals?.windows||0),
   Number(totals?.trades||0),Number(totals?.decisions||0));
 $('export-trades').disabled=!ready;
 $('export-journal').disabled=!ready;
 txt('journal-summary',ready?
  String(totals?.events??'—')+' recorded events · '+
  String(totals?.trades??'—')+' completed trade exits · '+
  String(totals?.decisions??'—')+' final PASS decisions · '+
  String(totals?.windows??'—')+' Kalshi market windows · '+
  String((data.activity?.pending||[]).length)+' unresolved positions'
  :'Full journal available after updated V4 gateway deployment');
}
function renderOutcomes(data){
 const root=$('outcome-list');if(!root)return;
 root.replaceChildren();
 const recent=Array.isArray(data.activity?.windows)?data.activity.windows:[];
 const ids=new Map(journalState.windows.map(w=>[w.ticker,w]));
 for(const w of recent)if(w?.ticker)ids.set(w.ticker,w);
 const windows=[...ids.values()].sort((a,b)=>(b.closeAt||0)-(a.closeAt||0));
 const totalRaw=data.activity?.journalTotals?.windows;
 const allTotal=totalRaw===undefined||totalRaw===null?NaN:Number(totalRaw);
 const officialRaw=data.activity?.journalTotals?.officialWindows;
 const allOfficial=officialRaw===undefined||officialRaw===null?NaN:Number(officialRaw);
 // User preference: retain the official exchange journal on the website
 // ONLY after the backend actually verifies at least one finalized result.
 // A list of PENDING/REPORTED records must never imply live verification.
 const officialPanel=$('outcome-list')?.closest('.outcome-section');
 if(officialPanel)officialPanel.hidden=!(Number.isSafeInteger(allOfficial)&&allOfficial>0);
 txt('outcome-count',Number.isFinite(allTotal)&&Number.isFinite(allOfficial)?
  allTotal+' archived · '+allOfficial+' official':
  windows.length?windows.length+' shown · full totals pending':'No records');
 const eventMap=new Map(),records=activityRecords(data);
 for(const e of records){
  const arr=eventMap.get(e.ticker)||[];
  arr.push(e.type);eventMap.set(e.ticker,arr);
 }
 const trades=[...(data.activity?.trades||[])];
 if(data.status?.open)trades.push(data.status.open);
 for(const t of trades){
  if(!t.ticker)continue;
  const arr=eventMap.get(t.ticker)||[];
  if(!arr.includes('PAPER BUY'))arr.push('PAPER BUY');
  eventMap.set(t.ticker,arr);
 }
 if(!windows.length){
  const empty=document.createElement('div');empty.className='empty-state';
  empty.textContent='Awaiting V4 exchange-result journal activation. No outcome will be guessed from the price chart.';
  root.append(empty);
 }else{
  for(const w of windows.slice(0,30)){
   const line=document.createElement('div');line.className='outcome-item';
   const date=document.createElement('time');
   date.textContent=w.closeAt?new Date(w.closeAt).toLocaleString('en-US',{
    timeZone:'America/Chicago',month:'short',day:'2-digit',
    hour:'2-digit',minute:'2-digit'}):'—';
   const result=document.createElement('div');
   const badge=document.createElement('span');
   badge.className='outcome-pill '+(w.status==='OFFICIAL_RESULT'?
     w.outcome==='UP'?'up':'down':w.status==='VOID'?'void':'pending');
   badge.textContent=w.status==='OFFICIAL_RESULT'?w.outcome+' · OFFICIAL':
     w.status==='VOID'?'VOID':w.status==='REPORTED'?'REPORTED · UNCONFIRMED':'PENDING';
   result.append(badge);
   const activity=document.createElement('span');activity.className='outcome-action';
   const types=eventMap.get(w.ticker)||[];
   activity.textContent=types.includes('PAPER BUY')?'Paper trade':
     types.includes('PASS')?'PASS':types.includes('WATCH')?'WATCH':'No recorded entry';
   const contract=document.createElement('span');contract.className='outcome-ticker';
   contract.textContent=w.ticker||'—';
   line.append(date,result,activity,contract);root.append(line);
  }
 }
 const scan=data.activity?.windowScan;
 txt('outcome-status',scan?.error?
  'Kalshi result scan is currently unavailable; earlier official records are preserved. Details: '+scan.error:
  scan?.verifiedAt?'Source: Kalshi public API · Last successful check '+ago(scan.verifiedAt)+
   ' · Only settled, non-provisional outcomes are confirmed':
  'Kalshi exchange outcomes are pending activation on the V4 bot. No Kraken-derived outcomes are displayed.');
}
function journalStatus(message){txt('journal-message',message)}
async function journalPage(offset,anchor){
 const url=new URL(JOURNAL_API);url.searchParams.set('offset',String(offset));
 url.searchParams.set('limit','100');
 if(anchor)url.searchParams.set('anchor',String(anchor));
 const r=await fetch(url.toString(),{cache:'no-store',
  headers:{Authorization:'Bearer '+token}});
 if(!r.ok)throw new Error('Journal page unavailable (HTTP '+r.status+')');
 const j=await r.json();
 if(j.paperOnly!==true||j.readOnly!==true||
    !Array.isArray(j.events)||!Array.isArray(j.trades)||!Array.isArray(j.decisions)||
    !Array.isArray(j.windows))
   throw new Error('Invalid journal response');
 return j;
}
async function olderEvents(){
 if(!journalState.ready||!token)return;
 $('older-events').disabled=true;journalStatus('Loading older research records…');
 try{
  const page=await journalPage(journalState.offset,journalState.anchor);
  const have=new Set(journalState.events.map(e=>e.id));
  for(const e of page.events)if(!have.has(e.id)){journalState.events.push(e);have.add(e.id)}
  const winIds=new Set(journalState.windows.map(w=>w.ticker));
  for(const w of page.windows)if(w?.ticker&&!winIds.has(w.ticker)){
   journalState.windows.push(w);winIds.add(w.ticker);
  }
  journalState.offset+=Math.max(page.events.length,page.windows.length,page.trades.length,page.decisions.length);
  journalState.events.sort((a,b)=>(b.time||b.at||0)-(a.time||a.at||0));
  journalState.windows.sort((a,b)=>(b.closeAt||0)-(a.closeAt||0));
  if(lastPayload){renderFeed(lastPayload);renderOutcomes(lastPayload);updateJournalControls(lastPayload)}
  journalStatus('Loaded '+page.events.length+' older entries and '+page.windows.length+
   ' exchange windows. Existing journal entries were preserved.');
 }catch(err){
  journalStatus('Older history could not load: '+String(err.message||err));
  if(lastPayload)updateJournalControls(lastPayload);
 }
}
async function fullJournal(){
 if(!token||!journalState.ready)throw new Error('V4 journal is not connected');
 let offset=0,anchor=journalState.anchor,totals=null,
  events=[],trades=[],decisions=[],windows=[],pending=[];
 do{
  const page=await journalPage(offset,anchor);
  anchor=page.anchor;totals=page.totals||{events:0,trades:0,decisions:0,windows:0};
  events.push(...page.events);trades.push(...page.trades);
  decisions.push(...page.decisions);windows.push(...page.windows);
  if(!offset)pending=Array.isArray(page.pending)?page.pending:[];
  offset+=100;
  if(offset%1000===0)journalStatus('Exporting historical journal… '+offset+' records scanned per category.');
 }while(offset<Math.max(Number(totals.events)||0,Number(totals.trades)||0,
   Number(totals.decisions)||0,Number(totals.windows)||0));
 return {format:'ETH-15 Scout V4 research journal',version:2,
  createdAt:new Date().toISOString(),anchor,
  note:'Simulated fills and fees. Kalshi settled outcome separate from simulated P&L.',
  totals,events,trades,decisions,windows,pending,
  releaseMarkers:lastPayload?.activity?.releaseMarkers||[],
  open:lastPayload?.status?.open||null,
  account:lastPayload?.status||null};
}
function download(name,content,mime){
 const blob=new Blob([content],{type:mime}),href=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=href;a.download=name;
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(href),6000);
}
function csvText(journal){
 const fields=['ticker','side','qty','status','entry_time_utc','exit_time_utc',
  'entry_price','exit_price','entry_fee','exit_fee','total_cost','net_proceeds',
  'net_pnl','settlement_confirmed','exit_reason'];
 const csvCell=v=>{
  const value=String(v??'');
  // Defend analysts opening CSV in Excel from formula injection.
  const safe=/^[\s]*[=+@]/.test(value)?"'"+value:value;
  return '"'+safe.replace(/"/g,'""')+'"';
 };
 const format=t=>[t.ticker,t.side,t.qty,t.status,
  t.time?new Date(t.time).toISOString():'',
  t.exitAt?new Date(t.exitAt).toISOString():'',
  t.entry,t.exitPrice,t.entryFee,t.sellFee,t.cost,t.proceeds,t.pnl,
  t.confirmed===true?'YES':'NO',t.reason||''];
 return [fields.join(','),...journal.trades.map(t=>format(t).map(csvCell).join(',')),
  ...journal.pending.map(t=>format({...t,confirmed:false,status:'PENDING'}).map(csvCell).join(',')),
  ...(journal.open?[format({...journal.open,confirmed:false,status:'OPEN'}).map(csvCell).join(',')]:[])
 ].join('\r\n');
}
async function exportResearch(type){
 const btn=$(type==='csv'?'export-trades':'export-journal');
 btn.disabled=true;journalStatus('Preparing complete anchored V4 paper journal…');
 try{
  const data=await fullJournal(),stamp=new Date().toISOString().slice(0,10);
  if(type==='csv'){
   download('ETH-15-Scout-V4-Trades-'+stamp+'.csv',csvText(data),'text/csv;charset=utf-8');
  }else{
   download('ETH-15-Scout-V4-Research-'+stamp+'.json',
    JSON.stringify(data,null,2),'application/json');
  }
  journalStatus('Research export prepared: '+data.events.length+' events, '+
   data.trades.length+' completed exits, '+data.decisions.length+
   ' final PASS decisions, '+data.windows.length+
   ' exchange market outcomes. Nothing was deleted from Cloudflare.');
 }catch(err){journalStatus('Export could not complete: '+String(err.message||err))}
 finally{btn.disabled=!journalState.ready}
}
function setSoundUI(){
 const sound=window.ScoutSounds;
 const enabled=!!sound?.enabled;
 txt('sound-summary',enabled?'♫ Sounds on':'♩ Sounds off');
 $('sound-summary').classList.toggle('enabled',enabled);
 txt('sound-toggle',enabled?'Mute sounds':'Enable trade sounds');
 $('sound-toggle').setAttribute('aria-pressed',String(enabled));
}
$('sound-toggle').addEventListener('click',async()=>{
 const sound=window.ScoutSounds;
 if(!sound){return}
 const good=await sound.setEnabled(!sound.enabled);
 if(!good)$('sound-toggle').title='Audio blocked by this browser. Try clicking a preview.';
 setSoundUI();
});
$('preview-buy').addEventListener('click',()=>window.ScoutSounds?.preview('PAPER BUY'));
$('preview-sell').addEventListener('click',()=>window.ScoutSounds?.preview('PAPER SELL'));
$('older-events').addEventListener('click',olderEvents);
$('export-trades').addEventListener('click',()=>exportResearch('csv'));
$('export-journal').addEventListener('click',()=>exportResearch('json'));
setSoundUI();

$('connect-form').addEventListener('submit',e=>{e.preventDefault();login()});
$('sign-out').addEventListener('click',()=>reset());
$('refresh').addEventListener('click',()=>{if(!token){connectionVisible(true);connectMessage('Sign in to connect to V4.')}else load()});
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
setInterval(()=>{if(token&&!document.hidden)load()},15000);
setInterval(()=>{if(lastPayload){renderLiveAction(lastPayload);txt('metric-age',ago(lastPayload.status?.lastTick));
 txt('contract-time',lastPayload.market?.contract?.close_time?
 'Closes '+ct(lastPayload.market.contract.close_time)+' CT · '+remaining(lastPayload.market.contract.close_time):'Latest engine contract')}},15000);
if(token&&expiresAt>Date.now()){connectionVisible(false);load()}
else{connectionVisible(true)}

/* V4 preliminary quote timeline. Only recorded bid values; never fill in missing prices. */
function drawQuoteChart(){
 const canvas=$('v4-quote-chart'),meta=$('v4-quote-meta');
 if(!canvas||!meta)return;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 const w=Math.max(300,Math.round(canvas.getBoundingClientRect().width));
 const h=Math.max(120,Math.round(canvas.getBoundingClientRect().height));
 const scale=Math.min(2,window.devicePixelRatio||1);
 canvas.width=Math.floor(w*scale);canvas.height=Math.floor(h*scale);
 ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,w,h);
 const ticker=lastPayload?.status?.lastMarket||lastPayload?.market?.contract?.ticker;
 // Use recorded WebSocket book levels only when they actually exist.
 // Never claim a REST fallback observation is a real-time exchange tick.
 const stream=Array.isArray(lastPayload?.streamHistory)?
   lastPayload.streamHistory.filter(q=>q?.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&
     q.ticker===ticker&&Number.isSafeInteger(q.receivedAt)):[]; 
 const streaming=stream.length>0;
 const officialRest=Array.isArray(lastPayload?.restBookHistory)?
   lastPayload.restBookHistory.filter(q=>
     q?.source==='KALSHI_OFFICIAL_REST_ORDERBOOK'&&q.ticker===ticker&&
     Number.isSafeInteger(q.receivedAt)):[];
 const directRest=!streaming&&officialRest.length>0;
 const raw=streaming?stream.map(q=>({
   ticker:q.ticker,observed_at:q.receivedAt,
   yes_bid:q.valid&&q.fresh?q.yesBid?.price??null:null,
   no_bid:q.valid&&q.fresh?q.noBid?.price??null:null
 })):directRest?officialRest.map(q=>({
   ticker:q.ticker,observed_at:q.receivedAt,
   yes_bid:!q.lockedOrCrossed?q.yesBid?.price??null:null,
   no_bid:!q.lockedOrCrossed?q.noBid?.price??null:null
 })):(Array.isArray(lastPayload?.quoteHistory)?lastPayload.quoteHistory:[]);
 const data=raw.filter(q=>q?.ticker===ticker&&Number.isFinite(Number(q.observed_at)))
   .sort((a,b)=>Number(a.observed_at)-Number(b.observed_at));
 txt('v4-quote-source',streaming?'Kalshi WebSocket book · read-only archive':
   directRest?'Official Kalshi REST depth · receipt timestamps only':
   'REST proxy quotes · best effort · may be cached');
 const left=30,right=w-16,top=12,bottom=h-26;
 ctx.strokeStyle='#334663';ctx.lineWidth=1;ctx.fillStyle='#94a7c5';ctx.font='11px sans-serif';
 for(let i=0;i<=4;i++){
  const y=top+(bottom-top)*i/4;
  ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  ctx.fillText(String(Math.round((1-i/4)*100))+'¢',0,y+4);
 }
 if(data.length<2){meta.textContent='Insufficient historical quote observations. V4 streaming may not be active.';return}
 const min=Number(data[0].observed_at),max=Number(data.at(-1).observed_at);
 function line(key,color){
  ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let drawing=false,count=0,lastX=0;
  for(const q of data){
   const n=Number(q[key]),valid=q[key]!==null&&q[key]!==undefined&&Number.isFinite(n)&&n>=0&&n<=1;
   if(!valid){drawing=false;continue}
   const x=left+(right-left)*(Number(q.observed_at)-min)/Math.max(1,max-min);
   const y=top+(bottom-top)*(1-n);
   if(!drawing||x>lastX+Math.max(1,(right-left)*5000/Math.max(1,max-min)))ctx.moveTo(x,y);
   else ctx.lineTo(x,y);
   lastX=x;
   drawing=true;count++;
  }
  if(count>1)ctx.stroke();
 }
 line('yes_bid','#49d9f5');line('no_bid','#a78bfa');
 ctx.fillStyle='#91a3c1';ctx.fillText(new Date(min).toLocaleTimeString(),left,bottom+17);
 ctx.textAlign='right';ctx.fillText(new Date(max).toLocaleTimeString(),right,bottom+17);
 ctx.textAlign='start';
 const up=data.filter(q=>q.yes_bid!==null).length,no=data.filter(q=>q.no_bid!==null).length;
 meta.textContent=(streaming?'Recorded WebSocket observations: ':'Recorded REST observations: ')+
  data.length+' · UP bid values: '+up+' · DOWN bid values: '+no+
  ' · Cyan: UP bid / Violet: DOWN bid. '+
  (streaming?'Historic snapshots of displayed bids; not proven fills or settlement values.':
   directRest?'Direct REST order-book bids; receipt time only, no exchange event timestamp or proven fills.':
   'REST proxy prices may be cached; no verified exchange event timestamps.');
}


/* V4 research evidence: read-only, anchored and never stored in localStorage.
 * Original V3 journals remain independent; no simulated fill is claimed here.
 */
function synchronizeResearch(data){
 if(data.researchAvailable!==true||!Array.isArray(data.researchHistory))return;
 const recent=data.researchHistory.filter(x=>Number.isSafeInteger(x?.id)&&x.id>0);
 const nTotal=Number(data.researchTotal);
 if(!researchState.ready){
  researchState={ready:true,
   anchor:Number.isSafeInteger(data.researchAnchor)?data.researchAnchor:0,
   offset:recent.length,rows:[...recent],
   anchorTotal:Number.isSafeInteger(nTotal)?nTotal:0,
   currentTotal:Number.isSafeInteger(nTotal)?nTotal:0};
 }else{
  researchState.currentTotal=Number.isSafeInteger(nTotal)?nTotal:researchState.currentTotal;
  const ids=new Set(researchState.rows.map(x=>x.id));
  for(const row of recent)if(!ids.has(row.id)){
   researchState.rows.push(row);ids.add(row.id);
  }
  researchState.rows.sort((a,b)=>b.id-a.id);
 }
}
function researchElement(r){
 const el=document.createElement('div');el.className='research-item';
 const date=document.createElement('time');
 date.textContent=r.observedAt?new Date(r.observedAt).toLocaleString('en-US',{
  timeZone:'America/Chicago',month:'short',day:'numeric',hour:'2-digit',
  minute:'2-digit',second:'2-digit'}):'—';
 const contract=document.createElement('span');
 contract.className='research-ticker';
 contract.textContent=r.ticker||'No valid market';
 const feed=document.createElement('div');
 const status=document.createElement('strong');
 const good=r.dataStatus==='READY_FOR_HEURISTIC_EVALUATION';
 status.className=good?'research-healthy':'research-incomplete';
 status.textContent=good?'Baseline feeds complete':'Feeds incomplete';
 const prices=document.createElement('small');
 prices.textContent='REST UP '+quote(r.quote?.yesAsk)+' · DOWN '+quote(r.quote?.noAsk)+
  ' · Kraken '+(n(r.kraken?.spot)===null?'—':'$'+fmt(r.kraken.spot,2));
 feed.append(status,prices);
 const decision=document.createElement('div');
 const summary=document.createElement('div');
 const probe=r.decision?.shadowProbe;
 summary.textContent=probe?.status==='HEURISTIC_CANDIDATE'?
  'SHADOW CANDIDATE ONLY · '+String(probe.candidate?.side||'')+
  ' '+quote(probe.candidate?.ask)+' · '+String(probe.candidate?.strategy||'baseline')+
  ' · not an approved or executable trade':
  probe?.status==='WATCH'?
   'SHADOW WATCH · '+String(probe.reason||'No baseline candidate')+
   (Array.isArray(probe.rejections)&&probe.rejections.length?
     ' · '+probe.rejections.join('; ').slice(0,180):''):
  String(r.decision?.notice||r.lastError||'No decision note recorded');
 const details=document.createElement('details');details.className='research-detail';
 const toggle=document.createElement('summary');toggle.textContent='View feed, signal and timing evidence';
 const payload=document.createElement('pre');
 payload.textContent=JSON.stringify({
  observedAt:r.observedAt,processingMs:r.processingMs,
  secondsRemaining:r.secondsRemaining,quote:r.quote,
  reference:r.kraken,feeds:r.feeds,issues:r.issues,
  dailyRegime:r.dailyRegime,decision:r.decision,
  paperSnapshot:r.paperSnapshot,lastError:r.lastError},null,2);
 details.append(toggle,payload);
 decision.append(summary,details);
 el.append(date,contract,feed,decision);
 return el;
}
function renderResearch(){
 const root=$('research-list');if(!root)return;
 root.replaceChildren();
 const ready=researchState.ready;
 $('research-older').disabled=!ready||researchState.offset>=researchState.anchorTotal;
 $('research-export').disabled=!ready||!journalState.ready;
 $('stop-audit-run').disabled=!ready||!journalState.ready||!window.ScoutStopAudit;
 txt('research-count',ready?String(researchState.currentTotal)+' recorded':'Not collecting yet');
 txt('research-summary',ready?
  String(researchState.currentTotal)+' durable engine observations · '+
  String(researchState.rows.length)+' currently loaded · '+
  String(researchState.anchorTotal)+' in original anchored history · '+
  String(lastPayload?.streamArchiveTotal??'—')+' recorded WebSocket book observations · '+
  String(lastPayload?.restBookArchiveTotal??'—')+' official REST depth snapshots':
  'V4 is not connected to its research recorder. No observation is being claimed.');
 if(!ready||!researchState.rows.length){
  const empty=document.createElement('div');empty.className='empty-state';
  empty.textContent=ready?'No research observations recorded yet. No historical data has been invented.':
   'V4 research recorder has not been deployed or connected. Development-only records cannot appear here.';
  root.append(empty);return;
 }
 const shown=researchState.rows.slice(0,250);
 for(const r of shown)root.append(researchElement(r));
 if(researchState.rows.length>shown.length){
  const note=document.createElement('p');note.className='fine';
  note.textContent='Showing 250 of '+researchState.rows.length+
   ' loaded records for performance. Full history remains available in the JSON export.';
  root.append(note);
 }
}
function researchStatus(message){txt('research-message',message);}
async function researchPageRequest(offset,anchor){
 const url=new URL(RESEARCH_API);
 url.searchParams.set('limit','100');url.searchParams.set('offset',String(offset));
 if(anchor!==null)url.searchParams.set('anchor',String(anchor));
 const resp=await fetch(url.toString(),{cache:'no-store',
  headers:{Authorization:'Bearer '+token}});
 if(!resp.ok)throw Error('Research page unavailable (HTTP '+resp.status+')');
 const page=await resp.json();
 if(page.readOnly!==true||page.paperOnly!==true||!Array.isArray(page.ticks)||
  !Number.isSafeInteger(page.total)||!Number.isSafeInteger(page.anchor))
  throw Error('Invalid research archive response');
 return page;
}
async function loadOlderResearch(){
 if(!researchState.ready||!token)return;
 $('research-older').disabled=true;
 researchStatus('Loading older V4 decision evidence…');
 try{
  const page=await researchPageRequest(researchState.offset,researchState.anchor);
  if(page.anchor!==researchState.anchor||page.total!==researchState.anchorTotal)
   throw Error('Research anchor changed; reload the dashboard');
  if(!page.ticks.length&&researchState.offset<researchState.anchorTotal)
   throw Error('Research archive ended unexpectedly');
  const ids=new Set(researchState.rows.map(x=>x.id));
  for(const r of page.ticks)if(!ids.has(r.id)){
   researchState.rows.push(r);ids.add(r.id);
  }
  researchState.offset+=page.ticks.length;
  researchState.rows.sort((a,b)=>b.id-a.id);
  renderResearch();
  researchStatus('Loaded '+page.ticks.length+' older observations; no V4 records were deleted.');
 }catch(err){
  researchStatus('Older research unavailable: '+String(err?.message||err));
  renderResearch();
 }
}
async function exportArchive(url,collection){
 let anchor=null,offset=0,total=null;const records=[];
 for(;;){
  const u=new URL(url);u.searchParams.set('limit','100');
  u.searchParams.set('offset',String(offset));
  if(anchor!==null)u.searchParams.set('anchor',String(anchor));
  const resp=await fetch(u.toString(),{cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
  if(!resp.ok)throw Error('Archive export interrupted (HTTP '+resp.status+')');
  const page=await resp.json();
  if(page.paperOnly!==true||page.readOnly!==true||
   !Array.isArray(page[collection])||
   !Number.isSafeInteger(page.anchor)||!Number.isSafeInteger(page.total))
   throw Error('Unverified archive response');
  if(anchor===null){anchor=page.anchor;total=page.total}
  else if(anchor!==page.anchor||total!==page.total)
   throw Error('Archive changed within the anchored export');
  const batch=page[collection];
  records.push(...batch);offset+=batch.length;
  if(offset>=total)return {anchor,total,records};
  if(!batch.length||offset>1000000)throw Error(
   'Archive exceeds the available pagination range; export not marked complete');
  if(offset%1000===0)researchStatus('Exporting '+collection+'… '+offset+'/'+total);
 }
}
/* Cursor-based Kalshi book history (unlike REST OFFSET endpoints).
 * Bound a single browser export so we never falsely claim a complete backup
 * after a crash or out-of-memory error. The read-only cursor API itself has
 * no one-million-row offset ceiling.
 */
async function exportStreamArchive(){
 if(lastPayload?.streamAvailable!==true)
  return {anchor:null,total:null,records:[],available:false};
 let anchor=null,before=null,total=null;
 const records=[];
 for(;;){
  const url=new URL('https://eth-15-scout-v4-view.leoseazon.workers.dev/api/v4/stream');
  url.searchParams.set('limit','100');
  if(anchor!==null)url.searchParams.set('anchor',String(anchor));
  if(before!==null)url.searchParams.set('before',String(before));
  const response=await fetch(url.toString(),{cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('Stream archive HTTP '+response.status);
  const p=await response.json();
  if(p.readOnly!==true||p.paperOnly!==true||
   !Array.isArray(p.items)||!Number.isSafeInteger(p.anchor)||
   !Number.isSafeInteger(p.total))
   throw Error('Stream archive pagination invalid');
  if(anchor===null){anchor=p.anchor;total=p.total}
  else if(anchor!==p.anchor||total!==p.total)
   throw Error('Stream archive snapshot inconsistent');
  if(total>50000)throw Error(
   'Stream history exceeds the 50,000-record safe browser-export limit. '+
   'Complete cursor archive remains on the private gateway; a chunked backup is required.');
  records.push(...p.items);
  if(records.length>=total)return {anchor,total,records,available:true};
  if(!p.items.length||!Number.isSafeInteger(p.nextBefore))
   throw Error('Incomplete Kalshi stream archive');
  before=p.nextBefore;
  if(records.length%1000===0)researchStatus(
   'Exporting authenticated streaming observations… '+records.length+'/'+total);
 }
}
/* Separately anchored official REST-depth snapshots. Receipt times are not
 * exchange timestamps and no observed depth guarantees an executable fill. */
async function exportRestBookArchive(){
 if(lastPayload?.restBookAvailable!==true)
  return {anchor:null,total:null,records:[],available:false};
 let anchor=null,before=null,total=null;
 const records=[];
 for(;;){
  const u=new URL(REST_BOOK_ARCHIVE_API);
  u.searchParams.set('limit','100');
  if(anchor!==null)u.searchParams.set('anchor',String(anchor));
  if(before!==null)u.searchParams.set('before',String(before));
  const response=await fetch(u.toString(),{cache:'no-store',
   headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('REST depth archive HTTP '+response.status);
  const p=await response.json();
  if(p.readOnly!==true||p.paperOnly!==true||p.isWebSocket!==false||
     p.source!=='KALSHI_OFFICIAL_REST_ORDERBOOK'||
     !Array.isArray(p.items)||!Number.isSafeInteger(p.anchor)||
     !Number.isSafeInteger(p.total))
    throw Error('REST depth archive provenance or pagination invalid');
  if(anchor===null){anchor=p.anchor;total=p.total}
  else if(anchor!==p.anchor||total!==p.total)
    throw Error('REST depth archive anchored totals changed');
  if(total>50000)throw Error(
    'REST depth history exceeds the 50,000-row safe browser export limit. '+
    'Use a paginated private backup.');
  records.push(...p.items);
  if(records.length>=total)return {anchor,total,records,available:true};
  if(!p.items.length||!Number.isSafeInteger(p.nextBefore))
    throw Error('Incomplete official REST depth archive');
  before=p.nextBefore;
 }
}
async function exportCompleteEvidence(){
 const btn=$('research-export');if(!token||!researchState.ready||!journalState.ready)return;
 btn.disabled=true;researchStatus('Building anchored research export from Cloudflare…');
 try{
  const base=await fullJournal();
  const [ticks,quotes,stream,restBooks]=await Promise.all([
   exportArchive(RESEARCH_API,'ticks'),
   exportArchive(QUOTE_ARCHIVE_API,'quotes'),
   exportStreamArchive(),exportRestBookArchive()
  ]);
  const payload={format:'ETH-15 Scout V4 complete research evidence',version:4,
   exportedAt:new Date().toISOString(),paperOnly:true,
   completeness:'Complete through each included per-source high-water anchor',
   warnings:[
    'Kalshi REST snapshots may be cached and are not verified exchange tick times.',
    'Kraken spot is not the official Kalshi settlement index.',
    'Displayed prices are not verified executable fills.',
    'Streaming history requires confirmed book snapshots, not REST inference.',
    'Official REST depth observations have receipt timestamps only and unknown source-event ages.'
   ],
   journals:base,researchTicks:ticks.records,restQuoteArchive:quotes.records,
   officialRestBookArchive:restBooks.records,restBookArchiveAvailable:restBooks.available,
   webSocketBookArchive:stream.records,streamArchiveAvailable:stream.available,
   stopPostmortem:window.ScoutStopAudit?.analyzeStopHistory(
     base.trades,quotes.records,base.windows)||null,
   anchors:{journal:base.anchor,research:ticks.anchor,quotes:quotes.anchor,stream:stream.anchor,
    restBook:restBooks.anchor},
   totals:{...base.totals,researchTicks:ticks.total,restQuotes:quotes.total,
    streamedBookSamples:stream.total,officialRestBookSamples:restBooks.total}};
  const stamp=new Date().toISOString().slice(0,10);
  download('ETH-15-Scout-V4-Complete-Evidence-'+stamp+'.json',
   JSON.stringify(payload,null,2),'application/json');
  researchStatus('Evidence export created: '+ticks.total+' tick observations, '+
   quotes.total+' recorded REST quotes, '+(stream.total??'unavailable')+
   ' streaming book observations, '+(restBooks.total??'unavailable')+
   ' official REST depth observations, plus paper journal and official outcomes.');
 }catch(err){
  researchStatus('Export incomplete; no complete archive was claimed: '+
   String(err?.message||err));
 }finally{if(lastPayload)renderResearch();}
}
$('research-older').addEventListener('click',loadOlderResearch);
$('research-export').addEventListener('click',exportCompleteEvidence);



/* Explicit analysis, not a hidden side-effect of a page refresh. */
let stopAuditLoading=false;
function showStopAudit(a){
 const root=$('stop-audit-list');root.replaceChildren();
 if(!a){txt('stop-audit-summary','Stop audit unavailable.');return}
 txt('stop-audit-summary',a.stoppedTrades+' observed 40% stop exits · net realized '+money(a.realizedStopNetPnl,true)+
  ' · '+a.observedQuoteRecoveries+' showed a later bid at or above their entry price within recorded horizons · '+
  a.officialDirectionCorrectCount+' officially resolved in the traded direction. Observed quotes are NOT proven fills.');
 if(!a.stoppedTrades){
  const el=document.createElement('p');el.className='fine';
  el.textContent='No recorded V4 40% emergency stop exits yet. This is not evidence the rule is effective.';
  root.append(el);return;
 }
 for(const item of a.stops.slice(0,40)){
  const row=document.createElement('div');row.className='stop-audit-row';
  const top=document.createElement('strong');
  top.textContent=(item.side||'?')+' · '+(item.ticker||'—')+' · '+money(item.netRealizedPnl,true)+
   ' · '+(item.exitAt?ct(item.exitAt):'—')+' CT';
  const horizons=document.createElement('div');
  horizons.textContent=item.horizons.map(h=>h.seconds+'s: '+
   (h.status==='OBSERVED_REST_UNVERIFIED_EXECUTION'?
     quote(h.bid)+(h.reachedEntryPrice===true?' (reached entry)':h.reachedEntryPrice===false?' (below entry)':''):
     h.status==='CONTRACT_EXPIRED'?'market expired':'data unavailable')).join(' · ');
  const settlement=document.createElement('small');
  settlement.textContent='Official settlement direction: '+(
   item.settlementDirectionCorrect===null?'unavailable':
   item.settlementDirectionCorrect?'correct':'incorrect')+
   ' · resale fill not verified';
  row.append(top,horizons,settlement);root.append(row);
 }
 if(a.stops.length>40){
  const el=document.createElement('p');el.className='fine';
  el.textContent='Showing 40 of '+a.stops.length+' stopped exits; all are included in the full JSON export.';
  root.append(el);
 }
}
async function analyzeStops(){
 if(stopAuditLoading||!token||!journalState.ready)return;
 stopAuditLoading=true;$('stop-audit-run').disabled=true;
 researchStatus('Loading historical stop losses and quote follow-ups…');
 try{
  const [journal,quotes]=await Promise.all([
   fullJournal(),exportArchive(QUOTE_ARCHIVE_API,'quotes')
  ]);
  if(!window.ScoutStopAudit)throw Error('Stop audit analysis library unavailable');
  const result=window.ScoutStopAudit.analyzeStopHistory(
   journal.trades,quotes.records,journal.windows);
  showStopAudit(result);
  researchStatus('Stop observations calculated from archived quotes; no exit prices or outcomes were invented.');
 }catch(err){
  researchStatus('Stop audit incomplete: '+String(err?.message||err));
 }finally{
  stopAuditLoading=false;
  if(lastPayload)renderResearch();
 }
}
$('stop-audit-run').addEventListener('click',analyzeStops);


function renderStreamHealth(data){
 const s=data?.status||{},c=s.streamConnection||{},archive=s.streamArchive||{};
 const enabled=s.streamCaptureEnabled===true;
 txt('v4-stream-state',!enabled?'Disabled · requires separate V4 release':
   c.connected?(c.quote?.fresh?'Connected · fresh snapshot':'Connected · book not verified fresh'):
   'Enabled, not connected · no live quote asserted');
 txt('v4-stream-count',Number.isFinite(archive.count)?
  archive.count.toLocaleString('en-US'):'—');
 txt('v4-stream-gaps',enabled&&Number.isFinite(c.sequenceGaps)?
  String(c.sequenceGaps)+' this connection':'—');
 const received=archive.latest?.receivedAt;
 txt('v4-stream-received',Number.isSafeInteger(received)?
  ago(received)+' · '+(archive.latest?.ticker||'unknown contract'):
  'No authenticated book observation');
}
