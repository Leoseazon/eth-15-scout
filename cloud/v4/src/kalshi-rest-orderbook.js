/* V4-only Kalshi official REST order-book snapshots.
 * RESEARCH ONLY: REST has no event/sequence timestamps and can be delayed/cached.
 * Never promote these observations to streaming, executable trades, or settlement.
 */
import {fixed} from './kalshi-orderbook.js';
import {classifyNetworkException} from './kalshi-ws-transport.js';

const TICKER=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const BASE='https://external-api.kalshi.com/trade-api/v2/markets/';
const SOURCE='KALSHI_OFFICIAL_REST_ORDERBOOK';
const MAX_DEPTH=20,MAX_TEXT_BYTES=131072;
const positiveTime=v=>Number.isSafeInteger(v)&&v>0;
const safeCursor=v=>v===null||(Number.isSafeInteger(v)&&v>=0);
const safeStatus=status=>Number.isInteger(status)&&status>=100&&status<=599?
  'HTTP_'+status:'HTTP_UNKNOWN';

export function restBookUrl(ticker,depth=MAX_DEPTH){
 if(!TICKER.test(ticker||'')||!Number.isSafeInteger(depth)||depth<1||depth>MAX_DEPTH)
  throw new TypeError('V4 REST market or depth not allowed');
 return BASE+encodeURIComponent(ticker)+'/orderbook?depth='+depth;
}
function parseLadder(levels){
 if(!Array.isArray(levels)||levels.length>MAX_DEPTH)throw TypeError('REST levels invalid');
 let previous=0;
 return levels.map(pair=>{
  if(!Array.isArray(pair)||pair.length!==2)throw TypeError('REST tuple invalid');
  const p=fixed(pair[0],4),size=fixed(pair[1],2);
  if(p<=0||p>=10000||size<=0||p<=previous)
   throw TypeError('REST prices must be strictly ascending; counts positive');
  previous=p;
  // Original fixed-point values preserved without any float reinterpretation.
  return {price:p,sizeFp:(size/100).toFixed(2)};
 });
}
function best(ladder){return ladder.length?ladder.at(-1):null}
function top(levels,complement=false){
 const x=best(levels);
 if(!x)return null;
 return {price:(complement?10000-x.price:x.price)/10000,sizeFp:x.sizeFp};
}
export function parseOfficialRestBook(data,{ticker,requestedAt,receivedAt,depth=MAX_DEPTH}){
 restBookUrl(ticker,depth);
 if(!positiveTime(requestedAt)||!positiveTime(receivedAt)||receivedAt<requestedAt||
    receivedAt-requestedAt>30000)throw TypeError('Invalid REST observation timestamps');
 const book=data?.orderbook_fp;
 if(!book||typeof book!=='object'||Array.isArray(book))throw TypeError('REST book missing');
 const yes=parseLadder(book.yes_dollars),no=parseLadder(book.no_dollars);
 if(yes.length>depth||no.length>depth)throw TypeError('REST book exceeds requested depth');
 const yesBid=top(yes),noBid=top(no),
  yesAsk=top(no,true),noAsk=top(yes,true);
 const lockedOrCrossed=!!(yesBid&&yesAsk&&yesBid.price>=yesAsk.price);
 return Object.freeze({
  schemaVersion:1,ticker,source:SOURCE,
  sourceTrust:'OFFICIAL_REST_SNAPSHOT_RECEIPT_ONLY',
  requestedAt,receivedAt,requestDurationMs:receivedAt-requestedAt,
  // Kalshi's REST response does not identify source event time or sequence.
  exchangeEventAt:null,sequence:null,verifiedExchangeAge:false,
  latestAtTimeOfRequest:false,
  yesLevels:yes.map(x=>[Number((x.price/10000).toFixed(4)).toFixed(4),x.sizeFp]),
  noLevels:no.map(x=>[Number((x.price/10000).toFixed(4)).toFixed(4),x.sizeFp]),
  yesBid,noBid,yesAsk,noAsk,
  empty:yes.length===0&&no.length===0,
  lockedOrCrossed,valid:true,
  eligibleAsFreshStreaming:false,executableFillVerified:false,
  note:'Receipt-time Kalshi REST research snapshot; source age and exchange sequence unknown'
 });
}
export async function fetchOfficialRestBook(ticker,{
 fetcher=fetch,makeSignal=ms=>AbortSignal.timeout(ms),
 timeoutMs=3500,depth=MAX_DEPTH,clock=Date.now
}={}){
 const url=restBookUrl(ticker,depth);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>7000)
  throw RangeError('Invalid V4 REST timeout');
 const requestedAt=clock();
 let response;
 try{
  response=await fetcher(url,{
   method:'GET',headers:{Accept:'application/json'},redirect:'manual',
   signal:makeSignal(timeoutMs),cf:{cacheTtl:0,cacheEverything:false}
  });
 }catch(err){return {ok:false,reason:classifyNetworkException(err),requestedAt}}
 const status=safeStatus(response?.status);
 if(response?.status!==200){
  try{await response.body?.cancel()}catch{}
  return {ok:false,reason:'REST_BOOK_'+status,requestedAt};
 }
 try{
  const head=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(head)&&head>MAX_TEXT_BYTES)
   throw TypeError('REST response too large');
  // No unbounded DB writes. The endpoint has at most twenty bid levels/side.
  const raw=await response.text();
  if(typeof raw!=='string'||raw.length>MAX_TEXT_BYTES)
   throw TypeError('REST response too large');
  const data=JSON.parse(raw);
  const receivedAt=clock();
  const book=parseOfficialRestBook(data,{ticker,requestedAt,receivedAt,depth});
  return {ok:true,book};
 }catch{
  return {ok:false,reason:'REST_BOOK_INVALID_RESPONSE',requestedAt};
 }
}
export function ensureRestBookArchive(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS v4_rest_book_samples ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL,'+
  'received_at INTEGER NOT NULL,source TEXT NOT NULL,payload TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_v4_rest_book_ticker_id ON v4_rest_book_samples(ticker,id DESC);');
}
export function appendRestBookSample(sql,book){
 if(!book||book.source!==SOURCE||book.valid!==true||
    book.eligibleAsFreshStreaming!==false||book.executableFillVerified!==false||
    !TICKER.test(book.ticker||'')||
    !positiveTime(book.requestedAt)||!positiveTime(book.receivedAt)||
    book.receivedAt<book.requestedAt||book.exchangeEventAt!==null||
    book.sequence!==null||!Array.isArray(book.yesLevels)||!Array.isArray(book.noLevels))
  throw TypeError('Not a safe V4 official REST research snapshot');
 sql.exec('INSERT INTO v4_rest_book_samples(ticker,received_at,source,payload) VALUES(?,?,?,?)',
  book.ticker,book.receivedAt,SOURCE,JSON.stringify(book));
 return book;
}
export function restBookPage(sql,{ticker=null,anchor=null,before=null,limit=50}={}){
 if((ticker!==null&&!TICKER.test(ticker))||!safeCursor(anchor)||!safeCursor(before)||
    !Number.isInteger(limit)||limit<1||limit>100)
  throw RangeError('Invalid V4 REST book archive cursor');
 const high=anchor??sql.exec('SELECT COALESCE(MAX(id),0) n FROM v4_rest_book_samples').toArray()[0]?.n??0;
 const where=(ticker?'ticker=? AND ':'')+'id<=?'+(before!==null?' AND id<?':'');
 const args=[...(ticker?[ticker]:[]),high,...(before!==null?[before]:[])];
 const items=sql.exec('SELECT id,payload FROM v4_rest_book_samples WHERE '+
   where+' ORDER BY id DESC LIMIT ?',...args,limit).toArray()
   .map(x=>({id:x.id,...JSON.parse(x.payload)}));
 const total=sql.exec('SELECT count(*) n FROM v4_rest_book_samples WHERE '+
  (ticker?'ticker=? AND ':'')+'id<=?',...(ticker?[ticker]:[]),high).toArray()[0]?.n??0;
 return {paperOnly:true,readOnly:true,source:SOURCE,
  isWebSocket:false,exchangeTimestampAvailable:false,
  anchor:high,before,limit,total:Number(total),items,
  nextBefore:items.length===limit?items.at(-1).id:null};
}
export function latestRestBookStatus(sql){
 const count=sql.exec('SELECT count(*) n FROM v4_rest_book_samples').toArray()[0]?.n??0;
 const last=sql.exec('SELECT id,payload FROM v4_rest_book_samples ORDER BY id DESC LIMIT 1').toArray()[0];
 return {count:Number(count),last:last?{id:last.id,...JSON.parse(last.payload)}:null,
  source:SOURCE,isWebSocket:false,verifiedExchangeAge:false};
}
