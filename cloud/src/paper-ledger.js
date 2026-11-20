/* Persistent PAPER ledger; no live Kalshi orders. */
import {buildPaperSettlement} from './settlement-accounting.js';
export const TIMESTOP_TAG='V3-TIME40-6M-20261120';
export function paperResults(sql,releaseTag) {
  const marker=tag=>sql.exec(
    'SELECT first_engine_tick_at FROM release_markers WHERE tag=?',tag
  ).toArray()[0]?.first_engine_tick_at||null;
  const revisedAt=marker(TIMESTOP_TAG),originalAt=marker(releaseTag);
  const q='SELECT COUNT(*) completed,'+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')>0 THEN 1 ELSE 0 END),0) wins,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')<0 THEN 1 ELSE 0 END),0) losses,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')=0 THEN 1 ELSE 0 END),0) flats,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) earlySales,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.exitType')='OFFICIAL SETTLEMENT' THEN 1 ELSE 0 END),0) officialSettlements,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.time')>=? AND json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) revisedCohort,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.time')>=? AND json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) originalCohort"+
    " FROM trades WHERE json_extract(data,'$.confirmed')=1 AND json_type(data,'$.pnl') IN ('integer','real')";
  const results=sql.exec(q,revisedAt||Number.MAX_SAFE_INTEGER,
    originalAt||Number.MAX_SAFE_INTEGER).toArray()[0];
  return {...results,revisedFirstTick:revisedAt,originalFirstTick:originalAt,
    definition:'Realized, fee-adjusted per-position paper P/L (early exits independent of window outcome)'};
}
// Official Kalshi market finalization is required; never infer from spot ETH.
// Trades are keyed by market ticker. No repeat credit for a completed ticker.
export function reconcilePending(s,sql,now=Date.now()) {
  if(!Array.isArray(s.pending)||!s.pending.length)return 0;
  const remaining=[];
  let resolved=0;
  for(const pos of s.pending) {
    if(typeof pos?.ticker!=='string'||!pos.ticker) {remaining.push(pos);continue;}
    if(sql.exec('SELECT ticker FROM trades WHERE ticker=?',pos.ticker).toArray().length) {
      s.events.unshift({time:now,type:'PAPER RECONCILED',ticker:pos.ticker,
        msg:'Completed ledger record found; duplicate pending position cleared without cash credit.'});
      resolved++;continue;
    }
    const row=sql.exec('SELECT status,data FROM window_outcomes WHERE ticker=?',
      pos.ticker).toArray()[0];
    if(!row||row.status!=='OFFICIAL_RESULT') {remaining.push(pos);continue;}
    let official=null;
    try{official=JSON.parse(row.data);}catch{}
    const trade=buildPaperSettlement(pos,official,now);
    if(!trade) {remaining.push(pos);continue;}
    s.cash=Number((s.cash+trade.proceeds).toFixed(2));
    s.realized=Number((s.realized+trade.pnl).toFixed(2));
    s.trades.unshift(trade);
    s.events.unshift({time:now,type:'PAPER SETTLED',ticker:pos.ticker,
      msg:'Kalshi finalized '+trade.officialOutcome+'; held '+trade.side+
        ' paper position '+trade.status+'; payout $'+trade.proceeds.toFixed(2)+
        '; net realized P/L '+(trade.pnl>=0?'+':'')+'$'+trade.pnl.toFixed(2)});
    resolved++;
  }
  if(resolved) s.pending=remaining;
  return resolved;
}
