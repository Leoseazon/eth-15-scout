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
let evaluating = false;
const persist = () => { try { localStorage.setItem(KEY,JSON.stringify({...state,armed:false})); } catch(e) {notice='Storage unavailable — export your paper journal.';} };
const note = (type,msg,ticker='') => {
 state.events.unshift({time:Date.now(),type,msg,ticker});
 state.events=state.events.slice(0,250);
};
function quote(m,side,bidask) {
 const key=(side==='UP'?'yes_':'no_')+(bidask==='ask'?'ask_dollars':'bid_dollars');
 const n=Number(m?.[key]);
 return m?.[key] != null && n>0 && n<1 ? n : NaN;
}
function depth(m,side,bidask) {
 const key=(side==='UP'?'yes_':'no_')+(bidask==='ask'?'ask_size_fp':'bid_size_fp');
 return m?.[key]==null?NaN:Number(m[key]);
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
function recentLearning(priceBucket) {
 const a=state.trades.filter(x=>x.confirmed&&x.bucket===priceBucket).slice(0,16);
 const n=a.length,net=a.reduce((sum,x)=>sum+x.pnl,0);
 const negative=n>=8&&net<0;
 return {n,net,required:negative?5:4};
}
function decisionComplete(window,reason='No qualifying discounted reversal setup') {
 if (!window || window.entered || window.finished) return;
 window.finished=true;
 state.decisions.unshift({ticker:window.ticker,time:Date.now(),status:'PASS',reason:window.reason||reason});
 state.decisions=state.decisions.slice(0,250);
 note('PASS',window.reason||reason,window.ticker);
}
function enter(m,side,signal,now,price) {
 if(state.open || state.pending.length>=4 || state.blocked.includes(m.ticker)) return false;
 const budget=Math.min(state.cash*state.risk/100,state.initial*0.02);
 let qty=Math.floor(budget/price);
 while(qty>0 && qty*price+fee(price,qty)>budget)qty--;
 if(qty<1 || !Number.isFinite(depth(m,side,'ask')) || depth(m,side,'ask')<qty) return false;
 const entryFee=fee(price,qty),cost=Number((qty*price+entryFee).toFixed(2));
 if(cost>state.cash)return false;
 state.cash=Number((state.cash-cost).toFixed(2));
 const bucket=price<.30?'12–29¢':'30–48¢';
 const position={ticker:m.ticker,side,qty,entry:price,entryFee,cost,time:now,
   target:Number(m.floor_strike),closeTime:m.close_time,priceBucket:bucket,bucket,
   checks:signal.checks.map(c=>[c.name,c.ok]),score:signal.passed,
   status:'OPEN',bestBid:NaN,highestProfit:0};
 state.open=position;
 state.blocked.push(m.ticker);
 state.blocked=state.blocked.slice(-100);
 if(state.window?.ticker===m.ticker)state.window.entered=true;
 note('PAPER BUY',side+' '+qty+' contracts @ '+cents(price)+' + '+money(entryFee)+' fee; spent '+money(cost),m.ticker);
 notice='SIMULATED BUY: '+side+' '+qty+' × '+cents(price)+' = '+money(cost)+' including fee';
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
 note(tr.status,'PAPER SELL: '+pos.side+' '+pos.qty+' @ '+cents(bid)+'; received '+money(received)+'; P/L '+money(pnl)+' — '+why,pos.ticker);
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
   exitType:'MANUALLY VERIFIED SETTLEMENT',result};
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
function paint() {
 const n=state.trades.length, wins=state.trades.filter(x=>x.pnl>0).length,losses=state.trades.filter(x=>x.pnl<0).length;
 const passes=state.decisions.length;const net=state.trades.reduce((a,x)=>a+x.pnl,0);
 el('paperState').textContent=state.armed?'ARMED':'PAUSED';
 el('paperState').className='pill '+(state.armed?'good':'warn');
 el('paperToggle').textContent=state.armed?'■ Pause new entries':'▶ Arm paper trading';
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
   ' · Cheap 12–29¢: '+recentLearning('12–29¢').n+' resolved · 30–48¢: '+recentLearning('30–48¢').n+
   ' resolved. After 8 completed trades in a price bracket, losing brackets require an extra confirmation. These are simulated outcomes, not confirmed fills or statistical win probabilities.';
 el('paperHistory').innerHTML=state.events.length?state.events.slice(0,25).map(showEvent).join(''):'No recorded signals yet. Each unused observed 15-minute market is logged as PASS when the window ends.';
}
el('paperPending').addEventListener('click',e=>{
 const b=e.target.closest('button[data-ticker][data-result]');if(b)settlePending(b.dataset.ticker,b.dataset.result);
});
el('paperToggle').onclick=()=>{
 state.armed=!state.armed;
 notice=state.armed?'Paper bot armed. Only simulated trades; searching for discounted reversal entries.':'New paper entries paused; existing simulated positions may still be managed.';
 persist();paint();
 if(state.armed&&!timer)el('start').click();
};
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
  if(state.window && (!m || state.window.ticker!==m.ticker || Date.now()>state.window.end)){
    decisionComplete(state.window);state.window=null;
  }
  if(state.open && (Date.now()>=new Date(state.open.closeTime).getTime() || !m || m.ticker!==state.open.ticker))
    toPending(state.open);
  if(!m||!lastKraken||Date.now()-lastCheckedAt>90000){notice='Waiting for fresh Kalshi and Kraken data; no simulated entry.';persist();paint();return;}
  if((state.armed||state.open) && (!state.window || state.window.ticker!==m.ticker))
    state.window={ticker:m.ticker,end:new Date(m.close_time).getTime(),entered:state.blocked.includes(m.ticker),reason:'No qualifying discounted reversal entry'};
  const remaining=(new Date(m.close_time).getTime()-Date.now())/60000;
  let one=null;
  try{
    const result=await get('https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1');
    if(result.error?.length)throw Error('Kraken API');
    const rows=Object.values(result.result).find(Array.isArray);
    one=fastScan(rows?.slice(0,-1)||[]);
  }catch(e){notice='1-minute feed unavailable; no new simulated entry.';}
  if(state.open && m.ticker===state.open.ticker){
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
  if(state.armed && !state.open && remaining>=2.5&&remaining<=12.5 && one){
    const today=new Date().toDateString();
    const daily=state.trades.filter(t=>new Date(t.exitAt).toDateString()===today).reduce((a,t)=>a+t.pnl,0);
    if(daily<=-state.initial*0.04){notice='Daily 4% paper loss cap reached. No new entries.';}
    else if(state.blocked.includes(m.ticker)){notice='No repeat entry for this 15-minute contract.';}
    else {
      const candidates=['UP','DOWN'].map(side=>{
        const price=quote(m,side,'ask'),signal=judge(side,one,lastKraken.ind,m,remaining);
        const learning=recentLearning(price<.30?'12–29¢':'30–48¢');
        return {side,price,signal,required:learning.required};
      }).filter(x=>x.price>=.12&&x.price<=.48 && x.signal.turn&&x.signal.plausible&&x.signal.alignment&&x.signal.passed>=x.required);
      candidates.sort((a,b)=>b.signal.passed-a.signal.passed||a.price-b.price);
      if(candidates.length){
        const c=candidates[0];if(enter(m,c.side,c.signal,Date.now(),c.price))
          state.window.entered=true;
        else {notice='Reversal found but available quantity, fee-adjusted bankroll or depth prevented a simulated fill.';state.window.reason=notice;}
      }else {
        notice='PASS / WATCH: no discounted contract meets the reversal, momentum, target-reachability and quote requirements.';
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