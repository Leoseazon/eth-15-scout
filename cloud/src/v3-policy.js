/* V3 paper-only guardrails agreed Nov 18-19, 2026.
 * Deterministic policy, NOT a probability estimate or live trading authorization.
 */
export const PAPER_POLICY = Object.freeze({
  minEntryMinutes: 1.5,
  maxEntryMinutes: 12.5,
  expensiveThreshold: 0.80,
  expensiveCutoffMinutes: 3,
  maxNewEntryPrice: 0.96,
  lateMinConfirmations: 7,
  lateMaxSpread: 0.03,
  sellAtBid: 0.96,
  finalMinuteHold: 1,
  maxStakeIncludingFees: 3,
  defaultRiskPercent: 3,
});

export function entryBudget(cash, riskPercent = PAPER_POLICY.defaultRiskPercent) {
  if (!Number.isFinite(cash) || !Number.isFinite(riskPercent) ||
      cash <= 0 || riskPercent <= 0) return 0;
  return Math.max(0, Math.floor((Math.min(PAPER_POLICY.maxStakeIncludingFees,
      cash * riskPercent / 100) + 1e-9) * 100) / 100);
}

// Called AFTER baseline trend/reversal, quote-size, fee and liquidity checks.
// Late entries are possible, but only under exceptionally strict *observable*
// confirmations. These checks do not establish true odds or a positive edge.
export function entryGate({price, remaining, passed, slowTrend, plausible, alignment, spread}) {
  const fail = reason => ({ok: false, reason});
  if (![price, remaining, spread].every(Number.isFinite) || !(price > 0) ||
      !(spread >= 0)) return fail('Incomplete price or timing information');
  if (remaining > PAPER_POLICY.maxEntryMinutes || remaining < PAPER_POLICY.minEntryMinutes)
    return fail('Outside 1.5–12.5 minute entry window');
  if (price >= PAPER_POLICY.maxNewEntryPrice)
    return fail('Entry at 96¢ or more leaves insufficient exit room');
  if (price >= PAPER_POLICY.expensiveThreshold &&
      remaining >= PAPER_POLICY.expensiveCutoffMinutes)
    return fail('80¢+ contract prohibited with 3+ minutes left');
  if (remaining < PAPER_POLICY.expensiveCutoffMinutes &&
      (passed < PAPER_POLICY.lateMinConfirmations || !slowTrend ||
       !plausible || !alignment || spread > PAPER_POLICY.lateMaxSpread))
    return fail('Late entry requires 7/7 checks, trend, strike plausibility and spread ≤3¢');
  return {ok: true, reason: remaining < PAPER_POLICY.expensiveCutoffMinutes ?
    'Exceptional late-entry checks satisfied' : 'Standard entry window'};
}

// A bid at 96¢ or higher normally triggers a paper exit (subject to depth
// and estimated fees). During the FINAL minute the user allows holding until
// the official result; no settlement result is invented here.
export function profitExitGate(bid, remaining) {
  if (!Number.isFinite(bid) || !Number.isFinite(remaining) ||
      bid < PAPER_POLICY.sellAtBid) return 'NONE';
  return remaining <= PAPER_POLICY.finalMinuteHold ? 'HOLD_PENDING' : 'SELL';
}
