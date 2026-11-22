'use strict';
/* Confidence is a heuristic 0..100 signal-strength index, NOT an empirical
 * probability of winning. Display-only; does not place or adjust paper trades.
 */
(function(){
 const $=id=>document.getElementById(id);
 const panel=$('buy-confidence-panel');
 if(!panel)return;
 const entry=$('confidence-entry'),live=$('confidence-live');
 const trend=$('confidence-trend'),quality=$('confidence-quality');
 const note=$('confidence-note'),meter=$('confidence-meter');
 const bar=$('confidence-meter-fill'),path=$('confidence-sparkline-path');
 const valid=x=>Number.isInteger(x)&&x>=0&&x<=100;
 let latest=null;
 const printable=x=>valid(x)?x+'%':'—';
 const setValue=(el,s)=>{if(el)el.textContent=s};
 const historyPath=(history)=>{
  const points=(Array.isArray(history)?history:[]).filter(
   p=>valid(p?.value)&&Number.isFinite(p?.at)).slice(-60);
  if(points.length<2)return '';
  return points.map((p,i)=>{
   const x=Number((i/(points.length-1)*238+1).toFixed(1));
   const y=Number((39-p.value/100*38).toFixed(1));
   return (i===0?'M':'L')+x+','+y;
  }).join(' ');
 };
 function display(data){
  const s=data?.status||{},open=s.open?.strategy==='V4_SETTLEMENT_FIRST'?s.open:null;
  const recent=Array.isArray(s.recentTrades)?
   s.recentTrades.find(t=>t?.strategy==='V4_SETTLEMENT_FIRST'&&
    valid(t?.entryConfidence?.value)):null;
  const pos=open||recent;
  const locked=pos?.entryConfidence?.value;
  const current=open?.liveConfidence;
  const sourceAt=current?.asOf;
  const fresh=!!open&&current?.status==='CURRENT'&&valid(current?.value)&&
   Number.isSafeInteger(sourceAt)&&Date.now()-sourceAt<=120000&&
   Date.now()>=sourceAt-3000;
  const nowValue=fresh?current.value:null;
  setValue(entry,printable(locked));
  setValue(live,printable(nowValue));
  let change='—';
  if(fresh&&valid(locked)){
   const delta=nowValue-locked;
   change=(delta>0?'↑ +':delta<0?'↓ ':'↔ ')+delta+' pts';
  }
  setValue(trend,change);
  trend?.classList.toggle('confidence-up',fresh&&nowValue>locked);
  trend?.classList.toggle('confidence-down',fresh&&nowValue<locked);
  if(!pos){
   setValue(quality,'No current paper position');
   setValue(note,'A paper BUY will save its entry confidence here. Live confidence can rise or fall while held.');
  }else if(!open){
   setValue(quality,'Last closed paper position');
   setValue(note,'Entry confidence '+printable(locked)+' was recorded; there is no live held position. This is not a settlement win probability.');
  }else if(!fresh){
   setValue(quality,'Live confidence unavailable / stale');
   setValue(note,'Entry confidence is preserved. Latest update: '+String(current?.reason||'NO_RECENT_VALID_MARKET_DATA')+
    '. No guess or artificial zero is shown.');
  }else{
   setValue(quality,'Live score · updated '+new Date(sourceAt).toLocaleTimeString());
   const diff=valid(current?.deltaFromPrevious)?current.deltaFromPrevious:current?.deltaFromPrevious;
   const motion=Number.isInteger(diff)?(diff>0?'↑ ':diff<0?'↓ ':'↔ ')+diff+' points since previous update. ':'';
   setValue(note,motion+'Changes reflect official index distance, volatility, momentum, 3m/5m structure and quote freshness. Not a forecast win probability.'+
    (current?.caveat&&current?.remainingSeconds<=60?' Final minute: official accumulating settlement average is not incorporated.':''));
  }
  if(bar)bar.style.width=fresh?nowValue+'%':'0%';
  if(meter){
   if(fresh)meter.setAttribute('aria-valuenow',String(nowValue));
   else meter.removeAttribute('aria-valuenow');
   meter.setAttribute('aria-valuetext',fresh?nowValue+' of 100, heuristic confidence':'Unavailable');
  }
  if(path)path.setAttribute('d',historyPath(pos?.confidenceHistory));
 }
 document.addEventListener('v4:dashboard-confidence',e=>{
  latest=e?.detail||null;display(latest);
 });
 // If the browser stops receiving updates, remove the CURRENT label.
 setInterval(()=>{if(latest&&!document.hidden)display(latest)},20000);
})();
