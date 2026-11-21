/* V4: append-only best-effort Kalshi REST observations.
 * Times are local receipt times, NOT official exchange event timestamps.
 */
const price=v=>{
 if(v==null||v==='')return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1?n:null;
};
const positive=v=>{
 if(v==null||v==='')return null;
 const n=Number(v);return Number.isFinite(n)&&n>0?n:null;
};
export function ensureQuoteTable(sql){
 sql.exec(`CREATE TABLE IF NOT EXISTS quote_observations (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   ticker TEXT NOT NULL, observed_at INTEGER NOT NULL,
   proxy_retrieved_at INTEGER, close_at INTEGER NOT NULL,
   strike REAL NOT NULL, kraken_spot REAL,
   yes_bid REAL, yes_ask REAL, no_bid REAL, no_ask REAL,
   provenance TEXT NOT NULL DEFAULT 'Kalshi REST proxy (may be cached)',
   UNIQUE(ticker,observed_at)
 );
 CREATE INDEX IF NOT EXISTS idx_v4_quotes_ticker_at
   ON quote_observations(ticker,observed_at DESC);`);
}
export function recordQuote(sql,{market,observedAt,proxyRetrievedAt=null,krakenSpot=null}){
 if(typeof market?.ticker!=='string'||!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(market.ticker)||
   !Number.isSafeInteger(observedAt)||observedAt<=0)return false;
 const strike=positive(market.floor_strike),closeAt=Date.parse(market.close_time);
 if(strike===null||!Number.isFinite(closeAt)||closeAt<=observedAt)return false;
 const retrieved=Number.isSafeInteger(proxyRetrievedAt)&&proxyRetrievedAt>0?proxyRetrievedAt:null;
 sql.exec(`INSERT OR IGNORE INTO quote_observations
  (ticker,observed_at,proxy_retrieved_at,close_at,strike,kraken_spot,
   yes_bid,yes_ask,no_bid,no_ask) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  market.ticker,observedAt,retrieved,closeAt,strike,positive(krakenSpot),
  price(market.yes_bid_dollars),price(market.yes_ask_dollars),
  price(market.no_bid_dollars),price(market.no_ask_dollars));
 return true;
}
export function recentQuotes(sql,{ticker=null,limit=240}={}){
 if(!Number.isInteger(limit)||limit<1||limit>600)throw new RangeError('Invalid limit');
 if(ticker!==null&&(typeof ticker!=='string'||!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(ticker)))
   throw new TypeError('Invalid ticker');
 const query=ticker?
  'SELECT * FROM quote_observations WHERE ticker=? ORDER BY observed_at DESC LIMIT ?':
  'SELECT * FROM quote_observations ORDER BY observed_at DESC LIMIT ?';
 return sql.exec(query,...(ticker?[ticker,limit]:[limit])).toArray().reverse();
}
