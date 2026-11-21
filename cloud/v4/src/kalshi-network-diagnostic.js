/* Isolated V4 read-only network probe.
 * Public Kalshi exchange-status endpoints only; no API key, no signature,
 * no response body, no user-provided URLs, no order/trading routes.
 */
import {classifyNetworkException,readonlyRestAuthHeaders,KALSHI_READONLY_REST_PATH,KALSHI_WS_URL,KALSHI_COMPAT_WS_URL} from './kalshi-ws-transport.js';

export const KALSHI_PUBLIC_HEALTH_URLS=Object.freeze([
  {label:'PRIMARY',url:'https://external-api.kalshi.com/trade-api/v2/exchange/status'},
  {label:'COMPAT',url:'https://api.elections.kalshi.com/trade-api/v2/exchange/status'}
]);
export async function probeKalshiPublicRest({
  fetcher=fetch,makeSignal=ms=>AbortSignal.timeout(ms),timeoutMs=3500
}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>10000)
    throw new RangeError('Invalid V4 read-only network probe timeout');
  const results=[];
  for(const {label,url} of KALSHI_PUBLIC_HEALTH_URLS){
    let result;
    try{
      const response=await fetcher(url,{
        method:'GET',signal:makeSignal(timeoutMs),redirect:'manual',
        headers:{Accept:'application/json'}
      });
      const code=Number.isInteger(response?.status)&&response.status>=100&&
        response.status<=599?response.status:'UNKNOWN';
      result='HTTP_'+code;
      // No body is read, and no remote user data is persisted.
      try{await response.body?.cancel()}catch{}
    }catch(err){result=classifyNetworkException(err)}
    results.push(Object.freeze({endpoint:label,result}));
  }
  return Object.freeze(results);
}


/* Diagnostic only: verifies whether the V4 read key can authenticate on
 * Kalshi's documented read::portfolio_balance endpoint. The response body is
 * NEVER parsed, logged, returned, or persisted; only safe status/error codes.
 */
export async function probeKalshiSignedRead({keyId,privatePem,
  fetcher=fetch,signer=readonlyRestAuthHeaders,
  makeSignal=ms=>AbortSignal.timeout(ms),timeoutMs=3500}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>10000)
  throw new RangeError('Invalid V4 signed read probe timeout');
 let headers;
 try{headers=await signer({keyId,privatePem,now:Date.now()})}
 catch(err){
  const code=typeof err?.kalshiCode==='string'&&/^[A-Z0-9_]{2,60}$/.test(err.kalshiCode)?
    err.kalshiCode:'AUTH_SIGNING_FAILED';
  return 'AUTH_REST_'+code;
 }
 try{
  const response=await fetcher('https://external-api.kalshi.com'+KALSHI_READONLY_REST_PATH,{
   method:'GET',redirect:'manual',signal:makeSignal(timeoutMs),
   headers:{Accept:'application/json',...headers}
  });
  const status=Number.isInteger(response?.status)&&response.status>=100&&
   response.status<=599?response.status:'UNKNOWN';
  try{await response.body?.cancel()}catch{}
  return 'AUTH_REST_HTTP_'+status;
 }catch(err){return 'AUTH_REST_'+classifyNetworkException(err)}
}

/* GET on the documented WebSocket path but with NO upgrade and NO credentials.
 * Response codes (401/400/426/etc.) show HTTPS hostname/path reachability,
 * NOT that WebSocket upgrade or authenticated stream succeeds.
 */
export async function probeKalshiWebsocketHostHttps({
 fetcher=fetch,makeSignal=ms=>AbortSignal.timeout(ms),timeoutMs=3500
}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>10000)
  throw new RangeError('Invalid V4 HTTPS host probe timeout');
 const endpoints=[{label:'PRIMARY',url:KALSHI_WS_URL},
  {label:'COMPAT',url:KALSHI_COMPAT_WS_URL}];
 return await Promise.all(endpoints.map(async ({label,url})=>{
  let result;
  try{
   const response=await fetcher(url,{
    method:'GET',redirect:'manual',signal:makeSignal(timeoutMs),
    headers:{Accept:'application/json'} // deliberately NO Upgrade or auth
   });
   const status=Number.isInteger(response?.status)&&response.status>=100&&
    response.status<=599?response.status:'UNKNOWN';
   result='HTTP_'+status;
   try{await response.body?.cancel()}catch{}
  }catch(err){result=classifyNetworkException(err)}
  return Object.freeze({endpoint:label,result});
 }));
}
