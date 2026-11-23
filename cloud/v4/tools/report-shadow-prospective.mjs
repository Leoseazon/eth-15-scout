/* Offline read-only shadow report. Does not call APIs or mutate history.
 * node cloud/v4/tools/report-shadow-prospective.mjs saved-decision-audit.json
 * Results are research observations, not simulated or real filled orders.
 */
import fs from 'node:fs';
import {selectFirstShadowSignals,joinFinalizedOfficialOutcomes,
 summarizeFirstSignals} from '../src/shadow-prospective-scoring.js';
const path=process.argv[2];
if(!path)throw new Error('Provide a local V4 Decision Audit JSON export path');
const data=JSON.parse(fs.readFileSync(path,'utf8'));
if(data.format!=='ETH-15 Scout V4 decision audit evidence'||
 data.paperOnly!==true||data.readOnly!==true||
 !Array.isArray(data.researchTicks)||!Array.isArray(data.journal?.windows))
 throw new Error('Refusing invalid/unauthenticated-format V4 paper-only audit');
const first=selectFirstShadowSignals(data.researchTicks);
const scored=joinFinalizedOfficialOutcomes(first,data.journal.windows);
const summary=summarizeFirstSignals(scored);
console.log(JSON.stringify({exportedAt:data.exportedAt,source:data.completeness,
 summary,firstSignals:scored},null,2));
