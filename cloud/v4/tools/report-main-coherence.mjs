/* RESEARCH ONLY: Offline analysis of existing V4 Decision Audit JSON.
 * No Cloudflare access, no trading, no strategy mutation, no fills.
 * Example:
 *   node cloud/v4/tools/report-main-coherence.mjs audit.json > coherence.json
 * Reads original submitted evidence, groups repeated 15s ticks by market,
 * freezes the first comparable observation BEFORE joining official results.
 */
import fs from 'node:fs';
import {assessMainDecisionCoherence,MAIN_COHERENCE_RESEARCH_VERSION}
 from '../src/main-coherence-research.js';

const filename=process.argv[2];
if(!filename)throw new Error('Provide one existing V4 Decision Audit JSON file');
const data=JSON.parse(fs.readFileSync(filename,'utf8'));
if(data.format!=='ETH-15 Scout V4 decision audit evidence'||
 data.paperOnly!==true||data.readOnly!==true||
 !Array.isArray(data.researchTicks)||!Array.isArray(data.journal?.windows))
 throw new Error('A V4 paper-only read-only decision audit is required');
const tally=(xs,key)=>Object.fromEntries(
 [...xs.reduce((m,x)=>{const k=key(x);m.set(k,(m.get(k)||0)+1);return m},new Map())]
 .sort((a,b)=>b[1]-a[1]));
const rows=[];
for(const tick of data.researchTicks){
 const sp=tick?.decision?.shadowProbe,c=sp?.candidate;
 if(sp?.version!=='V4-TARGET-CONTEXTUAL-VALUE-20261122'||
    !['WATCH','CANDIDATE'].includes(c?.status)||
    !Number.isSafeInteger(tick.observedAt)||
    !Number.isSafeInteger(tick.closeAt)||tick.closeAt<=tick.observedAt||
    tick.observedAt<tick.closeAt-900000||
    typeof tick.ticker!=='string'||tick.paperOnly!==true)continue;
 const coherent=assessMainDecisionCoherence({
  market:{ticker:tick.ticker},candidate:c,
  context:{three:tick.kraken?.threeStructure,five:tick.kraken?.fiveStructure},
  at:tick.observedAt});
 if(coherent.status!=='EVIDENCE_RECONCILED')continue;
 rows.push({ticker:tick.ticker,at:tick.observedAt,closeAt:tick.closeAt,
  reason:coherent.baselineReason,status:coherent.baselineDecision,
  technicalSide:coherent.technical.technicalPreferredSide,
  valueSide:coherent.value.side,
  valueMode:coherent.value.status,
  concordance:coherent.concordance.classification,
  flags:coherent.concordance.flags});
}
rows.sort((a,b)=>a.at-b.at||a.ticker.localeCompare(b.ticker));
const firstByTicker=new Map();
for(const row of rows)if(!firstByTicker.has(row.ticker))
 firstByTicker.set(row.ticker,row);
const finalMap=new Map();
for(const w of data.journal.windows){
 if(w?.status!=='OFFICIAL_RESULT'||w.exchangeStatus!=='finalized'||
    !['UP','DOWN'].includes(w.outcome)||
    !Number.isSafeInteger(w.closeAt)||!Number.isSafeInteger(w.settledAt)||
    w.settledAt<w.closeAt||!String(w.source||'').includes('Kalshi'))continue;
 const old=finalMap.get(w.ticker);
 if(!old||w.settledAt<old.settledAt)finalMap.set(w.ticker,w);
}
const frozen=[...firstByTicker.values()].map(row=>{
 const official=finalMap.get(row.ticker);
 if(!official||official.closeAt!==row.closeAt||
    official.settledAt<=row.at)
  return {...row,officialResult:'UNRESOLVED',
   technicalCorrect:null,researchCentralCorrect:null};
 return {...row,officialResult:official.outcome,
  technicalCorrect:['UP','DOWN'].includes(row.technicalSide)?
   row.technicalSide===official.outcome:null,
  researchCentralCorrect:['UP','DOWN'].includes(row.valueSide)?
   row.valueSide===official.outcome:null};
});
const seen=(name)=>frozen.filter(x=>x[name]!==null);
const outcome=(name)=>{
 const s=seen(name);
 return {uniqueRounds:s.length,correct:s.filter(x=>x[name]).length,
  incorrect:s.filter(x=>!x[name]).length,
  notAnEntryStrategy:true,notProfitabilityEvidence:true};
};
console.log(JSON.stringify({
 format:'ETH-15 Scout V4 main strategy coherence retrospective diagnostic',
 modelVersion:'V4-TARGET-CONTEXTUAL-VALUE-20261122',
 coherenceVersion:MAIN_COHERENCE_RESEARCH_VERSION,
 exportedAt:data.exportedAt,sourceCompleteness:data.completeness,
 paperOnly:true,readOnly:true,executionAuthorized:false,
 sampleCounts:{eligibleResearchTicks:rows.length,
  uniqueFirstComparableMarkets:frozen.length,
  originalCandidateTicks:rows.filter(x=>x.status==='CANDIDATE').length,
  originalWatchTicks:rows.filter(x=>x.status==='WATCH').length},
 tickLevel:{baselineReasons:tally(rows,x=>x.reason),
  classification:tally(rows,x=>x.concordance),
  valueStatus:tally(rows,x=>x.valueMode),
  observedConflicts:tally(rows.flatMap(x=>x.flags),x=>x)},
 firstPerMarket:{classification:tally(frozen,x=>x.concordance),
  technicalDirectionalMatch:outcome('technicalCorrect'),
  unqualifiedCentralRankingDirectionalMatch:outcome('researchCentralCorrect'),
  rows:frozen},
 limitations:[
  'One first comparable tick PER CONTRACT prevents 15s repeats from appearing as independent outcomes.',
  'Central-value side can be from an UNQUALIFIED WATCH scenario and was never an executable BUY.',
  'Historical REST archive cannot verify executable WebSocket fills, liquidity or 5-second freshness.',
  'Archived 3m/5m structural excerpts lack complete support/resistance zone state; no retrospective barrier veto is assumed.',
  'The technical composite is a heuristic, and scenario frequencies are not calibrated winning probabilities.',
  'EXIT improvements cannot be assessed from this export alone without synchronized live order-book bid paths and actual held positions.',
  'Exploratory retrospective findings can prioritize hypotheses but must never tune or validate results against the same known outcomes.'
 ]
},null,2));
