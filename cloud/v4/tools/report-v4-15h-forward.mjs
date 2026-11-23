/* ETH-15 V4 15h PRE-REGISTERED offline comparison report.
 * NO network calls, no mutations, NO inferred fills. The first FULL 15m
 * market after the research release's first verified observation begins the
 * cohort. Exactly 60 successive markets, even with zero candidates.
 *
 * Usage: node cloud/v4/tools/report-v4-15h-forward.mjs  *   "ETH-15-Scout-V4-Decision-Audit.json" > V4-15H-results.json
 */
import fs from 'node:fs';
import {SHADOW_QUALITY_VERSION,REVISED_POLICY}
 from '../src/shadow-quality-revisions.js';
import {MAIN_COHERENCE_RESEARCH_VERSION}
 from '../src/main-coherence-research.js';
import {selectFirstShadowSignals,joinFinalizedOfficialOutcomes,
 summarizeFirstSignals} from '../src/shadow-prospective-scoring.js';
import {selectCandidateCFirstConfirmed,scoreCandidateCConfirmed,
 summarizeCandidateC} from '../src/candidate-c-scoring.js';
import {selectRevisedFirstConfirmed,joinRevisedOfficialOutcomes,
 summarizeRevisedOutcomes} from '../src/shadow-quality-scoring.js';
import {replayExitDecisionStudies,finalizeExitStudies,summarizeExitStudies}
 from '../src/shadow-exit-counterfactual.js';

const fsFile=process.argv[2];
if(!fsFile)throw new Error('Provide exported V4 Decision Audit JSON filename');
const data=JSON.parse(fs.readFileSync(fsFile,'utf8'));
const ts=n=>Number.isSafeInteger(n)&&n>1000000000000;
const f=n=>typeof n==='number'&&Number.isFinite(n);
const ticker=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const validWindow=w=>ticker.test(w?.ticker||'')&&
 w.status==='OFFICIAL_RESULT'&&w.exchangeStatus==='finalized'&&
 ['UP','DOWN'].includes(w.outcome)&&ts(w.closeAt)&&ts(w.settledAt)&&
 w.settledAt>=w.closeAt&&w.source?.includes('Kalshi');
const freq=(arr,fn)=>Object.fromEntries([...arr.reduce((m,x)=>{
 const key=fn(x);m.set(key,(m.get(key)||0)+1);return m;
},new Map())].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))));
const pct=(n,d)=>d>0?Number((100*n/d).toFixed(2)):null;
const dt=n=>new Date(n).toISOString();
const priceBand=ask=>!f(ask)?'UNAVAILABLE':ask<.2?'BELOW_20C':
 ask<.35?'20_TO_35C':ask<.6?'35_TO_60C':
 ask<.75?'60_TO_75C':ask<=.87?'75_TO_87C':'ABOVE_87C';
const remainingBand=s=>s>600?'10_TO_14_MIN':
 s>360?'6_TO_10_MIN':s>150?'2.5_TO_6_MIN':
 s>90?'1.5_TO_2.5_MIN':'OUTSIDE_ENTRY_WINDOW';
const percentile=(arr,p)=>arr.length?
 arr[Math.min(arr.length-1,Math.floor(p*(arr.length-1)))]:null;
if(data.format!=='ETH-15 Scout V4 decision audit evidence'||
 data.paperOnly!==true||data.readOnly!==true||
 !Array.isArray(data.researchTicks)||!Array.isArray(data.journal?.windows)||
 !Array.isArray(data.journal?.trades))throw Error('Only complete exported paper-only V4 audit accepted');

const releaseCandidates=data.researchTicks.filter(r=>r?.paperOnly===true&&
 r.decision?.shadowProbe?.mainCoherence?.entry?.version===
 MAIN_COHERENCE_RESEARCH_VERSION&&
 r.decision?.shadowProbe?.prospectiveShadow?.revised?.version===
 SHADOW_QUALITY_VERSION&&
 r.sampledExitBook?.source==='SAME_TICK_AUTHENTICATED_BOOK_SAMPLE'&&
 ts(r.observedAt));
if(!releaseCandidates.length)throw Error(
 'No complete revised V4 release observations in export. Verify Cloudflare deployment/version first.');
const firstNew=Math.min(...releaseCandidates.map(r=>r.observedAt));
const cohortStart=Math.ceil(firstNew/900000)*900000;
const cohortEnd=cohortStart+15*60*60*1000;
const filtered=data.researchTicks.filter(r=>r?.paperOnly===true&&
 ts(r.observedAt)&&r.observedAt>=cohortStart&&r.observedAt<cohortEnd)
 .sort((a,b)=>a.observedAt-b.observedAt||(a.id||0)-(b.id||0));
