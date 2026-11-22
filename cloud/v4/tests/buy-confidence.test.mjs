import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreBuyConfidence,scoreHeldConfidence,BUY_CONFIDENCE_VERSION} from '../src/buy-confidence.js';
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,sourceAt:T-1000,price:1804};
const one={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
 crossed:false,receivedAt:T-1000,
 yesBid:{price:.43,sizeFp:'20.00'},yesAsk:{price:.45,sizeFp:'20.00'},
 noBid:{price:.55,sizeFp:'20.00'},noAsk:{price:.57,sizeFp:'20.00'}};
const position={ticker,side:'UP',target:1800,closeTime:new Date(T+7*60000).toISOString()};
const args={position,index,one,five,context,book,now:T};
test('entry confidence is integer 0–100 with fixed transparent components, never advertised as win probability',()=>{
 const r=scoreBuyConfidence({side:'UP',score:.75,geometry:.8,momentum:.7,structure:.6,
   familySupport:3,contradictionReasons:[],spread:.02,indexAgeMs:1000,bookAgeMs:1000});
 assert.ok(Number.isInteger(r.value)&&r.value>=0&&r.value<=100);
 assert.equal(r.scaleMax,100);assert.equal(r.calibrated,false);
 assert.equal(r.winProbability,null);assert.equal(r.version,BUY_CONFIDENCE_VERSION);
 assert.equal(r.kind,'HEURISTIC_DECISION_CONFIDENCE_NOT_WIN_PROBABILITY');
 assert.deepEqual(Object.keys(r.components).sort(),[
 'targetAlignment','compositeEvidence','independentIndicatorStrength',
 'independentFamilyAgreement','orderbookSpreadQuality','feedFreshness',
 'contradictionPenaltyPoints'].sort());
});
test('strong aligned evidence ranks above weak contradictory evidence',()=>{
 const strong=scoreBuyConfidence({side:'UP',score:.7,geometry:.8,momentum:.6,structure:.7,
  familySupport:3,contradictionReasons:[],spread:.01,indexAgeMs:1000,bookAgeMs:1000});
 const weak=scoreBuyConfidence({side:'UP',score:-.4,geometry:-.5,momentum:-.2,structure:-.6,
  familySupport:0,contradictionReasons:['OFFICIAL_INDEX_OPPOSES_HELD_SIDE'],
  spread:.045,indexAgeMs:13000,bookAgeMs:4000});
 assert.ok(strong.value>weak.value,{strong,weak});
 assert.ok(weak.value>=0);
});
test('same UP contract live confidence rises and falls as evidence changes',()=>{
 const strong=scoreHeldConfidence(args);
 const bearish=scoreHeldConfidence({...args,now:T+15000,
   index:{...index,sourceAt:T+14000,price:1796},
   one:{...one,last:1796,e8:1798,e21:1801,rNow:35,mNow:-.8,sNow:-.1,three:-2},
   five:{rsi:40,e21:1800,e50:1802},
   context:{three:{trend:'DOWN'},five:{trend:'DOWN'}},
   book:{...book,receivedAt:T+14000}});
 const recovered=scoreHeldConfidence({...args,now:T+30000,
   index:{...index,sourceAt:T+29000,price:1804},
   book:{...book,receivedAt:T+29000}});
 assert.equal(strong.status,'CURRENT');
 assert.equal(bearish.status,'CURRENT');
 assert.equal(recovered.status,'CURRENT');
 assert.ok(strong.value>bearish.value,{strong:strong.value,bearish:bearish.value});
 assert.ok(recovered.value>bearish.value);
 assert.equal(bearish.side,'UP');
 assert.equal(bearish.modelImpliedSide,'DOWN');
 assert.equal(strong.calibrated,false);
});
test('stale, missing, mismatched or corrupted sources return UNKNOWN, not a misleading zero or old score',()=>{
 const cases=[
  {...args,index:null},
  {...args,index:{...index,sourceAt:T-30000}},
  {...args,book:{...book,receivedAt:T-10000}},
  {...args,book:{...book,ticker:'OTHER'}},
  {...args,book:{...book,source:'KALSHI_REST'}},
  {...args,one:{...one,sd:NaN}},
  {...args,position:{...position,closeTime:new Date(T-1).toISOString()}}
 ];
 for(const c of cases){
  const result=scoreHeldConfidence(c);
  assert.equal(result.status,'UNAVAILABLE',JSON.stringify(result));
  assert.equal(result.value,null);
  assert.equal(result.winProbability,null);
 }
});
test('same confidence score measures held direction, not newly selected opposite side',()=>{
 const r=scoreHeldConfidence({...args,position:{...position,side:'DOWN'}});
 assert.equal(r.status,'CURRENT');
 assert.equal(r.side,'DOWN');
 assert.ok(r.value<scoreHeldConfidence(args).value);
});
test('in final minute report limitations of lacking accumulating benchmark settlement average',()=>{
 const r=scoreHeldConfidence({...args,position:{...position,
  closeTime:new Date(T+45000).toISOString()}});
 assert.equal(r.status,'CURRENT');
 assert.match(r.caveat,/final|settlement accumulator/i);
});
