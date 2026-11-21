import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants,webcrypto} from 'node:crypto';
import {wsAuthHeaders,KalshiReadOnlySocket,KALSHI_WS_URL,KALSHI_SIGN_PATH} from '../src/kalshi-ws-transport.js';
const ticker='KXETH15M-26NOV210015-15';
const ed=generateKeyPairSync('ed25519',{
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}
});
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}
});
const creds={keyId:'read-scope-test-key',privatePem:ed.privateKey};

class FakeSocket{
  constructor(){this.readyState=1;this.handlers=new Map();this.sent=[];this.accepted=false;}
  addEventListener(name,fn){this.handlers.set(name,fn);}
  accept(){this.accepted=true;}
  send(data){if(this.readyState!==1)throw Error('closed socket');this.sent.push(JSON.parse(data));}
  close(){this.readyState=3;this.handlers.get('close')?.({code:1000});}
  emit(name,data){this.handlers.get(name)?.({data});}
}
const packet=(seq=2)=>({type:'orderbook_snapshot',sid:4,seq,
  sending_ts_ms:Date.now()-1,
  msg:{market_ticker:ticker,clock:100,yes_dollars_fp:[['0.3800','2.00']],
    no_dollars_fp:[['0.5900','3.00']]}});
const delta=seq=>({type:'orderbook_delta',sid:4,seq,
  sending_ts_ms:Date.now()-1,
  msg:{market_ticker:ticker,clock:110,side:'yes',price_dollars:'0.3800',
    delta_fp:'-1.00',ts_ms:Date.now()-2}});

