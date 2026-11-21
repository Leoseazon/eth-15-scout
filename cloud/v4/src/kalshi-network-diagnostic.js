/* Isolated V4 read-only network probe.
 * Public Kalshi exchange-status endpoints only; no API key, no signature,
 * no response body, no user-provided URLs, no order/trading routes.
 */
import {classifyNetworkException} from './kalshi-ws-transport.js';

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
