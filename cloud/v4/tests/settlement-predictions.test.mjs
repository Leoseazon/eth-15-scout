import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureSettlementPredictions,appendSettlementPrediction,
 reconcileSettlementPredictions,settlementPredictionStats} from '../src/settlement-predictions.js';
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
const position={ticker,side:'UP',time:T,target:1800,indexValue:1804,
 indexSourceAt:T-1000,entry:.45,entryFee:.04,cost:2.74,qty:6,
 strategyVersion:'V4-SETTLEMENT-FIRST-CONTEXT-20261122'};
test('immutable paper market prediction records target, index source age and entry before P&L',()=>{
 const queries=[];
 const sql={exec:(q,...args)=>{
  queries.push({q,args});return {toArray:()=>[]};
 }};
 ensureSettlementPredictions(sql);
 appendSettlementPrediction(sql,position);
 assert.ok(queries.some(x=>x.q.includes('CREATE TABLE IF NOT EXISTS v4_settlement_predictions')));
 const ins=queries.find(x=>x.q.startsWith('INSERT INTO v4_settlement_predictions'));
 assert.ok(ins);assert.ok(ins.q.includes('target,index_value,index_source_at'));
 assert.equal(ins.args[0],ticker);
 assert.equal(ins.args[1],'UP');
 assert.equal(ins.args[4],1800);
 assert.equal(ins.args[5],1804);
 assert.equal(JSON.parse(ins.args.at(-1)).executionVerified,false);
 assert.ok(!JSON.stringify(queries).includes('KALSHI-ACCESS-SIGNATURE'));
});
test('no malformed, oversized, or missing-context prediction is archived',()=>{
 const sql={exec:()=>{throw Error('Should not reach SQL')}};
 for(const p of [
  {...position,ticker:'INVALID'}, {...position,side:'PASS'},
  {...position,target:null},{...position,indexValue:null},
  {...position,cost:3.01}, {...position,indexSourceAt:100},
  {...position,entry:1}
 ])assert.throws(()=>appendSettlementPrediction(sql,p));
});
test('official result matching is independent of early-sold paper P&L',()=>{
 const recorded=[];
 const sql={exec:(q,...args)=>{
  recorded.push({q,args});
  if(q.startsWith('SELECT p.ticker'))return {toArray:()=>[
   {ticker,predicted_side:'UP',outcome:'DOWN',status:'OFFICIAL_RESULT',observed_at:T+900000},
   {ticker:'KXETH15M-26NOV211815-15',predicted_side:'DOWN',outcome:'DOWN',
    status:'OFFICIAL_RESULT',observed_at:T+900000}]};
  return {toArray:()=>[]};
 }};
 assert.equal(reconcileSettlementPredictions(sql,T+1000000),2);
 const updates=recorded.filter(x=>x.q.startsWith('UPDATE v4_settlement_predictions'));
 assert.deepEqual(updates.map(x=>x.args[0]),[0,1]);
 assert.equal(updates[0].args[1],'DOWN');
});
test('direction hit rate counts ONLY finalized predictions, not P&L',()=>{
 const sql={exec:()=>({toArray:()=>[{
  totalPredictions:12,verified:10,correct:7,incorrect:3,upPredictions:5,downPredictions:7
 }]})};
 const result=settlementPredictionStats(sql);
 assert.equal(result.accuracyOnVerified,.7);
 assert.equal(result.source,'FINALIZED_KALSHI_RESULTS_ONLY');
 assert.equal(result.calibrated,false);
});
