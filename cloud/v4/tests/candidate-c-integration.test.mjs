import test from 'node:test';
import assert from 'node:assert/strict';
import {observeProspectiveShadow} from '../src/shadow-research-observer.js';
import {CANDIDATE_C_SPEC} from '../src/candidate-c-observer.js';
const at=Date.parse('2026-11-22T18:11:00Z');
const ticker='KXETH15M-26NOV221215-15';
const closed=sec=>Math.floor(at/(1000*sec))*sec-sec;
const make=()=>({
 market:{ticker,close_time:'2026-11-22T18:15:00Z'},
 report:{status:'WATCH',candidate:{consideredSideValues:[{
  side:'UP',status:'REJECT',
  reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',
  ask:.30,bid:.29,spread:.01,quantity:9,allIn:2.84,
  breakEven:2.84/9,centralScenario:.42,lowerScenario:.285,
  requiredEdge:.035
 }]}},
 index:{indexId:'ETHUSD_RTI',validValuesVerified:true,
  price:1800,sourceAt:at-1000},
 book:{ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
  fresh:true,valid:true,crossed:false,receivedAt:at-1000,
  yesAsk:{price:.30,sizeFp:12},yesBid:{price:.29,sizeFp:12},
  noAsk:{price:.72,sizeFp:12},noBid:{price:.69,sizeFp:12}},
 one:{sd:1},five:{rsi:50},
 context:{oneClosedAt:closed(60),
  three:{trend:'UP',closedAt:closed(180)},
  five:{trend:'UP',closedAt:closed(300)}},
 feedChecks:{kraken1m:{ok:true},kraken5m:{ok:true}},
 streamStatus:{connected:true,targetTicker:ticker},
 riskMode:'NORMAL',blocked:[],now:at
});
test('runtime-shape bridge emits A, B and C without granting execution',()=>{
 const input=make(),before=JSON.stringify(input);
 const r=observeProspectiveShadow(input);
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.readOnly,true);
 assert.equal(r.candidateC.version,CANDIDATE_C_SPEC);
 assert.equal(r.candidateC.status,'QUALIFYING_OBSERVATION');
 assert.equal(r.candidateC.proposed.allIn,.32);
 assert.equal(r.candidateC.confirmationStatus,'PENDING_NEXT_CONSECUTIVE_OBSERVATION');
 assert.equal(r.policies.A_STRESS_RELAXED.status,'SHADOW_RESEARCH_CANDIDATE');
 assert.equal(r.policies.B_EXECUTION_FILTERED.status,'SHADOW_RESEARCH_CANDIDATE');
 assert.equal(JSON.stringify(input),before);
});
test('neutral 3m trend rejects C without suppressing A/B research',()=>{
 const input=make();
 input.context.three.trend='NEUTRAL';
 const r=observeProspectiveShadow(input);
 assert.equal(r.candidateC.reason,'THREE_MIN_TREND_UNCONFIRMED');
 assert.equal(r.policies.A_STRESS_RELAXED.status,'SHADOW_RESEARCH_CANDIDATE');
 assert.equal(r.policies.B_EXECUTION_FILTERED.status,'SHADOW_RESEARCH_CANDIDATE');
});
test('disconnected WebSocket rejects all three, independent of apparent central value',()=>{
 const input=make();
 input.streamStatus.connected=false;
 const r=observeProspectiveShadow(input);
 assert.equal(r.candidateC.status,'NO_C_OBSERVATION');
 assert.equal(r.policies.A_STRESS_RELAXED.status,'NO_SHADOW_SIGNAL');
 assert.equal(r.policies.B_EXECUTION_FILTERED.status,'NO_SHADOW_SIGNAL');
});
test('no additional market calls or mutation occur in observer',()=>{
 const original=make();
 const r=observeProspectiveShadow(original);
 assert.equal(r.candidateC.executionAuthorized,false);
 assert.equal(r.candidateC.proposed.actualFillVerified,false);
 assert.ok(!('paperOrder' in r));
 assert.ok(!('paperCash' in r));
});
