/* V3 paper-only guardrails agreed Nov 18-19, 2026.
 * Deterministic policy, NOT a probability estimate or live trading authorization.
 */
export const PAPER_POLICY = Object.freeze({
  minEntryMinutes: 1.5,
  maxEntryMinutes: 12.5,
  expensiveThreshold: 0.80,
  expensiveCutoffMinutes: 8, // 80-89c eligible at <=8m, not earlier
  premiumCutoffMinutes: 5, // 90c+ still requires <=5m
  lateValueEarlierChecks: 5, // 80-89c with 3-8m left
  lateValueFinalChecks: 6, // 80-89c with 1.5-3m left
  maxNewEntryPrice: 0.96,
  lateMinConfirmations: 7,
  finalThreeLowPriceChecks: 7, // 20–69c: require all fast checks under 3m
  finalThreeMidPriceChecks: 5, // 70–79c: require five fast checks under 3m
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

// Used after quote, liquidity, price-direction and structure validation.
// A lateValueVerified flag MUST come from the guarded strategy-specific gate;
// caller cannot earn this permission merely by supplying 5/7 checks.
export function entryGate({price,remaining,passed,slowTrend,plausible,alignment,spread,
    lateValueVerified=false}) {
  const fail=reason=>({ok:false,reason});
  if(![price,remaining,spread].every(Number.isFinite)||price<=0||spread<0)
    return fail('Incomplete price or timing information');
  if(remaining>PAPER_POLICY.maxEntryMinutes||remaining<PAPER_POLICY.minEntryMinutes)
    return fail('Outside 1.5–12.5 minute entry window');
  if(price>=PAPER_POLICY.maxNewEntryPrice)
    return fail('Entry at 96c or more leaves insufficient exit room');
  const isLateValue=price>=PAPER_POLICY.expensiveThreshold&&price<.90;
  const premium=price>=.90;
  const veryLate=remaining<3;
  if(isLateValue){
    if(remaining>PAPER_POLICY.expensiveCutoffMinutes)
      return fail('80–89c entries require eight minutes or less');
    const required=veryLate?PAPER_POLICY.lateValueFinalChecks:
      PAPER_POLICY.lateValueEarlierChecks;
    if(passed<required||!lateValueVerified||!plausible||
       spread>PAPER_POLICY.lateMaxSpread)
      return fail('80–89c time-sensitive setup requires guarded strike/structure, '+
        required+'/7 checks and spread <=3c');
    return {ok:true,reason:'Guarded 80–89c time-aware late value setup'};
  }
  if(premium&&remaining>PAPER_POLICY.premiumCutoffMinutes)
    return fail('90c+ entries require five minutes or less');
  // 20–69c: preserve strict 7/7 in the final three minutes.
  // 70–79c: allow 5/7 in the final three minutes, WITHOUT removing the
  // slow trend, strike plausibility, 5m RSI alignment or liquidity screens.
  // Under-20c MICRO-VALUE has a separate mandatory 7/7 guard.
  const finalThreeRequired=veryLate&&price>=.70&&price<.80?
    PAPER_POLICY.finalThreeMidPriceChecks:PAPER_POLICY.finalThreeLowPriceChecks;
  if(premium||veryLate){
    const required=premium?PAPER_POLICY.lateMinConfirmations:finalThreeRequired;
    if(passed<required||!slowTrend||!plausible||!alignment||
       spread>PAPER_POLICY.lateMaxSpread)
      return fail('Final entry requires '+required+
        '/7 checks, aligned slow trend, strike plausibility and spread <=3c');
  }
  return {ok:true,reason:premium?'Exceptional 90c+ confirmation passed':
      veryLate?'Final-3m '+finalThreeRequired+'/7 confirmations passed':
      'Standard entry window'};
}

// A bid at 96¢ or higher normally triggers a paper exit (subject to depth
// and estimated fees). During the FINAL minute the user allows holding until
// the official result; no settlement result is invented here.
export function profitExitGate(bid, remaining) {
  if (!Number.isFinite(bid) || !Number.isFinite(remaining) ||
      bid < PAPER_POLICY.sellAtBid) return 'NONE';
  return remaining <= PAPER_POLICY.finalMinuteHold ? 'HOLD_PENDING' : 'SELL';
}

// Kalshi ETH15m final price is the 60-second CF Benchmarks RTI average.
// This classifies CLOCK PHASE ONLY. It never computes a Kalshi result from
// Kraken, and never treats a last traded tick as the official settlement.
export function settlementClockPhase(closeTime,now=Date.now()){
  const end=Date.parse(closeTime);
  if(!Number.isFinite(end)||!Number.isFinite(now))return 'UNKNOWN';
  const remaining=(end-now)/1000;
  if(remaining<=0)return 'AWAITING_OFFICIAL_RESULT';
  if(remaining<=60)return 'RTI_60_SECOND_AVERAGING_UNVERIFIED';
  return 'PRE_SETTLEMENT_AVERAGING';
}
