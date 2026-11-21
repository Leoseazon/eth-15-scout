import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {KALSHI_PUBLIC_HEALTH_URLS,probeKalshiPublicRest} from '../src/kalshi-network-diagnostic.js';

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
