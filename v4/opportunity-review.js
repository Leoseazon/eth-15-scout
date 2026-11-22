'use strict';
/* V4 READ-ONLY Opportunity Review.
 * Uses only the already-authenticated dashboard payload. No additional HTTP
 * requests, no Cloudflare Worker/DO writes, no BUY/SELL controls or policy
 * changes. A skipped round is NOT a missed executable opportunity.
 */
(function(){
 const ROUND_MS=15*60*1000;
 const MAX_PASS_FINALIZE_LAG_MS=2*60*1000;
 const FINALIZATION_GRACE_MS=45*1000;
 const fourPassThreshold=4;
 const finiteTime=t=>Number.isSafeInteger(t)&&t>1000000000000;
 function classify(reason){
  const r=String(reason||'').toUpperCase();
  if(/FRESH_.*REQUIRED|INDICATORS_REQUIRED|CONTEXT_REQUIRED|FEED|KRAKEN|OFFICIAL_INDEX|MISSING|UNAVAILABLE|BOOK_REQUIRED/.test(r))
   return 'Data / evidence unavailable';
  if(/NO_RISK_ADJUSTED_VALUE|CONSERVATIVE_SCENARIO|PRICE_ABOVE|BUDGET|DEPTH|SPREAD|PREMIUM|VALUE/.test(r))
   return 'Price / value did not qualify';
  if(/ENTRY_WINDOW|ENTRY_CLOCK|OPENING|OUTSIDE_EARLY|FINAL_90/.test(r))
   return 'Entry-time restriction';
  if(/RISK|HALT|UNRESOLVED|ARMED|DISABLED/.test(r))
   return 'Risk or operational safeguard';
  return r?'Other logged restriction':'Reason not recorded';
 }
 function summarize(data,now=Date.now()){
  const activity=data?.activity||{},status=data?.status||{};
  const complete=activity.journalAvailable===true&&Array.isArray(activity.decisions);
  const decisions=complete?activity.decisions.filter(d=>
   d&&d.status==='PASS'&&typeof d.ticker==='string'&&
   d.ticker.startsWith('KXETH15M-')&&finiteTime(d.time)&&
   d.time<=now+5000):[];
  // A decision is persisted only when the bot FINALIZES a skipped market.
  // Use actual close-aligned 15m slots, not a count of transient WATCH ticks.
  // Delayed/missing logs are treated as incomplete, never as proof of a streak.
  const bySlot=new Map();
  for(const d of decisions){
   const slot=Math.floor(d.time/ROUND_MS)*ROUND_MS;
   if(d.time-slot>MAX_PASS_FINALIZE_LAG_MS)continue;
   if(!bySlot.has(slot)||bySlot.get(slot).time<d.time)bySlot.set(slot,d);
  }
  const newestFinalizedSlot=Math.floor((now-FINALIZATION_GRACE_MS)/ROUND_MS)*ROUND_MS;
  let consecutive=0;
  if(complete)for(let slot=newestFinalizedSlot;slot>=0;slot-=ROUND_MS){
   if(!bySlot.has(slot))break;
   consecutive++;
   if(consecutive>=72)break; // bounded display only
  }
  const recentDecisions=[...decisions].sort((a,b)=>b.time-a.time);
  const latest=recentDecisions[0]||null;
  // Last entry may be older than the 70 most-recent events. Cross-reference
  // the existing trades, pending and open state. Never assert "no buys"
  // merely because limited recent pages do not contain one.
  const candidates=[];
  const add=t=>{if(finiteTime(t)&&t<=now+5000)candidates.push(t)};
  add(status.open?.time);
  for(const t of Array.isArray(activity.trades)?activity.trades:[])add(t?.time);
  for(const p of Array.isArray(activity.pending)?activity.pending:[])add(p?.time);
  for(const e of Array.isArray(activity.events)?activity.events:[])
   if(e?.type==='PAPER BUY')add(e.time??e.at);
  const lastBuy=candidates.length?Math.max(...candidates):null;
  const outcomes=new Set((Array.isArray(activity.windows)?activity.windows:[])
   .filter(w=>w?.status==='OFFICIAL_RESULT'&&['UP','DOWN'].includes(w.outcome))
   .map(w=>w.ticker));
  const recent=recentDecisions.slice(0,12);
  const matches=recent.filter(d=>outcomes.has(d.ticker)).length;
  const total=Number.isSafeInteger(status.passes)&&status.passes>=0?
   status.passes:null;
  return {
   complete,consecutive,needsReview:complete&&consecutive>=fourPassThreshold,
   total,latest,latestClass:classify(latest?.reason),
   lastBuy,reviewedPasses:recent.length,officialMatches:matches,
   // Result alone cannot establish historical entry value, depth or fill.
   missedValueVerified:false
  };
 }
 function elapsed(at,now){
  if(at===null)return 'Not in recent history';
  const diff=Math.max(0,now-at),mins=Math.floor(diff/60000);
  if(mins<60)return mins+'m ago';
  const hours=Math.floor(mins/60);
  return hours<48?hours+'h '+mins%60+'m ago':
   Math.floor(hours/24)+'d '+hours%24+'h ago';
 }
 if(typeof module==='object'&&module.exports)module.exports={summarize,classify};
 if(typeof document==='undefined')return;
 const $=id=>document.getElementById(id);
 const write=(id,value)=>{const e=$(id);if(e)e.textContent=value};
 function render(data){
  const now=Date.now(),m=summarize(data,now);
  write('opportunity-streak',!m.complete?'—':
   m.consecutive===0?'No confirmed current streak':
   m.consecutive+' consecutive');
  write('opportunity-last-buy',elapsed(m.lastBuy,now));
  write('opportunity-last-pass',m.latest?m.latestClass:'No final PASS in recent records');
  const last=$('opportunity-last-pass');
  if(last)last.title=m.latest?String(m.latest.reason||'No reason stored'):
   'Latest final ROUND PASS record not available';
  write('opportunity-review-evidence',m.reviewedPasses?
   m.officialMatches+' of '+m.reviewedPasses+' recent PASS results archived':
   'Awaiting matched exchange outcomes');
  const flag=$('opportunity-review-state');
  if(flag){
   flag.textContent=!m.complete?'JOURNAL UNAVAILABLE':
    m.needsReview?'REVIEW · 4+ ROUNDS':'OBSERVATION ONLY';
   flag.classList.toggle('attention',m.needsReview);
   flag.classList.toggle('unknown',!m.complete);
  }
  write('opportunity-review-note',!m.complete?
   'The permanent journal is unavailable. Consecutive PASS tracking is unverified; no entry changes.':
   m.needsReview?
   'Four consecutive 15-minute markets have recorded a final ROUND PASS. Review their contemporaneous prices, feeds and decisions; do not force a trade.':
   'Four consecutive recorded ROUND PASSES will trigger a research flag, never an entry mandate. Missing rounds or records remain unverified.');
 }
 document.addEventListener('v4:dashboard-health',e=>render(e.detail));
})();
