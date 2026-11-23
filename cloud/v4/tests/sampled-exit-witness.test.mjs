import test from 'node:test';
import assert from 'node:assert/strict';
import {sampledExitWitness,buildResearchTick} from '../src/research-journal.js';
const at=Date.parse('2026-11-23T03:10:00Z');
const ticker='KXETH15M-26NOV222115-15';
const market={ticker,floor_strike:1750,close_time:'2026-11-23T03:15:00Z'};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
 valid:true,fresh:true,crossed:false,receivedAt:at-1000,
 yesBid:{price:.58,sizeFp:14},noBid:{price:.41,sizeFp:12},
 yesAsk:{price:.60,sizeFp:20},noAsk:{price:.43,sizeFp:17}};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,
 sourceAt:at-1500,price:1752};
const observation=(changes={})=>sampledExitWitness({market,book,index,
 observedAt:at,...changes});
test('record two bid prices only, NOT raw book frames or ask/depth ladders',()=>{
 const o=observation();
 assert.equal(o.bookState,'FRESH_SAME_TICK');
 assert.deepEqual(o.upBid,{price:.58,depth:14});
 assert.deepEqual(o.downBid,{price:.41,depth:12});
 assert.equal(o.indexState,'OFFICIAL_FRESH');
 assert.equal(o.indexPrice,1752);
 assert.equal(o.actualFillVerified,false);
 assert.equal(o.executionAuthorized,false);
 assert.equal(o.rawFrames,undefined);
 assert.equal(o.ask,undefined);
});
test('a 7s stale or crossed book has ZERO bid witness, not a sell',()=>{
 for(const bad of [
 {...book,receivedAt:at-7000},
 {...book,crossed:true},
 {...book,source:'KALSHI_REST'},
 {...book,ticker:'KXETH15M-WRONG'}]){
  const o=observation({book:bad});
  assert.equal(o.bookState,'NOT_VERIFIED');
  assert.equal(o.upBid,null);
  assert.equal(o.downBid,null);
 }
});
test('stale/invalid official index is not fabricated by Kraken spot',()=>{
 for(const bad of [
 {...index,sourceAt:at-18000},
 {...index,indexId:'KRAKEN_SPOT'},
 {...index,validValuesVerified:false}
 ]){
  const o=observation({index:bad});
  assert.equal(o.indexState,'NOT_VERIFIED');
  assert.equal(o.indexPrice,null);
 }
});
test('insufficient or corrupt displayed BID depth is null, no imagined size',()=>{
 const bad={...book,yesBid:{price:.58,sizeFp:-2}};
 assert.equal(observation({book:bad}).upBid,null);
 assert.deepEqual(observation({book:bad}).downBid,{price:.41,depth:12});
});
test('existing research record keeps original settlement decision provenance',()=>{
 const record=buildResearchTick({startedAt:at-100,finishedAt:at,
  market,bookSample:book,indexSample:index,spot:1751,one:{sd:1},
  five:{rsi:50},context:{three:{trend:'UP',closedAt:1795410480},
   five:{trend:'UP',closedAt:1795410300}},feedChecks:{},
  report:{status:'WATCH',notice:'Insufficient value'},shadowProbe:{
   mainCoherence:{entry:{status:'EVIDENCE_RECONCILED'}},
   prospectiveShadow:{revised:{status:'RESEARCH'}}}});
 assert.equal(record.sampledExitBook.bookState,'FRESH_SAME_TICK');
 assert.equal(record.decision.shadowProbe.mainCoherence.entry.status,
  'EVIDENCE_RECONCILED');
 assert.equal(record.paperOnly,true);
 assert.equal(record.shadowOnly,true);
 assert.equal(record.decision.exitFillVerified,false);
});
