/* ETH-15 Scout isolated Cloudflare cloud service: PAPER ONLY.
 * Independent of the existing market proxy and GitHub Pages browser trader.
 */
import { DurableObject } from 'cloudflare:workers';
import {freshPaperState,makeV2Engine,indicators} from './v2.js';
import {aggregate3m,analyzeStructure,completedFresh,buildDailyRegime} from './structure.js';
import {paperEntryArmed} from './v3-policy.js';

const INTERVAL_MS=30000;
const REGIME_RETRY_MS=30*60000;
const chicagoDay=ts=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(ts));
const API='https://api.kraken.com/0/public/';
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'}
});
async function remote(url){
  const r=await fetch(url,{headers:{Accept:'application/json'},
    signal:AbortSignal.timeout(12000),cf:{cacheTtl:0,cacheEverything:false}});
  if(!r.ok)throw Error('Data provider HTTP '+r.status);
  return r.json();
}
function getMarket(j){
  return (j?.markets||[])
    .filter(m=>m.ticker?.startsWith('KXETH15M-')&&['open','active'].includes(m.status)
      &&Date.parse(m.close_time)>Date.now()-5000)
    .sort((a,b)=>Date.parse(a.close_time)-Date.parse(b.close_time))[0]||null;
}
const rows=j=>Object.values(j.result||{}).find(Array.isArray);
const safeErr=e=>String(e?.message||e).slice(0,200);
function normalize(s){
  return {...freshPaperState(),...s,armed:!!s?.armed,monitoring:s?.monitoring!==false,
    // Migrate the old fixed 2% V2 default to the approved $3/3% PAPER ceiling.
    risk:s?.risk===2?3:(s?.risk??3),
    pending:Array.isArray(s?.pending)?s.pending:[],
    blocked:Array.isArray(s?.blocked)?s.blocked:[],
    trades:[],decisions:[],events:[]};
}
export class ScoutEngine extends DurableObject {
  constructor(ctx,env){
    super(ctx,env); this.busy=null;
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS trades(
      ticker TEXT PRIMARY KEY, exit_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(
      ticker TEXT PRIMARY KEY, decided_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(
      key TEXT PRIMARY KEY, happened_at INTEGER NOT NULL, data TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS runtime_status(
         id INTEGER PRIMARY KEY CHECK(id=1), armed INTEGER NOT NULL,
         monitoring INTEGER NOT NULL, observed_at INTEGER NOT NULL,
         last_market TEXT, last_error TEXT);`);
  }
  record(){
    const s=normalize(this.ctx.storage.kv.get('runtime'));
    // Deployment-controlled activation. No public arm endpoint is needed.
    // Disabled/missing flag ALWAYS overrides old persisted armed state.
    // 'enabled' authorizes PAPER simulated entries only; no broker API exists.
    s.armed=paperEntryArmed(this.env.SCOUT_PAPER_MODE,s.monitoring);
    s.trades=this.ctx.storage.sql.exec('SELECT data FROM trades ORDER BY exit_at DESC LIMIT 130')
      .toArray().map(r=>JSON.parse(r.data));
    this.loadedTradeTickers=new Set(s.trades.map(t=>t.ticker));
    return s;
  }
  save(s,meta={}){
    const sql=this.ctx.storage.sql;
    this.ctx.storage.transactionSync(()=>{
      for(const t of s.trades) if(t.ticker&&Number.isFinite(t.exitAt)&&!this.loadedTradeTickers?.has(t.ticker))
        sql.exec('INSERT OR IGNORE INTO trades(ticker,exit_at,data) VALUES(?,?,?)',
          t.ticker,t.exitAt,JSON.stringify(t));
      for(const d of s.decisions) if(d.ticker)
        sql.exec('INSERT OR IGNORE INTO decisions(ticker,decided_at,data) VALUES(?,?,?)',
          d.ticker,d.time||Date.now(),JSON.stringify(d));
      for(const e of s.events){
        const key=[e.time,e.type,e.ticker,e.msg].join('|');
        sql.exec('INSERT OR IGNORE INTO events(key,happened_at,data) VALUES(?,?,?)',
          key,e.time||Date.now(),JSON.stringify(e));
      }
      const runtime={...s,...meta,trades:[],decisions:[],events:[],
        blocked:s.blocked.slice(-200)};
      // Read-only production safety check from Data Studio, no public URL required.
      sql.exec(`INSERT INTO runtime_status(id,armed,monitoring,observed_at,last_market,last_error)
        VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        armed=excluded.armed,monitoring=excluded.monitoring,
        observed_at=excluded.observed_at,last_market=excluded.last_market,
        last_error=excluded.last_error`,s.armed?1:0,s.monitoring?1:0,
        meta.lastTick||Date.now(),meta.lastMarket??null,meta.lastError??null);
      this.ctx.storage.kv.put('runtime',runtime);
    });
  }
  async run(){
    if(this.busy)return this.busy;
    this.busy=this.tick().finally(()=>{this.busy=null});
    return this.busy;
  }
  async tick(){
    const s=this.record(); if(!s.monitoring)return;
    const now=Date.now(),mUrl=this.env.MARKET_PROXY;
    const engine=makeV2Engine(s);
    let market=null,one=null,m5=null,error=null,fresh=false;
    const today=chicagoDay(now);
    const context={strict:true,three:null,five:null,oneClosedAt:null,
      regime:s.dailyRegime?.day===today?s.dailyRegime:null};
    try{
      const [kj,tj,fivej]=await Promise.all([
        remote(mUrl),remote(API+'Ticker?pair=ETHUSD'),
        remote(API+'OHLC?pair=ETHUSD&interval=5')
      ]);
      if(tj.error?.length||fivej.error?.length)
        throw Error('Kraken API rejected a request');
      const retrieved=Date.parse(kj.worker_retrieved_at);
      if(!Number.isFinite(retrieved)||Date.now()-retrieved>90000||retrieved>Date.now()+5000)
        throw Error('Kalshi quote is stale or missing its retrieval timestamp');
      market=getMarket(kj);
      if(!market)throw Error('No open ETH 15-minute contract in market feed');
      const prices=rows(fivej)?.slice(0,-1);
      
if(!prices?.length || !Object.values(tj.result||{}).some(t=>Array.isArray(t?.c) && Number.isFinite(Number(t.c[0]))))

        throw Error('Kraken 5m candles or ticker missing');
      // Never evaluate new entries with missing/stale completed 5m candles.
      if(!completedFresh(prices,5))throw Error('Kraken 5m completed candles stale');
      m5=indicators(prices);
      context.five=analyzeStructure(prices);
      if(!Number.isFinite(m5?.e50)||!context.five)
        throw Error('Kraken 5m indicators/structure incomplete');
      fresh=true;
      try {
        const onej=await remote(API+'OHLC?pair=ETHUSD&interval=1');
        if(onej.error?.length)throw Error('Kraken 1m API error');
        const oneRows=rows(onej)?.slice(0,-1)||[];
        if(!completedFresh(oneRows,1))throw Error('Kraken 1m completed candles stale');
        one=engine.fastScan(oneRows);
        context.oneClosedAt=Number(oneRows.at(-1)?.[0]);
        context.three=analyzeStructure(aggregate3m(oneRows));
        if(!one||!context.three)throw Error('Kraken 1m/3m indicators incomplete');
      } catch(e) { error='1m indicator unavailable: '+safeErr(e) }
    }catch(e){error=safeErr(e)}
    // ONE light context refresh per Houston day (retry at most each 30m
    // on failure). This is crypto price/volume context, NOT verified macro
    // event news, ETF flows or a calibrated probability forecast.
    if((s.dailyRegime?.day!==today||s.dailyRegime?.status!=='ready') &&
       now-(s.lastRegimeAttemptAt||0)>REGIME_RETRY_MS){
      s.lastRegimeAttemptAt=now;
      try{
        const [eh,bh]=await Promise.all([
          remote(API+'OHLC?pair=ETHUSD&interval=60'),
          remote(API+'OHLC?pair=XBTUSD&interval=60')
        ]);
        if(eh.error?.length||bh.error?.length)throw Error('Hourly Kraken request rejected');
        s.dailyRegime=buildDailyRegime(rows(eh)?.slice(0,-1)||[],
          rows(bh)?.slice(0,-1)||[],today,now);
      }catch(e){s.dailyRegime={day:today,at:now,status:'unavailable',
        regime:'UNKNOWN',eventRisk:'unverified',reason:safeErr(e)};}
    }
    context.regime=s.dailyRegime?.day===today?s.dailyRegime:null;
    let report={notice:'No new buy; waiting for complete fresh market data.'};
    try{report=engine.step(market,one,m5,fresh,context)}
    catch(e){error='V2 evaluation failed: '+safeErr(e)}
    this.save(s,{lastTick:now,lastError:error,lastMarket:market?.ticker||null,
      lastNotice:report.notice||'',lastFeedOkay:fresh});
  }
  async alarm(){
    try{await this.run()}catch(e){
      const s=this.record();
      this.save(s,{lastTick:Date.now(),lastError:'Uncaught cloud tick: '+safeErr(e)});
    }finally{
      const s=this.record();
      if(s.monitoring)await this.ctx.storage.setAlarm(Date.now()+INTERVAL_MS);
    }
  }
  async fetch(req){
    const path=new URL(req.url).pathname;
    if(path==='/bootstrap'){
      const s=this.record();
      if(s.monitoring && await this.ctx.storage.getAlarm()===null)
        await this.ctx.storage.setAlarm(Date.now()+1000);
      return json({ok:true,monitoring:s.monitoring});
    }
    if(path==='/v1/status'&&req.method==='GET'){
      const s=this.record();
      const counts=this.ctx.storage.sql.exec(
        'SELECT (SELECT count(*) FROM trades) as trades,(SELECT count(*) FROM decisions) as passes'
      ).toArray()[0];
      return json({monitoring:s.monitoring,armed:s.armed,paperOnly:true,
        paperMode:this.env.SCOUT_PAPER_MODE==='enabled'?'enabled':'disabled',
        initial:s.initial,cash:s.cash,
        realized:s.realized,risk:s.risk,open:s.open,pending:s.pending.length,
        ...counts,lastTick:s.lastTick||null,lastError:s.lastError||null,
        lastMarket:s.lastMarket||null,lastNotice:s.lastNotice||null,
        lastFeedOkay:!!s.lastFeedOkay,policyVersion:'V3-PAPER',
        dailyRisk:s.dailyRisk||null,
        dailyRegime:s.dailyRegime||null,
        recentTrades:s.trades.slice(0,10)});
    }
    if(path==='/v1/journal'&&req.method==='GET'){
      // Append-only SQLite is the canonical research record; no 100-row
      // history ceiling and no browser localStorage dependency.
      // Anchor fixes the displayed historical snapshot during pagination.
      const u=new URL(req.url),rawLimit=Number(u.searchParams.get('limit')||100),
        rawOffset=Number(u.searchParams.get('offset')||0),
        rawAnchor=Number(u.searchParams.get('anchor')||Date.now());
      if(![rawLimit,rawOffset,rawAnchor].every(Number.isSafeInteger)||
         rawLimit<1||rawLimit>100||rawOffset<0||rawOffset>1000000||
         rawAnchor<1000000000000||rawAnchor>Date.now()+60000)
        return json({error:'Invalid journal pagination'},400);
      const sql=this.ctx.storage.sql;
      const events=sql.exec(
        'SELECT key,happened_at,data FROM events WHERE happened_at<=? ORDER BY happened_at DESC,key DESC LIMIT ? OFFSET ?',
        rawAnchor,rawLimit,rawOffset
      ).toArray().map(r=>({id:r.key,at:r.happened_at,...JSON.parse(r.data)}));
      const trades=sql.exec(
        'SELECT ticker,exit_at,data FROM trades WHERE exit_at<=? ORDER BY exit_at DESC,ticker DESC LIMIT ? OFFSET ?',
        rawAnchor,rawLimit,rawOffset
      ).toArray().map(r=>JSON.parse(r.data));
      const decisions=sql.exec(
        'SELECT ticker,decided_at,data FROM decisions WHERE decided_at<=? ORDER BY decided_at DESC,ticker DESC LIMIT ? OFFSET ?',
        rawAnchor,rawLimit,rawOffset
      ).toArray().map(r=>JSON.parse(r.data));
      const counts=sql.exec(`SELECT
        (SELECT count(*) FROM events WHERE happened_at<=?) events,
        (SELECT count(*) FROM trades WHERE exit_at<=?) trades,
        (SELECT count(*) FROM decisions WHERE decided_at<=?) decisions`,
        rawAnchor,rawAnchor,rawAnchor).toArray()[0];
      return json({paperOnly:true,readOnly:true,anchor:rawAnchor,offset:rawOffset,limit:rawLimit,
        totals:counts,events,trades,decisions,
        // Pending settlement is UNCONFIRMED, never counted as a win.
        pending:this.record().pending});
    }
    if(path==='/v1/history'&&req.method==='GET'){
      const sql=this.ctx.storage.sql;
      const trades=sql.exec('SELECT data FROM trades ORDER BY exit_at DESC LIMIT 100')
        .toArray().map(x=>JSON.parse(x.data));
      const decisions=sql.exec('SELECT data FROM decisions ORDER BY decided_at DESC LIMIT 100')
        .toArray().map(x=>JSON.parse(x.data));
      return json({trades,decisions});
    }
    if(req.method!=='POST')return json({error:'Not found'},404);
    if(this.busy)await this.busy.catch(()=>{});
    const s=this.record();
    if(path==='/v1/start'){s.monitoring=true;this.save(s);
      await this.ctx.storage.setAlarm(Date.now()+1000)}
    else if(path==='/v1/arm'||path==='/v1/pause')
      return json({error:'Paper entry state is controlled only by SCOUT_PAPER_MODE in Worker settings',
        paperOnly:true,armed:s.armed},409);
    else if(path==='/v1/stop'){s.monitoring=false;s.armed=false;this.save(s);
      await this.ctx.storage.deleteAlarm()}
    else return json({error:'Not found'},404);
    return json({ok:true,monitoring:s.monitoring,armed:s.armed});
  }
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path==='/health')return json({ok:true,service:'ETH-15 Scout Cloud V2',paperOnly:true});
    if(!env.SCOUT_ADMIN_TOKEN)return json({error:'Admin secret not configured'},503);
    if(req.headers.get('Authorization')!=='Bearer '+env.SCOUT_ADMIN_TOKEN)
      return json({error:'Unauthorized'},401);
    const stub=env.SCOUT.getByName('single-paper-scout');
    return stub.fetch(new Request('https://internal'+path,req));
  },
  async scheduled(_event,env,ctx){
    const stub=env.SCOUT.getByName('single-paper-scout');
    ctx.waitUntil(stub.fetch('https://internal/bootstrap'));
  }
};
