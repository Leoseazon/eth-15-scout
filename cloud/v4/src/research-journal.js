/*
 * V4-only append-only research history. NOT official settlement, a trade fill,
 * or a calibrated prediction. One record per monitored engine evaluation.
 * No credentials or raw provider responses are persisted.
 */
const SERIES=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const millis=v=>Number.isSafeInteger(v)&&v>0?v:null;
// Kraken OHLC timestamps are UNIX seconds; research archive times are milliseconds.
// Reject unknown units rather than silently blending seconds and milliseconds.
const candleMs=v=>Number.isSafeInteger(v)&&v>=1000000000&&v<=10000000000?v*1000:null;
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const str=(v,max=180)=>typeof v==='string'?v.slice(0,max):null;
const trend=v=>['UP','DOWN','NEUTRAL','UNKNOWN'].includes(v)?v:null;
const feedKeys=['kalshi','krakenTicker','kraken1m','kraken5m'];
const metricKeys=['last','prev','e8','e8prev','e21','e50','rNow','rPrev',
  'mNow','mPrev','sNow','sPrev','three','sd','rsi','macd','signal',
  'vwap','support','resistance'];
function metrics(input){
 if(!input||typeof input!=='object')return null;
 const out={};for(const k of metricKeys)
  if(Object.prototype.hasOwnProperty.call(input,k))out[k]=num(input[k]);
 return Object.keys(out).length?out:null;
}
function structure(v){return v?{
 trend:trend(v.trend),closedAt:candleMs(v.closedAt),price:num(v.price),
 rsi:num(v.rsi),e8:num(v.e8),e21:num(v.e21),
 support:num(v.support),resistance:num(v.resistance),
 adDelta:num(v.adDelta),bands:v.bands?{
  lower:num(v.bands.lower),mid:num(v.bands.mid),
  upper:num(v.bands.upper),width:num(v.bands.width)}:null
}:null;}
function providerNum(v,max){
 if(v===undefined||v===null||v==='')return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=max?n:null;
}
function stopEvidence(v){
 if(!v||typeof v!=='object')return null;
 const early=v.earlyExitEvidence;
 return {version:str(v.version,55),at:millis(v.at),
  ticker:SERIES.test(v.ticker||'')?v.ticker:null,
  side:['UP','DOWN'].includes(v.side)?v.side:null,
  entry:num(v.entry),bid:num(v.bid),qty:num(v.qty),
  markPnl:num(v.markPnl),usable:v.usable===true,
  armed:v.armed===true,triggered:v.triggered===true,
  thresholdHit:v.thresholdHit===true,
  thresholdBid:num(v.thresholdBid),declinePct:num(v.declinePct),
  wholeSecondsRemaining:num(v.wholeSecondsRemaining),
  cause:str(v.cause,80),executableFillVerified:false,
  oneMinuteChecksPassed:num(v.oneMinuteChecksPassed),
  structureExitConfirmed:v.structureExitConfirmed===true,
  structureExitReason:str(v.structureExitReason,125),
  earlyExitEvidence:early?{
   consecutive:num(early.consecutive),trigger:early.trigger===true,
   lastCandleOpenSeconds:num(early.lastCandleOpenSeconds),
   reason:str(early.reason,80)}:null};
}
function mostRecentExit(s,startedAt,finishedAt){
 const t=Array.isArray(s?.trades)?s.trades.find(x=>
  Number.isSafeInteger(x.exitAt)&&x.exitAt>=startedAt&&x.exitAt<=finishedAt):null;
 if(!t)return null;
 return {ticker:SERIES.test(t.ticker||'')?t.ticker:null,
   side:['UP','DOWN'].includes(t.side)?t.side:null,
   at:t.exitAt,entry:num(t.entry),exitBid:num(t.exitPrice),
   qty:num(t.qty),cost:num(t.cost),netPnl:num(t.pnl),
   reason:str(t.reason,220),feeEstimate:num(t.sellFee),
   officialSettlementVerified:false,source:'V4 simulated displayed bid'}; 
}
function feedStates(checks){
 const out={};
 for(const k of feedKeys){
  const c=checks?.[k];out[k]={
   ok:typeof c?.ok==='boolean'?c.ok:null,
   checkedAt:millis(c?.checkedAt),retrievedAt:millis(c?.retrievedAt),
   ageMs:num(c?.ageMs),reason:str(c?.error||c?.reason,160)
  };
 }
 return out;
}
export function ensureResearchJournal(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS research_ticks('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL UNIQUE,'+
  'finished_at INTEGER NOT NULL,ticker TEXT,close_at INTEGER,'+
  'valid_feeds INTEGER NOT NULL,has_market INTEGER NOT NULL,payload TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_v4_research_ticker_time ON research_ticks(ticker,started_at DESC);'+
  'CREATE TABLE IF NOT EXISTS research_book_samples('+
  'id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL,'+
  'received_at INTEGER NOT NULL,exchange_event_at INTEGER,sending_at INTEGER,'+
  'source TEXT NOT NULL,stream_seq INTEGER,valid INTEGER NOT NULL,payload TEXT NOT NULL);'+
  'CREATE INDEX IF NOT EXISTS idx_v4_research_books_ticker_id ON research_book_samples(ticker,id DESC);');
}
// Sparse, per-engine-tick quote witness for hypothetical exit STUDY ONLY.
 // This records at most the TOP bid on each side, not raw WebSocket frames
 // or a full order book. No quote is relabeled as an executable fill.
