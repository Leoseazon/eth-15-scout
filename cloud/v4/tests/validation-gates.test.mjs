import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOfficialHoldout,measureBookCoverage} from '../src/validation-gates.js';
const t=i=>'KXETH15M-26NOV21-'+String(i).padStart(5,'0');
const at=1795200000000;
const windows=Array.from({length:120},(_,i)=>({
 ticker:t(i),status:'OFFICIAL_RESULT',outcome:i%2?'DOWN':'UP',
 closeAt:at+i*900000}));
const forecasts=windows.map((w,i)=>({ticker:w.ticker,closeAt:w.closeAt,
 producedAt:w.closeAt-300000,
 pUp:i%2?.20:.80,marketUp:.50,
 modelVersion:'V4-CALIBRATION-DEMO',source:'V4_OUT_OF_SAMPLE_FORECAST'}));
test('without qualified predictions, validation refuses to report an edge',()=>{
 const r=evaluateOfficialHoldout({forecasts:[],windows});
 assert.equal(r.status,'INSUFFICIENT_EVIDENCE');
 assert.equal(r.edgeConfirmed,false);
 assert.equal(r.holdoutMetrics,null);
 assert.equal(r.eligibleMarketWindows,0);
});
test('one qualified prediction per official ETH15 market prevents duplicated outcomes',()=>{
 const repeated=[...forecasts,...forecasts.map(p=>({...p,
  producedAt:p.producedAt+10000}))];
 const r=evaluateOfficialHoldout({forecasts:repeated,windows});
 assert.equal(r.eligibleMarketWindows,120);
 assert.equal(r.trainingWindow.count,90);
 assert.equal(r.holdoutWindow.count,30);
 assert.equal(r.status,'HOLDOUT_METRICS_UNCALIBRATED_EDGE_NOT_ESTABLISHED');
 assert.equal(r.holdoutMetrics.count,30);
 assert.ok(Math.abs(r.holdoutMetrics.brier-.04)<1e-7);
 assert.equal(r.holdoutMetrics.marketBrier,.25);
 assert.equal(r.edgeConfirmed,false);
});
test('provisional, late, future, and invalid settlement sources cannot validate a model',()=>{
 const corrupted=[...forecasts.slice(0,20),{
  ...forecasts[22],producedAt:forecasts[22].closeAt+1000
 }];
 const provisional=windows.map(w=>({...w,status:'REPORTED'}));
 const r=evaluateOfficialHoldout({forecasts:corrupted,windows:provisional});
 assert.equal(r.status,'INSUFFICIENT_EVIDENCE');
 assert.equal(r.eligibleMarketWindows,0);
});
test('forecasts at the wrong horizon are not silently scored',()=>{
 const r=evaluateOfficialHoldout({forecasts:forecasts.map(f=>({
  ...f,producedAt:f.closeAt-80000})),windows});
 assert.equal(r.eligibleMarketWindows,0);
 assert.equal(r.edgeConfirmed,false);
});
test('stream coverage reveals gaps rather than replacing missing observations',()=>{
 const ticker=t(0),startAt=at,endAt=at+30000;
 const complete=Array.from({length:7},(_,i)=>({
  ticker,receivedAt:at+i*5000,fresh:true,valid:true}));
 const r=measureBookCoverage(complete,{ticker,startAt,endAt,maxGapMs:5000});
 assert.equal(r.gapsOverThreshold,0);
 assert.equal(r.reliable,true);
 assert.equal(r.approximateCoverageFraction,1);
 const missing=measureBookCoverage(complete.slice(0,2),{
  ticker,startAt,endAt,maxGapMs:5000});
 assert.equal(missing.reliable,false);
 assert.ok(missing.longestGapMs>=25000);
 assert.ok(missing.approximateCoverageFraction<1);
});
