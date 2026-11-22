import test from 'node:test';
import assert from 'node:assert/strict';
import {countRecentDistinctBuys,shouldExploreForHourlySamples,
 EXPLORATORY_TARGET_PER_HOUR,EXPLORATORY_STAKE_CAP} from '../src/exploratory-policy.js';
import {evaluateSettlementFirst} from '../src/settlement-first.js';
import {settlementFirstPaperStep} from '../src/settlement-first-paper.js';
import {freshPaperState} from '../src/v2.js';
import {priceAwareOpportunity} from '../src/context-opportunity.js';

const T=1795320000000;
const ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,close_time:new Date(T+450000).toISOString()};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,sourceAt:T-1000,price:1800};
const one={sd:1.2,last:1800,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
 crossed:false,receivedAt:T-1000,
 yesBid:{price:.43,sizeFp:'20.00'},yesAsk:{price:.45,sizeFp:'20.00'},
 noBid:{price:.55,sizeFp:'20.00'},noAsk:{price:.57,sizeFp:'20.00'}};
const args={market,index,one,five,context,book,now:T,onPrediction:()=>{}};
const setup=()=>({...freshPaperState(),armed:true,monitoring:true,
 events:[],decisions:[],blocked:[],pending:[],trades:[]});

test('hourly target counts unique KXETH15M BUY tickers across completed, pending, open, not sells',()=>{
 const p=(ticker,time,strategy='V4_SETTLEMENT_FIRST')=>({ticker,time,strategy});
 const s=setup();
 s.trades=[p('KXETH15M-A',T-20000),p('KXETH15M-A',T-18000),
  p('KXETH15M-OLDER',T-3600001),p('KXETH15M-OTHER-STRATEGY',T-15000,'V3')];
 s.pending=[p('KXETH15M-B',T-50000)];
 s.open=p('KXETH15M-C',T-10000);
 assert.equal(countRecentDistinctBuys(s,T),3);
 assert.equal(shouldExploreForHourlySamples(s,T,{enabled:true,riskMode:'NORMAL'}),false);
 s.open=null;s.pending=[];
 assert.equal(countRecentDistinctBuys(s,T),1);
 assert.equal(shouldExploreForHourlySamples(s,T,{enabled:true,riskMode:'NORMAL'}),true);
 assert.equal(shouldExploreForHourlySamples(s,T,{enabled:false,riskMode:'NORMAL'}),false);
 assert.equal(shouldExploreForHourlySamples(s,T,{enabled:true,riskMode:'SOFT'}),false);
 assert.equal(EXPLORATORY_TARGET_PER_HOUR,2);
 assert.equal(EXPLORATORY_STAKE_CAP,1);
});

test('default conservative candidate decisions are identical when exploration disabled',()=>{
 const s=setup(),before=settlementFirstPaperStep(s,args);
 assert.equal(before.status,'WATCH');
 assert.equal(s.open,null);assert.equal(s.cash,100);
 assert.equal(evaluateSettlementFirst(args).status,'WATCH');
 const normal=setup(),again=settlementFirstPaperStep(normal,{...args,explorationEnabled:false});
 assert.equal(again.status,before.status);
 assert.equal(again.notice,before.notice);
 assert.equal(normal.cash,100);
});

test('central model may offer a SMALL separate research sample after conservative strategy passes',()=>{
 const normal=evaluateSettlementFirst({...args,budget:3});
 const exploratory=evaluateSettlementFirst({...args,budget:1,allowExploration:true});
 assert.equal(normal.status,'WATCH',JSON.stringify(normal));
 assert.equal(exploratory.status,'CANDIDATE',JSON.stringify(exploratory));
 assert.equal(exploratory.researchMode,'EXPLORATORY');
 assert.equal(exploratory.contextualOpportunity.conservativeValuePassed,false);
 assert.ok(exploratory.contextualOpportunity.centralScenarioNetProfit>0);
 assert.ok(exploratory.contextualOpportunity.conservativeEdge<.035);
 const s=setup(),results=[];
 const e=settlementFirstPaperStep(s,{...args,explorationEnabled:true,onPrediction:p=>results.push(p)});
 assert.equal(e.status,'PAPER_BUY',e.notice);
 assert.equal(results.length,1);
 assert.equal(s.open.researchMode,'EXPLORATORY');
 assert.match(s.open.researchCohort,/EXPLORATORY/);
 assert.ok(s.open.cost<=1,'exploratory total including fees must stay <=1 USD');
 assert.ok(s.events[0].msg.includes('NOT A CONSERVATIVE BUY SIGNAL'));
 assert.equal(s.blocked.length,1);
 assert.equal(s.window.entered,true);
});