const aligned=filtered.filter(r=>r.decision?.shadowProbe?.mainCoherence?.entry?.version===
 MAIN_COHERENCE_RESEARCH_VERSION&&
 r.decision?.shadowProbe?.prospectiveShadow?.revised?.version===
 SHADOW_QUALITY_VERSION);
const officialMap=new Map();
for(const w of data.journal.windows){
 if(!validWindow(w))continue;
 const old=officialMap.get(w.ticker);
 if(!old||old.settledAt>w.settledAt)officialMap.set(w.ticker,w);
}
const allRoundCloses=Array.from({length:60},(_,i)=>cohortStart+900000*(i+1));
const byClose=new Map();
for(const r of filtered){
 if(!ts(r.closeAt))continue;
 const set=byClose.get(r.closeAt)||new Set();
 if(ticker.test(r.ticker||''))set.add(r.ticker);
 byClose.set(r.closeAt,set);
}
const markets=allRoundCloses.map((closeAt,i)=>{
 const tickers=[...(byClose.get(closeAt)||new Set())];
 const m=tickers.find(t=>officialMap.get(t)?.closeAt===closeAt)||
   tickers[0]||null;
 const w=m?officialMap.get(m):null;
 return {round:i+1,closeAt:dt(closeAt),ticker:m,
  sampledEngineTicks:filtered.filter(x=>x.closeAt===closeAt).length,
  officialStatus:w&&w.closeAt===closeAt?'FINALIZED':'UNRESOLVED',
  officialOutcome:w?.closeAt===closeAt?w.outcome:null};
});
// Both A/B controls, original C and revised quality entries must use
// ONLY research ticks within 15h, not pre-release rows.
const originalAB=joinFinalizedOfficialOutcomes(
 selectFirstShadowSignals(filtered,{notBefore:cohortStart}),data.journal.windows);
const originalC=scoreCandidateCConfirmed(
 selectCandidateCFirstConfirmed(filtered,{notBefore:cohortStart}),
 data.journal.windows);
const revised=joinRevisedOfficialOutcomes(
 selectRevisedFirstConfirmed(filtered,{notBefore:cohortStart}),
 data.journal.windows);
const paperOnlyMain=data.journal.trades.filter(t=>
 t.strategy==='V4_SETTLEMENT_FIRST'&&ts(t.time)&&
 t.time>=cohortStart&&t.time<cohortEnd);
const mainForReplay=paperOnlyMain.map(t=>({
 policy:'MAIN_ACTUAL_PAPER_ENTRY',ticker:t.ticker,closeAt:Date.parse(t.closeTime),
 side:t.side,firstObservedAt:t.time,ask:t.entry,quantity:t.qty,
 allIn:t.cost,actualFillVerified:false
})).filter(t=>ticker.test(t.ticker||'')&&ts(t.closeAt)&&
 ['UP','DOWN'].includes(t.side)&&f(t.ask)&&f(t.allIn)&&
 Number.isSafeInteger(t.quantity)&&t.quantity>0);
const combined=[...originalAB,...originalC,...revised,...mainForReplay];
// Only the first entry of each policy+market, even if data duplicates.
const single=new Map();
for(const x of combined.sort((a,b)=>a.firstObservedAt-b.firstObservedAt)){
 const key=x.policy+'|'+x.ticker;
 if(!single.has(key))single.set(key,x);
}
const exitPaths=finalizeExitStudies(replayExitDecisionStudies(
 [...single.values()],filtered),data.journal.windows);
const recordedAlignment=aligned.map(r=>{
 const e=r.decision.shadowProbe.mainCoherence.entry;
 return {ticker:r.ticker,at:r.observedAt,closeAt:r.closeAt,
  reason:e.baselineReason,status:e.status,classification:e.concordance?.classification,
  flags:e.concordance?.flags||[],technicalSide:e.technical?.technicalPreferredSide,
  valueSide:e.value?.side,valueMode:e.value?.status,
  selected:e.value?.currentlyEligibleBaselineSide||null,
  remainingSeconds:r.secondsRemaining};
});
const firstCoherence=new Map();
for(const e of recordedAlignment)if(ticker.test(e.ticker||'')&&
 e.status==='EVIDENCE_RECONCILED'&&!firstCoherence.has(e.ticker))
 firstCoherence.set(e.ticker,e);
const mainFirst=[...firstCoherence.values()].map(x=>{
 const w=officialMap.get(x.ticker),outcome=
 w?.closeAt===x.closeAt?w.outcome:null;
 return {...x,officialOutcome:outcome,technicalCorrect:outcome&&
 ['UP','DOWN'].includes(x.technicalSide)?x.technicalSide===outcome:null,
 valueRankCorrect:outcome&&['UP','DOWN'].includes(x.valueSide)?
 x.valueSide===outcome:null};
});
const processDurations=aligned.map(t=>t.processingMs).filter(f)
 .sort((a,b)=>a-b);
