/* V4 15h owner-requested EIGHT-way profile research comparison.
 * OFFLINE ONLY — no market API calls, no orders, no account writes.
 * Accepts a complete dashboard evidence export or saved Decision Audit.
 * MAIN paper trades and CONSERVATIVE CONTROL paper positions are separate.
 * A/B/C and A2/B2/C2 remain individually frozen non-executing hypotheses.
 *
 * node cloud/v4/tools/report-v4-profile-comparison.mjs export.json > results.json
 */
import fs from 'node:fs';
import {selectFirstShadowSignals,joinFinalizedOfficialOutcomes,
 summarizeFirstSignals} from '../src/shadow-prospective-scoring.js';
import {selectCandidateCFirstConfirmed,scoreCandidateCConfirmed,
 summarizeCandidateC} from '../src/candidate-c-scoring.js';
import {selectRevisedFirstConfirmed,joinRevisedOfficialOutcomes,
 summarizeRevisedOutcomes} from '../src/shadow-quality-scoring.js';
const src=process.argv[2];
if(!src)throw Error('Provide paper-only dashboard evidence or decision audit JSON');
const data=JSON.parse(fs.readFileSync(src,'utf8'));
const tickRows=data.researchTicks,journal=data.journals||data.journal;
const validData=new Set(['ETH-15 Scout V4 complete research evidence',
 'ETH-15 Scout V4 decision audit evidence']);
if(!validData.has(data.format)||data.paperOnly!==true||
 !Array.isArray(tickRows)||!journal||!Array.isArray(journal.trades)||
 !Array.isArray(journal.windows))
 throw Error('Invalid/incomplete paper-only V4 complete export');
const ts=n=>Number.isSafeInteger(n)&&n>1000000000000;
const num=n=>typeof n==='number'&&Number.isFinite(n);
const key=t=>typeof t==='string'&&/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(t);
const asDate=n=>new Date(n).toISOString();
const count=(arr,fn)=>Object.fromEntries([...arr.reduce((m,x)=>{
 const k=fn(x);m.set(k,(m.get(k)||0)+1);return m;},new Map())]
 .sort((a,b)=>b[1]-a[1]));
const releases=tickRows.filter(r=>r?.paperOnly===true&&
 r.decision?.shadowProbe?.mainStrategyProfile?.active==='OPPORTUNISTIC'&&
 r.decision?.shadowProbe?.conservativeReference?.readOnly===true&&
 ts(r.observedAt)&&ts(r.closeAt)&&key(r.ticker));
if(!releases.length)throw Error('No verified Opportunistic MAIN + Conservative reference observations in this export');
const firstObservedAt=Math.min(...releases.map(r=>r.observedAt));
const cohortStart=Math.ceil(firstObservedAt/900000)*900000;
const cohortEnd=cohortStart+15*60*60*1000;
const cohort=tickRows.filter(r=>r?.paperOnly===true&&
 ts(r.observedAt)&&r.observedAt>=cohortStart&&
 r.observedAt<cohortEnd).sort((a,b)=>a.observedAt-b.observedAt);
const current=cohort.filter(r=>r.decision?.shadowProbe?.mainStrategyProfile?.active==='OPPORTUNISTIC');
const windows=journal.windows.filter(w=>ts(w.closeAt));
const officialMap=new Map();
for(const w of windows){
 if(!key(w.ticker)||w.status!=='OFFICIAL_RESULT'||
  w.exchangeStatus!=='finalized'||!['UP','DOWN'].includes(w.outcome)||
  !ts(w.settledAt)||w.settledAt<w.closeAt)continue;
 const old=officialMap.get(w.ticker);
 if(!old||w.settledAt<old.settledAt)officialMap.set(w.ticker,w);
}
const rounds=Array.from({length:60},(_,i)=>{
 const closeAt=cohortStart+(i+1)*900000;
 const rows=cohort.filter(r=>r.closeAt===closeAt);
 const ticker=rows.find(r=>officialMap.has(r.ticker))?.ticker||
  rows[0]?.ticker||null;
 const result=officialMap.get(ticker);
 return {number:i+1,closeAt:asDate(closeAt),ticker,
  observedTicks:rows.length,
  officialOutcome:result?.closeAt===closeAt?result.outcome:null,
  finalized:result?.closeAt===closeAt};
});
const mainBuyTicks=current.filter(r=>{
 const d=r.decision?.shadowProbe?.decision;
 // A lastDecision is sticky while holding. A stale displayed PAPER_BUY
 // is NOT a new entry. This cohort counts only same-tick authorizations.
 return d?.status==='PAPER_BUY'&&
  ['UP','DOWN'].includes(d.side)&&ts(d.at)&&
  d.at>=cohortStart&&d.at<cohortEnd&&
  Math.abs(d.at-r.observedAt)<=30000&&
  r.ticker===r.decision?.shadowProbe?.conservativeReference?.candidate?.ticker;
});
const firstMainBuys=new Map();
for(const r of mainBuyTicks)if(!firstMainBuys.has(r.ticker))firstMainBuys.set(r.ticker,{
 ticker:r.ticker,at:r.observedAt,side:r.decision.shadowProbe.decision.side,
 ask:r.decision.shadowProbe.decision.entry,
 allIn:r.decision.shadowProbe.decision.cost});
const mainTrades=journal.trades.filter(t=>
 ts(t?.time)&&t.time>=cohortStart&&t.time<cohortEnd&&
 t.strategy==='V4_SETTLEMENT_FIRST'&&t.confirmed===true);
