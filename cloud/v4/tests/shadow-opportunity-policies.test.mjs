import test from 'node:test';
import assert from 'node:assert/strict';
import {SHADOW_POLICIES,SHADOW_SPEC_VERSION,evaluateShadowPolicy,
 evaluateBothShadowPolicies} from '../src/shadow-opportunity-policies.js';
const witness={officialIndexFresh:true,authenticatedBookFresh:true,sameTickerBook:true,
 kraken1mClosed:true,kraken3mClosed:true,kraken5mClosed:true,
 baselineSpreadDepthAndFeeChecksPassed:true};
const side=(p={})=>({side:'UP',status:'REJECT',
 reason:'CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT',ask:.55,bid:.54,spread:.01,
 quantity:5,allIn:2.83,breakEven:.566,centralScenario:.70,lowerScenario:.51,
 requiredEdge:.035,...p});
const input=(overrides={})=>({ticker:'KXETH15M-26NOV221645-45',remainingSeconds:400,
 sourceWitness:witness,riskMode:'NORMAL',alreadyTraded:false,baselineStatus:'WATCH',
 consideredSideValues:[side()],...overrides});
const run=(policy='A_STRESS_RELAXED',overrides={})=>evaluateShadowPolicy({policy,...input(overrides)});
const none=r=>assert.equal(r.executionAuthorized,false);
test('version and fixed prereg configurations cannot be mutated',()=>{
 assert.equal(SHADOW_SPEC_VERSION,'V4-SHADOW-PREREG-20261122-v1');
 assert.ok(Object.isFrozen(SHADOW_POLICIES));assert.ok(Object.isFrozen(SHADOW_POLICIES.A_STRESS_RELAXED));
});
test('A returns research candidate but never an execution instruction',()=>{
 const r=run();assert.equal(r.status,'SHADOW_RESEARCH_CANDIDATE');none(r);
 assert.equal(r.calibratedProbability,null);assert.equal(r.proposed.side,'UP');
});
test('B more stringent central/spread/price criteria',()=>{
 const r=run('B_EXECUTION_FILTERED');assert.equal(r.status,'SHADOW_RESEARCH_CANDIDATE');none(r);
 assert.equal(run('B_EXECUTION_FILTERED',{consideredSideValues:[side({ask:.08,bid:.07,spread:.01,quantity:6,allIn:.50,breakEven:.0834,centralScenario:.24,lowerScenario:.06})]}).status,'NO_SHADOW_SIGNAL');
 assert.equal(run('B_EXECUTION_FILTERED',{consideredSideValues:[side({spread:.03})]}).status,'NO_SHADOW_SIGNAL');
});
test('missing source evidence cannot become a candidate',()=>{
 for(const field of Object.keys(witness)){
  const w={...witness,[field]:false};assert.equal(run('A_STRESS_RELAXED',{sourceWitness:w}).status,'NO_SHADOW_SIGNAL');
 }
 assert.equal(run('A_STRESS_RELAXED',{sourceWitness:{}}).reason,'REQUIRED_VERIFIED_SOURCE_MISSING');
});
test('invalid ticker and wrong risk states fail closed',()=>{
 for(const riskMode of ['SOFT','HARD','UNKNOWN'])assert.equal(run('A_STRESS_RELAXED',{riskMode}).status,'NO_SHADOW_SIGNAL');
 assert.equal(run('A_STRESS_RELAXED',{alreadyTraded:true}).status,'NO_SHADOW_SIGNAL');
 assert.equal(run('A_STRESS_RELAXED',{ticker:'KXBTC15M-26NOV221645-45'}).status,'NO_SHADOW_SIGNAL');
});
test('entry window opening minute, final 90 and B final 150 remain off',()=>{
 for(const remainingSeconds of [900,840.001,90,45])assert.equal(run('A_STRESS_RELAXED',{remainingSeconds}).status,'NO_SHADOW_SIGNAL');
 assert.equal(run('A_STRESS_RELAXED',{remainingSeconds:91}).status,'SHADOW_RESEARCH_CANDIDATE');
 assert.equal(run('B_EXECUTION_FILTERED',{remainingSeconds:150}).status,'NO_SHADOW_SIGNAL');
});
test('only a valid baseline conservative rejection is eligible',()=>{
 assert.equal(run('A_STRESS_RELAXED',{baselineStatus:'CANDIDATE'}).status,'NO_SHADOW_SIGNAL');
 assert.equal(run('A_STRESS_RELAXED',{consideredSideValues:[side({reason:'INVALID_OR_EMPTY_BOOK'})]}).status,'NO_SHADOW_SIGNAL');
});
test('all-in budget, cheap stake, price ceiling and numerical integrity stay intact',()=>{
 for(const x of [side({allIn:3.01}),side({ask:.88}),side({lowerScenario:1.1}),
   side({quantity:1.5}),side({centralScenario:NaN}),side({breakEven:1.2}),
   side({bid:.60}),side({ask:.15,allIn:1}),side({spread:.005}),
   side({breakEven:.52}),side({allIn:2.70})]){
  assert.equal(run('A_STRESS_RELAXED',{consideredSideValues:[x]}).status,'NO_SHADOW_SIGNAL');
 }
});
test('bounded stress and central hurdles reject inadequate edges',()=>{
 assert.equal(run('A_STRESS_RELAXED',{consideredSideValues:[side({centralScenario:.60})]}).status,'NO_SHADOW_SIGNAL');
 assert.equal(run('A_STRESS_RELAXED',{consideredSideValues:[side({lowerScenario:.45})]}).status,'NO_SHADOW_SIGNAL');
});
test('both policies use deterministic ranking and stay paper-only',()=>{
 const i=input({consideredSideValues:[side({side:'DOWN',centralScenario:.71}),side()]});
 const out=evaluateBothShadowPolicies(i);
 assert.equal(out.A_STRESS_RELAXED.proposed.side,'DOWN');
 for(const p of Object.values(out)){none(p);assert.ok(!('buy' in p));}
});
