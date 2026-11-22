import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {parseCFValueFrame,parsePublicTradeFrame,ensureIndependentResearch,
 appendCFValue,appendPublicTrade,independentResearchPage} from '../src/research-sources.js';
import {KalshiResearchSocket} from '../src/research-socket.js';

const T=1770000000000;
const ticker='KXETH15M-26NOV221200-15';
const cf=(seq=1)=>({type:'cfbenchmarks_value',sid:4,seq,sending_ts_ms:T+200,
 msg:{index_id:'ETHUSD_RTI',received_at:T+100,
  data:JSON.stringify({type:'value',id:'ETHUSD_RTI',time:T,value:'1876.12345678'}),
  avg_60s_data:{value:'1876.12345678',window_size:5,
   window_start_ts_ms:T-60000,window_end_ts_exclusive:T},
  last_60s_windowed_average_15min:{value:'1876.09876543',window_size:47,
   window_start_ts_ms:T-47000,window_end_ts_exclusive:T}}});
const trade=(seq=2)=>({type:'trade',sid:5,seq,sending_ts_ms:T+250,
 msg:{trade_id:'d91bc706-ee49-470d-82d8-11418bda6fed',
  market_ticker:ticker,yes_price_dollars:'0.4300',
  no_price_dollars:'0.5700',count_fp:'136.00',taker_side:'no',
  taker_book_side:'ask',taker_outcome_side:'no',is_block_trade:false,ts:T/1000,ts_ms:T}});
test('parses timestamped official ETH reference without substituting Kraken or inventing a settlement',()=>{
 const v=parseCFValueFrame(cf(),T+500);
 assert.equal(v.indexId,'ETHUSD_RTI');
 assert.equal(v.sourceAt,T);assert.equal(v.receivedAt,T+500);
 assert.equal(v.averageFinalMinute.sampleCount,47);
 assert.equal(v.averageTrailing60s.value,'1876.12345678');
 assert.equal(v.settlementVerified,false);assert.equal(v.fillVerified,false);
});
test('rejects wrong indexes, malformed upstream JSON, future source clocks and missing values',()=>{
 for(const mutation of [
  p=>{p.msg.index_id='BRTI'},
  p=>{p.msg.data='not json'},
  p=>{p.msg.data=JSON.stringify({type:'value',id:'ETHUSD_RTI',time:T,value:''})},
  p=>{p.msg.data=JSON.stringify({type:'value',id:'ETHUSD_RTI',time:T+10000,value:'1876'})},
  p=>{p.msg.last_60s_windowed_average_15min.window_size=-1}
 ]){
  const p=cf();mutation(p);assert.throws(()=>parseCFValueFrame(p,T+500));
 }
});
test('parses public trades with explicit taker and exchange clocks',()=>{
 const v=parsePublicTradeFrame(trade(),T+500,ticker);
 assert.equal(v.tradeId,trade().msg.trade_id);assert.equal(v.countFp,'136.00');
 assert.equal(v.takerSide,'no');assert.equal(v.fillVerified,false);
});
test('rejects wrong contract, bad trade timestamps and malformed price or amount',()=>{
 for(const mutation of [
  p=>{p.msg.market_ticker='BAD'},
  p=>{p.msg.ts_ms=T+20000},
  p=>{p.msg.count_fp='0'},
  p=>{p.msg.yes_price_dollars='-0.2'},
  p=>{p.msg.taker_side='both'}
 ]){
  const p=trade();mutation(p);assert.throws(()=>parsePublicTradeFrame(p,T+500,ticker));
 }
});
test('table writer uses append-only unique index/timestamp and trade ID',()=>{
 const statements=[],sql={exec:(statement,...params)=>{statements.push([statement,...params]);return {toArray:()=>[]}}};
 ensureIndependentResearch(sql);
 const x=parseCFValueFrame(cf(),T+500),y=parsePublicTradeFrame(trade(),T+500,ticker);
 appendCFValue(sql,x);appendPublicTrade(sql,y);
 assert.ok(statements.some(x=>x[0].includes('UNIQUE(index_id,source_at)')));
 assert.ok(statements.some(x=>x[0].includes('trade_id TEXT NOT NULL UNIQUE')));
 assert.ok(statements.some(x=>x[0].startsWith('INSERT OR IGNORE INTO v4_cf_values')));
 assert.ok(statements.some(x=>x[0].startsWith('INSERT OR IGNORE INTO v4_public_trades')));
 assert.doesNotMatch(JSON.stringify(statements),/PRIVATE KEY|KALSHI-ACCESS/);
});
test('rejects archive page cursor misuse',()=>{
 const sql={exec:()=>({toArray:()=>[{n:0}]})};
 assert.throws(()=>independentResearchPage(sql,{kind:'benchmark',limit:101}));
 assert.throws(()=>independentResearchPage(sql,{kind:'trades',ticker:'BAD'}));
});
class FakeSocket{
 constructor(){this.readyState=1;this.events={};this.sent=[];this.closed=false;}
 addEventListener(kind,cb){this.events[kind]=cb}
 accept(){this.accepted=true}
 close(){this.readyState=3;this.closed=true}
 send(data){this.sent.push(JSON.parse(data))}
}
test('isolated transport subscribes only to benchmark and public trade; indexlist verifies entitlement',async()=>{
 const ws=new FakeSocket(),seen=[],events=[];
 const {privateKey}=generateKeyPairSync('ed25519');
 const pem=privateKey.export({format:'pem',type:'pkcs8'}).toString();
 const socket=new KalshiResearchSocket({
  fetcher:async()=>({status:101,webSocket:ws}),onCF:v=>seen.push(v),
  onEvent:kind=>events.push(kind)});
 assert.equal(await socket.ensure(ticker,{keyId:'test-read-only',privatePem:pem},T),true);
 assert.deepEqual(ws.sent.slice(0,2).map(x=>x.params.channels),[['cfbenchmarks_value'],['trade']]);
 assert.deepEqual(ws.sent[0].params.index_ids,['ETHUSD_RTI']);
 assert.deepEqual(ws.sent[1].params.market_tickers,[ticker]);
 socket.handleMessage(JSON.stringify({type:'subscribed',id:1,msg:{sid:4,channel:'cfbenchmarks_value'}}),T+100,ws);
 assert.equal(ws.sent[2].params.action,'indexlist');
 socket.handleMessage(JSON.stringify({type:'cfbenchmarks_value_indexlist',sid:4,seq:1,
  msg:{index_ids:['ETHUSD_RTI']}}),T+150,ws);
 socket.handleMessage(JSON.stringify(cf(2)),T+500,ws);
 assert.equal(seen.length,1);assert.equal(socket.indexAvailable,'AVAILABLE');
 assert.equal(socket.status().connected,true);
 socket.stop();assert.equal(socket.status().connected,false);
 assert.equal(ws.closed,true);
 assert.ok(!events.includes('CF_PARSE_ERROR'));
});
test('supplementary research failures never trigger order execution',async()=>{
 const ws=new FakeSocket(),events=[];
 const {privateKey}=generateKeyPairSync('ed25519');
 const socket=new KalshiResearchSocket({
  fetcher:async()=>({status:101,webSocket:ws}),
  onCF:()=>{throw Error('storage write blocked')},
  onEvent:kind=>events.push(kind)});
 await socket.ensure(ticker,{keyId:'test-read-only',
  privatePem:privateKey.export({format:'pem',type:'pkcs8'}).toString()},T);
 socket.handleMessage(JSON.stringify({type:'subscribed',id:1,msg:{
  sid:4,channel:'cfbenchmarks_value'}}),T+100,ws);
 socket.handleMessage(JSON.stringify({type:'cfbenchmarks_value_indexlist',
  sid:4,seq:1,msg:{index_ids:['ETHUSD_RTI']}}),T+150,ws);
 socket.handleMessage(JSON.stringify(cf(2)),T+500,ws);
 assert.ok(events.includes('CF_WRITE_FAILED'));
 assert.equal(socket.status().connected,true);
});

