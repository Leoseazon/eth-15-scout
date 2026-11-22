/*
 * V4 read-only authenticated Kalshi WebSocket transport.
 * Connected only to the isolated V4 Durable Object, never to V3 paper trading.
 * Cloudflare outbound WebSocket via fetch(https, {Upgrade:'websocket', headers}).
 * Dedicated Kalshi READ-SCOPE-ONLY key is required; no trading/write scopes.
 */
import {KalshiBookStream,subscribeOrderbook,requestSnapshot} from './kalshi-orderbook.js';
// Kalshi officially documents both production hosts. No arbitrary host input.
export const KALSHI_WS_URL='https://external-api-ws.kalshi.com/trade-api/ws/v2';
export const KALSHI_COMPAT_WS_URL='https://api.elections.kalshi.com/trade-api/ws/v2';
const KALSHI_WS_ENDPOINTS=Object.freeze([KALSHI_WS_URL,KALSHI_COMPAT_WS_URL]);
export function classifyNetworkException(err){
  // This function inspects exceptions locally but persists ONLY fixed labels.
  // Never record raw error messages, causes, stack traces, headers or responses.
  const name=typeof err?.name==='string'?err.name:'';
  const description=typeof err?.message==='string'?err.message.toLowerCase():'';
  if(name==='AbortError'||/timed? ?out|timeout/.test(description))return 'NETWORK_TIMEOUT';
  if(/dns|enotfound|eai_again|name resolution/.test(description))return 'NETWORK_DNS_FAILED';
  if(/tls|ssl|certificate|cert_/.test(description))return 'NETWORK_TLS_FAILED';
  if(/network connection lost|connection reset|econnreset|unexpected eof/.test(description))
    return 'NETWORK_CONNECTION_LOST';
  if(/fetch failed|connection refused|econnrefused/.test(description))
    return 'NETWORK_FETCH_REJECTED';
  return 'NETWORK_CONNECT_FAILED';
}
// A second, WebSocket-specific diagnostic stage. Inspect exception text only
// in memory, mapping to fixed labels. Never store .message, .cause, or stack.
// Conservative: unrecognized conditions remain NETWORK_CONNECT_FAILED.
export function classifyWebSocketUpgradeException(err){
 const base=classifyNetworkException(err);
 if(base!=='NETWORK_CONNECT_FAILED')return base;
 const raw=typeof err?.message==='string'?err.message.toLowerCase().slice(0,2000):'';
 const cause=typeof err?.cause?.code==='string'?err.cause.code.toUpperCase():'';
 if(['ENOTFOUND','EAI_AGAIN'].includes(cause))return 'NETWORK_DNS_FAILED';
 if(['ETIMEDOUT','ESOCKETTIMEDOUT'].includes(cause))return 'NETWORK_TIMEOUT';
 if(['ECONNRESET','EPIPE'].includes(cause))return 'NETWORK_CONNECTION_LOST';
 if(['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH'].includes(cause))
  return 'NETWORK_FETCH_REJECTED';
 if(/unsupported (?:url )?scheme|unsupported protocol|invalid url scheme/.test(raw))
  return 'WS_SCHEME_REJECTED';
 if(/invalid.*(?:upgrade|header)|(?:upgrade|header).*not (?:allowed|supported)|forbidden.*header/.test(raw))
  return 'WS_UPGRADE_HEADER_REJECTED';
 if(/websocket.*(?:not supported|unsupported|upgrade rejected)|(?:websocket|upgrade).*not implemented/.test(raw))
  return 'WS_UPGRADE_RUNTIME_UNSUPPORTED';
 if(/(?:subrequest|outbound request).*(?:limit|exceeded)/.test(raw))
  return 'WS_WORKER_SUBREQUEST_LIMIT';
 if(/(?:egress|outbound|connection).*(?:blocked|prohibited|denied|not permitted)/.test(raw))
  return 'NETWORK_EGRESS_BLOCKED';
 return 'NETWORK_CONNECT_FAILED';
}
function shouldSwitchHost(reason){
  return /^NETWORK_/.test(reason)||
    ['HANDSHAKE_HTTP_502','HANDSHAKE_HTTP_503','HANDSHAKE_HTTP_504'].includes(reason);
}
export const KALSHI_SIGN_PATH='/trade-api/ws/v2';
export const KALSHI_READONLY_REST_PATH='/trade-api/v2/portfolio/balance';
const TICKER=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const enc=new TextEncoder();
// Error reason codes are safe for the private V4 audit database. Never persist
// credentials, signatures, response bodies or raw exception messages.
const authError=code=>Object.assign(new Error(code),{kalshiCode:code});
function base64(bytes){
  let s='';for(let i=0;i<bytes.length;i+=8192)
    s+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(s);
}
async function signedReadHeaders({keyId,privatePem,now,subtle,signPath}){
  if(signPath!==KALSHI_SIGN_PATH&&signPath!==KALSHI_READONLY_REST_PATH)
    throw authError('AUTH_PATH_NOT_ALLOWLISTED');
  if(typeof keyId!=='string'||!keyId.trim()||keyId.trim().length>200||
    typeof privatePem!=='string'||!Number.isSafeInteger(now)||now<=0)
    throw authError('CREDENTIALS_MISSING_OR_INVALID');
  if(!/^-----BEGIN PRIVATE KEY-----/.test(privatePem.trim())||
     !/-----END PRIVATE KEY-----$/.test(privatePem.trim()))
    throw authError('KEY_PEM_BOUNDARIES_INVALID');
  const pem=privatePem.trim().replace(/\r/g,'');
  const body=pem.replace(/^-----BEGIN PRIVATE KEY-----\s*/,'').replace(/\s*-----END PRIVATE KEY-----$/,'').replace(/\s+/g,'');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(body)||body.length>16384)
    throw authError('KEY_PEM_BASE64_INVALID');
  // Kalshi recommends Ed25519 PKCS#8; self-generated RSA PKCS#8 also works.
  // Kalshi-issued RSA PKCS#1 keys must be converted to PKCS#8 offline.
  // No persistent key cache and no secret logging.
  let binary;
  try{binary=Uint8Array.from(atob(body),c=>c.charCodeAt(0))}
  catch{throw authError('KEY_PEM_BASE64_INVALID')}
  let key,method;
  try{
    key=await subtle.importKey('pkcs8',binary.buffer,{name:'Ed25519'},false,['sign']);
    method={name:'Ed25519'};
  }catch{
    try{
      key=await subtle.importKey('pkcs8',binary.buffer,{name:'RSA-PSS',hash:'SHA-256'},false,['sign']);
      method={name:'RSA-PSS',saltLength:32};
    }catch{throw authError('KEY_IMPORT_FAILED')}
  }
  const timestamp=String(now);
  let signature;
  try{signature=new Uint8Array(await subtle.sign(method,
    key,enc.encode(timestamp+'GET'+signPath)))}
  catch{throw authError('KEY_SIGNING_FAILED')}
  return {'KALSHI-ACCESS-KEY':keyId.trim(),
    'KALSHI-ACCESS-SIGNATURE':base64(signature),
    'KALSHI-ACCESS-TIMESTAMP':timestamp};
}
export async function wsAuthHeaders({keyId,privatePem,now=Date.now(),subtle=crypto.subtle}){
  return signedReadHeaders({keyId,privatePem,now,subtle,signPath:KALSHI_SIGN_PATH});
}
export async function readonlyRestAuthHeaders({keyId,privatePem,now=Date.now(),subtle=crypto.subtle}){
  // Dedicated read-only endpoint with no body parsing, trading or transfers.
  return signedReadHeaders({keyId,privatePem,now,subtle,signPath:KALSHI_READONLY_REST_PATH});
}
export class KalshiReadOnlySocket {
  constructor({fetcher=fetch,onObservation=()=>{},onFault=()=>{}}={}){
    this.fetcher=fetcher;this.onObservation=onObservation;this.onFault=onFault;
    this.book=new KalshiBookStream();this.socket=null;this.ticker=null;
    this.lastMessageAt=null;this.lastSubscriptionAt=null;
    this.attempts=0;this.retryAfter=0;this.commandId=1;
    this.connecting=false;this.resyncAt=0;this.lastFailure=null;this.generation=0;
    this.endpointIndex=0;this.endpointFailureStreak=0;
    this.lastNetworkDiagnostic='NONE';
    this.lastAttemptEndpoint=null;this.lastHttpStatus=null;
  }
  fault(reason,at=Date.now()){
    this.book.invalidate(reason);
    this.lastFailure=reason;
    try{this.onFault(reason)}catch{}
  }
  socketClosed(reason,at=Date.now()){
    this.book.disconnected();this.socket=null;this.lastFailure=reason;
    this.lastNetworkDiagnostic=reason;
    this.attempts++;
    // Kalshi's 429 is either a connection cap or a reconnect-rate limit.
    // Never route around an auth refusal or rate limit by switching hosts.
    const delay=Math.min(60000,1000*2**Math.min(this.attempts,6));
    this.retryAfter=at+Math.max(reason==='HANDSHAKE_HTTP_429'?120000:0,delay);
    try{this.onFault(reason)}catch{}
    if(shouldSwitchHost(reason)){
      this.endpointFailureStreak++;
      if(this.endpointFailureStreak>=2){
        this.endpointFailureStreak=0;
        this.endpointIndex=(this.endpointIndex+1)%KALSHI_WS_ENDPOINTS.length;
        // A fixed enum, never a dynamic or secret-bearing endpoint string.
        try{this.onFault(this.endpointIndex===1?
          'WS_FALLBACK_COMPAT_SELECTED':'WS_FALLBACK_PRIMARY_SELECTED')}catch{}
      }
    }else this.endpointFailureStreak=0;
  }
  stop(){
    this.generation++;this.connecting=false;
    const ws=this.socket;this.socket=null;this.book.disconnected();this.ticker=null;
    this.retryAfter=0;this.attempts=0;this.resyncAt=0;
    this.endpointFailureStreak=0;
    try{ws?.close(1000,'V4 shadow stream stopped')}catch{}
  }
  status(now=Date.now()){
    return {connected:!!this.socket&&this.socket.readyState===1,
      targetTicker:this.ticker,attempts:this.attempts,retryAfter:this.retryAfter,
      lastMessageAt:this.lastMessageAt,lastFailure:this.lastFailure,
      lastNetworkDiagnostic:this.lastNetworkDiagnostic,
      endpoint:this.endpointIndex===0?'PRIMARY':'COMPAT',
      lastAttemptEndpoint:this.lastAttemptEndpoint,
      lastHttpStatus:this.lastHttpStatus,
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
    const generation=++this.generation;
    let stage='AUTH_SIGNING';
    try{
      const headers=await wsAuthHeaders({...credentials,now:at});
      if(this.generation!==generation)return false; // Stopped or switched while signing.
      stage='NETWORK_CONNECT';
      const endpoint=KALSHI_WS_ENDPOINTS[this.endpointIndex];
      this.lastAttemptEndpoint=this.endpointIndex===0?'PRIMARY':'COMPAT';
      this.lastHttpStatus=null;
      const fetcher=this.fetcher;
      const response=await fetcher(endpoint,{headers:{...headers,Upgrade:'websocket'}});
      if(this.generation!==generation){
        try{response.webSocket?.accept();response.webSocket?.close(1000,'V4 cancelled')}catch{}
        return false;
      }
      if(response.status!==101){
        const status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?
          response.status:'UNKNOWN';
        this.lastHttpStatus=status;
        this.socketClosed('HANDSHAKE_HTTP_'+status,at);
        return false;
      }
      if(!response.webSocket){this.socketClosed('UPGRADE_SOCKET_MISSING',at);return false;}
      stage='SOCKET_SETUP';
      const ws=response.webSocket;
      const owner=this;
      ws.addEventListener('message',event=>owner.handleMessage(event.data,Date.now(),ws));
      ws.addEventListener('close',()=>{if(owner.socket===ws)owner.socketClosed('SOCKET_CLOSED')});
      ws.addEventListener('error',()=>{if(owner.socket===ws){
        owner.socketClosed('SOCKET_ERROR');try{ws.close()}catch{} }});
      ws.accept();
      this.socket=ws;this.book=new KalshiBookStream();
      this.commandId=1;this.lastMessageAt=at;this.resyncAt=0;
      stage='SUBSCRIPTION_SEND';
      ws.send(JSON.stringify(subscribeOrderbook(ticker,this.commandId++)));
      this.lastSubscriptionAt=at;
      this.lastFailure=null;
      return true;
    }catch(err){
      // No raw error.message, Kalshi response body or credential in storage.
      const code=typeof err?.kalshiCode==='string'?err.kalshiCode:
        stage==='NETWORK_CONNECT'?classifyWebSocketUpgradeException(err):
        stage==='SOCKET_SETUP'?'SOCKET_SETUP_FAILED':
        stage==='SUBSCRIPTION_SEND'?'SUBSCRIPTION_SEND_FAILED':
        'AUTH_SIGNING_FAILED';
      if(this.generation===generation)this.socketClosed(code,at);
      return false;
    }finally{if(this.generation===generation)this.connecting=false;}
  }

  // Called by a future isolated DO scheduler; never declares an old quote current.
  watchdog(at=Date.now(),silentMs=45000){
    if(!Number.isSafeInteger(silentMs)||silentMs<5000)throw new TypeError('Invalid watchdog interval');
    if(!this.socket||this.socket.readyState!==1)return 'NO_CONNECTION';
    if(this.lastMessageAt!==null&&at-this.lastMessageAt>silentMs){
      const ws=this.socket;
      this.socketClosed('STREAM_SILENCE',at);
      try{ws.close(1000,'V4 read-only stream silence')}catch{}
      return 'RECONNECT_REQUIRED';
    }
    const q=this.ticker?this.book.view(this.ticker,at):null;
    if(q&&!q.fresh&&this.book.sid&&at-this.resyncAt>=10000){
      this.resyncAt=at;
      try{
        this.socket.send(JSON.stringify(requestSnapshot(
          this.book.sid,this.ticker,this.commandId++)));
        return 'SNAPSHOT_REQUESTED';
      }catch{
        this.fault('WATCHDOG_RESYNC_FAILED',at);
        return 'RESYNC_FAILED';
      }
    }
    return 'OK';
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
    if(outcome?.gap){
      // Audit every sequence discontinuity, even when the next delta is
      // discarded while waiting for a clean replacement snapshot.
      try{this.onFault('SEQUENCE_GAP')}catch{}
    }
    if(outcome?.accepted){
      if(outcome.snapshot){
        this.attempts=0;this.endpointFailureStreak=0;
      } // Usable snapshot, not handshake, proves recovery.
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
