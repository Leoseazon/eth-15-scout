/*
 * ETH-15 Scout V4 — Kalshi WebSocket order-book reconstruction.
 * Read-only research. NO orders, P&L, automated execution or live-paper activation.
 * Spec: https://docs.kalshi.com/websockets/orderbook-updates.md
 *
 * Prices: integer ten-thousandths of $1; sizes: integer hundredths of a contract.
 * YES/NO bid levels are independent. Asks are complements of OPPOSITE-side bids.
 * seq is subscription-wide; clock is per-market and NOT a gap detector.
 */
const TICKER=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const MAX_LEVELS=5000;
const MAX_SIZE=9000000000000; // 90 billion contracts represented in hundredths.
export function fixed(value,digits,{negative=false,max=Number.MAX_SAFE_INTEGER}={}){
  if(typeof value!=='string')throw new TypeError('Fixed-point field must be a string');
  const pattern=negative?/^-?\d+(?:\.\d+)?$/:/^\d+(?:\.\d+)?$/;
  if(!pattern.test(value))throw new TypeError('Malformed fixed-point field');
  const sign=value[0]==='-'?-1:1;
  const parts=(sign<0?value.slice(1):value).split('.');
  if((parts[1]||'').length>digits)throw new RangeError('Too many fractional digits');
  const n=Number(parts[0])*10**digits+Number((parts[1]||'').padEnd(digits,'0'));
  if(!Number.isSafeInteger(n)||n>max)throw new RangeError('Fixed-point value out of range');
  return n*sign;
}
function price(v){
  const n=fixed(v,4);
  if(n<=0||n>=10000)throw new RangeError('Non-tradable price level');
  return n;
}
function count(v,allowNegative=false){
  return fixed(v,2,{negative:allowNegative,max:MAX_SIZE});
}
const timestamp=v=>Number.isSafeInteger(v)&&v>0?v:null;
function validateEnvelope(packet,receivedAt){
  if(!packet||!['orderbook_snapshot','orderbook_delta'].includes(packet.type))
    return null;
  if(!Number.isSafeInteger(receivedAt)||receivedAt<=0||
    !Number.isSafeInteger(packet.sid)||packet.sid<1||
    !Number.isSafeInteger(packet.seq)||packet.seq<1||
    !TICKER.test(packet.msg?.market_ticker||'')||
    !Number.isSafeInteger(packet.msg?.clock)||packet.msg.clock<0)
    throw new TypeError('Invalid order-book message envelope');
  const sent=timestamp(packet.sending_ts_ms);
  const event=timestamp(packet.msg.ts_ms);
  return {sent,event,ticker:packet.msg.market_ticker};
}
function parseLevels(levels){
  if(levels===undefined)return new Map(); // An omitted side is a genuinely empty book.
  if(!Array.isArray(levels)||levels.length>MAX_LEVELS)
    throw new TypeError('Invalid snapshot level array');
  const map=new Map();
  for(const pair of levels){
    if(!Array.isArray(pair)||pair.length!==2)throw new TypeError('Invalid price-size pair');
    const p=price(pair[0]),size=count(pair[1]);
    if(size<=0||map.has(p))throw new RangeError('Invalid or repeated price level');
    map.set(p,size);
  }
  return map;
}
function levelList(map){
  return [...map.entries()].sort((a,b)=>b[0]-a[0]);
}
function emptyState(){
  return {valid:false,reason:'NO_SNAPSHOT',yes:new Map(),no:new Map(),
    lastReceivedAt:null,lastEventAt:null,lastSentAt:null,lastSeq:null,clock:null};
}
export class KalshiBookStream {
  constructor(){this.sid=null;this.seq=null;this.books=new Map();
    this.needsResync=false;this.gaps=0;this.lastProblem=null;}
  invalidate(reason){
    for(const b of this.books.values()){b.valid=false;b.reason=reason;}
    this.needsResync=true;this.lastProblem=reason;
  }
  disconnected(){
    this.invalidate('DISCONNECTED');this.sid=null;this.seq=null;
  }
  apply(packet,receivedAt=Date.now()){
    let envelope;
    try{envelope=validateEnvelope(packet,receivedAt)}
    catch{this.invalidate('MALFORMED_ENVELOPE');return {accepted:false,reason:'MALFORMED_ENVELOPE',resync:true};}
    if(!envelope)return {accepted:false,ignored:true};
    const {ticker,event,sent}=envelope;
    if(this.sid!==null&&packet.sid!==this.sid){
      this.invalidate('SUBSCRIPTION_CHANGED');
      this.books.clear();this.seq=null;
    }
    this.sid=packet.sid;
    let gap=false;
    if(this.seq!==null&&packet.seq!==this.seq+1){
      gap=true;this.gaps++;this.invalidate('SEQUENCE_GAP');
    }
    this.seq=packet.seq;
    let state=this.books.get(ticker)||emptyState();
    if(packet.type==='orderbook_delta'&&!state.valid){
      this.books.set(ticker,state);
      return {accepted:false,reason:'SNAPSHOT_REQUIRED',gap,resync:true};
    }
    try{
      if(packet.type==='orderbook_snapshot'){
        // Parse BOTH sides before committing either. Snapshot replaces stale state.
        const yes=parseLevels(packet.msg.yes_dollars_fp);
        const no=parseLevels(packet.msg.no_dollars_fp);
        state={...emptyState(),valid:true,reason:null,yes,no};
      }else{
        if(!['yes','no'].includes(packet.msg.side))throw TypeError('Unknown book side');
        const p=price(packet.msg.price_dollars),delta=count(packet.msg.delta_fp,true);
        const book=packet.msg.side==='yes'?state.yes:state.no;
        const old=book.get(p)||0,next=old+delta;
        if(!Number.isSafeInteger(next)||next<0||next>MAX_SIZE)
          throw new RangeError('Delta would create negative or oversized depth');
        if(next===0)book.delete(p);
        else if(!book.has(p)&&book.size>=MAX_LEVELS)throw RangeError('Too many levels');
        else book.set(p,next);
      }
    }catch(_err){
      state.valid=false;state.reason='MALFORMED_LEVEL';
      this.books.set(ticker,state);
      this.invalidate('MALFORMED_LEVEL');
      return {accepted:false,reason:'MALFORMED_LEVEL',gap,resync:true};
    }
    state.lastReceivedAt=receivedAt;
    state.lastSentAt=sent;
    state.lastEventAt=event; // Snapshot may have NO event timestamp: do not fabricate one.
    state.lastSeq=packet.seq;
    state.clock=packet.msg.clock;
    this.books.set(ticker,state);
    // A gap can be recovered only by snapshot(s) for affected markets.
    this.needsResync=[...this.books.values()].some(b=>!b.valid);
    if(!this.needsResync)this.lastProblem=null;
    return {accepted:true,snapshot:packet.type==='orderbook_snapshot',
      gap,resync:this.needsResync,ticker};
  }
  view(ticker,now=Date.now(),maxAgeMs=5000){
    if(!TICKER.test(ticker||''))throw new TypeError('Invalid ETH15 ticker');
    const s=this.books.get(ticker);
    if(!s)return {ticker,valid:false,fresh:false,reason:'NO_SNAPSHOT',
      source:'KALSHI_WEBSOCKET_ORDERBOOK',yesBid:null,yesAsk:null,noBid:null,noAsk:null};
    const recvAge=s.lastReceivedAt===null?null:now-s.lastReceivedAt;
    const eventAge=s.lastEventAt===null?null:now-s.lastEventAt;
    const sendAge=s.lastSentAt===null?null:now-s.lastSentAt;
    const fresh=!!s.valid&&Number.isFinite(recvAge)&&recvAge>=0&&recvAge<=maxAgeMs
      &&(eventAge===null||(eventAge>=-5000&&eventAge<=maxAgeMs))
      &&(sendAge===null||(sendAge>=-5000&&sendAge<=maxAgeMs));
    const y=levelList(s.yes),n=levelList(s.no);
    const first=levels=>levels.length?levels[0]:null;
    const level=(pair,complement=false)=>pair?Object.freeze({
      price:(complement?10000-pair[0]:pair[0])/10000,
      sizeFp:(pair[1]/100).toFixed(2)
    }):null;
    const yesBid=level(first(y)),noBid=level(first(n));
    const yesAsk=level(first(n),true),noAsk=level(first(y),true);
    // Locked/crossed books may reflect asynchronous updates, not an arbitrage.
    const crossed=!!(yesBid&&yesAsk&&yesBid.price>=yesAsk.price);
    return {ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:!!s.valid,
      fresh:fresh&&!crossed,reason:!s.valid?s.reason:crossed?'LOCKED_OR_CROSSED':
        !fresh?'STALE_OR_UNVERIFIED_TIMESTAMPS':null,
      sid:this.sid,seq:s.lastSeq,clock:s.clock,
      receivedAt:s.lastReceivedAt,exchangeEventAt:s.lastEventAt,
      sendingAt:s.lastSentAt,receiveAgeMs:recvAge,eventAgeMs:eventAge,
      sendAgeMs:sendAge,yesBid,yesAsk,noBid,noAsk,crossed};
  }
  // Research-only cost of walking DISPLAYED liquidity, not a guaranteed fill.
  walk(ticker,{side,action,contracts,now=Date.now(),maxAgeMs=5000}){
    if(!['UP','DOWN'].includes(side)||!['BUY','SELL'].includes(action)||
      !Number.isSafeInteger(contracts)||contracts<1||contracts>10000)
      throw new TypeError('Invalid hypothetical execution');
    const snapshot=this.view(ticker,now,maxAgeMs);
    if(!snapshot.fresh)return {executable:false,reason:snapshot.reason||'UNAVAILABLE'};
    const s=this.books.get(ticker);
    const onYes=(side==='UP')===(action==='SELL');
    const source=levelList(onYes?s.yes:s.no);
    let left=contracts*100,cost=0,available=0;
    for(const [p,size] of source){
      const qty=Math.min(left,size);
      const tradePrice=action==='BUY'?10000-p:p;
      cost+=tradePrice*qty;
      left-=qty;available+=qty;
      if(left===0)break;
    }
    if(left!==0)return {executable:false,reason:'INSUFFICIENT_DISPLAYED_DEPTH',
      availableContracts:available/100,requestedContracts:contracts};
    return {executable:true,source:snapshot.source,action,side,
      contracts,averagePrice:cost/(contracts*100*10000),
      grossDollars:cost/(100*10000),
      note:'Displayed book walk only; fees, queue, latency and slippage not yet modeled'};
  }
}
// Build commands without credentials. Private keys must remain server-side.
export function subscribeOrderbook(ticker,id=1){
  if(!TICKER.test(ticker||'')||!Number.isSafeInteger(id)||id<1)
    throw new TypeError('Invalid subscription request');
  return {id,cmd:'subscribe',params:{channels:['orderbook_delta'],market_tickers:[ticker]}};
}
export function requestSnapshot(sid,ticker,id){
  if(!TICKER.test(ticker||'')||!Number.isSafeInteger(sid)||sid<1||
    !Number.isSafeInteger(id)||id<1)throw new TypeError('Invalid resync request');
  return {id,cmd:'update_subscription',
    params:{sids:[sid],action:'get_snapshot',market_tickers:[ticker]}};
}
