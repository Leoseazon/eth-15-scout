import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {averageProgress} from '../src/settlement-math.js';
import {ensureQuoteTable,recordQuote,recentQuotes} from '../src/quote-recorder.js';

test('40 observed seconds implies correct required remaining average',()=>{
 const r=averageProgress({strike:1555.75,readings:Array(40).fill(1555.50)});
 assert.equal(r.observedCount,40);
 assert.equal(r.remainingCount,20);
 assert.equal(r.requiredRemainingAverage,1556.25);
 assert.equal(r.officialOutcomeVerified,false);
});

test('completed arithmetic is not a verified Kalshi settlement',()=>{
 const r=averageProgress({strike:1555,readings:Array(60).fill(1556)});
 assert.equal(r.completedAverage,1556);
 assert.equal(r.requiredRemainingAverage,null);
 assert.equal(r.officialOutcomeVerified,false);
});

test('invalid index observations and missing numerical inputs fail closed',()=>{
 assert.throws(()=>averageProgress({strike:1555,readings:[1555,NaN]}));
 assert.throws(()=>averageProgress({strike:1555,readings:Array(61).fill(1555)}));
 assert.throws(()=>averageProgress({strike:0,readings:[]}));
});

test('quote recorder does not invent unavailable prices',()=>{
 const calls=[];
 const sql={exec:(...a)=>{calls.push(a);return {toArray:()=>[]}}};
 ensureQuoteTable(sql);
 const ok=recordQuote(sql,{
  market:{ticker:'KXETH15M-26NOV212300-15',
   close_time:'2026-11-22T00:00:00Z',
   floor_strike:'1555.75',
   yes_bid_dollars:'0.37',no_ask_dollars:'0.63'},
  observedAt:1795300000000,proxyRetrievedAt:1795300000000,krakenSpot:1554
 });
 assert.equal(ok,true);
 const args=calls.at(-1);
 assert.equal(args.at(-4),0.37);
 assert.equal(args.at(-3),null);
 assert.equal(args.at(-1),0.63);
 assert.equal(recordQuote(sql,{market:{ticker:'BAD'},observedAt:1795300000000}),false);
});

test('quote reader rejects unbounded or untrusted queries',()=>{
 const sql={exec:(...a)=>({toArray:()=>[{a}]})};
 assert.equal(recentQuotes(sql,{ticker:'KXETH15M-26NOV212300-15',limit:17}).length,1);
 assert.throws(()=>recentQuotes(sql,{limit:601}));
 assert.throws(()=>recentQuotes(sql,{ticker:';DROP TABLE'}));
});

test('V4 hard-disarms paper entries and references only its own Durable Object',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const worker=readFileSync(root+'src/worker.js','utf8');
 const viewer=readFileSync(root+'viewer-worker.js','utf8');
 assert.match(worker,/class ScoutEngineV4 extends DurableObject/);
 assert.match(worker,/s\.armed=false/);
 assert.match(worker,/softGuardEnabled:true/);
 assert.match(worker,/SCOUT_V4\.getByName\('v4-single-paper-scout'\)/);
 assert.match(viewer,/SCOUT_V4\.getByName\('v4-single-paper-scout'\)/);
 assert.doesNotMatch(worker,/SCOUT\.getByName\('single-paper-scout'\)/);
 assert.doesNotMatch(worker,/portfolio\/orders/);
});