export function sampledExitWitness({market,book,index,streamStatus,observedAt}={}){
 const ticker=SERIES.test(market?.ticker||'')?market.ticker:null;
 // A cached quote cannot be called authenticated+live after its socket
 // disconnected, even if its receivedAt timestamp is less than five seconds old.
 const socketReady=streamStatus?.connected===true&&
  streamStatus.targetTicker===ticker;
 const bookReady=socketReady&&!!ticker&&book?.ticker===ticker&&
  book.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&book.valid===true&&
  book.fresh===true&&book.crossed!==true&&millis(book.receivedAt)!==null&&
  Number.isSafeInteger(observedAt)&&book.receivedAt<=observedAt&&
  observedAt-book.receivedAt<=5000;
 const sourceIndexReady=index?.indexId==='ETHUSD_RTI'&&
  index.validValuesVerified===true&&millis(index.sourceAt)!==null&&
  Number.isSafeInteger(observedAt)&&index.sourceAt<=observedAt+3000&&
  observedAt-index.sourceAt<=15000&&
  num(index.price)!==null&&index.price>0;
 const bd=side=>{
  const q=side==='UP'?book?.yesBid:book?.noBid;
  const p=providerNum(q?.price,1),depth=providerNum(q?.sizeFp,100000000);
  return p!==null&&p>0&&p<1&&depth!==null?
   {price:p,depth}:null;
 };
 return {source:'SAME_TICK_AUTHENTICATED_BOOK_SAMPLE',
  readOnly:true,executionAuthorized:false,
  actualFillVerified:false,observedAt:millis(observedAt),
  ticker,bookState:bookReady?'FRESH_SAME_TICK':
   socketReady?'NOT_VERIFIED':'SOCKET_NOT_VERIFIED',
  bookReceivedAt:bookReady?book.receivedAt:null,
  upBid:bookReady?bd('UP'):null,
  downBid:bookReady?bd('DOWN'):null,
  indexState:sourceIndexReady?'OFFICIAL_FRESH':'NOT_VERIFIED',
  indexSourceAt:sourceIndexReady?index.sourceAt:null,
  indexPrice:sourceIndexReady?num(index.price):null,
  officialTarget:providerNum(market?.floor_strike,10000000),
  warning:'Sampled top bid once per 15-second engine tick, not raw stream or verified fill.'};
}

