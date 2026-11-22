/* V4-only supplementary Kalshi reference index and public-trades WebSocket.
 * Distinct from the production-style orderbook connection: cannot affect
 * V3, V4 candidate decisions, paper balances or simulated fills.
 * Fail-closed research provenance. Uses read-only, server-side Kalshi credentials.
 */
import {wsAuthHeaders,KALSHI_WS_URL,classifyWebSocketUpgradeException} from './kalshi-ws-transport.js';
import {parseCFValueFrame,parsePublicTradeFrame} from './research-sources.js';
const ETH=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
export class KalshiResearchSocket {
 constructor({fetcher=fetch,onCF=()=>{},onTrade=()=>{},onEvent=()=>{}}={}){
  this.fetcher=fetcher;this.onCF=onCF;this.onTrade=onTrade;this.onEvent=onEvent;
  this.socket=null;this.ticker=null;this.lastMessageAt=null;this.lastCFAt=null;
  this.lastTradeAt=null;this.retryAfter=0;this.failures=0;this.connecting=false;
  this.generation=0;this.lastFailure=null;this.sids=new Map();this.seqBySid=new Map();
  this.lastConnectAt=null;this.connectedAt=null;this.indexAvailable='UNVERIFIED';
 }
 event(kind){
  try{this.onEvent(kind,Date.now())}catch{} // research faults never block the primary engine
 }
 status(){
  return {connected:!!this.socket&&this.socket.readyState===1,
   source:'KALSHI_CF_AND_PUBLIC_TRADES_READ_ONLY',ticker:this.ticker,
   lastMessageAt:this.lastMessageAt,lastCFAt:this.lastCFAt,lastTradeAt:this.lastTradeAt,
   lastFailure:this.lastFailure,retryAfter:this.retryAfter,indexAvailable:this.indexAvailable,
   paperOnly:true,modelCalibrated:false};
 }
 stop(){
  ++this.generation;this.connecting=false;
  const ws=this.socket;this.socket=null;this.ticker=null;
  this.sids.clear();this.seqBySid.clear();this.indexAvailable='UNVERIFIED';
  try{ws?.close(1000,'V4 research stopped')}catch{}
 }
 disconnect(kind,now=Date.now(),httpStatus=0){
  const old=this.socket;this.socket=null;this.sids.clear();this.seqBySid.clear();
  this.lastFailure=kind;this.failures++;
  this.retryAfter=now+(httpStatus===429?120000:Math.min(60000,1000*2**Math.min(this.failures,6)));
  this.event(kind==='RESEARCH_STREAM_SILENT'?kind:'CF_CONNECT_ERROR');
  try{old?.close(1000,'V4 research reconnect')}catch{}
 }
 watchdog(now=Date.now()){
  if(this.socket?.readyState===1&&this.lastMessageAt!==null&&now-this.lastMessageAt>45000){
   this.disconnect('RESEARCH_STREAM_SILENT',now);return 'RECONNECT_REQUIRED';
  }
  return 'OK';
 }
 async ensure(ticker,credentials,now=Date.now()){
  if(!ETH.test(ticker||''))return false;
  if(this.ticker&&this.ticker!==ticker)this.stop();
  if(this.socket?.readyState===1||this.connecting||now<this.retryAfter)return false;
  this.ticker=ticker;this.connecting=true;const generation=++this.generation;
  try{
   const headers=await wsAuthHeaders({...credentials,now});
   if(this.generation!==generation)return false;
   const response=await this.fetcher(KALSHI_WS_URL,{
    headers:{...headers,Upgrade:'websocket'}});
   if(this.generation!==generation){try{response.webSocket?.close()}catch{}return false}
   if(response.status!==101||!response.webSocket){
    this.disconnect('CF_CONNECT_ERROR',now,response.status);return false;
   }
   const ws=response.webSocket;
   ws.addEventListener('message',e=>this.handleMessage(e.data,Date.now(),ws));
   ws.addEventListener('error',()=>{if(this.socket===ws)this.disconnect('CF_CONNECT_ERROR')});
   ws.addEventListener('close',()=>{if(this.socket===ws)this.disconnect('CF_CONNECT_ERROR')});
   ws.accept();
   this.socket=ws;this.connectedAt=now;this.lastMessageAt=now;
   this.lastFailure=null;this.failures=0;this.lastConnectAt=now;
   ws.send(JSON.stringify({id:1,cmd:'subscribe',
    params:{channels:['cfbenchmarks_value'],index_ids:['ETHUSD_RTI']}}));
   ws.send(JSON.stringify({id:2,cmd:'subscribe',
    params:{channels:['trade'],market_tickers:[ticker]}}));
   this.event('RESEARCH_STREAM_CONNECTED');
   return true;
  }catch(e){
   if(this.generation===generation){
    this.lastFailure=classifyWebSocketUpgradeException(e);
    this.disconnect('CF_CONNECT_ERROR',now);
   }
   return false;
  }finally{if(this.generation===generation)this.connecting=false}
 }
 handleMessage(raw,receivedAt=Date.now(),socket=this.socket){
  if(socket!==this.socket||typeof raw!=='string'||raw.length>65536)return;
  let p;try{p=JSON.parse(raw)}catch{this.event('CF_PARSE_ERROR');return}
  this.lastMessageAt=receivedAt;
  if(p?.type==='error'){
   if(p.id===2)this.event('TRADE_SUBSCRIPTION_ERROR');
   else this.event('CF_SUBSCRIPTION_ERROR');
   return;
  }
  if(p?.type==='subscribed'){
   if(Number.isSafeInteger(p.sid)&&p.sid>0){
    if(p.id===1)this.sids.set(p.sid,'cf');
    else if(p.id===2)this.sids.set(p.sid,'trade');
   }
   return;
  }
  if(p?.type==='cfbenchmarks_value_indexlist'){
   this.indexAvailable=Array.isArray(p.msg?.index_ids)&&
    p.msg.index_ids.includes('ETHUSD_RTI')?'AVAILABLE':'NOT_LISTED';
   return;
  }
  if(!['cfbenchmarks_value','trade'].includes(p?.type))return;
  const kind=p.type==='trade'?'trade':'cf';
  if(Number.isSafeInteger(p.sid)&&this.sids.has(p.sid)&&this.sids.get(p.sid)!==kind){
   this.event(kind==='trade'?'TRADE_PARSE_ERROR':'CF_PARSE_ERROR');return;
  }
  const previous=this.seqBySid.get(p.sid);
  if(previous!==undefined&&Number.isSafeInteger(p.seq)&&p.seq!==previous+1)
   this.event(kind==='trade'?'TRADE_GAP':'CF_GAP');
  if(Number.isSafeInteger(p.sid)&&Number.isSafeInteger(p.seq))
   this.seqBySid.set(p.sid,p.seq);
  if(kind==='cf'){
   try{
    const value=parseCFValueFrame(p,receivedAt);
    this.lastCFAt=receivedAt;
    try{this.onCF(value)}catch{this.event('CF_WRITE_FAILED')}
   }catch{this.event('CF_PARSE_ERROR')}
  }else{
   try{
    const value=parsePublicTradeFrame(p,receivedAt,this.ticker);
    this.lastTradeAt=receivedAt;
    try{this.onTrade(value)}catch{this.event('TRADE_WRITE_FAILED')}
   }catch{this.event('TRADE_PARSE_ERROR')}
  }
 }
}
