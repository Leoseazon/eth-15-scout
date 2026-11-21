// ETH-15 Scout V4: PUBLIC-FACING BUT TOKEN-PROTECTED READ-ONLY VIEW.
// Separate Worker: cannot call trade controls, does not modify the V4 engine.
// No Kalshi user token, broker session, trading order API or telemetry storage.
import {indicators} from './src/v2.js';
import {aggregate3m,analyzeStructure,completedFresh} from './src/structure.js';
import {credentialsConfigured,checkCredentials,newSession,sessionValid} from './viewer-auth.js';

const ALLOWED_ORIGIN='https://leoseazon.github.io';
const KRAKEN='https://api.kraken.com/0/public/';
const defaults={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
function respond(data,status=200,origin=''){
 const h={...defaults};
 if(origin===ALLOWED_ORIGIN){h['Access-Control-Allow-Origin']=ALLOWED_ORIGIN;h['Vary']='Origin';}
 return new Response(JSON.stringify(data),{status,headers:h});
}
async function jsonGet(url,deadline=8500){
 const response=await fetch(url,{headers:{Accept:'application/json'},
   signal:AbortSignal.timeout(deadline)});
 if(!response.ok)throw new Error('Data provider HTTP '+response.status);
 return response.json();
}
export function directQuoteTicker(ticker){
 if(typeof ticker!=='string'||!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(ticker))return null;
 return 'https://external-api.kalshi.com/trade-api/v2/markets/'+encodeURIComponent(ticker);
}
export function publicContract(m,observedAt){
 if(!m||typeof m.ticker!=='string')return null;
 const raw=(k)=>{const v=m[k];return v==null||v===''?null:v};
 const closeAt=Date.parse(m.close_time);
 if(!Number.isFinite(closeAt)||closeAt<=observedAt||!['active','open'].includes(String(m.status||'').toLowerCase()))return null;
 return {
  ticker:m.ticker,close_time:m.close_time,
  floor_strike:raw('floor_strike'),
  yes_ask_dollars:raw('yes_ask_dollars'),
  yes_bid_dollars:raw('yes_bid_dollars'),
  no_ask_dollars:raw('no_ask_dollars'),
  no_bid_dollars:raw('no_bid_dollars'),
  // Timestamp is observed response receipt, not true trade/exchange quote time.
  quoteObservedAt:observedAt,quoteSource:'Kalshi public REST (may be cached)'
 };
}
function marketFrom(data){
 return (data?.markets||[]).filter(m=>
  m?.ticker?.startsWith('KXETH15M-')&&['open','active'].includes(m.status)&&
  Date.parse(m.close_time)>Date.now()-5000)
  .sort((a,b)=>Date.parse(a.close_time)-Date.parse(b.close_time))[0]||null;
}
function rows(v){
 return Object.values(v?.result||{}).find(Array.isArray)||[];
}
function minifiedCandles(a){
 return (a||[]).slice(-84).map(r=>[
  Number(r[0]),Number(r[1]),Number(r[2]),Number(r[3]),Number(r[4]),
  Number(r[6])
 ]).filter(r=>r.every(Number.isFinite));
}
function finiteOrNull(n){return Number.isFinite(n)?n:null}
export function packStructure(s){
 if(!s)return null;
 return {
  at:s.closedAt,trend:s.trend,price:finiteOrNull(s.price),
  rsi:finiteOrNull(s.rsi),e8:finiteOrNull(s.e8),e21:finiteOrNull(s.e21),
  adDelta:finiteOrNull(s.adDelta),bands:s.bands&&{
   mid:finiteOrNull(s.bands.mid),upper:finiteOrNull(s.bands.upper),
   lower:finiteOrNull(s.bands.lower),width:finiteOrNull(s.bands.width)},
  support:s.support,resistance:s.resistance
 };
}
function marketContext({m1,m5,ticker,quote}){
 const one=rows(m1).slice(0,-1);
 const five=rows(m5).slice(0,-1);
 const three=aggregate3m(one);
 const freshness={one:completedFresh(one,1),five:completedFresh(five,5),
   three:completedFresh(three,3)};
 const slow=freshness.five?indicators(five):null;
 const threeStr=freshness.one&&freshness.three?analyzeStructure(three):null;
 const fiveStr=freshness.five?analyzeStructure(five):null;
 const price=Number(Object.values(ticker?.result||{})[0]?.c?.[0]);
 return {
  source:'Independent Kraken spot reference; NOT Kalshi settlement or a synchronized engine decision',
  asOf:Date.now(),freshness,
  spot:finiteOrNull(price),contract:quote,
  primary:{five:packStructure(fiveStr),three:packStructure(threeStr),
   ema21:finiteOrNull(slow?.e21),ema50:finiteOrNull(slow?.e50),
   vwap:finiteOrNull(slow?.vwap),
   support:finiteOrNull(slow?.support),resistance:finiteOrNull(slow?.resistance)},
  secondary:{rsi14:finiteOrNull(slow?.rsi),
   macd:finiteOrNull(slow?.macd),macdSignal:finiteOrNull(slow?.signal)},
  candles:{
   m1:freshness.one?minifiedCandles(one):[],
   m3:freshness.three?minifiedCandles(three):[],
   m5:freshness.five?minifiedCandles(five):[]
  }
 };
}
export default {
 async fetch(req,env){
  const path=new URL(req.url).pathname,origin=req.headers.get('Origin')||'';
  if(origin&&origin!==ALLOWED_ORIGIN)return respond({error:'Origin not allowed'},403);
  if(req.method==='OPTIONS'){
   return new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Authorization,Content-Type',
    'Access-Control-Max-Age':'600','Vary':'Origin'
   }});
  }
  if(path==='/health'&&req.method==='GET')
   return respond({ok:true,service:'V4 read-only dashboard bridge',paperOnly:true},200,origin);
  if(path==='/api/v4/login'){
   if(req.method!=='POST')return respond({error:'Method not allowed'},405,origin);
   if(!credentialsConfigured(env)||!env.LOGIN_RATE_LIMIT)
    return respond({error:'Viewer sign-in not configured'},503,origin);
   // Approximate per-IP Cloudflare regional rate limit. The encrypted,
   // high-entropy password remains the primary protection.
   const ip=req.headers.get('CF-Connecting-IP')||'unknown';
   const limited=await env.LOGIN_RATE_LIMIT.limit({key:'v4-login:'+ip});
   if(!limited.success)return respond({error:'Too many login attempts. Try later.'},429,origin);
   if(!(req.headers.get('Content-Type')||'').startsWith('application/json'))
    return respond({error:'Expected JSON login'},415,origin);
   if(Number(req.headers.get('Content-Length')||0)>1024)
    return respond({error:'Login request too large'},413,origin);
   let form;
   try{
     const raw=await req.text();
     if(raw.length>1024)return respond({error:'Login request too large'},413,origin);
     form=JSON.parse(raw);
   }catch{return respond({error:'Invalid login request'},400,origin)}
   const ok=await checkCredentials(env,form?.username,form?.password);
   if(!ok)return respond({error:'Incorrect username or password'},401,origin);
   const session=await newSession(env.SCOUT_SESSION_SECRET,form?.remember===true);
   return respond({ok:true,readOnly:true,paperOnly:true,
     token:session.token,expiresAt:session.expiresAt},200,origin);
  }
  if(!['/api/v4/dashboard','/api/v4/journal','/api/v4/research','/api/v4/quote-archive','/api/v4/stream'].includes(path)||req.method!=='GET')
   return respond({error:'Not found'},404,origin);
  if(!env.SCOUT_V4||!credentialsConfigured(env))
   return respond({error:'Viewer not configured'},503,origin);
  if(!await sessionValid(req.headers.get('Authorization'),env.SCOUT_SESSION_SECRET))
   return respond({error:'Sign in required or session expired'},401,origin);
  try{
   // Only hard-coded read-only Durable Object paths. NEVER proxy arbitrary
   // paths or expose /bootstrap,/arm,/stop to website users.
   const stub=env.SCOUT_V4.getByName('v4-single-paper-scout');
   if(path==='/api/v4/journal'){
     const query=new URL(req.url).searchParams;
     const offset=query.get('offset')||'0';
     const limit=query.get('limit')||'100';
     const anchor=query.get('anchor');
     const validInt=v=>/^\d{1,16}$/.test(v);
     if(!validInt(offset)||!validInt(limit)||(anchor&&!validInt(anchor))||
        Number(offset)>1000000||Number(limit)<1||Number(limit)>100)
       return respond({error:'Invalid journal pagination'},400,origin);
     const pathParams=new URLSearchParams({offset,limit});
     if(anchor)pathParams.set('anchor',anchor);
     const result=await stub.fetch('https://internal/v1/journal?'+pathParams.toString());
     if(!result.ok)return respond({error:'Journal endpoint is not yet active on V4'},502,origin);
     const data=await result.json();
     return respond({...data,version:'V4',source:'Durable Object append-only journal'},200,origin);
   }
   if(path==='/api/v4/stream'){
     const q=new URL(req.url).searchParams,limit=q.get('limit')||'60',
       anchor=q.get('anchor'),before=q.get('before'),ticker=q.get('ticker');
     const valid=v=>/^\d{1,15}$/.test(v);
     if(!valid(limit)||Number(limit)>100||(anchor!==null&&!valid(anchor))||
       (before!==null&&!valid(before))||
       (ticker!==null&&!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(ticker)))
       return respond({error:'Invalid stream page'},400,origin);
     const params=new URLSearchParams({limit});
     if(anchor!==null)params.set('anchor',anchor);
     if(before!==null)params.set('before',before);
     if(ticker!==null)params.set('ticker',ticker);
     const result=await stub.fetch('https://internal/v1/stream?'+params.toString());
     if(!result.ok)return respond({error:'Read-only stream archive unavailable'},502,origin);
     return respond({...await result.json(),version:'V4',
       paperOnly:true,readOnly:true},200,origin);
   }
   if(path==='/api/v4/research'||path==='/api/v4/quote-archive'){
     const q=new URL(req.url).searchParams,offset=q.get('offset')||'0',
       limit=q.get('limit')||'100',anchor=q.get('anchor');
     const valid=v=>/^\d{1,15}$/.test(v);
     if(!valid(offset)||!valid(limit)||(anchor!==null&&!valid(anchor))||
       Number(offset)>1000000||Number(limit)<1||Number(limit)>100)
       return respond({error:'Invalid research archive pagination'},400,origin);
     const params=new URLSearchParams({offset,limit});
     if(anchor!==null)params.set('anchor',anchor);
     const internal=path==='/api/v4/research'?'/v1/research':'/v1/quote-archive';
     const result=await stub.fetch('https://internal'+internal+'?'+params);
     if(!result.ok)return respond({error:'Research archive unavailable'},502,origin);
     const data=await result.json();
     return respond({...data,readOnly:true,paperOnly:true,version:'V4'},200,origin);
   }
   const [st,history,journal,quotes,research,stream]=await Promise.all([
    stub.fetch('https://internal/v1/status'),stub.fetch('https://internal/v1/history'),
    stub.fetch('https://internal/v1/journal?limit=70&offset=0'),
    stub.fetch('https://internal/v1/quotes?limit=240'),
    stub.fetch('https://internal/v1/research?limit=28&offset=0'),
    stub.fetch('https://internal/v1/stream?limit=100')
   ]);
   if(!st.ok||!history.ok)
    throw new Error('Private paper engine read unavailable');
   const [status,records]=await Promise.all([st.json(),history.json()]);
   const journalData=journal.ok?await journal.json():null;
   const quoteData=quotes.ok?await quotes.json():null;
   const researchData=research.ok?await research.json():null;
   const streamData=stream.ok?await stream.json():null;
   // Market context is independent of the bot tick: errors do not prevent
   // account and paper history from loading.
   let market=null,marketError=null;
   // Preferred: reuse actual candles fetched for the V4 decision engine.
   // This avoids simultaneous fresh Kraken API calls being necessary for
   // a responsive chart while the engine itself is already healthy.
   if(status.marketSnapshot?.asOf &&
      Date.now()-status.marketSnapshot.asOf<120000 &&
      status.marketSnapshot.candles?.m5?.length){
     market={...status.marketSnapshot,
       source:'V4 engine market snapshot (Kraken spot is not Kalshi settlement)'};
   }else{
     try{
       // Fallback sources are independent: a failed 1m or Kalshi proxy
       // call must NOT blank out a healthy 5m ETH chart.
       const [q,one,five,ticker]=await Promise.allSettled([
         jsonGet(env.MARKET_PROXY),
         jsonGet(KRAKEN+'OHLC?pair=ETHUSD&interval=1'),
         jsonGet(KRAKEN+'OHLC?pair=ETHUSD&interval=5'),
         jsonGet(KRAKEN+'Ticker?pair=ETHUSD')
       ]);
       if(five.status!=='fulfilled'||five.value.error?.length)
         throw new Error('Kraken 5-minute reference feed unavailable');
       const fallbackOne=one.status==='fulfilled'&&!one.value.error?.length?
         one.value:{result:{}};
       const fallbackTicker=ticker.status==='fulfilled'&&!ticker.value.error?.length?
         ticker.value:{result:{}};
       const fallbackQuote=q.status==='fulfilled'?marketFrom(q.value):null;
       market=marketContext({m1:fallbackOne,m5:five.value,
         ticker:fallbackTicker,quote:fallbackQuote});
     }catch(e){marketError=String(e?.message||e).slice(0,120)}
   }
   // The top contract-price panel is independently fed from Kalshi REST:
   // the bot's proxy may not carry all quote fields, whereas Get Market does.
   // NEVER backfill a missing price with a guess or the other side's 1-p complement.
   // Safely restrict the ticker to the KXETH15M series to prevent SSRF.
   const currentTicker=status.lastMarket||market?.contract?.ticker||null;
   const quoteUrl=directQuoteTicker(currentTicker);
   const latestMarket=market?.contract?.ticker===currentTicker?
     market.contract:null;
   if(quoteUrl){
    try{
     const q=await jsonGet(quoteUrl,3500);
     const observedAt=Date.now();
     const exact=q?.market?.ticker===currentTicker?
       publicContract(q.market,observedAt):null;
     if(exact){
       if(!market)market={source:'Kalshi official contract quote only',asOf:observedAt,
         freshness:{one:false,three:false,five:false},candles:{m1:[],m3:[],m5:[]}};
       market.contract={...(latestMarket||{}),...exact};
     }else if(latestMarket){
       market.contract={...latestMarket,quoteSource:'Bot market quote cache'};
     }
    }catch{
     if(market&&latestMarket)
       market.contract={...latestMarket,quoteSource:'Bot market quote cache'};
    }
   }
   // Do not leak authentication details, secrets, host configuration, or
   // technical stack traces through the JSON payload.
   return respond({paperOnly:true,readOnly:true,version:'V4',
    receivedAt:Date.now(),status,
    activity:{trades:records.trades||[],decisions:records.decisions||[],
      events:journalData?.events||[],pending:journalData?.pending||[],
      windows:journalData?.windows||status.recentWindows||[],
      windowScan:{at:status.lastWindowScanAt||null,
        verifiedAt:status.lastWindowScanOkayAt||null,
        error:status.lastWindowScanError||null},
      releaseMarkers:journalData?.releaseMarkers||status.releaseMarkers||[],
      journalTotals:journalData?.totals||null,journalAnchor:journalData?.anchor||null,
      journalAvailable:!!journalData},
    market,marketError,quoteHistory:quoteData?.quotes||[],
    quoteHistoryAvailable:!!quoteData,
    researchHistory:researchData?.ticks||[],
    researchTotal:researchData?.total??null,
    researchAnchor:researchData?.anchor??null,
    researchAvailable:!!researchData,
    streamHistory:streamData?.items||[],
    streamArchiveTotal:streamData?.total??null,
    streamArchiveAnchor:streamData?.anchor??null,
    streamAvailable:!!streamData},200,origin);
  }catch(e){
   return respond({error:'V4 paper feed temporarily unavailable'},502,origin);
  }
 }
};
