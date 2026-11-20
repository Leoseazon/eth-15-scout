/* ETH-15 Scout V3: independent 15-minute market-window outcomes.
 * Kalshi public results, NEVER Kraken spot price or bot predictions.
 * This module does not buy/sell, infer settlement from candles, or alter risk.
 */
export const SERIES='KXETH15M';
const PERIOD=15*60*1000;
export const LOOKBACK_MS=48*60*60*1000;
export function parseOfficialWindow(m,now=Date.now()){
  if(!m||typeof m.ticker!=='string'||
    !/^KXETH15M-[A-Za-z0-9-]+$/.test(m.ticker))return null;
  const closeAt=Date.parse(m.close_time);
  if(!Number.isFinite(closeAt)||closeAt<=0||closeAt>now+PERIOD)return null;
  const result=String(m.result||'').toLowerCase();
  const outcome=result==='yes'?'UP':result==='no'?'DOWN':null;
  const settledAt=m.settlement_ts?Date.parse(m.settlement_ts):null;
  return {ticker:m.ticker,closeAt,
    outcome,officialResult:outcome?result:null,
    status:outcome?'OFFICIAL_RESULT':closeAt>now?'OPEN':'PENDING',
    exchangeStatus:String(m.status||'unknown'),
    settledAt:Number.isFinite(settledAt)?settledAt:null,
    strike:Number.isFinite(Number(m.floor_strike))&&m.floor_strike!==null?
      Number(m.floor_strike):null,
    observedAt:now,source:'Kalshi public market API'};
}
export function windowEndpointUrl(now=Date.now()){
  const end=Math.floor((now-10000)/1000);
  const start=Math.floor((now-LOOKBACK_MS)/1000);
  const u=new URL('https://external-api.kalshi.com/trade-api/v2/markets');
  u.searchParams.set('series_ticker',SERIES);
  u.searchParams.set('min_close_ts',String(start));
  u.searchParams.set('max_close_ts',String(end));
  u.searchParams.set('limit','500');
  return u.toString();
}
export function parseList(payload,now=Date.now()){
  const windows=[],seen=new Set();
  for(const m of (Array.isArray(payload?.markets)?payload.markets:[])){
    const w=parseOfficialWindow(m,now);
    if(w&&w.closeAt<=now&&!seen.has(w.ticker)){
      seen.add(w.ticker);windows.push(w);
    }
  }
  return windows.sort((a,b)=>b.closeAt-a.closeAt);
}
