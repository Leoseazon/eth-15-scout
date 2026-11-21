import test from 'node:test';
import assert from 'node:assert/strict';
import {restBookUrl,parseOfficialRestBook,fetchOfficialRestBook,
 ensureRestBookArchive,appendRestBookSample,restBookPage,latestRestBookStatus}
 from '../src/kalshi-rest-orderbook.js';

const ticker='KXETH15M-26NOV210815-15';
const now=1795248900000;
const book={orderbook_fp:{
 yes_dollars:[['0.3200','10.00'],['0.4200','13.00']],
 no_dollars:[['0.3500','20.00'],['0.5600','17.00']]
}};
const context={ticker,requestedAt:now,receivedAt:now+74};

test('fixed-point REST bids imply exactly matched complementary asks; no exchange time fabricated',()=>{
 const item=parseOfficialRestBook(book,context);
 assert.equal(item.source,'KALSHI_OFFICIAL_REST_ORDERBOOK');
 assert.equal(item.yesBid.price,.42);
 assert.equal(item.noBid.price,.56);
 assert.equal(item.yesAsk.price,.44);
 assert.equal(item.noAsk.price,.58);
 assert.equal(item.yesAsk.sizeFp,'17.00');
 assert.equal(item.noAsk.sizeFp,'13.00');
 assert.equal(item.requestedAt,now);
 assert.equal(item.receivedAt,now+74);
 assert.equal(item.requestDurationMs,74);
 assert.equal(item.exchangeEventAt,null);
 assert.equal(item.sequence,null);
 assert.equal(item.eligibleAsFreshStreaming,false);
 assert.equal(item.executableFillVerified,false);
 assert.equal(item.verifiedExchangeAge,false);
 assert.deepEqual(item.yesLevels,[['0.3200','10.00'],['0.4200','13.00']]);
 assert.equal(item.empty,false);
 assert.equal(item.lockedOrCrossed,false);
});
test('REST ladder rejects duplicates, malformed floats, negative depth and overdepth',()=>{
 const bad=[
  [['0.4200','1.00'],['0.4200','2.00']],
  [['0.5600','1.00'],['0.4200','2.00']],
  [[0.42,'1.00']],
  [['0.42000','1.00']],
  [['0.0000','1.00']],
  [['0.4200','0.00']],
  [['0.4200','-1.00']],
  [['0.4200','1.999']],
  [['1.0000','3.00']]
 ];
 for(const yes_dollars of bad)
  assert.throws(()=>parseOfficialRestBook({orderbook_fp:{yes_dollars,no_dollars:[]}},context));
 assert.throws(()=>parseOfficialRestBook({orderbook_fp:{yes_dollars:[],no_dollars:[]}},
  {...context,receivedAt:now-1}));
 assert.throws(()=>parseOfficialRestBook({orderbook_fp:{}},context));
 assert.throws(()=>parseOfficialRestBook({orderbook_fp:{yes_dollars:[],no_dollars:[]}},
  {...context,ticker:'https://evil.example'}));
 assert.throws(()=>restBookUrl('KXBTC15M-26NOV210815-15'));
 assert.throws(()=>restBookUrl(ticker,101));
 assert.throws(()=>parseOfficialRestBook({orderbook_fp:{
  yes_dollars:Array.from({length:21},(_,i)=>['0.'+String(i+1).padStart(4,'0'),'1.00']),
  no_dollars:[]}},context));
});
test('empty or locked REST book is recorded but never treated as a tradable fresh WebSocket book',()=>{
 const empty=parseOfficialRestBook({orderbook_fp:{yes_dollars:[],no_dollars:[]}},context);
 assert.equal(empty.empty,true);
 assert.equal(empty.yesAsk,null);
 assert.equal(empty.eligibleAsFreshStreaming,false);
 const locked=parseOfficialRestBook({orderbook_fp:{
  yes_dollars:[['0.6000','10.00']],no_dollars:[['0.4100','10.00']] }},context);
 assert.equal(locked.lockedOrCrossed,true);
 assert.equal(locked.executableFillVerified,false);
});
test('direct Kalshi REST GET is bounded, unauthenticated and does not use V3 market proxy',async()=>{
 const calls=[];
 const result=await fetchOfficialRestBook(ticker,{
  clock:(()=>{let t=now;return ()=>t++})(),
  fetcher:async(url,options)=>{
   calls.push({url,options});
   return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify(book)};
  },makeSignal:ms=>({deadline:ms})});
 assert.equal(result.ok,true);
 assert.equal(result.book.yesAsk.price,.44);
 assert.equal(result.book.exchangeEventAt,null);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://external-api.kalshi.com/trade-api/v2/markets/'+ticker+'/orderbook?depth=20');
 assert.equal(calls[0].options.method,'GET');
 assert.deepEqual(calls[0].options.headers,{Accept:'application/json'});
 assert.equal(calls[0].options.headers['KALSHI-ACCESS-KEY'],undefined);
 assert.equal(calls[0].options.signal.deadline,3500);
 assert.equal(calls[0].options.redirect,'manual');
});
test('HTTP 401, 429, network and invalid JSON become safe reasons with no fake book',async()=>{
 for(const status of [401,403,429,500]){
  const r=await fetchOfficialRestBook(ticker,{
   fetcher:async()=>({status,body:{cancel:async()=>{}}})});
  assert.deepEqual(r.ok,false);
  assert.equal(r.reason,'REST_BOOK_HTTP_'+status);
  assert.equal(r.book,undefined);
 }
 const fail=await fetchOfficialRestBook(ticker,{
  fetcher:async()=>{throw Error('TLS certificate PRIVATE KEY') }});
 assert.equal(fail.reason,'NETWORK_TLS_FAILED');
 assert.doesNotMatch(fail.reason,/PRIVATE KEY/);
 const invalid=await fetchOfficialRestBook(ticker,{
  fetcher:async()=>({status:200,headers:{get:()=>null},text:async()=>'{broken'})});
 assert.equal(invalid.reason,'REST_BOOK_INVALID_RESPONSE');
 const oversized=await fetchOfficialRestBook(ticker,{
  fetcher:async()=>({status:200,headers:{get:()=>99999999},
   text:async()=>{throw Error('must not read oversized body')}})});
 assert.equal(oversized.reason,'REST_BOOK_INVALID_RESPONSE');
});
test('REST archive is append-only, source restricted and independent from WebSocket table',()=>{
 const calls=[],sql={exec:(q,...args)=>{calls.push([q,...args]);return {toArray:()=>[]}}};
 ensureRestBookArchive(sql);
 const item=parseOfficialRestBook(book,context);
 appendRestBookSample(sql,item);
 const put=calls.find(a=>a[0].includes('INSERT INTO v4_rest_book_samples'));
 assert.ok(put);
 assert.match(put[0],/v4_rest_book_samples/);
 assert.doesNotMatch(put[0],/v4_stream_samples|trades|positions/);
 assert.equal(JSON.parse(put.at(-1)).source,'KALSHI_OFFICIAL_REST_ORDERBOOK');
 assert.throws(()=>appendRestBookSample(sql,{...item,source:'KALSHI_WEBSOCKET_ORDERBOOK'}));
 assert.throws(()=>appendRestBookSample(sql,{...item,eligibleAsFreshStreaming:true}));
});
test('REST book cursor pages are stable under new records and no user SQL injection',()=>{
 const calls=[],sql={exec:(q,...args)=>{
  calls.push([q,...args]);
  if(q.includes('MAX(id)'))return {toArray:()=>[{n:1000}]};
  if(q.includes('count(*)'))return {toArray:()=>[{n:951}]};
  if(q.includes('SELECT id,payload'))return {toArray:()=>[
   {id:900,payload:JSON.stringify(parseOfficialRestBook(book,context))}
  ]};
  throw Error('Unexpected query '+q);
 }};
 const result=restBookPage(sql,{ticker,anchor:1000,before:901,limit:1});
 assert.equal(result.readOnly,true);
 assert.equal(result.total,951);
 assert.equal(result.nextBefore,900);
 assert.equal(result.source,'KALSHI_OFFICIAL_REST_ORDERBOOK');
 assert.equal(result.isWebSocket,false);
 assert.deepEqual(calls[0].slice(1),[ticker,1000,901,1]);
 assert.throws(()=>restBookPage(sql,{ticker:'bad'}));
 assert.throws(()=>restBookPage(sql,{limit:1001}));
 const summary=latestRestBookStatus({
  exec:q=>q.includes('count(*)')?{toArray:()=>[{n:0}]}:{toArray:()=>[]}
 });
 assert.equal(summary.count,0);
 assert.equal(summary.last,null);
 assert.equal(summary.isWebSocket,false);
});
