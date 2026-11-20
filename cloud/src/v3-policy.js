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
  stopLossArmedMinutes: 6,
  contractStopLossFraction: 0.40, // active only inside final 6 minutes
  maxStakeIncludingFees: 3,
  defaultRiskPercent: 3,
  dailySoftLossFraction: 0.12, // normal entries stop at -$12 on a $100 initial bankroll
  dailyHardLossFraction: 0.20, // ALL new entries stop at -$20
  softMaxStakeIncludingFees: 1.50,
  softRequiredChecks: 7,
  softMaxSpread: 0.03,
  softMinimumDepthMultiple: 2,
});

// The deployment must explicitly authorize PAPER simulation; no broker
// integration exists and a missing flag cannot inherit a previous armed state.
export function paperEntryArmed(mode,monitoring){
  return mode==='enabled'&&monitoring===true;
}

export function entryBudget(cash, riskPercent = PAPER_POLICY.defaultRiskPercent,
    cap = PAPER_POLICY.maxStakeIncludingFees) {
  if (![cash,riskPercent,cap].every(Number.isFinite) ||
      cash <= 0 || riskPercent <= 0 || cap <= 0) return 0;
  return Math.max(0, Math.floor((Math.min(PAPER_POLICY.maxStakeIncludingFees,cap,
      cash * riskPercent / 100) + 1e-9) * 100) / 100);
}

// This is an entry-risk brake, not a stop order and not a calibrated trading edge.
// Both soft and hard thresholds are latched for the Houston trading day: a
// temporary rebound in a marked/open position cannot re-enable risky entries.
// Worst-case unresolved pending losses are included in risk EXPOSURE, not
// misrepresented as realized outcomes.
export function assessDailyRisk({
  initial, realizedToday=0, openLoss=0, pendingExposure=0, previousMode='NORMAL'
}) {
  if (![initial,realizedToday,openLoss,pendingExposure].every(Number.isFinite) ||
      initial <= 0 || pendingExposure < 0)
    return {mode:'HARD',canEnter:false,netRiskPnl:null,reason:'Risk data unavailable'};
  const negativeOpen=Math.min(0,openLoss);
  const netRiskPnl=realizedToday+negativeOpen-pendingExposure;
  const hard=netRiskPnl<=-initial*PAPER_POLICY.dailyHardLossFraction||
    previousMode==='HARD';
  const soft=hard||netRiskPnl<=-initial*PAPER_POLICY.dailySoftLossFraction||
    previousMode==='SOFT';
  const mode=hard?'HARD':soft?'SOFT':'NORMAL';
  return {mode,canEnter:mode!=='HARD',netRiskPnl,
    realizedToday,openLoss:negativeOpen,pendingExposure,
    softLoss:initial*PAPER_POLICY.dailySoftLossFraction,
    hardLoss:initial*PAPER_POLICY.dailyHardLossFraction,
    maxStake:mode==='SOFT'?PAPER_POLICY.softMaxStakeIncludingFees:
      mode==='HARD'?0:PAPER_POLICY.maxStakeIncludingFees};
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
  // One-second conservative guard prevents scheduling jitter from
  // slipping a quote through the precise three-minute boundary.
  if (price >= PAPER_POLICY.expensiveThreshold &&
      remaining >= PAPER_POLICY.expensiveCutoffMinutes - 1/60)
    return fail('80¢+ contract prohibited at/near the 3-minute cutoff');
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
