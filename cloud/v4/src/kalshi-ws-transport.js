/*
 * V4 Gate 2B: read-only authenticated Kalshi WebSocket transport prototype.
 * NOT connected to running Worker; requires separate deployment review.
 * Cloudflare outbound WebSocket via fetch(https, {Upgrade:'websocket', headers}).
 * Dedicated Kalshi READ-SCOPE-ONLY key is required; no trading/write scopes.
 */
import {KalshiBookStream,subscribeOrderbook,requestSnapshot} from './kalshi-orderbook.js';
export const KALSHI_WS_URL='https://external-api-ws.kalshi.com/trade-api/ws/v2';
export const KALSHI_SIGN_PATH='/trade-api/ws/v2';
const TICKER=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const enc=new TextEncoder();
function base64(bytes){
  let s='';for(let i=0;i<bytes.length;i+=8192)
    s+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(s);
}
export async function wsAuthHeaders({keyId,privatePem,now=Date.now(),subtle=crypto.subtle}){
  if(typeof keyId!=='string'||!keyId.trim()||keyId.length>200||
    typeof privatePem!=='string'||!/^-----BEGIN PRIVATE KEY-----/.test(privatePem.trim())||
    !Number.isSafeInteger(now)||now<=0)throw new TypeError('Missing or invalid Kalshi WebSocket credentials');
  const pem=privatePem.trim().replace(/\r/g,'');
  const body=pem.replace(/^-----BEGIN PRIVATE KEY-----\s*/,'').replace(/\s*-----END PRIVATE KEY-----$/,'').replace(/\s+/g,'');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(body)||body.length>16384)
    throw new TypeError('Invalid PKCS8 private key envelope');
  // Kalshi recommends Ed25519 PKCS#8; self-generated RSA PKCS#8 also works.
  // Kalshi-issued RSA PKCS#1 keys must be converted to PKCS#8 offline.
  // No persistent key cache and no secret logging.
  const binary=Uint8Array.from(atob(body),c=>c.charCodeAt(0));
  let key,method;
  try{
    key=await subtle.importKey('pkcs8',binary.buffer,{name:'Ed25519'},false,['sign']);
    method={name:'Ed25519'};
  }catch{
    key=await subtle.importKey('pkcs8',binary.buffer,{name:'RSA-PSS',hash:'SHA-256'},false,['sign']);
    method={name:'RSA-PSS',saltLength:32};
  }
  const timestamp=String(now);
  const signature=new Uint8Array(await subtle.sign(method,
    key,enc.encode(timestamp+'GET'+KALSHI_SIGN_PATH)));
  return {'KALSHI-ACCESS-KEY':keyId,
    'KALSHI-ACCESS-SIGNATURE':base64(signature),
    'KALSHI-ACCESS-TIMESTAMP':timestamp};
}
export class KalshiReadOnlySocket {
  constructor({fetcher=fetch,onObservation=()=>{},onFault=()=>{}}={}){
    this.fetcher=fetcher;this.onObservation=onObservation;this.onFault=onFault;
    this.book=new KalshiBookStream();this.socket=null;this.ticker=null;
    this.lastMessageAt=null;this.lastSubscriptionAt=null;
    this.attempts=0;this.retryAfter=0;this.commandId=1;
    this.connecting=false;this.resyncAt=0;this.lastFailure=null;
  }
  fault(reason,at=Date.now()){
    this.book.invalidate(reason);
    this.lastFailure=reason;
    try{this.onFault(reason)}catch{}
  }
  socketClosed(reason,at=Date.now()){
    this.book.disconnected();this.socket=null;this.lastFailure=reason;
    this.attempts++;
    this.retryAfter=at+Math.min(60000,1000*2**Math.min(this.attempts,6));
    try{this.onFault(reason)}catch{}
  }
  stop(){
    const ws=this.socket;this.socket=null;this.book.disconnected();this.ticker=null;
    this.retryAfter=0;this.attempts=0;
    try{ws?.close(1000,'V4 shadow stream stopped')}catch{}
  }
  status(now=Date.now()){
    return {connected:!!this.socket&&this.socket.readyState===1,
      targetTicker:this.ticker,attempts:this.attempts,retryAfter:this.retryAfter,
      lastMessageAt:this.lastMessageAt,lastFailure:this.lastFailure,
      needResync:this.book.needsResync,sequenceGaps:this.book.gaps,
      quote:this.ticker?this.book.view(this.ticker,now):null,
      source:'Authenticated Kalshi WebSocket; read-only observations'};
  }
  async ensure(ticker,credentials,at=Date.now()){
    if(!TICKER.test(ticker||''))throw new TypeError('Invalid streaming ticker');
    if(this.ticker&&this.ticker!==ticker)this.stop(); // New 15m contract: fresh subscription.
    if(this.socket?.readyState===1||this.connecting)return false;
    if(at<this.retryAfter)return false;
    this.connecting=true;this.ticker=ticker;
    try{
      const headers=await wsAuthHeaders({...credentials,now:at});
      const response=await this.fetcher(KALSHI_WS_URL,{headers:{...headers,Upgrade:'websocket'}});
      if(response.status!==101||!response.webSocket)
        throw new Error('Kalshi WebSocket handshake failed (HTTP '+response.status+')');
      const ws=response.webSocket;
      const owner=this;
      ws.addEventListener('message',event=>owner.handleMessage(event.data,Date.now(),ws));
      ws.addEventListener('close',()=>{if(owner.socket===ws)owner.socketClosed('SOCKET_CLOSED')});
      ws.addEventListener('error',()=>{if(owner.socket===ws){
        owner.socketClosed('SOCKET_ERROR');try{ws.close()}catch{} }});
      ws.accept();
      this.socket=ws;this.book=new KalshiBookStream();
      this.commandId=1;this.lastMessageAt=at;
      ws.send(JSON.stringify(subscribeOrderbook(ticker,this.commandId++)));
      this.lastSubscriptionAt=at;
      this.lastFailure=null;
      return true;
    }catch(err){
      this.socketClosed('HANDSHAKE_OR_AUTH_FAILURE',at);
      return false;
    }finally{this.connecting=false;}
  }
  handleMessage(raw,receivedAt=Date.now(),fromSocket=this.socket){
    if(fromSocket!==this.socket)return; // stale socket callbacks must not mutate new books.
    if(typeof raw!=='string'||raw.length>65536){this.fault('OVERSIZE_OR_NON_TEXT_FRAME',receivedAt);return;}
    let packet;
    try{packet=JSON.parse(raw);}catch{this.fault('INVALID_JSON_FRAME',receivedAt);return;}
    this.lastMessageAt=receivedAt;
    if(packet?.type==='error'||packet?.type==='unsubscribed'){
      this.fault('KALSHI_SUBSCRIPTION_ERROR',receivedAt);return;
    }
    if(!['orderbook_snapshot','orderbook_delta'].includes(packet?.type))return;
    if(packet.msg?.market_ticker!==this.ticker){
      this.fault('UNEXPECTED_MARKET_TICKER',receivedAt);return;
    }
    let outcome;
    try{outcome=this.book.apply(packet,receivedAt)}
    catch{this.fault('INVALID_BOOK_FRAME',receivedAt);return;}
    if(outcome?.accepted){
      if(outcome.snapshot)this.attempts=0; // A usable snapshot, not just a handshake, proves recovery.
      try{this.onObservation({result:outcome,quote:this.book.view(this.ticker,receivedAt),
        type:packet.type,receivedAt})}catch{this.fault('OBSERVATION_HANDLER_FAILURE',receivedAt)}
    }
    if(outcome?.resync && !outcome.snapshot){
      // Demand a fresh snapshot; repeated subscribe does NOT re-snapshot.
      if(receivedAt-this.resyncAt>=1000&&this.book.sid){
        this.resyncAt=receivedAt;
        try{this.socket.send(JSON.stringify(requestSnapshot(
          this.book.sid,this.ticker,this.commandId++)));}
        catch{this.fault('RESYNC_SEND_FAILED',receivedAt);}
      }
    }
  }
}
