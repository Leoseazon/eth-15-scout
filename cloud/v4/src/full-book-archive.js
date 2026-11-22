/* Optional V4 raw order-book frame research journal.
 * Disabled by default: every accepted depth delta is a durable write,
 * potentially very expensive. This is observational evidence, NOT a fill.
 * The baseline 15-second sampled recorder remains separate and unchanged.
 */
const TICKER=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const price=/^\d{1,2}(?:\.\d{1,4})?$/;
const qty=/^\d{1,15}(?:\.\d{1,2})?$/;
const signedQty=/^-?\d{1,15}(?:\.\d{1,2})?$/;
const ms=n=>Number.isSafeInteger(n)&&n>1000000000000?n:null;
function levels(input){
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>5000)throw TypeError('Too many depth levels');
 const normalized=input.map(level=>{
  if(!Array.isArray(level)||level.length!==2||
    typeof level[0]!=='string'||!price.test(level[0])||
    typeof level[1]!=='string'||!qty.test(level[1]))
   throw TypeError('Malformed book level');
  return level;
 });
 return normalized;
}
export function sanitizeFullBookFrame(packet,receivedAt){
 const p=packet,m=p?.msg;
 if(!['orderbook_snapshot','orderbook_delta'].includes(p?.type)||
  !TICKER.test(m?.market_ticker||'')||ms(receivedAt)===null||
  !Number.isSafeInteger(p.seq)||p.seq<1||
  !Number.isSafeInteger(p.sid)||p.sid<1)
  throw TypeError('Invalid raw book envelope');
 const sourceEventAt=ms(m.ts_ms),sendingAt=ms(p.sending_ts_ms);
 const base={schemaVersion:1,source:'KALSHI_WEBSOCKET_BOOK_RAW_FRAME',
  ticker:m.market_ticker,kind:p.type,receivedAt,sourceEventAt,
  sendingAt,sid:p.sid,seq:p.seq,clock:Number.isSafeInteger(m.clock)?m.clock:null};
 if(p.type==='orderbook_snapshot'){
  base.yesDollarsFp=levels(m.yes_dollars_fp);
  base.noDollarsFp=levels(m.no_dollars_fp);
 }else{
  if(!['yes','no'].includes(m.side)||typeof m.price_dollars!=='string'||
   !price.test(m.price_dollars)||typeof m.delta_fp!=='string'||
   !signedQty.test(m.delta_fp))throw TypeError('Invalid delta');
  base.side=m.side;base.priceDollars=m.price_dollars;base.deltaFp=m.delta_fp;
 }
 if(JSON.stringify(base).length>65000)throw TypeError('Frame exceeds archived bounds');
 return base;
}
export function ensureFullBookArchive(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS v4_book_frames ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL,'+
  'received_at INTEGER NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_v4_book_frames_ticker_id ON v4_book_frames(ticker,id DESC);');
}
export function appendFullBookFrame(sql,packet,receivedAt){
 const frame=sanitizeFullBookFrame(packet,receivedAt);
 sql.exec('INSERT INTO v4_book_frames(ticker,received_at,seq,kind,payload) VALUES(?,?,?,?,?)',
  frame.ticker,frame.receivedAt,frame.seq,frame.kind,JSON.stringify(frame));
 return frame;
}
export function fullBookArchiveStatus(sql){
 const result=sql.exec('SELECT COUNT(*) AS count,MAX(received_at) AS lastAt FROM v4_book_frames').toArray()[0];
 return {source:'OPTIONAL_V4_WEBSOCKET_RAW_BOOK_FRAMES',
  total:Number(result?.count||0),lastAt:result?.lastAt||null,
  tradesOrFillsVerified:false,exhaustiveHistoryVerified:false};
}
export function fullBookArchivePage(sql,{ticker=null,anchor=null,before=null,limit=40}={}){
 if((ticker!==null&&!TICKER.test(ticker))||
  !Number.isInteger(limit)||limit<1||limit>100||
  (anchor!==null&&(!Number.isSafeInteger(anchor)||anchor<0))||
  (before!==null&&(!Number.isSafeInteger(before)||before<0)))
  throw TypeError('Invalid raw book page');
 const top=anchor??Number(sql.exec('SELECT COALESCE(MAX(id),0) n FROM v4_book_frames').toArray()[0].n);
 const filter=ticker?'ticker=? AND ':'';
 const args=[...(ticker?[ticker]:[]),top];
 const rows=sql.exec('SELECT id,payload FROM v4_book_frames WHERE '+filter+'id<=?'+
  (before!==null?' AND id<?':'')+' ORDER BY id DESC LIMIT ?',
  ...args,...(before!==null?[before]:[]),limit).toArray();
 return {paperOnly:true,readOnly:true,source:'KALSHI_WEBSOCKET_BOOK_RAW_FRAME',
  anchor:top,before,limit,items:rows.map(x=>({id:x.id,...JSON.parse(x.payload)})),
  nextBefore:rows.length===limit?rows.at(-1).id:null};
}
