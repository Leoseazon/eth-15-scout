// ETH-15 Scout V3: PUBLIC-FACING BUT TOKEN-PROTECTED READ-ONLY VIEW.
// Separate Worker: cannot call trade controls, does not modify the V3 engine.
// No Kalshi user token, broker session, trading order API or telemetry storage.
import {indicators} from './src/v2.js';
import {aggregate3m,analyzeStructure,completedFresh} from './src/structure.js';

const ALLOWED_ORIGIN='https://leoseazon.github.io';
const KRAKEN='https://api.kraken.com/0/public/';
const defaults={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export function authorized(value,secret){
 return typeof secret==='string'&&secret.length>=24&&value==='Bearer '+secret;
}
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
    'Access-Control-Allow-Methods':'GET,OPTIONS',
    'Access-Control-Allow-Headers':'Authorization,Content-Type',
    'Access-Control-Max-Age':'600','Vary':'Origin'
   }});
  }
  if(path==='/health'&&req.method==='GET')
   return respond({ok:true,service:'V3 read-only dashboard bridge',paperOnly:true},200,origin);
  if(!['/api/v3/dashboard','/api/v3/journal'].includes(path)||req.method!=='GET')
   return respond({error:'Not found'},404,origin);
  if(!env.SCOUT||!env.VIEW_TOKEN)
   return respond({error:'Viewer not configured'},503,origin);
  if(!authorized(req.headers.get('Authorization'),env.VIEW_TOKEN))
   return respond({error:'Incorrect viewer access key'},401,origin);
  try{
   // Only hard-coded read-only Durable Object paths. NEVER proxy arbitrary
   // paths or expose /bootstrap,/arm,/stop to website users.
   const stub=env.SCOUT.getByName('single-paper-scout');
   if(path==='/api/v3/journal'){
     const query=new URL(req.url).searchParams;
     const offset=query.get('offset')||'0';
     const limit=query.get('limit')||'100';
     const anchor=query.get('anchor');
     const validInt=v=>/^\\d{1,16}$/.test(v);
     if(!validInt(offset)||!validInt(limit)||(anchor&&!validInt(anchor))||
        Number(offset)>1000000||Number(limit)<1||Number(limit)>100)
       return respond({error:'Invalid journal pagination'},400,origin);
     const pathParams=new URLSearchParams({offset,limit});
     if(anchor)pathParams.set('anchor',anchor);
     const result=await stub.fetch('https://internal/v1/journal?'+pathParams.toString());
     if(!result.ok)return respond({error:'Journal endpoint is not yet active on V3'},502,origin);
     const data=await result.json();
     return respond({...data,version:'V3',source:'Durable Object append-only journal'},200,origin);
   }
   const [st,history,journal]=await Promise.all([
    stub.fetch('https://internal/v1/status'),stub.fetch('https://internal/v1/history'),
    stub.fetch('https://internal/v1/journal?limit=70&offset=0')
   ]);
   if(!st.ok||!history.ok)
    throw new Error('Private paper engine read unavailable');
   const [status,records]=await Promise.all([st.json(),history.json()]);
   const journalData=journal.ok?await journal.json():null;
   // Market context is independent of the bot tick: errors do not prevent
   // account and paper history from loading.
   let market=null,marketError=null;
   try{
    const [q,one,five,ticker]=await Promise.all([
     jsonGet(env.MARKET_PROXY),
     jsonGet(KRAKEN+'OHLC?pair=ETHUSD&interval=1'),
     jsonGet(KRAKEN+'OHLC?pair=ETHUSD&interval=5'),
     jsonGet(KRAKEN+'Ticker?pair=ETHUSD')
    ]);
    if(one.error?.length||five.error?.length||ticker.error?.length)
     throw new Error('Kraken response rejected');
    market=marketContext({m1:one,m5:five,ticker,quote:marketFrom(q)});
   }catch(e){marketError=String(e?.message||e).slice(0,120)}
   // Do not leak authentication details, secrets, host configuration, or
   // technical stack traces through the JSON payload.
   return respond({paperOnly:true,readOnly:true,version:'V3',
    receivedAt:Date.now(),status,
    activity:{trades:records.trades||[],decisions:records.decisions||[],
      events:journalData?.events||[],pending:journalData?.pending||[],
      journalTotals:journalData?.totals||null,journalAnchor:journalData?.anchor||null,
      journalAvailable:!!journalData},
    market,marketError},200,origin);
  }catch(e){
   return respond({error:'V3 paper feed temporarily unavailable'},502,origin);
  }
 }
};