test('documented msg.sid ACK is required before retaining a CF price',async()=>{
 const ws=new FakeSocket(),seen=[],events=[];
 const {privateKey}=generateKeyPairSync('ed25519');
 const sock=new KalshiResearchSocket({fetcher:async()=>({status:101,webSocket:ws}),
  onCF:v=>seen.push(v),onEvent:kind=>events.push(kind)});
 await sock.ensure(ticker,{keyId:'test-read-only',privatePem:privateKey.export({format:'pem',type:'pkcs8'}).toString()},T);
 // A raw frame before a valid acknowledgement must never reach the journal.
 sock.handleMessage(JSON.stringify(cf()),T+500,ws);
 assert.equal(seen.length,0);assert.ok(events.includes('CF_PARSE_ERROR'));
 sock.handleMessage(JSON.stringify({type:'subscribed',id:1,sid:4}),T+510,ws);
 assert.equal(sock.indexAvailable,'UNVERIFIED');assert.equal(ws.sent.length,2);
 sock.handleMessage(JSON.stringify({type:'subscribed',id:1,
  msg:{sid:4,channel:'cfbenchmarks_value'}}),T+520,ws);
 assert.equal(ws.sent.length,3);
 // A forged/unassociated indexlist cannot verify entitlement.
 sock.handleMessage(JSON.stringify({type:'cfbenchmarks_value_indexlist',sid:999,seq:1,
  msg:{index_ids:['ETHUSD_RTI']}}),T+530,ws);
 assert.equal(sock.indexAvailable,'UNVERIFIED');
 sock.handleMessage(JSON.stringify(cf(1)),T+540,ws);
 assert.equal(seen.length,0);
 sock.handleMessage(JSON.stringify({type:'cfbenchmarks_value_indexlist',sid:4,seq:1,
  msg:{index_ids:['ETHUSD_RTI']}}),T+550,ws);
 sock.handleMessage(JSON.stringify(cf(2)),T+570,ws);
 assert.equal(sock.indexAvailable,'AVAILABLE');assert.equal(seen.length,1);
 sock.stop();
});
test('research stream labels every contract rollover as a coverage interruption',async()=>{
 const ws1=new FakeSocket(),ws2=new FakeSocket(),events=[];
 const {privateKey}=generateKeyPairSync('ed25519');
 const sock=new KalshiResearchSocket({fetcher:async()=>({status:101,webSocket:
  ws1.closed?ws2:ws1}),onEvent:kind=>events.push(kind)});
 const credentials={keyId:'test-read-only',privatePem:privateKey.export({format:'pem',type:'pkcs8'}).toString()};
 await sock.ensure(ticker,credentials,T);
 const next='KXETH15M-26NOV221215-15';
 await sock.ensure(next,credentials,T+901000);
 assert.equal(sock.ticker,next);assert.equal(ws1.closed,true);
 assert.ok(events.includes('RESEARCH_STREAM_ROLLOVER'));
 sock.stop();
});
