import test from 'node:test';
import {sampledStreamRecorder} from '../src/stream-audit.js';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants,webcrypto} from 'node:crypto';
import {wsAuthHeaders,readonlyRestAuthHeaders,KalshiReadOnlySocket,KALSHI_WS_URL,KALSHI_COMPAT_WS_URL,KALSHI_SIGN_PATH,KALSHI_READONLY_REST_PATH,classifyNetworkException,classifyWebSocketUpgradeException} from '../src/kalshi-ws-transport.js';
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


test('Classify only safe network codes and never persist raw exception containing secret-looking strings',()=>{
 const cases=[
  [{name:'AbortError',message:'secret-token'},'NETWORK_TIMEOUT'],
  [{name:'TypeError',message:'fetch failed'},'NETWORK_FETCH_REJECTED'],
  [{name:'TypeError',message:'TLS handshake failed for SECRET'},'NETWORK_TLS_FAILED'],
  [{name:'TypeError',message:'DNS ENOTFOUND SECRET'},'NETWORK_DNS_FAILED'],
  [{name:'TypeError',message:'Network connection lost SECRET'},'NETWORK_CONNECTION_LOST'],
  [{name:'TypeError',message:'unexpected-secret-value'},'NETWORK_CONNECT_FAILED']
 ];
 for(const [err,code] of cases){
  const result=classifyNetworkException(err);
  assert.equal(result,code);
  assert.doesNotMatch(result,/SECRET|token|unexpected-secret/i);
 }
});

test('two consecutive primary network failures select official compatibility host with identical signing path',async()=>{
 const urls=[],reasons=[];
 const client=new KalshiReadOnlySocket({
  fetcher:async url=>{
   urls.push(url);
   if(url===KALSHI_WS_URL)throw new TypeError('Network connection lost');
   return {status:101,webSocket:new FakeSocket()};
  },onFault:r=>reasons.push(r)});
 const t=Date.now();
 assert.equal(await client.ensure(ticker,creds,t),false);
 assert.equal(client.status(t).endpoint,'PRIMARY');
 assert.equal(await client.ensure(ticker,creds,t+3000),false);
 assert.equal(client.status(t+3000).endpoint,'COMPAT');
 assert.ok(reasons.includes('WS_FALLBACK_COMPAT_SELECTED'));
 assert.equal(await client.ensure(ticker,creds,t+7500),true);
 assert.equal(client.status(t+7500).connected,true);
 assert.deepEqual(urls,[KALSHI_WS_URL,KALSHI_WS_URL,KALSHI_COMPAT_WS_URL]);
 client.stop();
});

test('HTTP 401 and 403 never trigger alternate-host retries or recreate keys',async()=>{
 for(const status of [401,403]){
  const urls=[];
  const client=new KalshiReadOnlySocket({fetcher:async url=>{
   urls.push(url);return {status,webSocket:null};
  }});
  let t=Date.now();
  for(let i=0;i<4;i++){
   assert.equal(await client.ensure(ticker,creds,t),false);
   t+=65000;
  }
  assert.ok(urls.every(url=>url===KALSHI_WS_URL));
  assert.equal(client.status(t).endpoint,'PRIMARY');
  assert.equal(client.status(t).lastFailure,'HANDSHAKE_HTTP_'+status);
 }
});
test('429 backoff persists for at least two minutes and does not switch hosts',async()=>{
 const urls=[];
 const client=new KalshiReadOnlySocket({fetcher:async url=>{
   urls.push(url);return {status:429,webSocket:null};
 }});
 const t=Date.now();
 assert.equal(await client.ensure(ticker,creds,t),false);
 assert.equal(client.status(t).retryAfter,t+120000);
 assert.equal(await client.ensure(ticker,creds,t+60000),false);
 assert.equal(urls.length,1);
 assert.equal(client.status(t).endpoint,'PRIMARY');
});
test('compatibility and primary endpoints remain hardcoded official Kalshi hostnames',()=>{
 assert.equal(new URL(KALSHI_WS_URL).hostname,'external-api-ws.kalshi.com');
 assert.equal(new URL(KALSHI_COMPAT_WS_URL).hostname,'api.elections.kalshi.com');
 assert.equal(new URL(KALSHI_WS_URL).pathname,KALSHI_SIGN_PATH);
 assert.equal(new URL(KALSHI_COMPAT_WS_URL).pathname,KALSHI_SIGN_PATH);
 assert.equal(new URL(KALSHI_COMPAT_WS_URL).protocol,'https:');
});


test('read-only signed REST probe uses its own allowlisted Kalshi endpoint and cannot reuse a WS signature',async()=>{
 const now=1795200000000;
 const headers=await readonlyRestAuthHeaders({...creds,now,subtle:webcrypto.subtle});
 const signature=Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64');
 assert.equal(headers['KALSHI-ACCESS-KEY'],'read-scope-test-key');
 assert.equal(verify(null,Buffer.from(now+'GET'+KALSHI_READONLY_REST_PATH),ed.publicKey,signature),true);
 assert.equal(verify(null,Buffer.from(now+'GET'+KALSHI_SIGN_PATH),ed.publicKey,signature),false);
 assert.equal(verify(null,Buffer.from(now+'POST'+KALSHI_READONLY_REST_PATH),ed.publicKey,signature),false);
 assert.equal(KALSHI_READONLY_REST_PATH,'/trade-api/v2/portfolio/balance');
});


