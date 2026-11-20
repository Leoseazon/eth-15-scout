/* ETH-15 Scout V3 — original synthesized notification cues.
 * No audio assets, no external calls, no autoplay, no live trading.
 * Alerts are triggered ONLY by new confirmed journal PAPER BUY/SELL events.
 */
(function(root){
 'use strict';
 let context=null,enabled=false,initialized=false;
 const seen=new Set(),queue=[];
 const maxSeen=500;
 function eventId(e){
  return String(e?.id||[e?.time,e?.type,e?.ticker,e?.msg].join('|'));
 }
 function remember(key){
  if(seen.has(key))return false;
  seen.add(key);queue.push(key);
  if(queue.length>maxSeen)seen.delete(queue.shift());
  return true;
 }
 function canPlay(){
  return enabled&&context&&context.state==='running'&&
    typeof document!=='undefined'&&!document.hidden;
 }
 function supported(){return !!(root.AudioContext||root.webkitAudioContext)}
 async function unlock(){
  if(!supported())return false;
  try{
   if(!context)context=new (root.AudioContext||root.webkitAudioContext)();
   if(context.state!=='running')await context.resume();
   return context.state==='running';
  }catch{return false}
 }
 async function setEnabled(value){
  if(!value){enabled=false;return true}
  if(!await unlock()){enabled=false;return false}
  enabled=true;return true;
 }
 function tone(start,freq,hold,gain,shape='sine'){
  const osc=context.createOscillator(),level=context.createGain();
  osc.type=shape;osc.frequency.setValueAtTime(freq,start);
  level.gain.setValueAtTime(.0001,start);
  level.gain.exponentialRampToValueAtTime(gain,start+.012);
  level.gain.exponentialRampToValueAtTime(.0001,start+hold);
  osc.connect(level);level.connect(context.destination);
  osc.start(start);osc.stop(start+hold+.01);
 }
 // Two short, clearly different, non-copyrighted motifs.
 function play(type){
  if(!canPlay())return false;
  const t=context.currentTime+.022;
  if(type==='PAPER BUY'){
   // Bright upward triplet: invitation / confirmation.
   tone(t,440,.17,.035,'sine');
   tone(t+.10,587.33,.18,.045,'sine');
   tone(t+.205,739.99,.26,.045,'sine');
  }else if(type==='PAPER SELL'){
   // Gentle descending notes: closing / cashing out.
   tone(t,523.25,.17,.045,'triangle');
   tone(t+.13,392,.20,.038,'sine');
   tone(t+.275,293.66,.26,.035,'sine');
  }else return false;
  return true;
 }
 async function preview(type){
  return await unlock()&&playUnlocked(type);
 }
 function playUnlocked(type){
  const wasEnabled=enabled;enabled=true;
  const played=play(type);enabled=wasEnabled;return played;
 }
 function observe(events,now=Date.now()){
  const arr=Array.isArray(events)?events:[];
  const arrivals=[];
  // On first successful response establish the historical baseline. It must
  // never make old BUY/SELL records sound like current activity.
  for(const e of arr){
   if(!e||!['PAPER BUY','PAPER SELL'].includes(e.type))continue;
   const key=eventId(e),fresh=Number.isFinite(e.time)&&e.time<=now+5000&&
     now-e.time>=0&&now-e.time<=110000;
   const novel=remember(key);
   if(initialized&&novel&&fresh)arrivals.push(e);
  }
  initialized=true;
  // Process in time order; if several arrive at once, play only most recent
  // so a background reconnect cannot burst many alerts.
  arrivals.sort((a,b)=>a.time-b.time);
  if(arrivals.length&&canPlay())return play(arrivals[arrivals.length-1].type);
  return false;
 }
 root.ScoutSounds={
  setEnabled,preview,observe,
  get enabled(){return enabled},
  get supported(){return supported()}
 };
})(window);
