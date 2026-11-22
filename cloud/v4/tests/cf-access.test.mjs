import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {cfValuesAuthHeaders,KALSHI_CF_VALUES_PATH} from '../src/kalshi-ws-transport.js';
import {checkCFValuesAccess} from '../src/cf-access.js';
const T=1770000000000;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const creds={keyId:'test-read-only-cf',privatePem:privateKey.export({format:'pem',type:'pkcs8'}).toString()};
test('CF GET signs the canonical path only, never query and never POST',async()=>{
 const h=await cfValuesAuthHeaders({...creds,now:T});
 const signature=Buffer.from(h['KALSHI-ACCESS-SIGNATURE'],'base64');
 assert.equal(KALSHI_CF_VALUES_PATH,'/trade-api/v2/cfbenchmarks/values');
 assert.equal(verify(null,Buffer.from(T+'GET'+KALSHI_CF_VALUES_PATH),publicKey,signature),true);
 assert.equal(verify(null,Buffer.from(T+'GET'+KALSHI_CF_VALUES_PATH+'?id=ETHUSD_RTI'),publicKey,signature),false);
 assert.equal(verify(null,Buffer.from(T+'POST'+KALSHI_CF_VALUES_PATH),publicKey,signature),false);
});
test('CF status probe accepts an authenticated data envelope but does not certify an index reading',async()=>{
 const urls=[];
 const result=await checkCFValuesAccess({...creds,now:T,fetcher:async(url,opts)=>{
  urls.push({url,headers:opts.headers,method:opts.method});
  return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({data:{payload:{example:'unverified'}}})};
 }});
 assert.equal(result.state,'HTTP_200_DATA_ENVELOPE');
 assert.equal(result.validValuesVerified,false);
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