test('specific WebSocket upgrade errors map to stable reason codes without leaking raw exception text',()=>{
 const tests=[
  ['Invalid Upgrade header for SECRET','WS_UPGRADE_HEADER_REJECTED'],
  ['WebSocket upgrade not implemented - PRIVATE KEY','WS_UPGRADE_RUNTIME_UNSUPPORTED'],
  ['unsupported protocol scheme SECRET','WS_SCHEME_REJECTED'],
  ['outbound request limit exceeded SECRET','WS_WORKER_SUBREQUEST_LIMIT'],
  ['outbound connection blocked SECRET','NETWORK_EGRESS_BLOCKED'],
  ['unknown private key = SECRET','NETWORK_CONNECT_FAILED']
 ];
 for(const [message,expected] of tests){
  const code=classifyWebSocketUpgradeException({name:'TypeError',message});
  assert.equal(code,expected);
  assert.doesNotMatch(code,/SECRET|private key/i);
 }
 for(const [cause,expected] of [['EAI_AGAIN','NETWORK_DNS_FAILED'],
  ['ETIMEDOUT','NETWORK_TIMEOUT'],['ECONNREFUSED','NETWORK_FETCH_REJECTED']]){
  assert.equal(classifyWebSocketUpgradeException({
   name:'TypeError',message:'Request failed PRIVATE KEY',cause:{code:cause}
  }),expected);
 }
});
test('an unsupported Cloudflare WebSocket upgrade is classified separately from DNS and HTTP 401',async()=>{
 const client=new KalshiReadOnlySocket({
  fetcher:async()=>{throw TypeError('WebSocket upgrade not implemented SECRET')}
 });
 assert.equal(await client.ensure(ticker,creds,Date.now()),false);
 assert.equal(client.status().lastFailure,'WS_UPGRADE_RUNTIME_UNSUPPORTED');
 assert.equal(client.status().lastNetworkDiagnostic,'WS_UPGRADE_RUNTIME_UNSUPPORTED');
 assert.equal(client.status().endpoint,'PRIMARY');
});

test('the archive captures price changes and heartbeats independently of gap recovery',async()=>{
  const ws=new FakeSocket(), archived=[], faults=[];
  let failWrite=false;
  const sql={exec:(_sql,...args)=>{
    if(failWrite)throw Error('storage unavailable');
    archived.push(JSON.parse(args.at(-1)));
  }};
  const client=new KalshiReadOnlySocket({
    fetcher:async()=>({status:101,webSocket:ws}),
    onObservation:sampledStreamRecorder(sql),onFault:reason=>faults.push(reason)
  });
  const at=Date.now();
  await client.ensure(ticker,creds,at);
  const send=(frame,elapsed)=>{
    frame.sending_ts_ms=at+elapsed;
    frame.msg.ts_ms=at+elapsed;
    client.handleMessage(JSON.stringify(frame),at+elapsed,ws);
  };
  send(packet(1),0);
  for(let seq=2;seq<=302;seq++){
    const frame=delta(seq);
    frame.msg.delta_fp='1.00';
    frame.msg.price_dollars=seq%2?'0.4000':'0.4100';
    send(frame,(seq-1)*50);
  }
  assert.equal(client.book.view(ticker,at+15_050).seq,302);
  assert.equal(client.book.view(ticker,at+15_050).yesBid.price,.41);
  assert.deepEqual(archived.map(x=>[x.seq,x.archiveTrigger]),[
    [1,'snapshot'],[2,'price_change'],[302,'heartbeat']
  ]);
  assert.equal(archived[2].archiveIntervalMs,15_000);
  const removeTop=delta(303);
  Object.assign(removeTop.msg,{price_dollars:'0.4100',delta_fp:'-151.00'});
  send(removeTop,15_100);
  const improveAsk=delta(304);
  Object.assign(improveAsk.msg,{side:'no',price_dollars:'0.5950',delta_fp:'1.00'});
  send(improveAsk,15_150);
  assert.deepEqual(archived.slice(-2).map(x=>[x.seq,x.archiveTrigger,x.yesBid.price,x.yesAsk.price]),[
    [303,'price_change',.40,.41],[304,'price_change',.40,.405]
  ]);
  send(delta(306),15_200);
  assert.ok(faults.includes('SEQUENCE_GAP'));
  assert.equal(ws.sent.at(-1).params.action,'get_snapshot');
  send(packet(307),15_250);
  assert.deepEqual(archived.map(x=>x.seq),[1,2,302,303,304,307]);
  failWrite=true;
  send(delta(308),30_250);
  assert.equal(client.book.view(ticker,at+30_250).valid,true);
  assert.ok(!faults.includes('OBSERVATION_HANDLER_FAILURE'));
  failWrite=false;
  send(packet(309),90_251);
  assert.equal(archived.at(-1).seq,309);
});
