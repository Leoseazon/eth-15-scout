import test from 'node:test';
import assert from 'node:assert/strict';
import {paperResults} from '../src/paper-ledger.js';
import {appendSettlementPrediction} from '../src/settlement-predictions.js';

test('V4 paper ledger keeps aggregate totals and separately reports both research cohorts',()=>{
 const queries=[];
 const sql={exec:(q,...args)=>{
  queries.push({q,args});
  if(q.startsWith('SELECT first_engine_tick_at'))return {toArray:()=>[]};
  if(q.startsWith('SELECT COUNT(*) completed')&&q.includes('FROM trades WHERE json_extract(data'))
   return {toArray:()=>[{completed:3,wins:2,losses:1,flats:0}]};
  if(q.includes('FROM trades WHERE json_extract(data')&&q.includes('strategyVersion'))
   return {toArray:()=>[{completed:3,wins:2,losses:1,netPnl:2.30}]};
  if(q.includes('conservativeCompleted')&&q.includes('exploratoryCompleted'))
   return {toArray:()=>[{conservativeCompleted:2,conservativeWins:1,
    conservativeLosses:1,conservativeNetPnl:1.80,exploratoryCompleted:1,
    exploratoryWins:1,exploratoryLosses:0,exploratoryNetPnl:.50}]};
  return {toArray:()=>[{}]};
 }};
 const result=paperResults(sql,'V4-CONTEXTUAL-VALUE-20261122');
 assert.equal(result.completed,3);
 assert.equal(result.contextualCohort.completed,3);
 assert.equal(result.researchCohorts.conservative.completed,2);
 assert.equal(result.researchCohorts.exploratory.completed,1);
 assert.equal(result.researchCohorts.exploratory.netPnl,.50);
 const split=queries.find(x=>x.q.includes('conservativeCompleted'));
 assert.ok(split,'a distinct SQL research-cohort aggregate is required');
 assert.match(split.q,/COALESCE\(json_extract\(data,'\$\.researchMode'\),'CONSERVATIVE'\)/);
 assert.match(split.q,/json_extract\(data,'\$\.confirmed'\)=1/);
 assert.match(split.q,/json_type\(data,'\$\.pnl'\) IN/);
});

test('paper forecast payload persists model cohort for separate official-outcome audit',()=>{
 const records=[];
 const sql={exec:(...args)=>{records.push(args);return {toArray:()=>[]}}};
 const pos={ticker:'KXETH15M-26NOV211800-00',side:'UP',
  time:1795320000000,target:1800,indexValue:1801,
  indexSourceAt:1795319999000,entry:.40,entryFee:.02,cost:.42,qty:1,
  strategyVersion:'V4-TARGET-CONTEXTUAL-VALUE-20261122',
  researchMode:'EXPLORATORY',researchCohort:'V4-EXPLORATORY-SAMPLE-20261122'};
 appendSettlementPrediction(sql,pos);
 const payload=JSON.parse(records[0].at(-1));
 assert.equal(payload.researchMode,'EXPLORATORY');
 assert.match(payload.researchCohort,/EXPLORATORY-SAMPLE/);
 assert.equal(payload.executionVerified,false);
 assert.equal(payload.calibratedProbability,null);
});