const firstTime=filtered[0]?.observedAt,lastTime=filtered.at(-1)?.observedAt;
let longGaps=0,largestGapMs=0;
for(let i=1;i<filtered.length;i++){
 const d=filtered[i].observedAt-filtered[i-1].observedAt;
 if(d>30000)longGaps++;
 largestGapMs=Math.max(largestGapMs,d);
}
const sourceWitness=aligned.map(r=>r.decision.shadowProbe.prospectiveShadow.sourceWitness)
 .filter(Boolean);
const revisedReasons={};
for(const policy of Object.keys(REVISED_POLICY)){
 const q=aligned.map(t=>t.decision.shadowProbe.prospectiveShadow.revised?.policies?.[policy])
  .filter(Boolean);
 revisedReasons[policy]={observations:q.length,
  reasons:freq(q,x=>x.status==='QUALIFYING_QUALITY_OBSERVATION'?
   'QUALIFYING_QUALITY_OBSERVATION':x.reason||'UNKNOWN'),
  qualityObservationTicks:q.filter(x=>x.status==='QUALIFYING_QUALITY_OBSERVATION').length,
  affordableAt50cTicks:q.filter(x=>x.proposed?.affordableAt50c===true).length};
}
// Positive evidence funnel. One row is one SIDE of one research tick,
// NOT an independent trade. Select a contract's nearest conservative
// margin without ever consulting the later official settlement.
const valueSides=[];
for(const row of aligned){
 const e=row.decision.shadowProbe.mainCoherence.entry;
 if(e?.status!=='EVIDENCE_RECONCILED')continue;
 for(const side of ['UP','DOWN']){
  const s=e.value?.sides?.[side];
  if(!s||![s.ask,s.breakEven,s.centralEdge,s.lowerEdge,
    s.requiredEdge].every(f))continue;
  valueSides.push({ticker:row.ticker,at:row.observedAt,
   remainingSeconds:row.secondsRemaining,side,ask:s.ask,
   centralMarginPp:Number(((s.centralEdge-s.requiredEdge)*100).toFixed(2)),
   stressMarginPp:Number(((s.lowerEdge-s.requiredEdge)*100).toFixed(2)),
   modelStatus:s.status});
 }
}
const funnel={
 sideEvaluationTicks:valueSides.length,
 distinctMarketsWithComparableSides:new Set(valueSides.map(x=>x.ticker)).size,
 askWithin87c:valueSides.filter(x=>x.ask<=.87).length,
 centralValueAboveRequiredHurdle:valueSides.filter(x=>
  x.centralMarginPp>=0&&x.ask<=.87).length,
 stressValueAboveRequiredHurdle:valueSides.filter(x=>
  x.stressMarginPp>=0&&x.ask<=.87).length,
 nearMissWithin2ppOfStressHurdle:valueSides.filter(x=>
  x.stressMarginPp<0&&x.stressMarginPp>=-2&&x.ask<=.87).length,
 observedAskBands:freq(valueSides,x=>priceBand(x.ask)),
 observedTimeBands:freq(valueSides,x=>remainingBand(x.remainingSeconds)),
 closestConservativeValueByMarket:[...valueSides.reduce((m,x)=>{
  const p=m.get(x.ticker);
  if(!p||x.stressMarginPp>p.stressMarginPp||
   (x.stressMarginPp===p.stressMarginPp&&x.at<p.at))m.set(x.ticker,x);
  return m;
 },new Map()).values()].sort((a,b)=>a.at-b.at)
 .map(x=>({...x,at:dt(x.at),
  officialSettlementNotUsedForSelection:true}))
};
const baselineReasons=recordedAlignment.map(x=>x.reason).filter(Boolean);
const mainRealNet=paperOnlyMain.filter(x=>f(x.pnl))
 .reduce((a,b)=>a+b.pnl,0);