export function buildResearchTick({startedAt,finishedAt,market=null,
 quoteRetrievedAt=null,quoteObservedAt=null,spot=null,one=null,five=null,context=null,
 feedChecks=null,feedIssues=[],report=null,shadowProbe=null,engineState=null,
 bookSample=null,indexSample=null,streamStatusSample=null,lastError=null}){
 if(!millis(startedAt)||!millis(finishedAt)||finishedAt<startedAt)
  throw new TypeError('Invalid tick chronology');
 const ticker=SERIES.test(market?.ticker||'')?market.ticker:null;
 const close=market?.close_time?Date.parse(market.close_time):NaN;
 const closeAt=Number.isFinite(close)?close:null;
 const feeds=feedStates(feedChecks);
 const ready=!!(ticker&&feeds.kalshi.ok===true&&feeds.kraken1m.ok===true&&
  feeds.kraken5m.ok===true&&one&&five&&context?.three&&context?.five);
 const observedEvents=(Array.isArray(engineState?.events)?engineState.events:[])
  .slice(0,12).map(e=>({
   type:str(e?.type,32),ticker:SERIES.test(e?.ticker||'')?e.ticker:null,
   note:str(e?.msg,180),at:millis(e?.time)
  }));
 return {
  schemaVersion:2,source:'V4_ISOLATED_ENGINE_TICK',
  paperOnly:true,shadowOnly:true,simulationArmed:false,
  observedAt:startedAt,finishedAt,processingMs:finishedAt-startedAt,
  ticker,closeAt,secondsRemaining:closeAt===null?null:Math.max(0,(closeAt-startedAt)/1000),
  dataStatus:ready?'READY_FOR_HEURISTIC_EVALUATION':'PARTIAL_OR_UNAVAILABLE',
  quote:{source:'Kalshi REST proxy (potentially cached)',
   retrievedAt:millis(quoteRetrievedAt),receiptAt:millis(quoteObservedAt),exchangeEventAt:null,
   strike:providerNum(market?.floor_strike,10000000),
   yesBid:providerNum(market?.yes_bid_dollars,1),
   yesAsk:providerNum(market?.yes_ask_dollars,1),
   noBid:providerNum(market?.no_bid_dollars,1),
   noAsk:providerNum(market?.no_ask_dollars,1),
   yesBidSize:providerNum(market?.yes_bid_size_fp,1e10),
   yesAskSize:providerNum(market?.yes_ask_size_fp,1e10)},
  kraken:{source:'Kraken spot proxy, NOT official settlement index',
   spot:num(spot),one:metrics(one),five:metrics(five),
   oneClosedAt:candleMs(context?.oneClosedAt),
   threeStructure:structure(context?.three),
   fiveStructure:structure(context?.five)},
  feeds,issues:Array.isArray(feedIssues)?
   feedIssues.slice(0,8).map(x=>str(x,180)).filter(Boolean):[],
  dailyRegime:{status:str(context?.regime?.status,30),
   regime:str(context?.regime?.regime,30),
   eventRisk:str(context?.regime?.eventRisk,30)},
  sampledExitBook:sampledExitWitness({
   market,book:bookSample,index:indexSample,
   streamStatus:streamStatusSample,observedAt:finishedAt}),
  decision:{classification:'UNVALIDATED_V3_BASELINE_SHADOW',
   notice:str(report?.notice,280),observedEvents,
   calibratedProbability:null,settlementVerified:false,exitFillVerified:false,
   shadowProbe:shadowProbe&&typeof shadowProbe==='object'?shadowProbe:null,
   stopAudit:engineState?.lastStopAudit?.at>=startedAt&&
    engineState?.lastStopAudit?.at<=finishedAt?
    stopEvidence(engineState.lastStopAudit):null,
   exitAtThisTick:mostRecentExit(engineState,startedAt,finishedAt)},
  paperSnapshot:{cash:num(engineState?.cash),realized:num(engineState?.realized),
   pendingCount:Array.isArray(engineState?.pending)?engineState.pending.length:null,
   openTicker:SERIES.test(engineState?.open?.ticker||'')?engineState.open.ticker:null},
  lastError:str(lastError,180)
 };
}
export function recordResearchTick(sql,args){
 const data=buildResearchTick(args);
 sql.exec('INSERT OR IGNORE INTO research_ticks(started_at,finished_at,ticker,close_at,valid_feeds,has_market,payload) VALUES(?,?,?,?,?,?,?)',
  data.observedAt,data.finishedAt,data.ticker,data.closeAt,
  data.dataStatus==='READY_FOR_HEURISTIC_EVALUATION'?1:0,
  data.ticker?1:0,JSON.stringify(data));
 return data;
}
export function researchPage(sql,{anchor=null,offset=0,limit=80}={}){
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||
  !Number.isSafeInteger(limit)||limit<1||limit>100||
  (anchor!==null&&(!Number.isSafeInteger(anchor)||anchor<0)))
  throw new RangeError('Invalid research pagination');
 const latest=sql.exec('SELECT COALESCE(MAX(id),0) top FROM research_ticks').toArray()[0]?.top??0;
 const high=anchor===null?Number(latest):anchor;
 const total=sql.exec('SELECT COUNT(*) n FROM research_ticks WHERE id<=?',high).toArray()[0]?.n??0;
 const ticks=sql.exec('SELECT id,payload FROM research_ticks WHERE id<=? ORDER BY id DESC LIMIT ? OFFSET ?',
  high,limit,offset).toArray().map(row=>({id:row.id,...JSON.parse(row.payload)}));
 return {anchor:high,offset,limit,total:Number(total),ticks,
  dataSource:'V4 durable, append-only engine-tick observations'};
}
export function recordBookSample(sql,{ticker,receivedAt,exchangeEventAt=null,
 sendingAt=null,seq=null,quote}){
 if(!SERIES.test(ticker||'')||!millis(receivedAt)||
  (exchangeEventAt!==null&&!millis(exchangeEventAt))||
  (sendingAt!==null&&!millis(sendingAt))||
  (seq!==null&&(!Number.isSafeInteger(seq)||seq<1))||
  !quote||quote.ticker!==ticker||quote.source!=='KALSHI_WEBSOCKET_ORDERBOOK')
  throw new TypeError('Invalid WebSocket book observation');
 // Deliberately NOT wired to a live socket yet.
 const data={schemaVersion:1,ticker,receivedAt,exchangeEventAt,sendingAt,seq,
  source:'KALSHI_WEBSOCKET_ORDERBOOK',
  valid:quote.valid===true,fresh:quote.fresh===true,
  reason:str(quote.reason,80),yesBid:quote.yesBid||null,
  yesAsk:quote.yesAsk||null,noBid:quote.noBid||null,noAsk:quote.noAsk||null,
  crossed:quote.crossed===true};
 sql.exec('INSERT INTO research_book_samples(ticker,received_at,exchange_event_at,sending_at,source,stream_seq,valid,payload) VALUES(?,?,?,?,?,?,?,?)',
  ticker,receivedAt,exchangeEventAt,sendingAt,data.source,seq,
  data.valid?1:0,JSON.stringify(data));
 return data;
}
