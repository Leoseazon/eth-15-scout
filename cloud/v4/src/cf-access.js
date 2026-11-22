/* V4-only signed Kalshi passthrough diagnostic for the latest ETHUSD_RTI.
 * /values returns roughly ONE HOUR of samples and can exceed 128 KiB.
 * For an entitlement check use /latest_values (one tiny reading). Never log
 * secrets, raw upstream payloads, trade account information or signatures.
 * No live trade or simulated fill is authorized.
 */
import {cfValuesAuthHeaders} from './kalshi-ws-transport.js';
const URL='https://external-api.kalshi.com/trade-api/v2/cfbenchmarks/latest_values?id=ETHUSD_RTI';
const RESPONSE_CAP=65536;
function envelopeResult(data,now){
 const item=data?.data?.payload?.latest_values?.ETHUSD_RTI;
 const value=typeof item?.value==='string'&&item.value.length<=80?Number(item.value):NaN;
 const sourceAt=item?.time;
 if(!data||typeof data!=='object'||!data.data||
    typeof data.data!=='object'||!data.data.payload||
    typeof data.data.payload!=='object')
  return {state:'HTTP_200_UNEXPECTED_ENVELOPE',entitlementVerified:false,validValuesVerified:false};
 if(!item)
  return {state:'HTTP_200_NO_ETH_INDEX',entitlementVerified:false,validValuesVerified:false};
 if(!Number.isFinite(value)||value<=0||value>=10000000||
   !Number.isSafeInteger(sourceAt)||sourceAt<1000000000000||
   sourceAt>now+30000)
  return {state:'HTTP_200_INVALID_ETH_VALUE',entitlementVerified:false,validValuesVerified:false};
 if(now-sourceAt>15*60*1000)
  return {state:'HTTP_200_STALE_ETH_VALUE',entitlementVerified:true,validValuesVerified:false,
    sourceAt,ageSeconds:Math.max(0,Math.floor((now-sourceAt)/1000))};
 return {state:'HTTP_200_VALID_ETH_INDEX',entitlementVerified:true,
  validValuesVerified:true,indexId:'ETHUSD_RTI',price:value,
  sourceAt,ageSeconds:Math.max(0,Math.floor((now-sourceAt)/1000))};
}
export async function checkCFValuesAccess({keyId,privatePem,fetcher=fetch,now=Date.now(),
 makeSignal=ms=>AbortSignal.timeout(ms)}={}){
 if(typeof keyId!=='string'||typeof privatePem!=='string')
  return {state:'CREDENTIALS_NOT_CONFIGURED',validValuesVerified:false,entitlementVerified:false};
 let headers;
 try{headers=await cfValuesAuthHeaders({keyId,privatePem,now})}
 catch{return {state:'SIGNING_UNAVAILABLE',validValuesVerified:false,entitlementVerified:false}}
 let response;
 try{
  response=await fetcher(URL,{
    method:'GET',headers:{...headers,Accept:'application/json'},
    redirect:'manual',signal:makeSignal(6500),cf:{cacheTtl:0,cacheEverything:false}
  });
 }catch{return {state:'NETWORK_UNAVAILABLE',validValuesVerified:false,entitlementVerified:false}}
 const status=Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?
  response.status:null;
 if(status!==200){
  try{await response.body?.cancel()}catch{}
  return {state:'HTTP_'+(status??'UNKNOWN'),httpStatus:status,
    validValuesVerified:false,entitlementVerified:false};
 }
 let raw;
 try{
  const header=response.headers?.get?.('content-length');
  const length=header===null||header===undefined?null:Number(header);
  if(length!==null&&Number.isFinite(length)&&length>RESPONSE_CAP)
   return {state:'HTTP_200_OVERSIZED',httpStatus:200,
    validValuesVerified:false,entitlementVerified:false};
  raw=await response.text();
 }catch{return {state:'HTTP_200_BODY_READ_ERROR',httpStatus:200,
  validValuesVerified:false,entitlementVerified:false}}
 if(typeof raw!=='string'||raw.length>RESPONSE_CAP)
  return {state:'HTTP_200_OVERSIZED',httpStatus:200,
   validValuesVerified:false,entitlementVerified:false};
 let data;try{data=JSON.parse(raw)}
 catch{return {state:'HTTP_200_INVALID_JSON',httpStatus:200,
  validValuesVerified:false,entitlementVerified:false}}
 return {...envelopeResult(data,now),httpStatus:200};
}
