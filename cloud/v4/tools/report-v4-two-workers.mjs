/* Compare physically isolated MAIN and CONTROLS V4 evidence OFFLINE.
 * node cloud/v4/tools/report-v4-two-workers.mjs main.json controls.json > comparison.json
 * Main remains the ONLY active paper strategy; Conservative is independently
 * simulated; A/B/C/A2/B2/C2 are original non-executing research hypotheses.
 * Never invent actual fills or assume synchronized cross-Worker quote ticks.
 */
import fs from 'node:fs';
import {selectFirstShadowSignals,joinFinalizedOfficialOutcomes,
 summarizeFirstSignals} from '../src/shadow-prospective-scoring.js';
import {selectCandidateCFirstConfirmed,scoreCandidateCConfirmed,
 summarizeCandidateC} from '../src/candidate-c-scoring.js';
import {selectRevisedFirstConfirmed,joinRevisedOfficialOutcomes,
 summarizeRevisedOutcomes} from '../src/shadow-quality-scoring.js';
const [mainPath,controlPath]=process.argv.slice(2);
if(!mainPath||!controlPath)throw Error('Need BOTH exported main and controls JSON');
const main=JSON.parse(fs.readFileSync(mainPath,'utf8'));
const other=JSON.parse(fs.readFileSync(controlPath,'utf8'));
const n=x=>typeof x==='number'&&Number.isFinite(x);
const ts=x=>Number.isSafeInteger(x)&&x>1000000000000;
const ticker=x=>typeof x==='string'&&/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(x);
const iso=x=>new Date(x).toISOString();
const counts=(arr,key)=>Object.fromEntries([...arr.reduce((m,x)=>{
 const k=key(x);m.set(k,(m.get(k)||0)+1);return m;},new Map())]
 .sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))));
const pct=(a,b)=>b?Number((100*a/b).toFixed(2)):null;
const win=(x)=>x?.status==='OFFICIAL_RESULT'&&
 x.exchangeStatus==='finalized'&&['UP','DOWN'].includes(x.outcome)&&
 ticker(x.ticker)&&ts(x.closeAt)&&ts(x.settledAt)&&x.settledAt>=x.closeAt;
const mainJ=main.journals||main.journal;
const controlJ=other.journal;
if(main.format!=='ETH-15 Scout V4 complete research evidence'&&
 main.format!=='ETH-15 Scout V4 decision audit evidence')
 throw Error('Main must be an actual V4 complete research export');
if(other.format!=='ETH-15 Scout V4 controls-only evidence'||
 other.paperOnly!==true||other.readOnly!==true||
 other.workerRole!=='CONTROLS_ONLY'||other.engineMainTradingDisabled!==true||
 other.snapshot?.status?.armed!==false||
 other.snapshot?.status?.mainTradingDisabledByCode!==true)
 throw Error('Separate, verified hard-disarmed CONTROLS export REQUIRED');
if(main.paperOnly!==true||!mainJ||!controlJ||
 !Array.isArray(main.researchTicks)||!Array.isArray(other.researchTicks)||
 !Array.isArray(mainJ.trades)||!Array.isArray(mainJ.windows)||
 !Array.isArray(controlJ.windows)||
 !Array.isArray(controlJ.conservativeControlJournal?.trades))
 throw Error('Main or separate Conservative journal incomplete; no made-up results');
const mainReady=main.researchTicks.filter(t=>ts(t.observedAt)&&
 t.decision?.shadowProbe?.mainStrategyProfile?.active==='OPPORTUNISTIC'&&
 t.decision?.shadowProbe?.mainCoherence?.readOnly===true);
const controlReady=other.researchTicks.filter(t=>ts(t.observedAt)&&
 t.decision?.shadowProbe?.researchWorkerRole==='CONTROLS_ONLY'&&
 t.decision?.shadowProbe?.conservativeReference?.readOnly===true);
