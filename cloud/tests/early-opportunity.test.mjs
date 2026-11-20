import test from 'node:test';
import assert from 'node:assert/strict';
import {EARLY_POLICY,signalFamilies,settlementRewardQuality,
  earlyCountertrendGate,opportunityScore} from '../src/early-opportunity.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';
import {structureFixture} from './fixtures.mjs';

const strong={last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
 rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2};
const slow={e21:1790,e50:1780,macd:2,signal:1,rsi:60};
function market(minutes=10,price=.60){
 return {ticker:'KXETH15M-EARLY-TEST',status:'active',
  close_time:new Date(Date.now()+minutes*60000).toISOString(),
  floor_strike:'1795',yes_ask_dollars:String(price),
  yes_bid_dollars:String(Number((price-.01).toFixed(3))),
  no_ask_dollars:String(Number((1-price+.01).toFixed(3))),
  no_bid_dollars:String(Number((1-price).toFixed(3))),
  yes_ask_size_fp:'50',yes_bid_size_fp:'50'};
}
const countertrend=()=>{const data=structureFixture();
 return {...data,five:{...data.five,trend:'DOWN'}}};
test('indicator families de-duplicate echoing price/EMA/three-candle evidence',()=>{
 const rows=[
  {name:'1m price vs EMA8',ok:true},{name:'1m EMA8 vs EMA21',ok:true},
  {name:'1m 3-candle move',ok:true},{name:'1m RSI9 direction',ok:false},
  {name:'1m RSI9 side of 50',ok:false},
  {name:'1m MACD vs signal',ok:false},
  {name:'1m MACD acceleration',ok:false}
 ];
 const groups=signalFamilies(rows);
 assert.equal(groups.breadth,1);
 assert.equal(groups.price,true);
 assert.equal(groups.momentum,false);
 assert.equal(groups.acceleration,false);
 rows[3].ok=true;assert.equal(signalFamilies(rows).breadth,2);
 rows[5].ok=true;assert.equal(signalFamilies(rows).breadth,3);
 assert.equal(signalFamilies(null).breadth,0);
});
test('paper market can take a guarded affordable reversal BEFORE five-minute trend flips',()=>{
 const s=freshPaperState();s.armed=true;
 makeV2Engine(s).step(market(10,.60),strong,slow,true,countertrend());
 assert.ok(s.open,'guarded early setup should qualify before 5m trend catches up');
 assert.equal(s.open.strategy,'EARLY-REVERSAL');
 assert.ok(s.open.cost<=1.50,'reduced early exploratory stake INCLUDING fee');
 assert.equal(s.trades.length,0);
 assert.equal(s.open.signalFamilies,3);
 assert.ok(s.open.maximumSettlementRewardPerContract>.08);
 assert.ok(s.events.some(e=>e.type==='PAPER BUY'&&/EARLY-REVERSAL/.test(e.msg)));
});
test('no early exception outside 7-12.5m, outside affordable price, or thin liquidity',()=>{
 for(const minutes of [6.9,13]){
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(market(minutes,.60),strong,slow,true,countertrend());
  assert.equal(s.open,null,'time rejected: '+minutes);
 }
 const overpriced=freshPaperState();overpriced.armed=true;
 makeV2Engine(overpriced).step(market(10,.72),strong,slow,true,countertrend());
 assert.equal(overpriced.open,null);
 const thin=freshPaperState();thin.armed=true;const m=market(10,.60);
 m.yes_bid_size_fp='1';m.yes_ask_size_fp='1';
 makeV2Engine(thin).step(m,strong,slow,true,countertrend());
 assert.equal(thin.open,null);
});
test('early exception never ignores opposing 3m trend or confirmed 5m resistance',()=>{
 const blocked=freshPaperState();blocked.armed=true;
 const c=countertrend();c.three={...c.three,trend:'DOWN'};
 makeV2Engine(blocked).step(market(10,.60),strong,slow,true,c);
 assert.equal(blocked.open,null);
 const barrier=freshPaperState();barrier.armed=true;
 const d=countertrend();d.five={...d.five,
  resistance:{center:1796,lower:1795.5,upper:1796.5,touches:3}};
 makeV2Engine(barrier).step(market(10,.60),strong,slow,true,d);
 assert.equal(barrier.open,null);
});
test('early exception is ineligible after soft daily-risk threshold',()=>{
 const s=freshPaperState();s.armed=true;
 s.trades=[{ticker:'LOSS-12',exitAt:Date.now(),pnl:-12,confirmed:true}];
 makeV2Engine(s).step(market(10,.60),strong,slow,true,countertrend());
 assert.equal(s.open,null);
 assert.equal(s.dailyRisk.mode,'SOFT');
});
test('fee-aware settlement reward prevents chasing tiny theoretical upside',()=>{
 const good=settlementRewardQuality({price:.80,entryFeePerContract:.02,remaining:4});
 assert.equal(good.ok,true);assert.equal(good.breakEvenProbability,.82);
 assert.ok(good.reward>.15);
 const bad=settlementRewardQuality({price:.94,entryFeePerContract:.01,remaining:3});
 assert.equal(bad.ok,false);
 const impossible=settlementRewardQuality({price:NaN,entryFeePerContract:.01,remaining:3});
 assert.equal(impossible.ok,false);
});
test('ranking prefers diversified affordable early entry to identical late overpriced evidence',()=>{
 const families={price:true,momentum:true,acceleration:true,breadth:3};
 const cheap=settlementRewardQuality({price:.58,entryFeePerContract:.02,remaining:10});
 const costly=settlementRewardQuality({price:.84,entryFeePerContract:.01,remaining:4});
 const common={passed:6,families,turned:true,spread:.02,
   strikeDirectionFavorable:true,strategy:'REVERSAL'};
 assert.ok(opportunityScore({...common,quality:cheap,remaining:10,price:.58})>
  opportunityScore({...common,quality:costly,remaining:4,price:.84}));
});
test('five-minute trend exception is narrowly guarded by evidence families',()=>{
 const acceptable={side:'UP',price:.60,remaining:10,spread:.02,fastChecks:5,
  turned:true,families:{breadth:3},threeTrend:'UP',fiveTrend:'DOWN',
  strikePlausible:true,directionReachable:true,sufficientDepth:true};
 assert.equal(earlyCountertrendGate(acceptable).ok,true);
 for(const change of [{families:{breadth:1}},{fastChecks:4},{remaining:5},
  {macroAgainst:true},{secondaryCaution:true},{sufficientDepth:false},
  {threeTrend:'DOWN'},{price:.80},{spread:.04}]){
  assert.equal(earlyCountertrendGate({...acceptable,...change}).ok,false,
   'failure to reject '+JSON.stringify(change));
 }
});
