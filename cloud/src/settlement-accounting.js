/* Pure, auditable PAPER-only settlement bookkeeping.
 * No real trades, no Kraken-inferred settlement, no trading API access.
 */
export const PAPER_TRADE_KINDS = Object.freeze({
  EARLY: 'EARLY SALE',
  SETTLED: 'OFFICIAL SETTLEMENT'
});
const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;

// A paper trade is a WIN or LOSS only after its own net cash P/L is realized.
// Kalshi's market result never reclassifies an early-sold paper position.
export function paperTradeOutcome(t) {
  if (t?.confirmed !== true || !Number.isFinite(t?.pnl) ||
      !Number.isFinite(t?.exitAt)) return null;
  return t.pnl > 0 ? 'WIN' : t.pnl < 0 ? 'LOSS' : 'FLAT';
}

// Only a FINALIZED official Kalshi result can resolve a simulated position.
// Assumes standard binary ETH15M $1/$0 payoff and no settlement transaction fee.
// Entry fees are already included in position.cost.
export function buildPaperSettlement(pos, window, now=Date.now()) {
  if (!pos || !window || !pos.ticker || pos.ticker !== window.ticker ||
      !['UP','DOWN'].includes(pos.side) ||
      !Number.isSafeInteger(pos.qty) || pos.qty < 1 ||
      !Number.isFinite(pos.cost) || pos.cost < 0 ||
      !Number.isFinite(pos.time) || !Number.isFinite(now) ||
      window.status !== 'OFFICIAL_RESULT' ||
      window.exchangeStatus !== 'finalized' ||
      !['UP','DOWN'].includes(window.outcome) ||
      window.outcome !== window.reportedDirection ||
      !['yes','no'].includes(window.officialResult)) return null;
  const expected = window.officialResult === 'yes' ? 'UP' : 'DOWN';
  if (expected !== window.outcome) return null;
  const proceeds = pos.side === window.outcome ? pos.qty : 0;
  const pnl = cents(proceeds - pos.cost);
  const officialAt = window.settledAt;
  const exitAt = Number.isFinite(officialAt) && officialAt >= pos.time &&
      officialAt <= now + 60000 ? officialAt : now;
  return {
    ...pos, status:pnl>0?'WIN':pnl<0?'LOSS':'FLAT',
    confirmed:true, exitType:PAPER_TRADE_KINDS.SETTLED,
    exitPrice:pos.side===window.outcome?1:0,
    proceeds, pnl, sellFee:0, settlementFee:0, exitAt,
    officialOutcome:window.outcome,
    officialSettlementAt:Number.isFinite(officialAt)?officialAt:null,
    reason:'Finalized Kalshi exchange result; no inferred Kraken settlement'
  };
}
