/* Authenticated, read-only Kalshi CF Benchmarks entitlement probe.
 * This confirms API response and envelope only. It deliberately does NOT
 * assume a 200 proves valid historical index values or official settlement.
 * Endpoint charges Kalshi read-rate-limit tokens; caller enforces >=6h cache.
 */
import {cfValuesAuthHeaders} from './kalshi-ws-transport.js';
const URL='https://external-api.kalshi.com/trade-api/v2/cfbenchmarks/values?id=ETHUSD_RTI';
export async function checkCFValuesAccess({keyId,privatePem,fetcher=fetch,now=Date.now(),
 makeSignal=ms=>AbortSignal.timeout(ms)}={}){
 if(typeof keyId!=='string'||typeof privatePem!=='string')
  return {state:'CREDENTIALS_NOT_CONFIGURED',validValuesVerified:false};
 let headers;
 try{headers=await cfValuesAuthHeaders({keyId,privatePem,now})}
 catch{return {state:'SIGNING_UNAVAILABLE',validValuesVerified:false}}
 let response;
 try{
  response=await fetcher(URL,{
   method:'GET',headers:{...headers,Accept:'application/json'},
   redirect:'manual',signal:makeSignal(5000),cf:{cacheTtl:0,cacheEverything:false}
  });
 }catch{return {state:'NETWORK_UNAVAILABLE',validValuesVerified:false}}
 const status=Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?
  response.status:null;
 if(status!==200){
  try{await response.body?.cancel()}catch{}
  return {state:'HTTP_'+(status??'UNKNOWN'),httpStatus:status,
   validValuesVerified:false,entitlementVerified:false};
 }
 try{
  const size=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(size)&&size>131072)throw TypeError('Too large');
  const raw=await response.text();
  if(typeof raw!=='string'||raw.length>131072)throw TypeError('Too large');
  const data=JSON.parse(raw);
  const envelope=!!(data?.data&&typeof data.data==='object'&&
   !Array.isArray(data.data)&&data.data.payload&&typeof data.data.payload==='object');
  return {state:envelope?'HTTP_200_DATA_ENVELOPE':'HTTP_200_UNEXPECTED_ENVELOPE',
   httpStatus:200,restAccessResponding:envelope,entitlementVerified:envelope,
   validValuesVerified:false};
 }catch{return {state:'HTTP_200_UNREADABLE_DATA',httpStatus:200,
  entitlementVerified:false,validValuesVerified:false}}
}