test('conservative entry always has first priority, full normal stake cap and tag',()=>{
 const s=setup(),strong={...args,index:{...index,price:1804},
 one:{...one,last:1804}};
 const r=settlementFirstPaperStep(s,{...strong,explorationEnabled:true});
 assert.equal(r.status,'PAPER_BUY',r.notice);
 assert.equal(s.open.researchMode,'CONSERVATIVE');
 assert.ok(s.open.cost<=3);
 assert.ok(s.open.cost>1,'original strategy retains its full three-dollar paper budget');
});

test('two already bought distinct markets suppress exploratory fallback, without changing normal entries',()=>{
 const s=setup();
 s.trades=[
  {ticker:'KXETH15M-PRIOR-A',time:T-400000,strategy:'V4_SETTLEMENT_FIRST',pnl:-.1,exitAt:T-10000},
  {ticker:'KXETH15M-PRIOR-B',time:T-300000,strategy:'V4_SETTLEMENT_FIRST',pnl:-.1,exitAt:T-10000}
 ];
 const r=settlementFirstPaperStep(s,{...args,explorationEnabled:true});
 assert.equal(r.status,'WATCH');assert.equal(s.open,null);
});

test('exploratory path never bypasses stale official index, bad book, excessive ask, or missing forecast atomicity',()=>{
 for(const override of [{index:null},{index:{...index,sourceAt:T-20000}},
  {book:{...book,source:'KALSHI_REST'}},
  {book:{...book,receivedAt:T-12000}},
  {book:{...book,yesBid:{price:.43,sizeFp:'0.00'}}},
  {book:{...book,yesAsk:{price:.88,sizeFp:'20.00'}}}]){
  const s=setup(),r=settlementFirstPaperStep(s,{...args,...override,explorationEnabled:true});
  assert.equal(r.status,'WATCH',JSON.stringify(override)+' '+r.notice);
  assert.equal(s.open,null);assert.equal(s.cash,100);
 }
 const s=setup(),r=settlementFirstPaperStep(s,{...args,
 explorationEnabled:true,onPrediction:()=>{throw Error('no persistence')}});
 assert.equal(r.status,'WATCH');
 assert.equal(s.open,null);assert.equal(s.cash,100);
});

test('SOFT/HARD daily risk and disarm prevent any exploratory candidate',()=>{
 for(const kind of ['SOFT','HARD']){
  const s=setup(),key=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',
   year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(T));
  s.dailyRisk={day:key,mode:kind};
  const r=settlementFirstPaperStep(s,{...args,explorationEnabled:true});
  assert.equal(r.status,'WATCH',kind);
  assert.equal(s.open,null);assert.equal(s.cash,100);
 }
 const disarmed=setup();disarmed.armed=false;
 assert.equal(settlementFirstPaperStep(disarmed,{...args,explorationEnabled:true}).status,'DISABLED');
});

test('new sample cannot cause second BUY in same market, and original 96c/stop exits remain',()=>{
 const s=setup();
 const buy=settlementFirstPaperStep(s,{...args,explorationEnabled:true});
 assert.equal(buy.status,'PAPER_BUY');
 const hold=settlementFirstPaperStep(s,{...args,explorationEnabled:true,
 now:T+150000,book:{...book,receivedAt:T+149000}});
 assert.equal(hold.status,'HOLD');
 const sold=settlementFirstPaperStep(s,{...args,explorationEnabled:true,
 now:T+151000,book:{...book,receivedAt:T+150000,yesBid:{price:.96,sizeFp:'20.00'}}});
 assert.equal(sold.status,'PAPER_SELL');
 const again=settlementFirstPaperStep(s,{...args,explorationEnabled:true,
 now:T+151100,book:{...book,receivedAt:T+150800}});
 assert.equal(again.status,'WATCH');
 assert.equal(s.blocked.length,1);
 assert.equal(s.trades[0].researchMode,'EXPLORATORY');
});

test('pure quote evaluator fails conservative but accepts exploratory only with positive UNCALIBRATED central margin',()=>{
 const scenario={status:'SCENARIOS_READY',
 UP:{lower:.28,central:.55,upper:.80},DOWN:{lower:.20,central:.45,upper:.72}};
 const conservative=priceAwareOpportunity({side:'UP',book,scenario,
 remainingSeconds:450,budget:1});
 assert.equal(conservative.status,'REJECT');
 const exploratory=priceAwareOpportunity({side:'UP',book,scenario,
 remainingSeconds:450,budget:1,mode:'EXPLORATORY'});
 assert.equal(exploratory.status,'QUALIFIED',JSON.stringify(exploratory));
 assert.equal(exploratory.conservativeValuePassed,false);
 assert.equal(exploratory.calibratedProbability,null);
 const expensive=priceAwareOpportunity({side:'UP',
 book:{...book,yesAsk:{price:.86,sizeFp:'20.00'},
 yesBid:{price:.84,sizeFp:'20.00'}},scenario,
 remainingSeconds:450,budget:1,mode:'EXPLORATORY'});
 assert.equal(expensive.status,'REJECT');
});
