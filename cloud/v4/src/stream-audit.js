/* V4-only read-only Kalshi streaming evidence.
 * Persistence is append-only; source timestamps are NOT substitute for fills.
 * Uses stable SQLite ID cursors, not OFFSET pagination over a growing log.
 */
const ETH=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const MAX_EVENT=120;
const ms=v=>Number.isSafeInteger(v)&&v>0?v:null;
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const str=(v,max=MAX_EVENT)=>typeof v==='string'?v.slice(0,max):null;
const level=v=>(v&&Number.isFinite(v.price)&&typeof v.sizeFp==='string'&&
  /^\d{1,15}(?:\.\d{1,2})?$/.test(v.sizeFp))?
  {price:v.price,sizeFp:v.sizeFp}:null;
export function ensureStreamAudit(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS v4_stream_samples ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL,'+
  'received_at INTEGER NOT NULL,source TEXT NOT NULL,'+
  'stream_seq INTEGER,valid INTEGER NOT NULL,payload TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_v4_stream_ticker_id ON v4_stream_samples(ticker,id DESC);'+
  'CREATE TABLE IF NOT EXISTS v4_stream_events ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,'+
  'ticker TEXT,kind TEXT NOT NULL,detail TEXT NOT NULL);');
}
export function appendStreamSample(sql,{quote,at=Date.now(),kind='delta'}){
 if(!ETH.test(quote?.ticker||'')||quote.source!=='KALSHI_WEBSOCKET_ORDERBOOK'||
  !ms(at)||!['snapshot','delta','recovery'].includes(kind))
   throw new TypeError('Invalid V4 stream sample');
 const sample={schemaVersion:1,source:quote.source,ticker:quote.ticker,
  observedAt:at,kind,sid:Number.isSafeInteger(quote.sid)?quote.sid:null,
  seq:Number.isSafeInteger(quote.seq)?quote.seq:null,
  clock:Number.isSafeInteger(quote.clock)?quote.clock:null,
  receivedAt:ms(quote.receivedAt),sendingAt:ms(quote.sendingAt),
  exchangeEventAt:ms(quote.exchangeEventAt),
  receiveAgeMs:n(quote.receiveAgeMs),eventAgeMs:n(quote.eventAgeMs),
  sendAgeMs:n(quote.sendAgeMs),valid:quote.valid===true,
  fresh:quote.fresh===true,reason:str(quote.reason,80),
  yesBid:level(quote.yesBid),yesAsk:level(quote.yesAsk),
  noBid:level(quote.noBid),noAsk:level(quote.noAsk),
  crossed:quote.crossed===true};
 sql.exec('INSERT INTO v4_stream_samples(ticker,received_at,source,stream_seq,valid,payload) VALUES(?,?,?,?,?,?)',
  sample.ticker,at,sample.source,sample.seq,sample.valid?1:0,
  JSON.stringify(sample));
 return sample;
}
export function appendStreamEvent(sql,{kind,ticker=null,at=Date.now(),detail='' }){
 const name=str(kind,60);
 if(!ms(at)||!name||!/^[A-Z][A-Z0-9_]{1,59}$/.test(name)||
  (ticker!==null&&!ETH.test(ticker)))
  throw new TypeError('Invalid stream event');
 const safeDetail=str(detail,MAX_EVENT)||'';
 sql.exec('INSERT INTO v4_stream_events(at,ticker,kind,detail) VALUES(?,?,?,?)',
  at,ticker,name,safeDetail);
 return {at,ticker,kind:name,detail:safeDetail};
}
const cursor=n=>n===null||(Number.isSafeInteger(n)&&n>=0);
export function streamPage(sql,{ticker=null,anchor=null,before=null,limit=100}={}){
 if(ticker!==null&&!ETH.test(ticker)||!cursor(anchor)||!cursor(before)||
  !Number.isInteger(limit)||limit<1||limit>100)
  throw new RangeError('Invalid stream archive query');
 // The anchor is a fixed database high-water ID across all tickers.
 const high=anchor??sql.exec('SELECT COALESCE(MAX(id),0) n FROM v4_stream_samples').toArray()[0]?.n??0;
 const where=(ticker?'ticker=? AND ':'')+'id<=?'+(before!==null?' AND id<?':'');
 const args=[...(ticker?[ticker]:[]),high,...(before!==null?[before]:[])];
 const rows=sql.exec('SELECT id,payload FROM v4_stream_samples WHERE '+where+
  ' ORDER BY id DESC LIMIT ?',...args,limit).toArray();
 const total=sql.exec('SELECT count(*) n FROM v4_stream_samples WHERE '+
  (ticker?'ticker=? AND ':'')+'id<=?',...(ticker?[ticker]:[]),high).toArray()[0]?.n??0;
 const items=rows.map(r=>({id:r.id,...JSON.parse(r.payload)}));
 return {paperOnly:true,readOnly:true,source:'Kalshi WebSocket recorded book top',
  anchor:high,before,limit,total:Number(total),items,
  nextBefore:items.length===limit?items.at(-1).id:null};
}
export function latestStreamStatus(sql){
 const result=sql.exec('SELECT id,payload FROM v4_stream_samples ORDER BY id DESC LIMIT 1').toArray()[0];
 const count=sql.exec('SELECT count(*) n FROM v4_stream_samples').toArray()[0]?.n??0;
 return {count:Number(count),latest:result?{id:result.id,...JSON.parse(result.payload)}:null,
  recentEvents:sql.exec('SELECT id,at,ticker,kind,detail FROM v4_stream_events ORDER BY id DESC LIMIT 20').toArray()};
}
