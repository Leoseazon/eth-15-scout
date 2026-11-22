/* Isolated V4 read-only research sources. Never authorize an order or paper fill.
 * CF Benchmarks schema: https://docs.kalshi.com/websockets/cfbenchmarks-value
 * Public trades: https://docs.kalshi.com/websockets/public-trades
 * All clocks are integer UNIX milliseconds; never infer missing timestamps.
 */
const ETH='ETHUSD_RTI';
const TICKER=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const ms=n=>Number.isSafeInteger(n)&&n>1000000000000?n:null;
const dec=(s,max=10000000)=>{
 if(typeof s!=='string'||!/^[0-9]{1,12}(?:\.[0-9]{1,12})?$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)&&n>0&&n<=max?n:null;
};
const count=s=>dec(s,1000000000);
const seq=p=>Number.isSafeInteger(p?.seq)&&p.seq>=0?p.seq:null;
const sid=p=>Number.isSafeInteger(p?.sid)&&p.sid>0?p.sid:null;
function avg(v){
 if(v==null)return null;
 if(!v||typeof v!=='object'||Array.isArray(v)||dec(v.value)===null||
  !Number.isSafeInteger(v.window_size)||v.window_size<0||v.window_size>1000||
  ms(v.window_start_ts_ms)===null||ms(v.window_end_ts_exclusive)===null||
  v.window_start_ts_ms>=v.window_end_ts_exclusive)
  throw new TypeError('Invalid benchmark window');
 return {value:v.value,sampleCount:v.window_size,
  startAt:v.window_start_ts_ms,endExclusiveAt:v.window_end_ts_exclusive};
}
export function parseCFValueFrame(p,receivedAt){
 if(p?.type!=='cfbenchmarks_value'||p?.msg?.index_id!==ETH||
  ms(receivedAt)===null||ms(p.sending_ts_ms)===null||
  sid(p)===null||seq(p)===null)throw new TypeError('Invalid benchmark frame');
 let raw;
 try{raw=JSON.parse(p.msg.data)}catch{throw new TypeError('Invalid benchmark raw data')}
 if(raw?.id!==ETH||raw?.type!=='value'||ms(raw.time)===null||
  dec(raw.value)===null||ms(p.msg.received_at)===null)
  throw new TypeError('Invalid benchmark source reading');
 if(p.msg.received_at<raw.time-5000||p.sending_ts_ms<raw.time-5000||
  receivedAt<raw.time-5000)
  throw new TypeError('Benchmark clocks inconsistent');
 return {schemaVersion:1,source:'KALSHI_CF_BENCHMARKS_1HZ',indexId:ETH,
  value:raw.value,sourceAt:raw.time,kalshiReceivedAt:p.msg.received_at,
  sendingAt:p.sending_ts_ms,receivedAt,sid:sid(p),seq:seq(p),
  averageTrailing60s:avg(p.msg.avg_60s_data),
  averageFinalMinute:avg(p.msg.last_60s_windowed_average_15min),
  settlementVerified:false,fillVerified:false};
}
export function parsePublicTradeFrame(p,receivedAt,expectedTicker){
 const m=p?.msg;
 if(p?.type!=='trade'||!TICKER.test(expectedTicker||'')||
  m?.market_ticker!==expectedTicker||ms(receivedAt)===null||
  ms(p.sending_ts_ms)===null||sid(p)===null||seq(p)===null||
  typeof m.trade_id!=='string'||m.trade_id.length<8||m.trade_id.length>100||
  !/^[A-Za-z0-9-]+$/.test(m.trade_id)||
  dec(m.yes_price_dollars,1)===null||dec(m.no_price_dollars,1)===null||
  count(m.count_fp)===null||ms(m.ts_ms)===null||
  !['yes','no'].includes(m.taker_side))
  throw new TypeError('Invalid public trade frame');
 if(m.ts_ms>receivedAt+5000||m.ts_ms>p.sending_ts_ms+5000||
  (typeof m.ts==='number'&&Math.abs(m.ts*1000-m.ts_ms)>1000))
  throw new TypeError('Public trade clock inconsistent');
 return {schemaVersion:1,source:'KALSHI_PUBLIC_TRADE_STREAM',
  tradeId:m.trade_id,ticker:expectedTicker,yesPrice:m.yes_price_dollars,
  noPrice:m.no_price_dollars,countFp:m.count_fp,takerSide:m.taker_side,
  takerOutcomeSide:['yes','no'].includes(m.taker_outcome_side)?m.taker_outcome_side:null,
  takerBookSide:['bid','ask'].includes(m.taker_book_side)?m.taker_book_side:null,
  blockTrade:m.is_block_trade===true,sourceAt:m.ts_ms,
  sendingAt:p.sending_ts_ms,receivedAt,sid:sid(p),seq:seq(p),
  fillVerified:false};
}
export function ensureIndependentResearch(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS v4_cf_values ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,index_id TEXT NOT NULL,'+
  'source_at INTEGER NOT NULL,received_at INTEGER NOT NULL,payload TEXT NOT NULL,'+
  'UNIQUE(index_id,source_at));'+
  'CREATE INDEX IF NOT EXISTS idx_v4_cf_time ON v4_cf_values(source_at DESC);'+
  'CREATE TABLE IF NOT EXISTS v4_public_trades ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,trade_id TEXT NOT NULL UNIQUE,'+
  'ticker TEXT NOT NULL,source_at INTEGER NOT NULL,received_at INTEGER NOT NULL,'+
  'payload TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_v4_public_trades_market ON v4_public_trades(ticker,id DESC);'+
  'CREATE TABLE IF NOT EXISTS v4_research_feed_events ('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,'+
  'kind TEXT NOT NULL,detail TEXT NOT NULL);');
}
export function appendCFValue(sql,v){
 if(v?.source!=='KALSHI_CF_BENCHMARKS_1HZ'||v.indexId!==ETH||
  ms(v.sourceAt)===null||ms(v.receivedAt)===null)throw TypeError('Unsafe benchmark archive');
 sql.exec('INSERT OR IGNORE INTO v4_cf_values(index_id,source_at,received_at,payload) VALUES(?,?,?,?)',
  ETH,v.sourceAt,v.receivedAt,JSON.stringify(v));
}
export function appendPublicTrade(sql,v){
 if(v?.source!=='KALSHI_PUBLIC_TRADE_STREAM'||!TICKER.test(v.ticker||'')||
  !/^[A-Za-z0-9-]{8,100}$/.test(v.tradeId||'')||
  ms(v.sourceAt)===null||ms(v.receivedAt)===null)throw TypeError('Unsafe trade archive');
 sql.exec('INSERT OR IGNORE INTO v4_public_trades(trade_id,ticker,source_at,received_at,payload) VALUES(?,?,?,?,?)',
  v.tradeId,v.ticker,v.sourceAt,v.receivedAt,JSON.stringify(v));
}
export function appendResearchFeedEvent(sql,kind,at=Date.now()){
 const permitted=new Set(['CF_CONNECT_ERROR','CF_SUBSCRIPTION_ERROR','CF_GAP','CF_PARSE_ERROR',
  'CF_WRITE_FAILED','TRADE_SUBSCRIPTION_ERROR','TRADE_GAP','TRADE_PARSE_ERROR',
  'TRADE_WRITE_FAILED','RESEARCH_STREAM_CLOSED','RESEARCH_STREAM_CONNECTED',
  'RESEARCH_STREAM_SILENT','RESEARCH_STREAM_CONFIG_MISSING']);
 if(!permitted.has(kind)||ms(at)===null)throw TypeError('Invalid research event');
 sql.exec('INSERT INTO v4_research_feed_events(at,kind,detail) VALUES(?,?,?)',
  at,kind,'V4_RESEARCH_ONLY');
}
export function independentResearchStatus(sql){
 const latest=(table)=>sql.exec('SELECT COUNT(*) AS count,MAX(received_at) AS lastAt FROM '+table).toArray()[0];
 return {benchmark:latest('v4_cf_values'),publicTrades:latest('v4_public_trades'),
  recentEvents:sql.exec('SELECT at,kind FROM v4_research_feed_events ORDER BY id DESC LIMIT 12').toArray(),
  sourcesVerified:false,officialOutcomeReconciled:false,modelCalibrated:false};
}
export function independentResearchPage(sql,{kind,anchor=null,before=null,limit=60,ticker=null}={}){
 if(!['benchmark','trades'].includes(kind)||
  !Number.isInteger(limit)||limit<1||limit>100||
  (anchor!==null&&(!Number.isSafeInteger(anchor)||anchor<0))||
  (before!==null&&(!Number.isSafeInteger(before)||before<0))||
  (ticker!==null&&!TICKER.test(ticker)))throw TypeError('Invalid research page');
 const table=kind==='benchmark'?'v4_cf_values':'v4_public_trades';
 const tickerPredicate=kind==='trades'&&ticker?'ticker=? AND ':'';
 const args=[...(tickerPredicate?[ticker]:[]),anchor??Number(sql.exec('SELECT COALESCE(MAX(id),0) n FROM '+table).toArray()[0].n)];
 const high=args.at(-1);
 const cursorClause=before===null?'':' AND id<?';
 const result=sql.exec('SELECT id,payload FROM '+table+' WHERE '+tickerPredicate+
  'id<=?'+cursorClause+' ORDER BY id DESC LIMIT ?',
  ...args,...(before===null?[]:[before]),limit).toArray();
 const total=sql.exec('SELECT COUNT(*) n FROM '+table+' WHERE '+tickerPredicate+'id<=?',...args).toArray()[0].n;
 return {readOnly:true,paperOnly:true,kind,anchor:high,before,limit,total,
  items:result.map(x=>({id:x.id,...JSON.parse(x.payload)})),
  nextBefore:result.length===limit?result.at(-1).id:null};
}
