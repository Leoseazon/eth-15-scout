/* ETH-15 Scout isolated Cloudflare cloud service: PAPER ONLY.
 * Independent of the existing market proxy and GitHub Pages browser trader.
 */
import { DurableObject } from 'cloudflare:workers';
import {freshPaperState,makeV2Engine,indicators} from './v2.js';

const INTERVAL_MS=30000;
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
      key TEXT PRIMARY KEY, happened_at INTEGER NOT NULL, data TEXT NOT NULL);`);
  }
  record(){
    const s=normalize(this.ctx.storage.kv.get('runtime'));
    s.trades=this.ctx.storage.sql.exec('SELECT data FROM trades ORDER BY exit_at DESC LIMIT 130')
      .toArray().map(r=>JSON.parse(r.data));
    return s;
  }
  save(s,meta={}){
    const sql=this.ctx.storage.sql;
    this.ctx.storage.transactionSync(()=>{
      for(const t of s.trades) if(t.ticker&&Number.isFinite(t.exitAt))
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
    try{
      const [kj,tj,fivej,onej]=await Promise.all([
        remote(mUrl),remote(API+'Ticker?pair=ETHUSD'),
        remote(API+'OHLC?pair=ETHUSD&interval=5'),
        remote(API+'OHLC?pair=ETHUSD&interval=1')
      ]);
      if(tj.error?.length||fivej.error?.length||onej.error?.length)
        throw Error('Kraken API rejected a request');
      const retrieved=Date.parse(kj.worker_retrieved_at);
      if(!Number.isFinite(retrieved)||Date.now()-retrieved>90000||retrieved>Date.now()+5000)
        throw Error('Kalshi quote is stale or missing its retrieval timestamp');
      market=getMarket(kj);
      if(!market)throw Error('No open ETH 15-minute contract in market feed');
      const prices=rows(fivej)?.slice(0,-1),short=rows(onej)?.slice(0,-1);
      if(!prices?.length||!short?.length||!rows(tj))
        throw Error('Kraken candles or ticker missing');
      // Calculate from completed candles only.
      m5=indicators(prices);
      one=engine.fastScan(short);
      if(!Number.isFinite(m5?.e50)||!one)throw Error('Kraken indicators incomplete');
      fresh=true;
    }catch(e){error=safeErr(e)}
    let report={notice:'No new buy; waiting for complete fresh market data.'};
    try{report=engine.step(market,one,m5,fresh)}
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
      return json({monitoring:s.monitoring,armed:s.armed,initial:s.initial,cash:s.cash,
        realized:s.realized,risk:s.risk,open:s.open,pending:s.pending.length,
        ...counts,lastTick:s.lastTick||null,lastError:s.lastError||null,
        lastMarket:s.lastMarket||null,lastNotice:s.lastNotice||null,
        recentTrades:s.trades.slice(0,10)});
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
    else if(path==='/v1/arm'){s.monitoring=true;s.armed=true;this.save(s);
      await this.ctx.storage.setAlarm(Date.now()+1000)}
    else if(path==='/v1/pause'){s.armed=false;this.save(s)}
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
