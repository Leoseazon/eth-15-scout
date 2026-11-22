import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {cfValuesAuthHeaders,KALSHI_CF_LATEST_PATH} from '../src/kalshi-ws-transport.js';
import {checkCFValuesAccess} from '../src/cf-access.js';
const T=1770000000000;
const ETH_LATEST={data:{serverTime:new Date(T).toISOString(),payload:{latest_values:{ETHUSD_RTI:{value:'1843.12345678',time:T-5000}}}}};
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const creds={keyId:'test-read-only-cf',privatePem:privateKey.export({format:'pem',type:'pkcs8'}).toString()};
test('CF GET signs the canonical path only, never query and never POST',async()=>{
 const h=await cfValuesAuthHeaders({...creds,now:T});
 const signature=Buffer.from(h['KALSHI-ACCESS-SIGNATURE'],'base64');
 assert.equal(KALSHI_CF_LATEST_PATH,'/trade-api/v2/cfbenchmarks/latest_values');
 assert.equal(verify(null,Buffer.from(T+'GET'+KALSHI_CF_LATEST_PATH),publicKey,signature),true);
 assert.equal(verify(null,Buffer.from(T+'GET'+KALSHI_CF_LATEST_PATH+'?id=ETHUSD_RTI'),publicKey,signature),false);
 assert.equal(verify(null,Buffer.from(T+'POST'+KALSHI_CF_LATEST_PATH),publicKey,signature),false);
});
test('CF latest_values probe validates the ETH index reading and source timestamp',async()=>{
 const urls=[];
 const result=await checkCFValuesAccess({...creds,now:T,fetcher:async(url,opts)=>{
  urls.push({url,headers:opts.headers,method:opts.method});
  return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify(ETH_LATEST)};
 }});
 assert.equal(result.state,'HTTP_200_VALID_ETH_INDEX');
 assert.equal(result.validValuesVerified,true);
 assert.equal(result.entitlementVerified,true);
 assert.equal(result.indexId,'ETHUSD_RTI');
 assert.equal(result.sourceAt,T-5000);
 assert.equal(urls[0].method,'GET');
 assert.equal(new URL(urls[0].url).hostname,'external-api.kalshi.com');
 assert.equal(new URL(urls[0].url).searchParams.get('id'),'ETHUSD_RTI');
});
test('CF no credentials and forbidden response fail closed without secret exposure',async()=>{
 const missing=await checkCFValuesAccess({});
 assert.equal(missing.state,'CREDENTIALS_NOT_CONFIGURED');
 const forbidden=await checkCFValuesAccess({...creds,now:T,
  fetcher:async()=>({status:403,body:{cancel:async()=>{}}})});
 assert.equal(forbidden.state,'HTTP_403');
 assert.equal(forbidden.entitlementVerified,false);
 assert.doesNotMatch(JSON.stringify(forbidden),/PRIVATE KEY|SIGNATURE|test-read-only-cf/);
});
test('CF unexpected response envelope cannot be reported as entitlement',async()=>{
 const invalid=await checkCFValuesAccess({...creds,now:T,fetcher:async()=>({
  status:200,headers:{get:()=>null},text:async()=>JSON.stringify({wrong:'shape'})})});
 assert.equal(invalid.entitlementVerified,false);
 assert.equal(invalid.validValuesVerified,false);
});

test('HTTP 200 oversized body is classified separately from invalid JSON',async()=>{
 const over=await checkCFValuesAccess({...creds,now:T,fetcher:async()=>({
  status:200,headers:{get:()=>String(1000000)},
  text:async()=>{throw Error('Should not read oversized body')}})});
 assert.equal(over.state,'HTTP_200_OVERSIZED');
 const malformed=await checkCFValuesAccess({...creds,now:T,fetcher:async()=>({
  status:200,headers:{get:()=>null},text:async()=>'{definitely not json'})});
 assert.equal(malformed.state,'HTTP_200_INVALID_JSON');
});
test('HTTP 200 with valid envelope but missing or stale index does not certify fresh readings',async()=>{
 for(const [payload,expected] of [
  [{data:{payload:{latest_values:{}}}},'HTTP_200_NO_ETH_INDEX'],
  [{data:{payload:{latest_values:{ETHUSD_RTI:{value:'1843',time:T-86400000}}}}},'HTTP_200_STALE_ETH_VALUE'],
  [{data:{payload:{latest_values:{ETHUSD_RTI:{value:'0',time:T-5000}}}}},'HTTP_200_INVALID_ETH_VALUE']
 ]){
  const r=await checkCFValuesAccess({...creds,now:T,fetcher:async()=>({
   status:200,headers:{get:()=>null},text:async()=>JSON.stringify(payload)})});
  assert.equal(r.state,expected);assert.equal(r.validValuesVerified,false);
 }
});
