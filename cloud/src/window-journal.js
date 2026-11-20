/* Official Kalshi ETH 15-minute window outcomes (paper-only research).
 * Sources: Kalshi public API market.result, market.status and settlement_ts.
 * No Kraken spot inference and no actual Kalshi order authorization.
 */
export const SERIES='KXETH15M';
export const LOOKBACK_MS=48*60*60*1000;
export const SCAN_INTERVAL_MS=3*60*1000;
const PERIOD_MS=15*60*1000;

export function parseOfficialWindow(m,now=Date.now()){
  if(!m||typeof m.ticker!=='string'||
      !/^KXETH15M-[A-Za-z0-9-]+$/.test(m.ticker))return null;
  const closeAt=Date.parse(m.close_time);
  if(!Number.isFinite(closeAt)||closeAt<=0||closeAt>now+PERIOD_MS)return null;
  const result=String(m.result||'').toLowerCase();
  const status=String(m.status||'unknown').toLowerCase();
  const direction=result==='yes'?'UP':result==='no'?'DOWN':null;
  const confirmed=status==='finalized'&&direction!==null&&m.is_provisional!==true;
  const voided=status==='finalized'&&result==='void';
  const settledAt=m.settlement_ts?Date.parse(m.settlement_ts):null;
  return {ticker:m.ticker,closeAt,outcome:confirmed?direction:null,
    reportedDirection:direction,officialResult:result||null,
    status:confirmed?'OFFICIAL_RESULT':voided?'VOID':closeAt>now?'OPEN':
      direction?'REPORTED':'PENDING',
    exchangeStatus:status,
    settledAt:Number.isFinite(settledAt)?settledAt:null,
    strike:Number.isFinite(Number(m.floor_strike))&&m.floor_strike!=null?
      Number(m.floor_strike):null,
    observedAt:now,source:'Kalshi public market API (official exchange result)'};
}

export function windowEndpointUrl(now=Date.now(),cursor=''){
  const u=new URL('https://external-api.kalshi.com/trade-api/v2/markets');
  u.searchParams.set('series_ticker',SERIES);
  u.searchParams.set('min_close_ts',String(Math.floor((now-LOOKBACK_MS)/1000)));
  u.searchParams.set('max_close_ts',String(Math.floor((now-10000)/1000)));
  u.searchParams.set('limit','500');
  u.searchParams.set('mve_filter','exclude');
  if(cursor)u.searchParams.set('cursor',cursor);
  return u.toString();
}

export function parseList(payload,now=Date.now()){
  const windows=[],seen=new Set();
  for(const m of (Array.isArray(payload?.markets)?payload.markets:[])){
    const item=parseOfficialWindow(m,now);
    if(item&&item.closeAt<=now&&!seen.has(item.ticker)){
      seen.add(item.ticker);windows.push(item);
    }
  }
  return windows.sort((a,b)=>b.closeAt-a.closeAt);
}