const control=journal.conservativeControlJournal;
const controlJournalValid=!!control&&
 control.version==='V4-CONSERVATIVE-INDEPENDENT-20261123-v1'&&
 control.journalIndependentOfMain===true&&Array.isArray(control.trades)&&
 Array.isArray(control.pendingPositions)&&Array.isArray(control.finalRoundPasses);
const controlTrades=controlJournalValid?
 control.trades.filter(t=>ts(t.time)&&t.time>=cohortStart&&
 t.time<cohortEnd&&t.confirmed===true):[];
const originalAB=joinFinalizedOfficialOutcomes(
 selectFirstShadowSignals(cohort,{notBefore:cohortStart}),journal.windows);
const originalC=scoreCandidateCConfirmed(
 selectCandidateCFirstConfirmed(cohort,{notBefore:cohortStart}),journal.windows);
const revisions=joinRevisedOfficialOutcomes(
 selectRevisedFirstConfirmed(cohort,{notBefore:cohortStart}),journal.windows);
const conservativeStates=current.map(t=>t.decision.shadowProbe.conservativeControl)
 .filter(s=>s?.version==='V4-CONSERVATIVE-INDEPENDENT-20261123-v1');
const emitted=conservativeStates.filter(s=>s.persisted===true);
const lastControl=emitted.at(-1)||null;
const totalNet=trades=>Number(trades.reduce((s,t)=>s+(num(t.pnl)?t.pnl:0),0).toFixed(2));
const total=trades=>({
 completed:trades.length,profitable:trades.filter(t=>t.pnl>0).length,
 losing:trades.filter(t=>t.pnl<0).length,
 realizedSimulatedNet:trades.length?totalNet(trades):null,
 entryAskDistribution:count(trades,t=>t.entry<.2?'BELOW_20C':
  t.entry<.35?'20_35C':t.entry<.6?'35_60C':
  t.entry<.75?'60_75C':t.entry<=.87?'75_87C':'ABOVE_CAP')});
const sourceStats={
 ticksExpectedApprox:3600,ticksRecorded:cohort.length,
 sameProfileObservations:current.length,
 controlPersistedTicks:emitted.length,
 controlUnavailableOrFailedTicks:current.length-emitted.length,
 mainDecisionReasons:count(current,
  r=>r.decision?.shadowProbe?.reason||'UNKNOWN'),
 shadowAReasons:count(current,r=>
  r.decision?.shadowProbe?.prospectiveShadow?.policies?.A_STRESS_RELAXED?.reason||
  r.decision?.shadowProbe?.prospectiveShadow?.policies?.A_STRESS_RELAXED?.status||'UNAVAILABLE'),
 shadowBReasons:count(current,r=>
  r.decision?.shadowProbe?.prospectiveShadow?.policies?.B_EXECUTION_FILTERED?.reason||
  r.decision?.shadowProbe?.prospectiveShadow?.policies?.B_EXECUTION_FILTERED?.status||'UNAVAILABLE')
};
const results={
 format:'ETH-15 Scout V4 independent 8-way prospective 15h report',
 createdAt:new Date().toISOString(),paperOnly:true,readOnly:true,
 allExecutionsSimulated:true,realFillsVerified:false,
 release:{activeMainProfile:'OPPORTUNISTIC',
  conservativeControl:'V4-CONSERVATIVE-INDEPENDENT-20261123-v1',
  firstVerifiedAt:asDate(firstObservedAt)},
 cohort:{start:asDate(cohortStart),end:asDate(cohortEnd),
  fullMarketWindows:60,complete:ts(Date.parse(data.exportedAt||data.createdAt))?
    Date.parse(data.exportedAt||data.createdAt)>=cohortEnd:
    false,officialFinalized:rounds.filter(r=>r.finalized).length,
  missingWindowObservations:rounds.filter(r=>!r.observedTicks).length},
 mainOpportunistic:{
  firstPaperBuyDecisions:firstMainBuys.size,
  firstEntries:[...firstMainBuys.values()],
  completedPaperTrades:total(mainTrades),
  currentOpenNotCountedAsCompleted:!!journal.open,
  note:'Original main paper account carried its prior bankroll and risk latches; compare prospective cohort net, not cumulative bankroll.'},
 independentMainConservative:{
  completeLedgerExported:controlJournalValid,
  newPaperAccountInitial:100,
  latestControlSnapshot:lastControl,
  completedPaperTrades:controlJournalValid?total(controlTrades):null,
  incompleteIfMissingLedger:!controlJournalValid,
  finalPassCount:controlJournalValid?control.finalRoundPasses.filter(
   x=>ts(x.time)&&x.time>=cohortStart&&x.time<cohortEnd).length:null},
 originalAandB:summarizeFirstSignals(originalAB),
 originalCandidateC:summarizeCandidateC(originalC),
 revisedA2B2C2:summarizeRevisedOutcomes(revisions),
 sourceDiagnostics:sourceStats,
 markets:rounds,
 cautions:[
  'Control is independent at the simulated account/strategy-state level; all algorithms still share one Cloudflare Worker deployment and one authenticated market feed.',
  'A/B/C and A2/B2/C2 are research-only and do not have actual exchange fills, separate cash accounts or real executions.',
  'Conservative control and active main use distinct account balances and may not have exactly identical risk-based stake sizing.',
  'For truly independent processes, deploy distinct Workers/DOs; this release does not provide physical process isolation.',
  'A market can have up to eight paired strategy observations but only ONE independent official result.',
  'Any incomplete Conservative journal or missing verified sources must be reported, never filled in with synthetic profit.',
  'No profitability guarantee and no forced trade quota; paper models are uncalibrated.'
 ]
};
console.log(JSON.stringify(results,null,2));
