/* V4 CF Benchmarks one-shot WebSocket entitlement probe.
 * No continuous subscription, SQLite writes, paper orders, Kalshi trade access,
 * full feed archival or calls to the existing ScoutEngineV4 monitoring instance.
 * Session closes on verification, refusal, timeout, or network failure.
 */
import {wsAuthHeaders,KALSHI_WS_URL,classifyWebSocketUpgradeException} from './kalshi-ws-transport.js';
import {parseCFValueFrame} from './research-sources.js';
const INDEX='ETHUSD_RTI';
const validSid=v=>Number.isSafeInteger(v)&&v>0;
const safeStatus=v=>Number.isSafeInteger(v)&&v>=100&&v<=599?v:null;
export async function verifyCFWebSocket({
 keyId,privatePem,fetcher=fetch,nowFn=Date.now,
 timeoutMs=10000,upgradeSignal=ms=>AbortSignal.timeout(ms)
}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>15000)
  throw new RangeError('Invalid one-shot check duration');
 if(typeof keyId!=='string'||typeof privatePem!=='string')
  return {state:'WS_CREDENTIALS_UNAVAILABLE',websocketVerified:false,archived:false};
 let headers;
 try{headers=await wsAuthHeaders({keyId,privatePem,now:nowFn()})}
 catch{return {state:'WS_SIGNING_UNAVAILABLE',websocketVerified:false,archived:false}}
 let response;
 try{response=await fetcher(KALSHI_WS_URL,{
  headers:{...headers,Upgrade:'websocket'},signal:upgradeSignal(4500)
 })}
 catch(e){return {state:classifyWebSocketUpgradeException(e),
  websocketVerified:false,archived:false}}
 const status=safeStatus(response?.status);
 if(status!==101||!response?.webSocket){
  try{await response?.body?.cancel?.()}catch{}
  return {state:'WS_HANDSHAKE_HTTP_'+(status??'INVALID'),
   httpStatus:status,websocketVerified:false,archived:false};
 }
 const socket=response.webSocket;
 return await new Promise(resolve=>{
  let done=false,subscribed=false,listSeen=false,listAvailable=false,sid=null;
  let value=null,badFrameCount=0,replyCount=0;
  let deadline=null;
  const common=()=>({
   indexId:INDEX,subscribed,indexlistReceived:listSeen,indexAvailable:listAvailable,
   validValueReceived:!!value,badFrameCount,replyCount,
   websocketVerified:false,archived:false,paperOnly:true,
   interpretation:'One-time read-only check; not settlement verification or data-retention authorization.'
  });
  const finish=(state,detail={})=>{
   if(done)return;
   done=true;clearTimeout(deadline);
   try{socket.close(1000,'V4 CF entitlement check complete')}catch{}
   resolve({...common(),state,...detail});
  };
  const completed=()=>{
   if(!subscribed||!listSeen||!listAvailable||!value)return;
   const sourceAgeMs=nowFn()-value.sourceAt;
   if(sourceAgeMs < -5000||sourceAgeMs>30000){
    finish('WS_ETH_VALUE_NOT_FRESH',{sourceAt:value.sourceAt});
    return;
   }
   finish('WS_ETH_INDEX_VERIFIED',{
    websocketVerified:true,validValueReceived:true,
    sourceAt:value.sourceAt,
    sourceAgeSeconds:Math.max(0,Math.floor(sourceAgeMs/1000)),
    value:Number(value.value),
    finalMinuteAveragePresent:value.averageFinalMinute!==null,
    trailingAveragePresent:value.averageTrailing60s!==null
   });
  };
  socket.addEventListener('message',evt=>{
   if(done)return;
   if(typeof evt.data!=='string'||evt.data.length>65536){
    ++badFrameCount;return;
   }
   let p;try{p=JSON.parse(evt.data)}catch{++badFrameCount;return}
   ++replyCount;
   if(replyCount>40){finish('WS_UNEXPECTED_MESSAGE_VOLUME');return}
   if(p?.type==='error'){
    const code=Number.isSafeInteger(p?.msg?.code)?p.msg.code:null;
    finish('WS_SUBSCRIPTION_REJECTED',{errorCode:code});return;
   }
   if(p?.type==='subscribed'&&p.id===1){
    const assigned=p?.msg?.sid??p?.sid;
    if(p?.msg?.channel!==undefined&&p.msg.channel!=='cfbenchmarks_value')return;
    if(!validSid(assigned)){finish('WS_SUBSCRIPTION_BAD_ACK');return}
    subscribed=true;sid=assigned;
    try{socket.send(JSON.stringify({id:2,cmd:'update_subscription',
      params:{sid,action:'indexlist'}}))}
    catch{finish('WS_INDEXLIST_SEND_FAILURE')}
    return;
   }
   if(p?.type==='cfbenchmarks_value_indexlist'){
    if(!subscribed||p.sid!==sid){++badFrameCount;return}
    listSeen=true;
    listAvailable=Array.isArray(p.msg?.index_ids)&&p.msg.index_ids.includes(INDEX);
    if(!listAvailable){finish('WS_ETH_INDEX_NOT_LISTED');return}
    completed();return;
   }
   if(p?.type==='cfbenchmarks_value'){
    if(p?.msg?.index_id!==INDEX)return;
    if(!subscribed||p?.sid!==sid){++badFrameCount;return}
    try{value=parseCFValueFrame(p,nowFn())}
    catch{++badFrameCount;return}
    completed();
   }
  });
  socket.addEventListener('error',()=>finish('WS_SOCKET_ERROR'));
  socket.addEventListener('close',()=>finish('WS_SOCKET_CLOSED'));
  deadline=setTimeout(()=>finish(
   !subscribed?'WS_NO_SUBSCRIPTION_ACK':
   !listSeen?'WS_INDEXLIST_TIMEOUT':
   !listAvailable?'WS_ETH_INDEX_NOT_LISTED':
   badFrameCount>0?'WS_INVALID_ETH_VALUE_FRAMES':'WS_NO_FRESH_ETH_VALUE'),timeoutMs);
  try{
   socket.accept();
   socket.send(JSON.stringify({id:1,cmd:'subscribe',
    params:{channels:['cfbenchmarks_value'],index_ids:[INDEX]}}));
  }catch{finish('WS_SUBSCRIBE_SEND_FAILED')}
 });
}
