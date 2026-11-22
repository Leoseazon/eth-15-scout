import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildResearchTick,recordResearchTick,researchPage,ensureResearchJournal,
 recordBookSample} from '../src/research-journal.js';
import {quoteArchivePage} from '../src/quote-recorder.js';
const start=Date.parse('2026-11-21T04:00:00Z');
const ticker='KXETH15M-26NOV210015-15';
const market={ticker,close_time:new Date(start+900000).toISOString(),
 floor_strike:'1737.85',yes_bid_dollars:'0.33',yes_ask_dollars:'0.36',
 no_bid_dollars:'0.64',no_ask_dollars:'0.67'};
const feedChecks={kalshi:{ok:true,checkedAt:start},
 kraken1m:{ok:true,checkedAt:start},kraken5m:{ok:true,checkedAt:start},
 krakenTicker:{ok:true,checkedAt:start}};
const engine={cash:100,realized:0,open:null,pending:[],
 trades:[{ticker,side:'UP',exitAt:start+2000,entry:.50,
  exitPrice:.29,cost:2,qty:4,pnl:-.90,reason:'Stop loss (−40%)'}],
 events:[{time:start+1000,ticker,type:'PAPER SELL',msg:'Stop loss'}],
 lastStopAudit:{at:start+1500,ticker,side:'UP',entry:.50,bid:.29,
  qty:4,markPnl:-.90,usable:true,armed:true,triggered:true,
  thresholdHit:true,declinePct:42,wholeSecondsRemaining:300,
  cause:'FORTY_PERCENT_DRAWDOWN',version:'V4-STOP-RESEARCH',
  earlyExitEvidence:{consecutive:1,trigger:false,reason:'ONE_ADVERSE_CANDLE'}}};
const inputs={startedAt:start,finishedAt:start+3000,market,
 quoteObservedAt:start+900,quoteRetrievedAt:start-800,spot:1737.90,
 one:{last:1737.95,rNow:42},five:{e50:1738.50},
 context:{oneClosedAt:Math.floor(start/1000)-60,
  three:{trend:'DOWN'},five:{trend:'DOWN'}},
 feedChecks,feedIssues:[],report:{notice:'Shadow stop example'},
 engineState:engine};

