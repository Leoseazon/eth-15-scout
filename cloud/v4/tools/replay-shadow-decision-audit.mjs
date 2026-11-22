/* Offline schema and safety audit only. NEVER use this sample for OOS claims.
 * Usage: node cloud/v4/tools/replay-shadow-decision-audit.mjs /path/audit.json
 * No network, no orders, no mutations, no file writes. */
import fs from 'node:fs';
import {evaluateBothShadowPolicies,SHADOW_SPEC_VERSION} from '../src/shadow-opportunity-policies.js';
const input=process.argv[2];
if(!input)throw Error('Provide an existing read-only decision audit JSON file');
const d=JSON.parse(fs.readFileSync(input,'utf8'));
if(d.paperOnly!==true||d.readOnly!==true||!Array.isArray(d.researchTicks))
 throw Error('Not a validated paper-only research audit');
const rows=[...d.researchTicks].sort((a,b)=>a.observedAt-b.observedAt);
const aggregate={version:SHADOW_SPEC_VERSION,sourceExport:d.exportedAt,
 explanation:'Historical diagnostic only; do not tune or interpret as OOS or true fills',
 policies:{A_STRESS_RELAXED:{eligibleTicks:0,distinctRoundSignals:0},
 B_EXECUTION_FILTERED:{eligibleTicks:0,distinctRoundSignals:0}},
 sourceWitnessRejections:0,baselineValueWatchTicks:0};
const first={A_STRESS_RELAXED:new Set(),B_EXECUTION_FILTERED:new Set()};
for(const t of rows){
 const probe=t.decision?.shadowProbe||{};
 const c=probe.candidate||{};
 if(c.reason!=='NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK')continue;
 aggregate.baselineValueWatchTicks++;
 const at=Number(probe.decision?.at||t.finishedAt||t.observedAt);
 const ms=(n,max)=>Number.isSafeInteger(n)&&n>0&&at>=n&&at-n<=max;
 // The exported "closedAt" values are CANDLE OPEN timestamps, not the close.
 const latestClosedBar=(openedAt,period)=>Number.isSafeInteger(openedAt)&&
  openedAt===Math.floor(at/period)*period-period;
 const feeds=t.feeds||{},k=t.kraken||{};
 const hasBook=ms(c.bookReceiptAt,5000)&&c.valueScenario?.status==='SCENARIOS_READY';
 const hasIndex=ms(c.indexSourceAt,15000);
 const sourceWitness={
  officialIndexFresh:hasIndex,
  authenticatedBookFresh:hasBook,
  sameTickerBook:typeof t.ticker==='string'&&t.ticker.startsWith('KXETH15M-')&&hasBook,
  kraken1mClosed:feeds.kraken1m?.ok===true&&latestClosedBar(k.oneClosedAt,60000),
  kraken3mClosed:latestClosedBar(k.threeStructure?.closedAt,180000),
  kraken5mClosed:feeds.kraken5m?.ok===true&&latestClosedBar(k.fiveStructure?.closedAt,300000),
  baselineSpreadDepthAndFeeChecksPassed:true // guaranteed by per-side conservative reject stage
 };
 if(Object.values(sourceWitness).some(v=>!v))aggregate.sourceWitnessRejections++;
 const outcome=evaluateBothShadowPolicies({ticker:t.ticker,
  remainingSeconds:t.secondsRemaining,sourceWitness,riskMode:'NORMAL',
  alreadyTraded:false,baselineStatus:probe.status,
  consideredSideValues:c.consideredSideValues});
 for(const [policy,v] of Object.entries(outcome)){
  if(v.status!=='SHADOW_RESEARCH_CANDIDATE')continue;
  aggregate.policies[policy].eligibleTicks++;
  first[policy].add(t.ticker);
 }
}
for(const key of Object.keys(first))
 aggregate.policies[key].distinctRoundSignals=first[key].size;
console.log(JSON.stringify(aggregate,null,2));
