import test from 'node:test';
import assert from 'node:assert/strict';
import {indicators} from '../src/v2.js';
import {analyzeStructure,aggregate3m} from '../src/structure.js';

const flatBars=(count,seconds)=>Array.from({length:count},(_,i)=>
  [1700000000+i*seconds,1800,1801,1799,1800,1800,8]);
test('flat 5m markets show neutral RSI, not spurious bullish 100',()=>{
 const data=indicators(flatBars(100,300));
 assert.equal(data.rsi,50);
 assert.equal(data.e21,1800);
 assert.equal(data.e50,1800);
 assert.equal(data.macd,0);
 assert.equal(data.signal,0);
});
test('flat completed 3m structure is neutral rather than manufactured bullish trend',()=>{
 const result=analyzeStructure(flatBars(45,180));
 assert.ok(result);
 assert.equal(result.rsi,50);
 assert.equal(result.trend,'NEUTRAL');
 assert.equal(result.bands.mid,1800);
});
test('3m construction uses complete UTC-aligned triplets, not partial bars',()=>{
 const base=1700000100; // intentionally unaligned, align below
 const start=Math.floor(base/180)*180;
 const one=Array.from({length:7},(_,i)=>
  [start+i*60,1800+i,1802+i,1799+i,1801+i,1801+i,10]);
 const result=aggregate3m(one);
 assert.equal(result.length,2);
 assert.equal(result[0][0],start);
 assert.equal(result[1][0],start+180);
});