test('complete V4 research tick captures V3 evidence and extra stop reasons without fabricating fills',()=>{
 const r=buildResearchTick(inputs);
 assert.equal(r.quote.receiptAt,start+900);
 assert.equal(r.quote.retrievedAt,start-800);
 assert.equal(r.quote.exchangeEventAt,null);
 assert.equal(r.dataStatus,'READY_FOR_HEURISTIC_EVALUATION');
 assert.equal(r.paperOnly,true);
 assert.equal(r.decision.calibratedProbability,null);
 assert.equal(r.decision.exitFillVerified,false);
 assert.equal(r.decision.stopAudit.triggered,true);
 assert.equal(r.decision.stopAudit.wholeSecondsRemaining,300);
 assert.equal(r.decision.stopAudit.earlyExitEvidence.consecutive,1);
 assert.equal(r.decision.exitAtThisTick.netPnl,-.90);
 assert.equal(r.decision.exitAtThisTick.officialSettlementVerified,false);
 assert.equal(r.kraken.five.e50,1738.50);
 assert.equal(r.kraken.oneClosedAt,(Math.floor(start/1000)-60)*1000);
 assert.equal(r.decision.observedEvents[0].type,'PAPER SELL');
});
test('missing feeds, missing quotes, and stale claimed prices remain explicitly unavailable',()=>{
 const r=buildResearchTick({...inputs,market:null,
  quoteObservedAt:null,one:null,five:null,feedChecks:{},engineState:null});
 assert.equal(r.dataStatus,'PARTIAL_OR_UNAVAILABLE');
 assert.equal(r.quote.yesBid,null);
 assert.equal(r.quote.receiptAt,null);
 assert.equal(r.kraken.one,null);
 assert.equal(r.decision.stopAudit,null);
 assert.equal(r.decision.exitAtThisTick,null);
 assert.throws(()=>buildResearchTick({...inputs,finishedAt:start-1}));
});
test('append-only engine writer inserts one complete versioned row',()=>{
 const calls=[];const sql={exec:(...a)=>{calls.push(a);return {toArray:()=>[]}}};
 ensureResearchJournal(sql);
 const r=recordResearchTick(sql,inputs);
 assert.equal(r.schemaVersion,2);
 assert.equal(r.kraken.oneClosedAt,(Math.floor(start/1000)-60)*1000);
 const query=calls.find(x=>x[0].startsWith('INSERT OR IGNORE INTO research_ticks'));
 assert.ok(query);
 assert.equal(query[1],start);
 const payload=JSON.parse(query.at(-1));
 assert.equal(payload.quote.source,'Kalshi REST proxy (potentially cached)');
 assert.equal(payload.decision.stopAudit.triggered,true);
});
test('stable highwater pagination does not fabricate missing historical observations',()=>{
 const queries=[];
 const sql={exec:(q,...args)=>{
  queries.push({q,args});
  if(q.includes('MAX(id)'))return {toArray:()=>[{top:20}]};
  if(q.includes('COUNT(*) n'))return {toArray:()=>[{n:18}]};
  if(q.includes('SELECT id,payload FROM research_ticks'))return {
   toArray:()=>[{id:10,payload:JSON.stringify(buildResearchTick(inputs))}]};
  if(q.includes('SELECT * FROM quote_observations'))return {toArray:()=>[]};
  throw Error('Unexpected query '+q);
 }};
 const page=researchPage(sql,{anchor:20,offset:0,limit:20});
 assert.equal(page.anchor,20);assert.equal(page.total,18);
 assert.equal(page.ticks[0].id,10);
 assert.throws(()=>researchPage(sql,{offset:-1}));
 assert.throws(()=>researchPage(sql,{limit:101}));
 const quote=quoteArchivePage(sql,{anchor:20,limit:10});
 assert.equal(quote.total,18);assert.equal(quote.quotes.length,0);
});
test('V4 stream book recorder keeps true event and receipt stamps distinct',()=>{
 const calls=[];const sql={exec:(...args)=>{calls.push(args)}};
 const item=recordBookSample(sql,{ticker,receivedAt:start+10,
  exchangeEventAt:start+5,sendingAt:start+8,seq:3,
  quote:{ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
   valid:true,fresh:true,reason:null,
   yesBid:{price:.30,sizeFp:'4.00'},yesAsk:{price:.32,sizeFp:'6.00'}}});
 assert.equal(item.exchangeEventAt,start+5);
 assert.equal(item.receivedAt,start+10);
 assert.equal(item.seq,3);
 assert.equal(item.valid,true);
 assert.equal(item.noBid,null);
 assert.equal(calls[0][0].includes('research_book_samples'),true);
 assert.throws(()=>recordBookSample(sql,{ticker:'BAD',receivedAt:start,quote:{}}));
});
test('private V4 gateway and UI expose research history without public controls',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const gateway=readFileSync(root+'cloud/v4/viewer-worker.js','utf8');
 const app=readFileSync(root+'v4/app.js','utf8');
 const html=readFileSync(root+'v4/index.html','utf8');
 assert.match(gateway,/\/api\/v4\/research/);
 assert.match(gateway,/\/api\/v4\/quote-archive/);
 assert.doesNotMatch(gateway,/stub\.fetch\(.+\/v1\/arm/);
 assert.match(html,/id="research-list"/);
 assert.match(html,/id="stop-audit-run"/);
 assert.match(html,/stop-postmortem\.js/);
 assert.match(app,/exportCompleteEvidence/);
 assert.match(app,/analyzeStopHistory/);
});
