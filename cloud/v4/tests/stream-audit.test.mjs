import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureStreamAudit,appendStreamSample,appendStreamEvent,streamPage,latestStreamStatus} from '../src/stream-audit.js';
const t='KXETH15M-26NOV210015-15';
const at=1795200000000;
const quote={ticker:t,source:'KALSHI_WEBSOCKET_ORDERBOOK',
 sid:2,seq:13,clock:500,valid:true,fresh:true,receivedAt:at,
 exchangeEventAt:at-8,sendingAt:at-4,receiveAgeMs:0,
 eventAgeMs:8,sendAgeMs:4,
 yesBid:{price:.33,sizeFp:'5.00'},yesAsk:{price:.35,sizeFp:'2.00'},
 noBid:{price:.65,sizeFp:'2.00'},noAsk:{price:.67,sizeFp:'5.00'}};
test('stream sample preserves bid, ask, quantities, event/send/receipt timestamp provenance',()=>{
 const calls=[];const sql={exec:(...a)=>{calls.push(a);return {toArray:()=>[]}}};
 ensureStreamAudit(sql);
 const item=appendStreamSample(sql,{quote,at,kind:'snapshot'});
 assert.equal(item.schemaVersion,1);
 assert.equal(item.yesBid.sizeFp,'5.00');
 assert.equal(item.noAsk.price,.67);
 assert.equal(item.receivedAt,at);
 assert.equal(item.sendingAt,at-4);
 assert.equal(item.exchangeEventAt,at-8);
 assert.equal(item.seq,13);
 assert.equal(item.valid,true);
 const insert=calls.find(x=>x[0].includes('INSERT INTO v4_stream_samples'));
 assert.ok(insert);
 assert.equal(JSON.parse(insert.at(-1)).fresh,true);
});
test('source cannot be spoofed and no non-KXETH15M markets leak into archive',()=>{
 const sql={exec:()=>({toArray:()=>[]})};
 assert.throws(()=>appendStreamSample(sql,{quote:{...quote,ticker:'OTHER'},at}));
 assert.throws(()=>appendStreamSample(sql,{quote:{...quote,source:'REST'},at}));
 assert.throws(()=>appendStreamEvent(sql,{kind:'BAD TOKEN STRING',ticker:t,at}));
 assert.throws(()=>appendStreamEvent(sql,{kind:'STREAM_GAP',ticker:'BAD',at}));
 assert.throws(()=>streamPage(sql,{limit:1000}));
});
test('immutable high-water anchor and keyset-before cursors make long archives possible',()=>{
 const calls=[];
 const sql={exec:(q,...args)=>{
  calls.push({q,args});
  if(q.includes('MAX(id)'))return {toArray:()=>[{n:1005000}]};
  if(q.includes('count(*) n'))return {toArray:()=>[{n:1004999}]};
  if(q.includes('SELECT id,payload'))return {toArray:()=>[
   {id:1004995,payload:JSON.stringify({ticker:t,kind:'snapshot'})},
   {id:1004994,payload:JSON.stringify({ticker:t,kind:'delta'})}]};
  throw Error('Unexpected SQL '+q);
 }};
 const page=streamPage(sql,{ticker:t,anchor:1005000,before:1004996,limit:2});
 assert.equal(page.anchor,1005000);
 assert.equal(page.nextBefore,1004994);
 assert.equal(page.items.length,2);
 assert.equal(page.total,1004999);
 const sqlQuery=calls.find(x=>x.q.includes('SELECT id,payload'));
 assert.match(sqlQuery.q,/id<=\? AND id<\?/);
 assert.deepEqual(sqlQuery.args,[t,1005000,1004996,2]);
});
test('fault history is append-only, bounded, and has no credentials',()=>{
 const calls=[];const sql={exec:(...args)=>{calls.push(args);return {toArray:()=>[]}}};
 const event=appendStreamEvent(sql,{
  kind:'STREAM_FAULT',ticker:t,at,detail:'Disconnected'.repeat(100)});
 assert.equal(event.detail.length,120);
 assert.ok(calls[0][0].includes('INSERT INTO v4_stream_events'));
 const empty={
  exec:q=>{
   if(q.includes('SELECT id,payload'))return {toArray:()=>[]};
   if(q.includes('count(*)'))return {toArray:()=>[{n:0}]};
   return {toArray:()=>[]};
  }
 };
 assert.deepEqual(latestStreamStatus(empty),{count:0,latest:null,recentEvents:[]});
});