test('Ed25519 handshakes use exact signed timestamp+GET+path, never a query string',async()=>{
  const now=1795200000000;
  const headers=await wsAuthHeaders({...creds,now,subtle:webcrypto.subtle});
  assert.equal(headers['KALSHI-ACCESS-KEY'],'read-scope-test-key');
  assert.equal(headers['KALSHI-ACCESS-TIMESTAMP'],String(now));
  assert.equal(verify(null,Buffer.from(now+'GET'+KALSHI_SIGN_PATH),ed.publicKey,
    Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64')),true);
  assert.equal(verify(null,Buffer.from(now+'POST'+KALSHI_SIGN_PATH),ed.publicKey,
    Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64')),false);
});
test('RSA-PSS PKCS8 alternate signing mode is verifiable at 32-byte salt',async()=>{
  const now=1795200000050;
  const headers=await wsAuthHeaders({
    keyId:'test-rsa',privatePem:rsa.privateKey,now,subtle:webcrypto.subtle
  });
  assert.equal(verify('sha256',Buffer.from(now+'GET'+KALSHI_SIGN_PATH),{
    key:rsa.publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32
  },Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64')),true);
});
test('invalid credentials are refused without exposing private key material',async()=>{
  for(const privatePem of ['not-a-key','-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----',null]){
    await assert.rejects(()=>wsAuthHeaders({keyId:'test',privatePem,now:123,subtle:webcrypto.subtle}));
  }
});
test('read-only authenticated transport subscribes to only a named ETH15 market',async()=>{
  const ws=new FakeSocket(),calls=[],observations=[];
  const client=new KalshiReadOnlySocket({
    fetcher:async (url,opts)=>{
      calls.push({url,headers:opts.headers});
      return {status:101,webSocket:ws};
    },onObservation:x=>observations.push(x)});
  const at=Date.now();
  assert.equal(await client.ensure(ticker,creds,at),true);
  assert.equal(ws.accepted,true);
  assert.equal(calls[0].url,KALSHI_WS_URL);
  assert.equal(calls[0].headers.Upgrade,'websocket');
  assert.deepEqual(ws.sent[0],{id:1,cmd:'subscribe',
    params:{channels:['orderbook_delta'],market_tickers:[ticker]}});
  client.handleMessage(JSON.stringify(packet()),Date.now(),ws);
  assert.equal(observations.length,1);
  assert.equal(observations[0].quote.yesBid.price,0.38);
  assert.equal(observations[0].quote.yesAsk.price,0.41);
  assert.equal(client.status().connected,true);
  client.stop();
  assert.equal(client.status().connected,false);
});
test('stream gaps trigger specific get_snapshot, never a repeated subscribe',async()=>{
  const ws=new FakeSocket();
  const client=new KalshiReadOnlySocket({fetcher:async()=>({status:101,webSocket:ws})});
  await client.ensure(ticker,creds,Date.now());
  client.handleMessage(JSON.stringify(packet(2)),Date.now(),ws);
  client.handleMessage(JSON.stringify(delta(4)),Date.now(),ws);
  assert.equal(client.book.view(ticker).fresh,false);
  assert.equal(ws.sent[1].cmd,'update_subscription');
  assert.equal(ws.sent[1].params.action,'get_snapshot');
  assert.deepEqual(ws.sent[1].params.sids,[4]);
  assert.equal(client.book.gaps,1);
  client.handleMessage(JSON.stringify(packet(5)),Date.now(),ws);
  assert.equal(client.book.view(ticker).valid,true);
});
test('unexpected tickers, malformed JSON and channel errors invalidate the book',async()=>{
  const ws=new FakeSocket(),faults=[];
  const client=new KalshiReadOnlySocket({
    fetcher:async()=>({status:101,webSocket:ws}),onFault:reason=>faults.push(reason)});
  await client.ensure(ticker,creds,Date.now());
  client.handleMessage(JSON.stringify(packet()),Date.now(),ws);
  client.handleMessage('{not-json',Date.now(),ws);
  assert.equal(client.book.view(ticker).valid,false);
  assert.ok(faults.includes('INVALID_JSON_FRAME'));
  client.handleMessage(JSON.stringify(packet(3)),Date.now(),ws);
  assert.equal(client.book.view(ticker).valid,true);
  const alien=packet(4);alien.msg.market_ticker='KXBTC15M-26NOV210015-15';
  client.handleMessage(JSON.stringify(alien),Date.now(),ws);
  assert.equal(client.book.view(ticker).fresh,false);
  client.handleMessage(JSON.stringify({type:'error',msg:{code:10}}),Date.now(),ws);
  assert.ok(faults.includes('KALSHI_SUBSCRIPTION_ERROR'));
});
test('handshake failure backs off; wrong market IDs cannot trigger connection',async()=>{
  let calls=0;
  const client=new KalshiReadOnlySocket({fetcher:async()=>{calls++;
    return {status:401,webSocket:null};}});
  await assert.rejects(()=>client.ensure('BAD',creds,Date.now()));
  const at=Date.now();
  assert.equal(await client.ensure(ticker,creds,at),false);
  assert.equal(calls,1);
  assert.equal(client.status(at).lastFailure,'HANDSHAKE_HTTP_401');
  assert.ok(client.status(at).retryAfter>at);
  assert.equal(await client.ensure(ticker,creds,at+10),false);
  assert.equal(calls,1);
});


test('watchdog requests a fresh snapshot before declaring stream silence',async()=>{
  const ws=new FakeSocket();
  const client=new KalshiReadOnlySocket({fetcher:async()=>({status:101,webSocket:ws})});
  const at=Date.now();
  await client.ensure(ticker,creds,at);
  client.handleMessage(JSON.stringify(packet()),at,ws);
  assert.equal(client.watchdog(at+16000),'SNAPSHOT_REQUESTED');
  assert.equal(ws.sent[1].cmd,'update_subscription');
  assert.equal(client.watchdog(at+18000),'OK');
  assert.equal(client.watchdog(at+50000),'RECONNECT_REQUIRED');
  assert.equal(client.status(at+50001).connected,false);
});
test('stopping during an in-flight handshake does not revive a cancelled stream',async()=>{
  let release,started;
  const fetchStarted=new Promise(resolve=>{started=resolve});
  const ws=new FakeSocket();
  const client=new KalshiReadOnlySocket({
    fetcher:async()=>{started();return new Promise(resolve=>{release=resolve})}
  });
  const running=client.ensure(ticker,creds,Date.now());
  await fetchStarted;
  client.stop();
  release({status:101,webSocket:ws});
  assert.equal(await running,false);
  assert.equal(client.status().connected,false);
  assert.equal(client.status().targetTicker,null);
  assert.equal(ws.sent.length,0);
});


test('sanitized diagnostic differentiates malformed PEM, unsupported keys and HTTP refusal without leaking credentials',async()=>{
 const reasons=[];
 const broken=new KalshiReadOnlySocket({
  fetcher:async()=>{throw Error('private key must never appear in logs')},
  onFault:reason=>reasons.push(reason)});
 const now=Date.now();
 const invalid={keyId:'test',privatePem:'-----BEGIN PRIVATE KEY-----\n***not-base64***\n-----END PRIVATE KEY-----'};
 assert.equal(await broken.ensure(ticker,invalid,now),false);
 assert.equal(broken.status(now).lastFailure,'KEY_PEM_BASE64_INVALID');
 assert.ok(reasons.every(r=>!r.includes('invalid')));
 const badFormat=new KalshiReadOnlySocket({onFault:r=>reasons.push(r)});
 assert.equal(await badFormat.ensure(ticker,{
  keyId:'test',privatePem:'not a key'},now),false);
 assert.equal(badFormat.status(now).lastFailure,'KEY_PEM_BOUNDARIES_INVALID');
 assert.equal(reasons.includes('KEY_PEM_BOUNDARIES_INVALID'),true);
});
test('read-only websocket handshakes classify 403, 429 and network failures without reading server bodies',async()=>{
 for(const status of [403,429,500]){
  const observed=[];
  const client=new KalshiReadOnlySocket({fetcher:async()=>({
   status,webSocket:null,json:()=>{throw Error('body must not be read')}}),
   onFault:r=>observed.push(r)});
  assert.equal(await client.ensure(ticker,creds,Date.now()),false);
  assert.equal(client.status().lastFailure,'HANDSHAKE_HTTP_'+status);
  assert.deepEqual(observed,['HANDSHAKE_HTTP_'+status]);
 }
 const network=new KalshiReadOnlySocket({fetcher:async()=>{
  throw Error('network error contains sensitive info');
 }});
 assert.equal(await network.ensure(ticker,creds,Date.now()),false);
 assert.equal(network.status().lastFailure,'NETWORK_CONNECT_FAILED');
 assert.doesNotMatch(network.status().lastFailure,/sensitive/);
});
test('handshake 101 without upgrade socket reports safe and distinct failure',async()=>{
 const client=new KalshiReadOnlySocket({fetcher:async()=>({status:101})});
 assert.equal(await client.ensure(ticker,creds,Date.now()),false);
 assert.equal(client.status().lastFailure,'UPGRADE_SOCKET_MISSING');
});
