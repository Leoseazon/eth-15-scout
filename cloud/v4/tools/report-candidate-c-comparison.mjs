/* Offline prospective comparison. RUNS ONLY ON A LOCAL SAVED JSON EXPORT.
 * No APIs, no trading, no writes, no state changes. Requires Candidate C
 * release to exist in research ticks: prior A/B outcomes are excluded for
 * a fair time-aligned cohort. Never counts hypothetical fills as orders.
 *
 * Usage: node cloud/v4/tools/report-candidate-c-comparison.mjs audit.json
 */
import fs from 'node:fs';
import {selectFirstShadowSignals,joinFinalizedOfficialOutcomes,
 summarizeFirstSignals} from '../src/shadow-prospective-scoring.js';
import {CANDIDATE_C_SPEC} from '../src/candidate-c-observer.js';
import {selectCandidateCFirstConfirmed,scoreCandidateCConfirmed,
 summarizeCandidateC} from '../src/candidate-c-scoring.js';

const filename=process.argv[2];
if(!filename)throw new Error('Provide a local exported V4 Decision Audit JSON file');
const data=JSON.parse(fs.readFileSync(filename,'utf8'));
if(data.format!=='ETH-15 Scout V4 decision audit evidence'||
   data.paperOnly!==true||data.readOnly!==true||
   !Array.isArray(data.researchTicks)||!Array.isArray(data.journal?.windows))
 throw new Error('Refusing non-V4, non-paper-only, or incomplete-format audit');
const cTicks=data.researchTicks.filter(t=>
 t?.decision?.shadowProbe?.prospectiveShadow?.candidateC?.version===CANDIDATE_C_SPEC);
if(!cTicks.length)throw new Error('No Candidate C observer records found. Confirm engine release and export again; no scores invented.');
const cohortStart=Math.min(...cTicks.map(t=>t.observedAt)
 .filter(t=>Number.isSafeInteger(t)&&t>1000000000000));
if(!Number.isFinite(cohortStart))throw new Error('No valid C cohort timestamps');
const aAndB=joinFinalizedOfficialOutcomes(
 selectFirstShadowSignals(data.researchTicks,{notBefore:cohortStart}),
 data.journal.windows);
const cFirst=selectCandidateCFirstConfirmed(data.researchTicks,{notBefore:cohortStart});
const cScored=scoreCandidateCConfirmed(cFirst,data.journal.windows);
const cReasonCounts={};
for(const t of cTicks){
 const v=t.decision.shadowProbe.prospectiveShadow.candidateC;
 const k=v.status==='QUALIFYING_OBSERVATION'?'QUALIFYING_OBSERVATION':(v.reason||'UNKNOWN');
 cReasonCounts[k]=(cReasonCounts[k]||0)+1;
}
const report={
 format:'ETH-15 Scout V4 prospective Candidate C research comparison',
 paperOnly:true,readOnly:true,actualFillsVerified:false,
 exportedAt:data.exportedAt,comparisonCohortStartedAt:new Date(cohortStart).toISOString(),
 sourceCompleteness:data.completeness,
 observations:{candidateCTicks:cTicks.length,candidateCReasons:cReasonCounts},
 shadowAandB:summarizeFirstSignals(aAndB),candidateC:summarizeCandidateC(cScored),
 firstSignals:{shadowAandB:aAndB,candidateC:cScored},
 warning:'Prospectively observed first side per contract only; no lookahead selection, no calibrated odds, no verified fills. Two hours is a diagnostic sample; any net values assume full displayed fills and hold to settlement.'
};
console.log(JSON.stringify(report,null,2));
