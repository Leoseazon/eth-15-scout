/* PAPER-ONLY exploratory research pacing.
 * Goal: at least two DISTINCT-market paper BUYs in a rolling hour when
 * contemporaneously safe and model-positive. This is NOT a guarantee, a
 * buy-on-timeout trigger, or a bypass of missing official/market data.
 * Distinguish exploratory positions from original conservative-value cohort.
 */
export const EXPLORATORY_VERSION='V4-EXPLORATORY-SAMPLE-20261122';
export const EXPLORATORY_TARGET_PER_HOUR=2;
export const EXPLORATORY_STAKE_CAP=1;
export const EXPLORATORY_MIN_CENTRAL_EDGE=.02;
export const EXPLORATORY_MAX_ASK=.85;
export const EXPLORATORY_MAX_SPREAD=.03;
const HOUR_MS=60*60*1000;
const valid=t=>Number.isSafeInteger(t)&&t>1000000000000;
export function countRecentDistinctBuys(s,now=Date.now()){
 if(!s||!valid(now))return null;
 const since=now-HOUR_MS,seen=new Set();
 const positions=[...(Array.isArray(s.trades)?s.trades:[]),
  ...(Array.isArray(s.pending)?s.pending:[]),
  ...(s.open?[s.open]:[])];
 for(const p of positions){
  if(!p||typeof p.ticker!=='string'||!p.ticker.startsWith('KXETH15M-')||
     !valid(p.time)||p.time>now+3000||p.time<=since)continue;
  if(p.strategy!=='V4_SETTLEMENT_FIRST')continue;
  seen.add(p.ticker);
 }
 return seen.size;
}
export function shouldExploreForHourlySamples(s,now,{enabled=false,riskMode}={}){
 if(enabled!==true||riskMode!=='NORMAL')return false;
 const n=countRecentDistinctBuys(s,now);
 return n!==null&&n<EXPLORATORY_TARGET_PER_HOUR;
}