if(!mainReady.length||!controlReady.length)
 throw Error('Both Workers must show verified first isolated strategy observations');
const firstMain=Math.min(...mainReady.map(x=>x.observedAt));
const firstControl=Math.min(...controlReady.map(x=>x.observedAt));
const start=Math.ceil(Math.max(firstMain,firstControl)/900000)*900000;
const end=start+60*900000;
const mainTicks=mainReady.filter(t=>t.observedAt>=start&&t.observedAt<end);
const controlTicks=controlReady.filter(t=>t.observedAt>=start&&t.observedAt<end);
const originalWindows=[...mainJ.windows,...controlJ.windows];
const official=new Map(),contradictions=[];
for(const w of originalWindows)if(win(w)){
 const old=official.get(w.ticker);
 if(old&&old.outcome!==w.outcome)contradictions.push(w.ticker);
 if(!old||w.settledAt<old.settledAt)official.set(w.ticker,w);
}
const independentCloses=Array.from({length:60},(_,i)=>start+(i+1)*900000);
const rounds=independentCloses.map((closeAt,i)=>{
 const m=mainTicks.filter(x=>x.closeAt===closeAt);
 const c=controlTicks.filter(x=>x.closeAt===closeAt);
 const choice=m.find(x=>official.get(x.ticker)?.closeAt===closeAt)||
  c.find(x=>official.get(x.ticker)?.closeAt===closeAt)||m[0]||c[0]||null;
 const w=official.get(choice?.ticker);
 return {round:i+1,ticker:choice?.ticker??null,
  closeAt:iso(closeAt),mainTicks:m.length,controlTicks:c.length,
  finalized:w?.closeAt===closeAt&&!contradictions.includes(choice?.ticker),
  officialOutcome:w?.closeAt===closeAt&&!contradictions.includes(choice?.ticker)?
   w.outcome:null};
});
const ctrl=controlJ.conservativeControlJournal;
if(ctrl.journalIndependentOfMain!==true||
 ctrl.version!=='V4-CONSERVATIVE-INDEPENDENT-20261123-v1'||
 !Array.isArray(ctrl.pendingPositions)||!Array.isArray(ctrl.finalRoundPasses))
 throw Error('Control data does not prove its separate simulated bankroll');
const inWindow=t=>ts(t?.time)&&t.time>=start&&t.time<end;
const uniqueByTicker=new Map();
const mainBuys=mainTicks.filter(t=>{
 const d=t.decision?.shadowProbe?.decision;
 return d?.status==='PAPER_BUY'&&ts(d.at)&&
 Math.abs(d.at-t.observedAt)<=30000&&ticker(t.ticker)&&
 ['UP','DOWN'].includes(d.side);
});
for(const r of mainBuys)if(!uniqueByTicker.has(r.ticker))
 uniqueByTicker.set(r.ticker,{
  ticker:r.ticker,side:r.decision.shadowProbe.decision.side,
  observedAt:r.observedAt,
  ask:r.decision.shadowProbe.decision.entry,
  allIn:r.decision.shadowProbe.decision.cost,
  hypotheticalFillOnly:true
 });
const selectedMain=mainJ.trades.filter(t=>inWindow(t)&&
 t.strategy==='V4_SETTLEMENT_FIRST');
const selectedControl=ctrl.trades.filter(inWindow);
const summary=trades=>({
 completed:trades.length,
 net:trades.length?Number(trades.reduce((s,t)=>s+(n(t.pnl)?t.pnl:0),0).toFixed(2)):null,
 wins:trades.filter(t=>n(t.pnl)&&t.pnl>0).length,
 losses:trades.filter(t=>n(t.pnl)&&t.pnl<0).length,
 exits:counts(trades,t=>t.exitType||t.status||'UNCLASSIFIED'),
 realExchangeFills:0
});
const ab=joinFinalizedOfficialOutcomes(
 selectFirstShadowSignals(controlTicks,{notBefore:start}),originalWindows);
