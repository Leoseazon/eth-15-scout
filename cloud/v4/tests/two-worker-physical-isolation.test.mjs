import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const read=p=>fs.readFileSync(root+p,'utf8');
const main=read('cloud/v4/src/main-only-worker.js');
const controls=read('cloud/v4/src/controls-only-worker.js');
const mainCfg=read('cloud/wrangler.v4paper.toml');
const haltedCfg=read('cloud/wrangler.v4test.toml');
const researchCfg=read('cloud/wrangler.v4controls.toml');
const count=(s,re)=>[...s.matchAll(re)].length;
test('MAIN existing Worker and DO storage identity are preserved',()=>{
 assert.match(mainCfg,/name = "eth-15-scout-cloud-v4test"/);
 assert.match(mainCfg,/main = "v4\/src\/main-only-worker.js"/);
 assert.match(mainCfg,/name = "SCOUT_V4"\nclass_name = "ScoutEngineV4"/);
 assert.match(main,/export class ScoutEngineV4 extends DurableObject/);
 assert.match(main,/getByName\('v4-single-paper-scout'\)/);
 assert.match(mainCfg,/V4_MAIN_PROFILE = "OPPORTUNISTIC"/);
 assert.match(haltedCfg,/main = "v4\/src\/main-only-worker.js"/);
 assert.match(haltedCfg,/SCOUT_V4_PAPER_MODE = "disabled"/);
});
test('MAIN bundle has NO control modules or shadow observer or research account',()=>{
 for(const x of ['conservative-control','shadow-research-observer',
   'shadow-quality-revisions','observeProspectiveShadow',
   'CONSERVATIVE_CONTROL','SCOUT_CONTROLS','controlState',
   'independentControlSourcesReady','conservativeControlJournal']){
  assert.ok(!main.includes(x),'FORBIDDEN main reference: '+x);
 }
 assert.match(main,/report=settlementFirstPaperStep\(s,/);
 assert.match(main,/profile:this\.mainProfileName/);
 assert.match(main,/this\.ctx\.storage\.transactionSync\(\(\)=>\{/);
 assert.match(main,/appendSettlementPrediction\(sql,forecastToCommit\)/);
 assert.match(main,/if\(exit\.status==='PAPER_SELL'\|\|s\.open===null\)/);
});
test('CONTROL Worker has new process, DO class, namespace and hard disable of MAIN',()=>{
 assert.match(researchCfg,/name = "eth-15-scout-v4-controls"/);
 assert.match(researchCfg,/main = "v4\/src\/controls-only-worker.js"/);
 assert.match(researchCfg,/name = "SCOUT_CONTROLS"\nclass_name = "ScoutControlResearchV4"/);
 assert.match(researchCfg,/new_sqlite_classes = \["ScoutControlResearchV4"\]/);
 assert.doesNotMatch(researchCfg,/script_name\s*=|SCOUT_V4\s*=|SCOUT_V4"\nclass_name/);
 assert.match(controls,/export class ScoutControlResearchV4 extends DurableObject/);
 assert.match(controls,/this\.paperExperimentAllowed=false;/);
 assert.doesNotMatch(controls,/report=settlementFirstPaperStep\(s,/);
 assert.doesNotMatch(controls,/engine\.step\(market,one,m5,fresh,context\)/);
 assert.doesNotMatch(controls,/s\.pendingPredictionToCommit=pos/);
 assert.match(controls,/env\.SCOUT_CONTROLS\.getByName\('v4-seven-controls'\)/);
 assert.doesNotMatch(controls,/env\.SCOUT_V4\.getByName/);
});
test('control entry is only enabled with explicit research role and disabled paper flags',()=>{
 assert.match(controls,/this\.controlsResearchAllowed=env\.V4_PHYSICAL_ISOLATION_ROLE==='CONTROLS_ONLY'&&/);
 assert.match(controls,/env\.SCOUT_V4_PAPER_MODE==='disabled'&&/);
 assert.match(controls,/env\.V4_SETTLEMENT_FIRST_EXPERIMENT==='false'/);
 assert.match(researchCfg,/SCOUT_V4_PAPER_MODE = "disabled"/);
 assert.match(researchCfg,/V4_SETTLEMENT_FIRST_EXPERIMENT = "false"/);
 assert.match(researchCfg,/V4_RESEARCH_CONTROLS_ENABLED = "true"/);
 assert.match(controls,/enabled:this\.controlsResearchAllowed/);
 assert.match(controls,/const independentControlSourcesReady=this\.controlsResearchAllowed&&marketReady/);
 assert.match(controls,/if\(!independentControlSourcesReady&&!s\.open\)/);
 assert.doesNotMatch(controls,/if\(!entrySourcesReady&&!s\.open\)/);
 assert.equal(count(controls,/if\(this\.controlsResearchAllowed\)/g),3); // release marker plus 2 protected paths
});
test('original A/B/C/A2/B2/C2 remain on controls Worker, not MAIN',()=>{
 assert.match(controls,/evaluateConservativePortfolio\(controlState/);
 assert.match(controls,/profile:'CONSERVATIVE',priorOfficialIndex:null/);
 assert.match(controls,/observeProspectiveShadow\(/);
 assert.match(controls,/prospectiveShadow=observeProspectiveShadow\(\{/);
 assert.match(controls,/report:conservativeReference,index,book:decisionBook/);
 assert.match(controls,/saveConservativePortfolio\(this\.ctx\.storage\.kv/);
 assert.match(controls,/settleConservativePortfolio\(controlState/);
 assert.match(controls,/report:conservativeReference,index,book:decisionBook/);
 assert.match(controls,/riskMode:'NORMAL',blocked:\[\]/);
 assert.match(controls,/mainTradingDisabledByCode:true/);
});
test('control network is independent, authenticated, not service-bound to MAIN',()=>{
 assert.match(researchCfg,/workers_dev = true/);
 assert.match(researchCfg,/V4_STREAM_CAPTURE_ENABLED = "true"/);
 assert.match(researchCfg,/V4_FULL_BOOK_ARCHIVE_ENABLED = "false"/);
 assert.match(researchCfg,/V4_DATA_RESEARCH_AUTHORIZED = "false"/);
 assert.match(controls,/if\(!env\.SCOUT_ADMIN_TOKEN\)/);
 assert.match(controls,/req\.headers\.get\('Authorization'\)!=='Bearer '\+env\.SCOUT_ADMIN_TOKEN/);
 assert.match(controls,/collectThrottledMarketFeeds\(remote,mUrl,API,now/);
 assert.match(controls,/checkCFValuesAccess\(\{/);
 assert.match(controls,/this\.stream\.ensure\(market\.ticker,/);
 assert.match(controls,/await this\.ctx\.storage\.setAlarm\(Date\.now\(\)\+7500\)/);
 assert.match(main,/await this\.ctx\.storage\.setAlarm\(Date\.now\(\)\+1000\)/);
 assert.doesNotMatch(researchCfg,/SCOUT_V4.*script_name|script_name.*eth-15-scout-cloud-v4test/);
});
test('MAIN and research have distinct journal routing and no shared SQL namespaces',()=>{
 assert.match(main,/env\.SCOUT_V4\.getByName\('v4-single-paper-scout'\)/);
 assert.match(controls,/env\.SCOUT_CONTROLS\.getByName\('v4-seven-controls'\)/);
 assert.match(controls,/researchWorkerRole:'CONTROLS_ONLY'/);
 assert.match(controls,/conservativeControlJournal:this\.controlSnapshot\(true\)/);
 assert.ok(!main.includes('researchWorkerRole'));
 assert.doesNotMatch(mainCfg,/SCOUT_CONTROLS|V4_RESEARCH_CONTROLS_ENABLED/);
});

test('owner cutover MUST refuse stale Worker2 data and require explicit protected MAIN Cloudflare version',()=>{
 const runner=read('cloud/scripts/deploy-v4-two-workers.ps1');
 assert.match(runner,/healthyTicks\.Count -ge 3/);
 assert.match(runner,/lastResearchTickAt/);
 assert.match(runner,/\(\$utcNow-\$researchAt\) -le 45000/);
 assert.match(runner,/officialIndexLastAgeMs -le 15000/);
 assert.match(runner,/Get-MainActiveVersion/);
 assert.match(runner,/wrangler deployments status --name eth-15-scout-cloud-v4test --json/);
 assert.match(runner,/\.percentage -eq 100/);
 assert.match(runner,/rollback.*\$previousMainVersion/);
 assert.match(runner,/Read-Host 'Enter the exact EXISTING MAIN Cloudflare version ID/);
 assert.match(runner,/Read-Host 'After reviewing MAIN dashboard and exporting MAIN evidence, type DEPLOY MAIN OPPORTUNISTIC'/);
 assert.match(runner,/if\(\(Get-MainActiveVersion\) -ne \$previousMainVersion\)/);
 assert.match(runner,/Worker2 became unhealthy; MAIN deployment blocked/);
 const target='wrangler deploy --config wrangler.v4paper.toml';
 const actualMainDeploys=[...runner.matchAll(/wrangler deploy --config wrangler\\.v4paper\\.toml(?=\\r?\\n)/g)];
 assert.equal(actualMainDeploys.length,1,'exactly one LIVE MAIN deploy (excluding dry-run)');
 assert.ok(runner.indexOf('DEPLOY MAIN OPPORTUNISTIC')<runner.indexOf(target));
 assert.ok(runner.indexOf('Get-MainActiveVersion')<runner.indexOf(target));
 assert.ok(runner.indexOf('healthyTicks.Count -ge 3')<runner.indexOf(target));
});