const missingMarkets=markets.filter(x=>!x.ticker).length;
const unresolvedMarkets=markets.filter(x=>x.officialStatus==='UNRESOLVED').length;
const result={
 format:'ETH-15 V4 15-hour prospective observed-strategy and exits',
 paperOnly:true,readOnly:true,executionAuthorized:false,
 actualFillsVerified:false,allNonMainProfitsHypothetical:true,
 sourceExportedAt:data.exportedAt,
 releaseFirstVerifiedObservationAt:dt(firstNew),
 cohort:{start:dt(cohortStart),end:dt(cohortEnd),minutes:900,
  consecutiveMarketCount:60,complete:Date.parse(data.exportedAt)>=cohortEnd,
  settlementComplete:unresolvedMarkets===0,marketObservations:60-missingMarkets,
  missingMarketWindows:missingMarkets,unresolvedMarkets,
  expectedEngineTicksApproximately:3600,recordedEngineTicks:filtered.length,
  allResearchRevisionsPresent:aligned.length===filtered.length,
  firstEngineTick:ts(firstTime)?dt(firstTime):null,
  lastEngineTick:ts(lastTime)?dt(lastTime):null},
 technicalFeeds:{
  alignedResearchTicks:aligned.length,processingMs:{
   median:percentile(processDurations,.5),p95:percentile(processDurations,.95),
   max:percentile(processDurations,1)},
  engineGapsLongerThan30s:longGaps,largestEngineGapMs:largestGapMs,
  sampledBookFresh:aligned.filter(t=>t.sampledExitBook?.bookState==='FRESH_SAME_TICK').length,
  sampledIndexFresh:aligned.filter(t=>t.sampledExitBook?.indexState==='OFFICIAL_FRESH').length,
  observedErrors:freq(aligned.filter(x=>x.lastError),x=>x.lastError),
  dataStatuses:freq(aligned,x=>x.dataStatus),
  sourceReadiness:Object.fromEntries(Object.keys(sourceWitness[0]||{}).map(k=>
   [k,{ready:sourceWitness.filter(s=>s[k]===true).length,total:sourceWitness.length}]))},
 mainBot:{
  paperBuys:paperOnlyMain.length,
  completedRecordedPaperTrades:paperOnlyMain.length,
  originalPaperResults:freq(paperOnlyMain,x=>x.status),
  realizedPaperNet:Math.round(mainRealNet*100)/100,
  watchReasons:freq(baselineReasons,x=>x),
  opportunityFunnel:funnel,
  directionalConcordance:{
   tickCount:recordedAlignment.length,
   groups:freq(recordedAlignment,x=>x.classification),
   conflictsByTick:freq(recordedAlignment.flatMap(x=>x.flags),x=>x),
   firstComparableByMarket:mainFirst.length,
   firstComparableMarketGroups:freq(mainFirst,x=>x.classification),
   technicalFirstForecast:{resolved:mainFirst.filter(x=>x.technicalCorrect!==null).length,
    correct:mainFirst.filter(x=>x.technicalCorrect===true).length},
   unqualifiedCentralRankFirstForecast:{resolved:mainFirst.filter(x=>x.valueRankCorrect!==null).length,
    correct:mainFirst.filter(x=>x.valueRankCorrect===true).length}
  }},
 originalControls:{AandB:summarizeFirstSignals(originalAB),C:summarizeCandidateC(originalC)},
 revisedQuality:{
  outcomes:summarizeRevisedOutcomes(revised),perTickReasons:revisedReasons,
  notes:'A2/B2/C2 use fixed first two-tick quality confirmation. Per-tick observations are not independent trades.'},
 exitStudy:{summary:summarizeExitStudies(exitPaths),
  pathways:exitPaths,
  warnings:'Unverified fills, incomplete top-book sampling, no continuous bid path and no main SELL policy changes.'},
 signalDiagnostics:{
  distinctMarketsWithAnySignals:new Set([...single.values()].map(x=>x.ticker)).size,
  firstSignals:[...single.values()].map(s=>({
   policy:s.policy,ticker:s.ticker,firstObservedAt:dt(s.firstObservedAt),
   side:s.side,ask:s.ask,priceBand:priceBand(s.ask),
   timeRemainingBand:remainingBand((s.closeAt-s.firstObservedAt)/1000),
   contractClosedAt:dt(s.closeAt),
   officialOutcome:officialMap.get(s.ticker)?.outcome||'UNRESOLVED',
   paperWholeContractAffordable:s.policy==='C2_EVIDENCE'?
    s.affordableAt50c:null,
   actualFillVerified:false
  })),
  byPolicyPriceBand:freq([...single.values()],s=>s.policy+'|'+priceBand(s.ask)),
  byPolicyTimeBand:freq([...single.values()],s=>s.policy+'|'+
   remainingBand((s.closeAt-s.firstObservedAt)/1000))},
 all60Markets:markets,
 warnings:[
  'A 15h window contains at most 60 independent contract resolutions, not 3600 independent outcomes.',
  'Original A/B/C and A2/B2/C2 may study the SAME exchange contract and must be paired, not treated as independent wins.',
  'No unverified Kalshi WS entry/exit quote is a guaranteed executable fill.',
  'Kalshi official outcomes are only joined AFTER entry and exit decisions are frozen.',
  'Scenario percentages are NOT scientifically calibrated probabilities.',
  'No trade frequency can be forced; zero signals in an entire cohort is still a finding.',
  'Do not tune rules on this 15h sample then claim an unbiased validation on the same data.'
 ]
};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
