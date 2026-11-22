import test from 'node:test';
import assert from 'node:assert/strict';
import {normalCDF,targetScenarioEnvelope,priceAwareOpportunity,
 bestContextualOpportunity} from '../src/context-opportunity.js';
const data={
 target:1800,indexValue:1804,remainingSeconds:450,
 one:{sd:1.2,last:1804,three:2,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25},
 five:{rsi:60,e21:1800,e50:1799},
 context:{three:{trend:'UP'},five:{trend:'UP'}}
};
const book=(yesAsk,yesBid=yesAsk-.02)=>{
 const nBid=+(1-yesAsk).toFixed(4),nAsk=+(1-yesBid).toFixed(4);
 return {yesAsk:{price:yesAsk,sizeFp:'20.00'},
  yesBid:{price:yesBid,sizeFp:'20.00'},
  noAsk:{price:nAsk,sizeFp:'20.00'},
  noBid:{price:nBid,sizeFp:'20.00'}};
};
test('normal tail is finite symmetric and monotonic',()=>{
 assert.ok(Math.abs(normalCDF(0)-.5)<1e-6);
 assert.ok(normalCDF(-3)<normalCDF(-1));
 assert.ok(normalCDF(-1)<normalCDF(0));
 assert.ok(normalCDF(1)>normalCDF(0));
 assert.ok(normalCDF(3)>normalCDF(1));
 assert.ok(Math.abs(normalCDF(2)+normalCDF(-2)-1)<1e-6);
 assert.equal(normalCDF(NaN),null);
});

test('official target and remaining clock drive scenario, with no invented calibrated probability',()=>{
 const x=targetScenarioEnvelope(data);
 assert.equal(x.status,'SCENARIOS_READY');
 assert.equal(x.calibrated,false);
 assert.equal(x.UP.central,1-x.DOWN.central);
 assert.ok(x.UP.lower<x.UP.central);
 assert.ok(x.UP.central<x.UP.upper);
 const stronger=targetScenarioEnvelope({...data,indexValue:1808,
  one:{...data.one,last:1808,e8:1805,e21:1802}});
 assert.ok(stronger.UP.lower>x.UP.lower);
 const crossed=targetScenarioEnvelope({...data,indexValue:1796,
  one:{...data.one,last:1796,e8:1798,e21:1801,rNow:35,
   mNow:-.8,sNow:-.1,three:-2},
  five:{rsi:40,e21:1800,e50:1802},
  context:{three:{trend:'DOWN'},five:{trend:'DOWN'}}});
 assert.ok(crossed.DOWN.central>x.DOWN.central);
 assert.equal(targetScenarioEnvelope({...data,target:null}).status,'SCENARIO_INPUT_UNAVAILABLE');
 assert.equal(targetScenarioEnvelope({...data,indexValue:1812}).status,'OFFICIAL_INDEX_KRAKEN_BASIS_UNSAFE');
});

test('cheap is not automatically good, expensive is not automatically safe',()=>{
 const scenario=targetScenarioEnvelope(data);
 const fair=priceAwareOpportunity({side:'UP',book:book(.45),scenario,
  remainingSeconds:450,budget:3});
 const expensive=priceAwareOpportunity({side:'UP',book:book(.87),scenario,
  remainingSeconds:450,budget:3});
 assert.equal(fair.status,'QUALIFIED');
 assert.equal(expensive.status,'REJECT');
 assert.ok(fair.conservativeEdge>0);
 const impossible=priceAwareOpportunity({side:'UP',book:book(.88),scenario,
  remainingSeconds:450,budget:3});
 assert.equal(impossible.reason,'PRICE_ABOVE_87C_HARD_BUY_LIMIT');
 const atTarget=targetScenarioEnvelope({...data,indexValue:1800,
  one:{...data.one,last:1800,e8:1800,e21:1800,rNow:50,mNow:0,sNow:0,three:0},
  five:{rsi:50,e21:1800,e50:1800},
  context:{three:{trend:'NEUTRAL'},five:{trend:'NEUTRAL'}}});
 const deceptivelyCheap=priceAwareOpportunity({side:'UP',book:book(.45),scenario:atTarget,
  remainingSeconds:450,budget:3});
 assert.equal(deceptivelyCheap.status,'REJECT');
});

test('score and risk cannot override cost, clock, liquidity or hard ceiling',()=>{
 const scenario=targetScenarioEnvelope(data);
 assert.equal(priceAwareOpportunity({side:'UP',book:book(.45),scenario,
  remainingSeconds:89,budget:3}).status,'REJECT');
 assert.equal(priceAwareOpportunity({side:'UP',book:book(.45),scenario,
  remainingSeconds:450,budget:.20}).status,'REJECT');
 assert.equal(priceAwareOpportunity({side:'UP',book:{
  ...book(.45),yesAsk:{price:.45,sizeFp:'0'}},scenario,
  remainingSeconds:450,budget:3}).status,'REJECT');
 assert.equal(priceAwareOpportunity({side:'UP',book:book(.45,.38),scenario,
  remainingSeconds:450,budget:3}).status,'REJECT');
});

test('evaluate BOTH sides, do not wait to buy at 85c',()=>{
 const choice=bestContextualOpportunity({...data,book:book(.45),budget:3});
 assert.equal(choice.status,'CANDIDATE');
 assert.equal(choice.selected.side,'UP');
 assert.equal(choice.selected.ask,.45);
 assert.equal(choice.selected.calibratedProbability,null);
 assert.ok(choice.selected.lowerScenarioNetProfit>0);
 const expensive=bestContextualOpportunity({...data,book:book(.87),budget:3});
 assert.equal(expensive.status,'WATCH');
});
