import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {KALSHI_PUBLIC_HEALTH_URLS,probeKalshiPublicRest,probeKalshiSignedRead,probeKalshiWebsocketHostHttps} from '../src/kalshi-network-diagnostic.js';

test('V4 public REST probe visits exactly two hardcoded official production status endpoints',async()=>{
 const urls=[],bodies=[];
 const result=await probeKalshiPublicRest({
  fetcher:async (url,options)=>{
   urls.push({url,options});
   return {status:200,body:{cancel:async()=>bodies.push(url)}};
  },makeSignal:ms=>({testTimeout:ms})});
 assert.deepEqual(urls.map(u=>u.url),[
  'https://external-api.kalshi.com/trade-api/v2/exchange/status',
  'https://api.elections.kalshi.com/trade-api/v2/exchange/status']);
 for(const x of urls){
  assert.deepEqual(x.options.headers,{Accept:'application/json'});
  assert.equal(x.options.method,'GET');
  assert.equal(x.options.redirect,'manual');
  assert.equal(x.options.signal.testTimeout,3500);
  assert.equal(JSON.stringify(x.options).includes('KALSHI-ACCESS'),false);
 }
 assert.equal(bodies.length,2);
 assert.deepEqual(result,[
  {endpoint:'PRIMARY',result:'HTTP_200'},
  {endpoint:'COMPAT',result:'HTTP_200'}]);
 assert.equal(KALSHI_PUBLIC_HEALTH_URLS.length,2);
});
test('public network probe reports statuses safely without reading potentially secret response bodies',async()=>{
 const result=await probeKalshiPublicRest({
  fetcher:async url=>url.includes('external-api.kalshi.com')?
    {status:429,body:{cancel:async()=>{}}}:
    {status:503,body:{cancel:async()=>{}}},
  makeSignal:()=>null});
 assert.equal(result[0].result,'HTTP_429');
 assert.equal(result[1].result,'HTTP_503');
});
test('public REST probe masks raw DNS, timeout and credential-bearing exceptions',async()=>{
 const result=await probeKalshiPublicRest({
  fetcher:async url=>{
   if(url.includes('external-api.kalshi.com'))
    throw Object.assign(new Error('TLS certificate error PRIVATE KEY CONTENT'),{name:'TypeError'});
   throw Object.assign(new Error('password=secret'),{name:'AbortError'});
  },makeSignal:()=>null});
 assert.equal(result[0].result,'NETWORK_TLS_FAILED');
 assert.equal(result[1].result,'NETWORK_TIMEOUT');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE KEY|password|secret/);
});
test('bad probe timeout is rejected and Worker only performs periodic read-only diagnostics',()=>{
 assert.rejects(probeKalshiPublicRest({timeoutMs:100}),RangeError);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const source=readFileSync(root+'src/worker.js','utf8');
 assert.match(source,/failed\.attempts>=3/);
 assert.match(source,/Date\.now\(\)-\(s\.lastNetworkProbeAt\|\|0\)>=10\*60\*1000/);
 assert.match(source,/kind:'NETWORK_REST_CHECK'/);
 assert.doesNotMatch(source,/https:\/\/api\.kalshi\.com\/.*\/orders/);
});


test('signed read-only probe records only HTTP status, never balance contents or bearer secrets',async()=>{
 let called=0;
 const fakeHeaders={
  'KALSHI-ACCESS-KEY':'sensitive-identifier',
  'KALSHI-ACCESS-SIGNATURE':'sensitive-signature',
  'KALSHI-ACCESS-TIMESTAMP':'1795200000000'
 };
 const result=await probeKalshiSignedRead({
  keyId:'sensitive-identifier',privatePem:'private-material',
  signer:async()=>fakeHeaders,
  fetcher:async (url,options)=>{
   called++;
   assert.equal(url,'https://external-api.kalshi.com/trade-api/v2/portfolio/balance');
   assert.equal(options.method,'GET');
   assert.equal(options.redirect,'manual');
   assert.equal(options.headers['KALSHI-ACCESS-SIGNATURE'],'sensitive-signature');
   assert.deepEqual(Object.keys(options.headers).sort(),[
    'Accept','KALSHI-ACCESS-KEY','KALSHI-ACCESS-SIGNATURE','KALSHI-ACCESS-TIMESTAMP'].sort());
   return {status:200,body:{
    cancel:async()=>{},
    text:async()=>{throw Error('A BALANCE RESPONSE MUST NEVER BE READ')},
    json:async()=>{throw Error('A BALANCE RESPONSE MUST NEVER BE READ')}
   }};
  },makeSignal:()=>null});
 assert.equal(result,'AUTH_REST_HTTP_200');
 assert.equal(called,1);
 assert.doesNotMatch(result,/sensitive|balance|private/i);
});
test('signed read-only probe distinguishes HTTP auth rejection, rate limit and timeouts',async()=>{
 for(const status of [401,403,429,500]){
  const response=await probeKalshiSignedRead({
   signer:async()=>({}),fetcher:async()=>({status,body:{cancel:async()=>{}}}),
   makeSignal:()=>null});
  assert.equal(response,'AUTH_REST_HTTP_'+status);
 }
 const fail=await probeKalshiSignedRead({
  signer:async()=>({}),fetcher:async()=>{throw new Error('TLS certificate secret content')},
  makeSignal:()=>null});
 assert.equal(fail,'AUTH_REST_NETWORK_TLS_FAILED');
 const rejected=await probeKalshiSignedRead({
  signer:async()=>{throw Object.assign(new Error('PRIVATE KEY content'),{
   kalshiCode:'KEY_IMPORT_FAILED'})},fetcher:async()=>{throw Error('must not fetch')}});
 assert.equal(rejected,'AUTH_REST_KEY_IMPORT_FAILED');
});
test('non-upgrade HTTPS checks on BOTH Kalshi WS hosts are uncredentialed and do not imply stream success',async()=>{
 const called=[];
 const results=await probeKalshiWebsocketHostHttps({
  fetcher:async(url,options)=>{
   called.push({url,options});
   return {status:401,body:{cancel:async()=>{}}};
  },makeSignal:ms=>({timeout:ms})});
 assert.deepEqual(results,[{endpoint:'PRIMARY',result:'HTTP_401'},
  {endpoint:'COMPAT',result:'HTTP_401'}]);
 assert.equal(called.length,2);
 for(const {url,options} of called){
  assert.equal(new URL(url).pathname,'/trade-api/ws/v2');
  assert.equal(options.method,'GET');
  assert.deepEqual(options.headers,{Accept:'application/json'});
  assert.equal(options.headers.Upgrade,undefined);
  assert.equal(options.headers['KALSHI-ACCESS-KEY'],undefined);
  assert.equal(options.signal.timeout,3500);
 }
});
test('network forensic probes all have strict safe timeout validation and bounded cooldown',async()=>{
 await assert.rejects(probeKalshiSignedRead({timeoutMs:100}),RangeError);
 await assert.rejects(probeKalshiWebsocketHostHttps({timeoutMs:100}),RangeError);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const source=readFileSync(root+'src/worker.js','utf8');
 assert.match(source,/kind:'AUTH_REST_CHECK'/);
 assert.match(source,/kind:'WS_HOST_HTTPS_CHECK'/);
 assert.match(source,/Date\.now\(\)-\(s\.lastNetworkProbeAt\|\|0\)>=10\*60\*1000/);
 assert.match(source,/SCOUT_V4/);
 assert.doesNotMatch(source,/POST.*\/portfolio\/orders/);
});
