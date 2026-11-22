/* Persistent PAPER ledger; no live Kalshi orders. */
import {buildPaperSettlement} from './settlement-accounting.js';
export const TIMESTOP_TAG='V3-TIME40-6M-20261120';
export const LATE_VALUE_TAG='V3-80C-EIGHTMIN-20261120';
export function paperResults(sql,releaseTag) {
  const marker=tag=>sql.exec(
    'SELECT first_engine_tick_at FROM release_markers WHERE tag=?',tag
  ).toArray()[0]?.first_engine_tick_at||null;
  const revisedAt=marker(TIMESTOP_TAG),originalAt=marker(releaseTag),latestAt=marker(LATE_VALUE_TAG);
  const q='SELECT COUNT(*) completed,'+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')>0 THEN 1 ELSE 0 END),0) wins,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')<0 THEN 1 ELSE 0 END),0) losses,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')=0 THEN 1 ELSE 0 END),0) flats,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) earlySales,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.exitType')='OFFICIAL SETTLEMENT' THEN 1 ELSE 0 END),0) officialSettlements,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.time')>=? AND json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) revisedCohort,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.time')>=? AND json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) originalCohort,"+
    " COALESCE(SUM(CASE WHEN json_extract(data,'$.time')>=? AND json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) latestCohort"+
    " FROM trades WHERE json_extract(data,'$.confirmed')=1 AND json_type(data,'$.pnl') IN ('integer','real')";
  const results=sql.exec(q,revisedAt||Number.MAX_SAFE_INTEGER,
    originalAt||Number.MAX_SAFE_INTEGER,latestAt||Number.MAX_SAFE_INTEGER).toArray()[0];
  // Separate the contextual V4 observation cohort from obsolete V3-style
  // eight-minute/honey-pot paper-exit milestones. Count both OFFICIAL SETTLEMENT
  // and EARLY SALE as completed paper trades, but report direction accuracy
  // from the independent settlement prediction ledger elsewhere.
  const contextualRelease=releaseTag==='V4-CONTEXTUAL-VALUE-20261122';
  const cohort=contextualRelease?sql.exec(
    `SELECT COUNT(*) completed,
      COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')>0 THEN 1 ELSE 0 END),0) wins,
      COALESCE(SUM(CASE WHEN json_extract(data,'$.pnl')<0 THEN 1 ELSE 0 END),0) losses,
      COALESCE(SUM(CASE WHEN json_extract(data,'$.exitType')='EARLY SALE' THEN 1 ELSE 0 END),0) earlySales,
      COALESCE(SUM(CASE WHEN json_extract(data,'$.exitType')='OFFICIAL SETTLEMENT' THEN 1 ELSE 0 END),0) officialSettlements,
      COALESCE(SUM(json_extract(data,'$.pnl')),0) netPnl
      FROM trades WHERE json_extract(data,'$.strategyVersion')=?
      AND json_extract(data,'$.confirmed')=1
      AND json_type(data,'$.pnl') IN ('integer','real')`,
    'V4-TARGET-CONTEXTUAL-VALUE-20261122').toArray()[0]:null;
  return {...results,revisedFirstTick:revisedAt,originalFirstTick:originalAt,
    latestFirstTick:latestAt,contextualCohort:cohort,
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