const c=scoreCandidateCConfirmed(
 selectCandidateCFirstConfirmed(controlTicks,{notBefore:start}),originalWindows);
const a2=joinRevisedOfficialOutcomes(
 selectRevisedFirstConfirmed(controlTicks,{notBefore:start}),originalWindows);
const marketErrorCount=rows=>counts(rows.filter(t=>t.lastError),
 t=>t.lastError||'UNKNOWN');
const lastControl=controlTicks.at(-1)?.decision?.shadowProbe?.conservativeControl;
const complete=Date.parse(main.exportedAt||main.createdAt)>=end&&
 Date.parse(other.exportedAt)>=end;
const output={
 format:'ETH-15 Scout V4 physically isolated 8-strategy 15h comparison',
 generatedAt:new Date().toISOString(),paperOnly:true,realExchangeFillsVerified:false,
 workers:[
  {role:'MAIN',name:'eth-15-scout-cloud-v4test',profile:'OPPORTUNISTIC',
   firstVerifiedAt:iso(firstMain),observations:mainTicks.length},
  {role:'CONTROLS',name:'eth-15-scout-v4-controls',profile:'SEVEN_CONTROLS',
   mainTradingDisabledByCode:true,firstVerifiedAt:iso(firstControl),
   observations:controlTicks.length}
 ],
 cohort:{start:iso(start),end:iso(end),expectedWindows:60,
  sourceExportsCover15h:complete,
  bothSourcesOnAllWindows:rounds.filter(r=>r.mainTicks>0&&r.controlTicks>0).length,
  officiallyFinalized:rounds.filter(r=>r.finalized).length,
  ambiguousOfficialTickers:[...new Set(contradictions)]},
 mainOpportunistic:{
  distinctDocumentedBuys:uniqueByTicker.size,
  firstBuys:[...uniqueByTicker.values()],
  completedPaperTrades:summary(selectedMain),
  passAndWatchReasons:counts(mainTicks,t=>
   t.decision?.shadowProbe?.reason||'UNAVAILABLE')
 },
 separateConservative:{
  privateInitialBankroll:ctrl.bankrollInitial||ctrl.initial||100,
  privateCashAtExport:ctrl.cash,
  privateNetAtExport:ctrl.realized,
  privateEntriesLifetime:ctrl.entries,
  privateCompletedCohortTrades:summary(selectedControl),
  controlReportedLastTick:lastControl||null,
  controlConfirmedOnlyByOwnPersistentJournal:true
 },
 unchangedResearchControls:{
  originalAandB:summarizeFirstSignals(ab),
  originalC:summarizeCandidateC(c),
  revisedA2B2C2:summarizeRevisedOutcomes(a2)
 },
 operational:{
  mainExceptions:marketErrorCount(mainTicks),
  controlsExceptions:marketErrorCount(controlTicks),
  mainTickCoveragePct:pct(mainTicks.length,3600),
  controlsTickCoveragePct:pct(controlTicks.length,3600),
  bothWorkersDecidedSameRounds:rounds.filter(r=>r.mainTicks&&r.controlTicks).length,
  separateSnapshotClocks:true,
  possibleSharedProviderRateLimits:true
 },
 rounds,
 caveats:[
  'One official market outcome per contract; eight strategy signals are paired, not independent market samples.',
  'Main is the only active simulated paper BUY/SELL engine; Conservative has separate simulated account state; A/B/C/A2/B2/C2 are signals only.',
  'Two Workers, two Durable Object namespaces, two socket connections: their observations are not synchronized to the millisecond.',
  'They still may share external market-data provider rate limits and Cloudflare account quotas.',
  'Quotes are NOT confirmed fills. Profits for control paper trades and all shadows are counterfactual.',
  'Comparing one 15h period does not establish a reliable or calibrated trading edge.'
 ]
};
console.log(JSON.stringify(output,null,2));
