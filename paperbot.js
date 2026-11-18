/* ETH-15 Scout Auto Paper Trader V2. Simulated only; no real orders. */
(() => {
'use strict';
const el = id => document.getElementById(id);
const KEY = 'eth15scout_learning_paper_v2';
const money = x => Number.isFinite(x) ? (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2) : '—';
const cents = x => Number.isFinite(x) ? (x * 100).toFixed(1) + '¢' : '—';
const fee = (price, qty) => Math.ceil(Math.max(0, 0.07 * qty * price * (1 - price)) * 100 - 1e-8) / 100;
const stateDefault = () => ({initial:100,cash:100,realized:0,armed:false,risk:2,open:null,pending:[],trades:[],decisions:[],events:[],window:null,blocked:[]});
let state = stateDefault();
try {
 const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
 if (saved && Array.isArray(saved.trades) && Array.isArray(saved.decisions) && Number.isFinite(saved.cash))
   state = {...stateDefault(),...saved,armed:false};
} catch(e) {}
let notice = 'Not armed. Start monitoring, then arm the paper bot.';
const SOUND_KEY='eth15scout_sound_alerts_v1';
let soundEnabled=true;
try {soundEnabled=localStorage.getItem(SOUND_KEY)!=='off'} catch(e){}
let audioContext=null;
function enableSoundContext(){
 if(!soundEnabled)return;
 try{
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)return;
  if(!audioContext)audioContext=new Context();
  if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
 }catch(e){}
}
function tradeSound(type){
 if(!soundEnabled||!audioContext||audioContext.state!=='running')return;
 try{
  const buy=type==='PAPER BUY';
  const frequencies=buy?[740,988]:[988,587];
  const start=audioContext.currentTime+0.01;
  frequencies.forEach((hz,i)=>{
   const osc=audioContext.createOscillator(),gain=audioContext.createGain(),t=start+i*0.16;
   osc.type='sine';osc.frequency.setValueAtTime(hz,t);
   gain.gain.setValueAtTime(0.0001,t);
   gain.gain.exponentialRampToValueAtTime(0.085,t+0.015);
   gain.gain.exponentialRampToValueAtTime(0.0001,t+0.13);
   osc.connect(gain);gain.connect(audioContext.destination);
   osc.start(t);osc.stop(t+0.15);
  });
 }catch(e){/* Audio errors must never affect trading simulation. */}
}
let evaluating = false;
const persist = () => { try { localStorage.setItem(KEY,JSON.stringify({...state,armed:false})); } catch(e) {notice='Storage unavailable — export your paper journal.';} };
const note = (type,msg,ticker='') => {
 state.events.unshift({time:Date.now(),type,msg,ticker});
 state.events=state.events.slice(0,250);
 if(type==='PAPER BUY'||type==='PAPER SELL')tradeSound(type);
};
function quote(m,side,bidask) {
 const key=(side==='UP'?'yes_':'no_')+(bidask==='ask'?'ask_dollars':'bid_dollars');
 const n=Number(m?.[key]);
 return m?.[key] != null && n>0 && n<1 ? n : NaN;
}
function depth(m,side,bidask) {
 // Kalshi's market schema publishes YES-side sizes. NO ask = YES bid; NO bid = YES ask.
 const key=side==='UP'?(bidask==='ask'?'yes_ask_size_fp':'yes_bid_size_fp'):(bidask==='ask'?'yes_bid_size_fp':'yes_ask_size_fp');
 const v=m?.[key];const n=v==null?NaN:Number(v);return Number.isFinite(n)&&n>=0?n:NaN;
}
function cleanArray(a) { return a.filter(Number.isFinite); }
function fastScan(rows) {
 const c=rows.map(x=>Number(x[4])).filter(Number.isFinite);
 if(c.length<50) return null;
 const e8=emaSeries(c,8),e21=emaSeries(c,21),e6=emaSeries(c,6),e13=emaSeries(c,13);
 const macd=c.map((_,i)=>Number.isFinite(e6[i])&&Number.isFinite(e13[i])?e6[i]-e13[i]:NaN);
 const signal=emaSeries(cleanArray(macd),5);
 const last=c.length-1;
 const rNow=rsi(c,9),rPrev=rsi(c.slice(0,-3),9);
 const mNow=macd[last],mPrev=macd[last-2],sNow=signal[signal.length-1],sPrev=signal[signal.length-3];
 if(![rNow,rPrev,mNow,mPrev,sNow,sPrev,e8[last],e8[last-2],e21[last]].every(Number.isFinite))return null;
 const returns=c.slice(-31).map((x,i,a)=>i>0?x-a[i-1]:0).slice(1);
 const avg=returns.reduce((a,b)=>a+b,0)/returns.length;
 const sd=Math.sqrt(returns.reduce((a,b)=>a+(b-avg)**2,0)/returns.length);
 return {last:c[last],prev:c[last-2],e8:e8[last],e8prev:e8[last-2],e21:e21[last],rNow,rPrev,mNow,mPrev,sNow,sPrev,
   three:c[last]-c[last-3],sd};
}
function judge(side,m1,m5,market,remaining) {
 const d=side==='UP'?1:-1;
 const yes = test => d===1?test:!test;
 let checks=[];
 checks.push({name:'1m price vs EMA8',ok:yes(m1.last>m1.e8)});
 checks.push({name:'1m EMA8 vs EMA21',ok:yes(m1.e8>m1.e21)});
 checks.push({name:'1m RSI9 direction',ok:d*(m1.rNow-m1.rPrev)>=2});
 checks.push({name:'1m RSI9 side of 50',ok:yes(m1.rNow>50)});
 checks.push({name:'1m MACD vs signal',ok:yes(m1.mNow>m1.sNow)});
 checks.push({name:'1m 3-candle move',ok:d*m1.three>0});
 checks.push({name:'1m MACD acceleration',ok:d*((m1.mNow-m1.sNow)-(m1.mPrev-m1.sPrev))>0});
 // Reversal entry requires a turn, not just a pre-existing trend.
 const cross=d===1?
   (m1.last>m1.e8 && m1.prev<=m1.e8prev)||(m1.mNow>m1.sNow&&m1.mPrev<=m1.sPrev)||(m1.rNow>50&&m1.rPrev<=50):
   (m1.last<m1.e8 && m1.prev>=m1.e8prev)||(m1.mNow<m1.sNow&&m1.mPrev>=m1.sPrev)||(m1.rNow<50&&m1.rPrev>=50);
 const turn=Boolean(cross || (d*(m1.rNow-m1.rPrev)>=6 && d*m1.three>0 && d*(m1.mNow-m1.sNow)>0));
 const passed=checks.filter(c=>c.ok).length;
 // Spot is NOT the official CF Benchmarks ETH index. This checks plausibility only.
 const target=Number(market.floor_strike);
 const plausible=Number.isFinite(target)&&m1.sd>0 &&
   Math.abs(m1.last-target)<=Math.max(3,2.75*m1.sd*Math.sqrt(Math.max(1,remaining)));
 const alignment=m5 && (side==='UP'?m5.rsi>30:m5.rsi<70);
 return {side,passed,checks,turn,plausible,alignment,
   detail:checks.filter(c=>c.ok).map(x=>x.name).join(', ')};
}
function priceBucketOf(p){return p<.35?'Under 35¢':p<.70?'35–69¢':'70¢ and up'}
function recentLearning(priceBucket) {
 const a=state.trades.filter(x=>x.confirmed&&x.bucket===priceBucket).slice(0,16);
 const n=a.length,net=a.reduce((sum,x)=>sum+x.pnl,0);
 return {n,net,extra:(n>=8&&net<0)?1:0};
}
function chooseCandidate(m,one,m5,remaining){
 const target=Number(m.floor_strike);
 if(!Number.isFinite(target)||!one||!m5)return null;
 const ranked=[];
 for(const side of ['UP','DOWN']){
   const price=quote(m,side,'ask'),bid=quote(m,side,'bid');
   const askSize=depth(m,side,'ask'),bidSize=depth(m,side,'bid');
   if(!Number.isFinite(price)||!Number.isFinite(bid)||!Number.isFinite(askSize)||!Number.isFinite(bidSize))continue;
   const spread=price-bid;
   // No fixed contract-price floor or ceiling; the real filter is quote quality, fees and setup.
   if(!(price>0&&price<1&&bid>=0&&bid<=price&&spread<=Math.min(.065,Math.max(.035,price*.10))))continue;
   const signal=judge(side,one,m5,m,remaining);
   const d=side==='UP'?1:-1;
   const slowTrend=d===1?(m5.e21>m5.e50&&m5.macd>m5.signal&&m5.rsi>=52&&m5.rsi<=78)
                       :(m5.e21<m5.e50&&m5.macd<m5.signal&&m5.rsi<=48&&m5.rsi>=22);
   const directionOk=d*(one.last-target)>=-Math.max(2,one.sd*2.5);
   const reachDist=Math.abs(one.last-target)<=Math.max(10,6*one.sd*Math.sqrt(Math.max(remaining,1)));
   const learn=recentLearning(priceBucketOf(price));
   const reversal=signal.turn&&signal.plausible&&signal.alignment&&signal.passed>=4+learn.extra;
   const momentum=slowTrend&&directionOk&&reachDist&&signal.passed>=5+learn.extra;
   if(!reversal&&!momentum)continue;
   const strategy=reversal?'REVERSAL':'MOMENTUM';
   // Realized upside from a winning settlement relative to entry, net of general estimated entry fee.
   const grossWinningUpside=1-price-fee(price,1);
   if(!(grossWinningUpside>0))continue;
   const edgeQuality=(signal.passed*10)+(strategy==='REVERSAL'?3:0)-spread*130
       +(d*(one.last-target)>=0?3:0)+Math.min(10,grossWinningUpside*10);
   ranked.push({side,price,bid,signal,strategy,score:edgeQuality,askSize,bidSize,breakEven:price+fee(price,1)});
 }
 ranked.sort((a,b)=>b.score-a.score);
 return ranked[0]||null;
}
function decisionComplete(window,reason='No qualifying setup') {
 if (!window || window.entered || window.finished || !window.seenArmed) return;
 window.finished=true;
 state.decisions.unshift({ticker:window.ticker,time:Date.now(),status:'PASS',reason:window.reason||reason});
 state.decisions=state.decisions.slice(0,250);
 note('PASS',window.reason||reason,window.ticker);
}
function enter(m,side,signal,now,price,strategy='REVERSAL') {
 if(state.open || state.pending.length>=4 || state.blocked.includes(m.ticker)) return false;
 const budget=Math.min(state.cash*state.risk/100,state.initial*0.02);
 let qty=Math.floor(budget/price);
 while(qty>0 && qty*price+fee(price,qty)>budget)qty--;
 if(qty<1 || !Number.isFinite(depth(m,side,'ask')) || depth(m,side,'ask')<qty) return false;
 const entryFee=fee(price,qty),cost=Number((qty*price+entryFee).toFixed(2));
 if(cost>state.cash)return false;
 state.cash=Number((state.cash-cost).toFixed(2));
 const bucket=priceBucketOf(price);
 const position={ticker:m.ticker,side,qty,entry:price,entryFee,cost,time:now,
   target:Number(m.floor_strike),closeTime:m.close_time,priceBucket:bucket,bucket,
   checks:signal.checks.map(c=>[c.name,c.ok]),score:signal.passed,strategy,
   status:'OPEN',bestBid:NaN,highestProfit:0};
 state.open=position;
 state.blocked.push(m.ticker);
 state.blocked=state.blocked.slice(-100);
 if(state.window?.ticker===m.ticker)state.window.entered=true;
 note('PAPER BUY',strategy+' '+side+' '+qty+' contracts @ '+cents(price)+' + '+money(entryFee)+' fee; spent '+money(cost),m.ticker);
 notice='SIMULATED BUY ('+strategy+'): '+side+' '+qty+' × '+cents(price)+' = '+money(cost)+' including fee';
 persist();return true;
}
function closeEarly(pos,bid,why,m) {
 const capacity=depth(m,pos.side,'bid');
 if(!Number.isFinite(capacity)||capacity<pos.qty || !Number.isFinite(bid))return false;
 const sellFee=fee(bid,pos.qty);
 const received=Number((pos.qty*bid-sellFee).toFixed(2));
 if(received<0)return false;
 const pnl=Number((received-pos.cost).toFixed(2));
 state.cash=Number((state.cash+received).toFixed(2));
 state.realized=Number((state.realized+pnl).toFixed(2));
 const tr={...pos,status:pnl>0?'WIN':pnl<0?'LOSS':'FLAT',exitPrice:bid,sellFee,proceeds:received,pnl,exitAt:Date.now(),
   confirmed:true,exitType:'EARLY SALE',reason:why};
 state.trades.unshift(tr);state.trades=state.trades.slice(0,300);
 state.open=null;
 note('PAPER SELL','Closed '+(pnl>0?'WIN':pnl<0?'LOSS':'FLAT')+': '+pos.side+' '+pos.qty+' @ '+cents(bid)+'; received '+money(received)+'; P/L '+money(pnl)+' — '+why,pos.ticker);
 notice='PAPER SELL '+pos.side+' '+money(pnl)+' ('+why+')';
 persist();return true;
}
function toPending(pos) {
 state.pending.unshift({...pos,status:'PENDING'});
 state.pending=state.pending.slice(0,50);
 state.open=null;
 note('PENDING','Contract closed; official outcome not verified. No profit/loss assumed.',pos.ticker);
 notice='Pending official result for '+pos.ticker+'. Confirm UP or DOWN after settlement.';
 persist();
}
function settlePending(ticker,result) {
 const index=state.pending.findIndex(p=>p.ticker===ticker);
 if(index<0)return;
 const pos=state.pending[index];
 if(!confirm('Confirm official Kalshi settlement was '+result+' for '+ticker+'? This affects simulated statistics only.'))return;
 const won=pos.side===result,proceeds=won?pos.qty:0,pnl=Number((proceeds-pos.cost).toFixed(2));
 state.cash=Number((state.cash+proceeds).toFixed(2));
 state.realized=Number((state.realized+pnl).toFixed(2));
 const tr={...pos,status:won?'WIN':'LOSS',exitPrice:null,sellFee:0,proceeds,pnl,exitAt:Date.now(),confirmed:true,
   exitType:'MANUALLY ENTERED OFFICIAL SETTLEMENT',result};
 state.trades.unshift(tr);state.trades=state.trades.slice(0,300);
 state.pending.splice(index,1);
 note(tr.status,'Settlement '+result+'; '+pos.side+' '+pos.qty+' @ '+cents(pos.entry)+'; P/L '+money(pnl),ticker);
 notice='Settlement recorded ('+result+'). Learning statistics updated.';
 persist();paint();
}
function showEvent(x) {
 const time=new Date(x.time).toLocaleString();
 return '<div class="item"><strong>'+escapeText(x.type)+'</strong> · '+escapeText(time)+'<br>'+escapeText(x.msg)+'<br><small>'+escapeText(x.ticker||'')+'</small></div>';
}
function escapeText(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function headline(){
 const title=el('call'),detail=el('reason');if(!title||!detail)return;
 const now=Date.now(),recent=state.events[0];
 if(state.open){
   const p=state.open; title.textContent='PAPER BUY '+p.side;
   title.className='val large '+(p.side==='UP'?'green':'red');
   detail.textContent='SIMULATED '+p.strategy+' PURCHASE: '+p.qty+' '+p.side+' contracts at '+cents(p.entry)+
    ' each. Entry fee '+money(p.entryFee)+', total spent '+money(p.cost)+'. '+p.ticker+
    '. Watching for a simulated early sale at the published bid. No real order placed.';
   return;
 }
 if(recent&&now-recent.time<5*60000&&recent.type==='PAPER SELL'){
   title.textContent='PAPER SOLD';title.className='val large blue';
   detail.textContent=recent.msg+'. '+recent.ticker+'. Simulated at published bid, not a guaranteed fill.';
   return;
 }
 if(recent&&now-recent.time<2*60000&&recent.type==='PAPER BUY'){
   title.textContent='PAPER BOUGHT';title.className='val large blue';detail.textContent=recent.msg;
   return;
 }
 // The original market dashboard still displays PASS or WATCH for setups.
}
window.refreshBotHeadline=headline;
function paint() {
 const n=state.trades.length, wins=state.trades.filter(x=>x.pnl>0).length,losses=state.trades.filter(x=>x.pnl<0).length;
 const passes=state.decisions.length;const net=state.trades.reduce((a,x)=>a+x.pnl,0);
 el('paperState').textContent=state.armed?'ARMED':'PAUSED';
 el('paperState').className='pill '+(state.armed?'good':'warn');
 el('paperToggle').textContent=state.armed?'■ Pause new entries':'▶ Arm paper trading';
 el('paperSound').textContent=soundEnabled?'🔔 Trade sounds ON':'🔕 Trade sounds OFF';
 el('paperCash').textContent=money(state.cash);
 el('paperRealized').textContent=money(net);
 el('paperWinLoss').textContent=wins+' / '+losses;
 el('paperPasses').textContent=String(passes);
 el('paperSetup').textContent=notice;
 el('paperStart').value=String(state.initial);
 el('paperRisk').value=String(state.risk);
 el('paperPosition').innerHTML=state.open?
   '<strong>PAPER BUY '+escapeText(state.open.side)+'</strong> · '+state.open.qty+' @ '+cents(state.open.entry)+
   '<div>Entry fee '+money(state.open.entryFee)+' · Amount spent '+money(state.open.cost)+
   ' · Quote window '+escapeText(state.open.ticker)+'</div>'+
   '<div>Last bid '+cents(state.open.bestBid)+' · Estimated open P/L '+money(state.open.markPnl)+
   ' (if liquid enough; not a real cash-out quote)</div>':
   'No simulated open position';
 el('paperPending').innerHTML=state.pending.length?state.pending.map(p=>
   '<div class="item"><strong>'+escapeText(p.side)+' '+p.qty+' @ '+cents(p.entry)+'</strong> · '+escapeText(p.ticker)+
   '<div>Awaiting official settlement. Do not guess based on Kraken spot.</div>'+
   '<div class="btns"><button class="paper-confirm" data-ticker="'+escapeText(p.ticker)+'" data-result="UP">Official result UP</button>'+
   '<button class="paper-confirm" data-ticker="'+escapeText(p.ticker)+'" data-result="DOWN">Official result DOWN</button></div></div>'
 ).join(''):'None';
 el('paperLearning').innerHTML='Completed simulated trades: '+n+' · Net '+money(net)+
   ' · Win rate '+(n?(wins/n*100).toFixed(1)+'%':'not established')+
   ' · Under 35¢: '+recentLearning('Under 35¢').n+' resolved · 35–69¢: '+recentLearning('35–69¢').n+' · 70¢+: '+recentLearning('70¢ and up').n+
   ' resolved. After 8 completed trades in a price bracket, losing brackets require an extra confirmation. These are simulated outcomes, not confirmed fills or statistical win probabilities.';
 el('paperHistory').innerHTML=state.events.length?state.events.slice(0,25).map(showEvent).join(''):'No recorded signals yet. Each unused observed 15-minute market is logged as PASS when the window ends.';
 headline();
}
el('paperPending').addEventListener('click',e=>{
 const b=e.target.closest('button[data-ticker][data-result]');if(b)settlePending(b.dataset.ticker,b.dataset.result);
});
el('paperToggle').onclick=()=>{
 enableSoundContext();
 state.armed=!state.armed;
 notice=state.armed?'Paper bot armed. Only simulated trades; searching for discounted reversal entries.':'New paper entries paused; existing simulated positions may still be managed.';
 persist();paint();
 if(state.armed&&!timer)el('start').click();
};
el('paperSound').onclick=()=>{soundEnabled=!soundEnabled;try{localStorage.setItem(SOUND_KEY,soundEnabled?'on':'off')}catch(e){};if(soundEnabled)enableSoundContext();paint();};
el('paperStart').onchange=()=>{
 if(state.trades.length||state.open||state.pending.length||state.decisions.length||state.events.length){paint();return;}
 const n=Number(el('paperStart').value);
 if(Number.isFinite(n)&&n>=10&&n<=10000){state.initial=n;state.cash=n;persist();}
 paint();
};
el('paperRisk').onchange=()=>{
 const n=Number(el('paperRisk').value);if(Number.isFinite(n)&&n>=1&&n<=2){state.risk=n;persist();}
 paint();
};
el('paperReset').onclick=()=>{
 if(!confirm('Reset the entire local auto-paper account, trades, learning history and passes? Your separate MANUAL positions are not affected.'))return;
 state=stateDefault();notice='Reset complete. Start monitoring and arm when ready.';persist();paint();
};
el('paperExport').onclick=()=>{
 const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eth15-scout-auto-paper-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
let activeEvaluation=false;
async function paperTick() {
 if(activeEvaluation)return;activeEvaluation=true;
 try {
  const m=lastKalshi;
  if(state.window && ((m && state.window.ticker!==m.ticker) || Date.now()>state.window.end)){
    decisionComplete(state.window);state.window=null;
  }
  if(state.open && Date.now()>=new Date(state.open.closeTime).getTime())
    toPending(state.open);
  if(!m||!lastKraken||Date.now()-lastCheckedAt>90000){notice='Waiting for fresh Kalshi and Kraken data; no simulated entry.';persist();paint();return;}
  if((state.armed||state.open) && (!state.window || state.window.ticker!==m.ticker))
    state.window={ticker:m.ticker,end:new Date(m.close_time).getTime(),entered:state.blocked.includes(m.ticker),reason:'No qualifying paper trade setup',seenArmed:false};
  if(state.armed&&state.window)state.window.seenArmed=true;
  const remaining=(new Date(m.close_time).getTime()-Date.now())/60000;
  let one=null;
  try{
    const result=await get('https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1');
    if(result.error?.length)throw Error('Kraken API');
    const rows=Object.values(result.result).find(Array.isArray);
    one=fastScan(rows?.slice(0,-1)||[]);
  }catch(e){notice='1-minute feed unavailable; no new simulated entry.';}
  if(state.open && m.ticker===state.open.ticker && Date.now()-lastCheckedAt<90000){
    const pos=state.open,bid=quote(m,pos.side,'bid'),bidDepth=depth(m,pos.side,'bid');
    pos.bestBid=bid;
    const proceeds=Number.isFinite(bid)&&Number.isFinite(bidDepth)&&bidDepth>=pos.qty?pos.qty*bid-fee(bid,pos.qty):NaN;
    pos.markPnl=Number.isFinite(proceeds)?Number((proceeds-pos.cost).toFixed(2)):NaN;
    if(Number.isFinite(proceeds)) {
      const gain=(bid-pos.entry)/pos.entry;
      let why=null;
      if(gain>=0.55&&pos.markPnl>0)why='Profit target (+55% contract-price movement)';
      else if(gain<=-0.40)why='Stop loss (−40% contract-price movement)';
      else if(remaining<1.25)why='Market close approaching';
      else if(one && remaining<7) {
        const q=judge(pos.side,one,lastKraken.ind,m,remaining);
        if(q.passed<=1)why='Reversal invalidated by current momentum';
      }
      if(why)closeEarly(pos,bid,why,m);
    }else if(remaining<=0)toPending(pos);
  }
  const freshRemaining=(new Date(m.close_time).getTime()-Date.now())/60000;
  if(state.armed && !state.open && m===lastKalshi && Date.now()-lastCheckedAt<90000 && freshRemaining>=2.5&&freshRemaining<=12.5 && one){
    const today=new Date().toDateString();
    const daily=state.trades.filter(t=>new Date(t.exitAt).toDateString()===today).reduce((a,t)=>a+t.pnl,0);
    if(daily<=-state.initial*0.04){notice='Daily 4% paper loss cap reached. No new entries.';}
    else if(state.blocked.includes(m.ticker)){notice='No repeat entry for this 15-minute contract.';}
    else {
      const c=chooseCandidate(m,one,lastKraken.ind,freshRemaining);
      if(c){
        if(enter(m,c.side,c.signal,Date.now(),c.price,c.strategy))state.window.entered=true;
        else {
          notice='Qualified '+c.strategy+' setup, but quote depth or fee-adjusted bankroll prevented a simulated fill.';
          state.window.reason=notice;
        }
      }else {
        notice='PASS / WATCH: no contract at any price meets reversal/trend, target-reachability, liquidity and quote-quality requirements.';
        state.window.reason=notice;
      }
    }
  }else if(!state.armed&&!state.open) notice='Paper bot paused. No new purchases.';
  persist();paint();
 }catch(e){notice='Paper bot analysis error; no new simulated trade.';console.warn(e);paint();}
 finally{activeEvaluation=false;}
}
const oldRefresh=refresh;
refresh=async function(){await oldRefresh();await paperTick();};
el('refresh').onclick=refresh;
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.open)paperTick()});
paint();
})();