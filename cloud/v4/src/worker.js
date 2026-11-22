/* ETH-15 Scout isolated Cloudflare cloud service: PAPER ONLY.
 * Independent of the existing market proxy and GitHub Pages browser trader.
 */
import { DurableObject } from 'cloudflare:workers';
import {freshPaperState,makeV2Engine,indicators} from './v2.js';
import {ensureQuoteTable,recordQuote,recentQuotes,quoteArchivePage} from './quote-recorder.js';
import {ensureResearchJournal,recordResearchTick,researchPage} from './research-journal.js';
import {aggregate3m,analyzeStructure,completedFresh,buildDailyRegime} from './structure.js';
import {settlementClockPhase} from './v3-policy.js';
import {parseList,windowEndpointUrl,SCAN_INTERVAL_MS} from './window-journal.js';
import {paperResults,reconcilePending} from './paper-ledger.js';
import {collectMarketFeeds,validateKalshiSnapshot} from './feed-health.js';
import {KalshiReadOnlySocket} from './kalshi-ws-transport.js';
import {probeKalshiPublicRest,probeKalshiSignedRead,probeKalshiWebsocketHostHttps} from './kalshi-network-diagnostic.js';
import {ensureStreamAudit,sampledStreamRecorder,appendStreamEvent,streamPage,latestStreamStatus} from './stream-audit.js';
import {fetchOfficialRestBook,ensureRestBookArchive,appendRestBookSample,
 restBookPage,latestRestBookStatus} from './kalshi-rest-orderbook.js';
import {KalshiResearchSocket} from './research-socket.js';
import {checkCFValuesAccess} from './cf-access.js';
import {verifyCFWebSocket} from './cf-ws-probe.js';
import {getV4StorageInventory} from './storage-inventory.js';
import {settlementFirstPaperStep} from './settlement-first-paper.js';
import {ensureSettlementPredictions,appendSettlementPrediction,
 reconcileSettlementPredictions,settlementPredictionStats} from './settlement-predictions.js';
import {SETTLEMENT_FIRST_VERSION} from './settlement-first.js';
import {scoreHeldConfidence} from './buy-confidence.js';
import {ensureFullBookArchive,appendFullBookFrame,
 fullBookArchiveStatus,fullBookArchivePage} from './full-book-archive.js';
import {ensureIndependentResearch,appendCFValue,appendPublicTrade,
 appendResearchFeedEvent,independentResearchStatus,independentResearchPage} from './research-sources.js';

// Poll every 15 seconds (REST data only; not a tick-level stream).
// Re-evaluation still requires fully closed 1m/5m Kraken candles.
const INTERVAL_MS=15000;
const REST_BOOK_INTERVAL_MS=15000;
const REST_BOOK_RETRY_AFTER_429_MS=120000;
const RELEASE_TAG='V4-FOUNDATION-20261121';
const PHASE1_TAG='V3-PHASE1-FEED-RELIABILITY-20261120';
const SOFT_GUARD_HOTFIX_TAG='V4-SHADOW-FOUNDATION-SOFT-GUARD-BYPASS-20261120';
const PRE_RELEASE_NOTED_AT='2026-11-19T23:40:00-06:00'; // Approximate, user-supplied change milestone.
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
const finite=n=>Number.isFinite(n)?n:null;
const viewStructure=o=>o?{at:o.closedAt,trend:o.trend,price:finite(o.price),
 rsi:finite(o.rsi),e8:finite(o.e8),e21:finite(o.e21),adDelta:finite(o.adDelta),
 bands:o.bands?{lower:finite(o.bands.lower),mid:finite(o.bands.mid),
 upper:finite(o.bands.upper)}:null,
 support:o.support||null,resistance:o.resistance||null}:null;
const smallCandles=a=>(a||[]).slice(-84).map(r=>[
 Number(r[0]),Number(r[1]),Number(r[2]),Number(r[3]),Number(r[4]),Number(r[6])
]).filter(r=>r.every(Number.isFinite));
function normalize(s){
  return {...freshPaperState(),...s,armed:!!s?.armed,monitoring:s?.monitoring!==false,
    // Migrate the old fixed 2% V2 default to the approved $3/3% PAPER ceiling.
    risk:s?.risk===2?3:(s?.risk??3),
    pending:Array.isArray(s?.pending)?s.pending:[],
    blocked:Array.isArray(s?.blocked)?s.blocked:[],
    trades:[],decisions:[],events:[]};
}
export class ScoutEngineV4 extends DurableObject {
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
         last_market TEXT, last_error TEXT);
      CREATE TABLE IF NOT EXISTS window_outcomes(
       ticker TEXT PRIMARY KEY, close_at INTEGER NOT NULL,
       observed_at INTEGER NOT NULL, outcome TEXT, status TEXT NOT NULL,
       data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_window_close ON window_outcomes(close_at);
      CREATE TABLE IF NOT EXISTS release_markers(
        tag TEXT PRIMARY KEY,first_engine_tick_at INTEGER NOT NULL,
        pre_release_reference_at TEXT NOT NULL,description TEXT NOT NULL);`);
    ensureQuoteTable(this.ctx.storage.sql);
    ensureResearchJournal(this.ctx.storage.sql);
    ensureStreamAudit(this.ctx.storage.sql);
    ensureRestBookArchive(this.ctx.storage.sql);
    ensureFullBookArchive(this.ctx.storage.sql);
    ensureIndependentResearch(this.ctx.storage.sql);
    ensureSettlementPredictions(this.ctx.storage.sql);
    // Two explicit deployment switches; no code path contains a real order API.
    this.paperExperimentAllowed=env.SCOUT_V4_PAPER_MODE==='enabled' &&
      env.V4_SETTLEMENT_FIRST_EXPERIMENT==='true';
    this.researchStream=null;
    // Formal permission gate is separate from each capture switch. Rest/pass-through
    // and WebSocket entitlement alone do NOT permit bulk retention/model training.
    this.dataResearchAuthorized=env.V4_DATA_RESEARCH_AUTHORIZED==='true';
    this.fullBookRecordingEnabled=this.dataResearchAuthorized&&
      env.V4_FULL_BOOK_ARCHIVE_ENABLED==='true';
    if(this.dataResearchAuthorized&&env.V4_RESEARCH_STREAM_ENABLED==='true'){
      const sql=this.ctx.storage.sql;
      this.researchStream=new KalshiResearchSocket({
        onCF:v=>appendCFValue(sql,v),
        onTrade:v=>appendPublicTrade(sql,v),
        onEvent:(kind,at)=>appendResearchFeedEvent(sql,kind,at)
      });
    }
    this.restBookCaptureEnabled=env.V4_REST_BOOK_CAPTURE_ENABLED==='true';
    // Zero connections unless the NEW V4-only feature flag is explicitly set.
    // The stream requires a dedicated READ-only Kalshi key, not a trading key.
    this.stream=null;
    this.streamLastFault=null;this.streamLastFaultAt=0;
    if(env.V4_STREAM_CAPTURE_ENABLED==='true'){
      this.stream=new KalshiReadOnlySocket({
        onObservation:sampledStreamRecorder(this.ctx.storage.sql),
        onRawFrame:this.fullBookRecordingEnabled?
          ({packet,receivedAt})=>appendFullBookFrame(this.ctx.storage.sql,packet,receivedAt):()=>{},
        onFault:reason=>{
          const at=Date.now();
          // Include every distinct fault and repeat faults at most once/30sec.
          if(reason!==this.streamLastFault||at-this.streamLastFaultAt>=30000){
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'STREAM_FAULT',ticker:this.stream?.ticker||null,
              at,detail:String(reason).slice(0,70)});
            this.streamLastFault=reason;this.streamLastFaultAt=at;
          }
        }
      });
    }
  }
  record(){
    const s=normalize(this.ctx.storage.kv.get('runtime'));
    // Deployment-controlled activation. No public arm endpoint is needed.
    // Disabled/missing flag ALWAYS overrides old persisted armed state.
    // 'enabled' authorizes PAPER simulated entries only; no broker API exists.
    // Hard disarm: V4 is shadow-only even if a config variable is enabled.
    s.armed=this.paperExperimentAllowed&&s.monitoring;
    s.trades=this.ctx.storage.sql.exec('SELECT data FROM trades ORDER BY exit_at DESC LIMIT 130')
      .toArray().map(r=>JSON.parse(r.data));
    this.loadedTradeTickers=new Set(s.trades.map(t=>t.ticker));
    return s;
  }
  save(s,meta={}){
    const sql=this.ctx.storage.sql;
    const forecastToCommit=s.pendingPredictionToCommit||null;
    // Prediction INSERT and synthetic bank/cash state must commit or roll back
    // together; an orphan forecast or unrecorded cash debit is unacceptable.
    this.ctx.storage.transactionSync(()=>{
      if(forecastToCommit)appendSettlementPrediction(sql,forecastToCommit);
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
      delete runtime.pendingPredictionToCommit;
      // Read-only production safety check from Data Studio, no public URL required.
      sql.exec(`INSERT INTO runtime_status(id,armed,monitoring,observed_at,last_market,last_error)
        VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        armed=excluded.armed,monitoring=excluded.monitoring,
        observed_at=excluded.observed_at,last_market=excluded.last_market,
        last_error=excluded.last_error`,s.armed?1:0,s.monitoring?1:0,
        meta.lastTick||Date.now(),meta.lastMarket??null,meta.lastError??null);
      this.ctx.storage.kv.put('runtime',runtime);
    });
    if(forecastToCommit)delete s.pendingPredictionToCommit;
  }
  async captureOfficialWindows(now=Date.now()){
    // Independent archival poll. Failure never changes strategy/entries/P&L.
    // Query ALL exchange-listed ETH15M closes, including those the bot passed.
    let cursor='',seen=new Set();
    const sql=this.ctx.storage.sql;
    for(let page=0;page<3;page++){
      const response=await remote(windowEndpointUrl(now,cursor));
      if(!Array.isArray(response?.markets))
        throw Error('Kalshi market-outcome feed unavailable');
      const windows=parseList(response,now).filter(x=>!seen.has(x.ticker));
      this.ctx.storage.transactionSync(()=>{
        for(const w of windows){
          seen.add(w.ticker);
          sql.exec(`INSERT INTO window_outcomes(
            ticker,close_at,observed_at,outcome,status,data)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(ticker) DO UPDATE SET
              observed_at=excluded.observed_at,
              outcome=excluded.outcome,status=excluded.status,data=excluded.data
            WHERE window_outcomes.status NOT IN ('OFFICIAL_RESULT','VOID')`,
            w.ticker,w.closeAt,w.observedAt,w.outcome,w.status,JSON.stringify(w));
        }
      });
      const next=typeof response.cursor==='string'?response.cursor:'';
      if(!next||next===cursor||response.markets.length<500)break;
      cursor=next;
    }
    return seen.size;
  }
  async run(){
    if(this.busy)return this.busy;
    this.busy=this.tick().finally(()=>{this.busy=null});
    return this.busy;
  }
  async tick(){
    const s=this.record(); if(!s.monitoring)return;
    const now=Date.now(),mUrl=this.env.MARKET_PROXY;
    // FAST PAPER EXIT PATH (BEFORE Kraken/market-proxy requests).
    // A delayed Kraken candle or nonessential regime fetch must NOT delay
    // protection of an existing V4 paper position with a fresh Kalshi WS bid.
    // Reuses the original persisted ticker/closeTime, and never fabricates a
    // sale if the stream is stale, disconnected or short of displayed depth.
    if(s.open?.strategy==='V4_SETTLEMENT_FIRST'){
      const earlier=s.open;
      const fastBook=this.stream?.status(Date.now())?.quote||null;
      try{
        const exit=settlementFirstPaperStep(s,{
          market:{ticker:earlier.ticker,close_time:earlier.closeTime},
          book:fastBook,now:Date.now()
        });
        if(exit.status==='PAPER_SELL'||s.open===null)
          this.save(s,{lastTick:Date.now(),lastMarket:earlier.ticker,
            lastNotice:exit.notice||'V4 paper position exit evaluated',
            lastError:null});
      }catch{
        // The full tick will retry exit assessment with validated sources.
        // No guessed exit or P&L is written on fast-path error.
      }
    }
    // Separate V4 cohort; no inherited V3 hotfix/soft-guard transition markers.
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO release_markers(tag,first_engine_tick_at,pre_release_reference_at,description) VALUES(?,?,?,?)',
      RELEASE_TAG,now,'not applicable',
      'V4 shadow foundation with V3 baseline logic; paper entries hard-disabled');
    const engine=makeV2Engine(s,{softGuardEnabled:true});
    let market=null,one=null,m5=null,error=null,fresh=false;
    let fiveCandles=[],oneCandles=[],tickerSpot=null;
    const today=chicagoDay(now);
    const context={strict:true,three:null,five:null,oneClosedAt:null,
      regime:s.dailyRegime?.day===today?s.dailyRegime:null};
    // PHASE 1: network results are independent: Kraken failure must not
    // prevent paper exits using a validated, executable Kalshi quote.
    const batch=await collectMarketFeeds(remote,mUrl,API,now);
    const feedChecks=batch.checks,feedIssues=[...batch.failures];
    const fail=(source,reason)=>{
      const msg=safeErr(reason);
      feedChecks[source]={...feedChecks[source],ok:false,error:msg};
      if(!feedIssues.includes(source+': '+msg))feedIssues.push(source+': '+msg);
    };
    const kj=batch.payloads.kalshi;
    if(kj){
      const validity=validateKalshiSnapshot(kj,Date.now(),90000);
      s.lastQuoteRetrievedAt=validity.retrievedAt;
      feedChecks.kalshi={...feedChecks.kalshi,...validity};
      if(validity.ok){
        market=getMarket(kj);
        if(!market)fail('kalshi','No currently open ETH 15-minute contract in quote');
      }else fail('kalshi',validity.reason);
    }else s.lastQuoteRetrievedAt=null;
    const tj=batch.payloads.krakenTicker,fivej=batch.payloads.kraken5m,
      onej=batch.payloads.kraken1m;
    if(tj&&fivej){
      try{
        const prices=rows(fivej)?.slice(0,-1);
        fiveCandles=prices||[];
        const validSpot=Object.values(tj.result||{}).find(t=>Array.isArray(t?.c));
        tickerSpot=Number(validSpot?.c?.[0]);
        if(!prices?.length){fail('kraken5m','5m candles missing');throw Error('5m candles missing')}
        if(!Number.isFinite(tickerSpot)){fail('krakenTicker','ETH ticker invalid');throw Error('ETH ticker invalid')}
        if(!completedFresh(prices,5)){fail('kraken5m','completed 5m candles stale');throw Error('5m candles stale')}
        m5=indicators(prices);context.five=analyzeStructure(prices);
        if(!Number.isFinite(m5?.e50)||!context.five){
          fail('kraken5m','5m indicators/structure incomplete');throw Error('5m indicators/structure incomplete')
        }
        fresh=true;
      }catch(e){feedIssues.push('entryIndicators: '+safeErr(e))}
    }
    if(onej){
      try{
        const oneRows=rows(onej)?.slice(0,-1)||[];
        oneCandles=oneRows;
        if(!completedFresh(oneRows,1))throw Error('1m candles stale');
        one=engine.fastScan(oneRows);
        context.oneClosedAt=Number(oneRows.at(-1)?.[0]);
        context.three=analyzeStructure(aggregate3m(oneRows));
        if(!one||!context.three)throw Error('1m/3m indicators incomplete');
      }catch(e){
        fail('kraken1m',e);one=null;context.three=null;context.oneClosedAt=null;
      }
    }
    s.lastFeedChecks=feedChecks;
    let quoteObservedAt=null;
    if(market){
      try{
        const receivedAt=Date.now();
        if(recordQuote(this.ctx.storage.sql,{
          market,observedAt:receivedAt,
          proxyRetrievedAt:s.lastQuoteRetrievedAt,krakenSpot:tickerSpot
        }))quoteObservedAt=receivedAt;
      }catch(e){feedIssues.push('recorder: '+safeErr(e));}
    }
    error=feedIssues.length?feedIssues.slice(0,3).join('; ').slice(0,200):null;
    // ONE light context refresh per Houston day (retry at most each 30m
    // on failure). This is crypto price/volume context, NOT verified macro
    // event news, ETF flows or a calibrated probability forecast.
    // A nonessential hourly Kraken/BTC refresh may take up to 12 seconds.
    // While a paper position is open, prioritize executable exit quotes
    // instead of delaying its stop for auxiliary macro context.
    if(!s.open &&
       (s.dailyRegime?.day!==today||s.dailyRegime?.status!=='ready') &&
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
    // Disarming new entries must NOT switch an existing V4 position to the
    // unrelated V3-derived close/stop policy. Manage it with its original
    // V4 paper exit rules until it is safely settled.
    const continueV4Position=s.open?.strategy==='V4_SETTLEMENT_FIRST';
    if(this.paperExperimentAllowed||continueV4Position){
      let index=null;
      // Check book locally before making a signed official-index REST call:
      // this avoids 4 requests/minute when WS is disconnected or stale.
      const book=this.stream?.status(Date.now())?.quote||null;
      const bookReady=book?.ticker===market?.ticker&&
        book?.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&
        book.valid===true&&book.fresh===true&&
        Number.isSafeInteger(book.receivedAt)&&
        Date.now()-book.receivedAt<=5000;
      const remainingForEntry=market?
        (Date.parse(market.close_time)-Date.now())/1000:null;
      const marketReady=!!market&&Number.isFinite(remainingForEntry)&&
        remainingForEntry>90&&remainingForEntry<=750;
      const entrySourcesReady=s.armed&&!s.open&&marketReady&&
        !!one&&!!m5&&!!context.three&&!!context.five&&
        !s.blocked.includes(market.ticker)&&bookReady;
      const confidenceSourcesReady=s.open?.strategy==='V4_SETTLEMENT_FIRST'&&
        market?.ticker===s.open.ticker&&!!one&&!!m5&&
        !!context.three&&!!context.five&&bookReady;
      // The latest-value REST request is also a source for live position
      // confidence. It does NOT change the entry or exit decision rules.
      if(entrySourcesReady||confidenceSourcesReady){
        const verified=await checkCFValuesAccess({
          keyId:this.env.KALSHI_V4_READ_KEY_ID,
          privatePem:this.env.KALSHI_V4_READ_PRIVATE_KEY,
          now:Date.now()
        });
        s.lastOfficialIndexCheck={
          at:Date.now(),state:verified.state,
          fresh:verified.state==='HTTP_200_VALID_ETH_INDEX'&&
            Number.isSafeInteger(verified.sourceAt)&&
            Date.now()-verified.sourceAt<=15000,
          sourceAgeMs:Number.isSafeInteger(verified.sourceAt)?
            Date.now()-verified.sourceAt:null
        };
        if(s.lastOfficialIndexCheck.fresh)index=verified;
      }
      // REST verification may take seconds; re-read the live socket NOW,
      // otherwise the entry simulator might evaluate a stale book snapshot.
      const decisionBook=this.stream?.status(Date.now())?.quote||null;
      const decisionBookFresh=decisionBook?.ticker===market?.ticker&&
        decisionBook?.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&
        decisionBook.valid===true&&decisionBook.fresh===true&&
        Number.isSafeInteger(decisionBook.receivedAt)&&
        Date.now()-decisionBook.receivedAt<=5000;
      if(!entrySourcesReady&&!s.open){
        s.lastOfficialIndexCheck={at:Date.now(),
          state:bookReady?'SKIPPED_OTHER_ENTRY_PREREQUISITE':'SKIPPED_NO_FRESH_WS_BOOK',
          fresh:false,sourceAgeMs:null};
      }
      s.lastPaperFeedHealth={
        at:Date.now(),marketTicker:market?.ticker||null,
        marketProxyValid:feedChecks.kalshi?.ok===true,
        krakenOneMinuteFresh:!!one,
        krakenFiveMinuteFresh:!!m5&&fresh,
        krakenThreeMinuteFresh:!!context.three,
        kalshiWsConnected:this.stream?.status(Date.now())?.connected===true,
        kalshiWsBookFresh:decisionBookFresh,
        kalshiBookAgeMs:Number.isSafeInteger(decisionBook?.receivedAt)?
          Date.now()-decisionBook.receivedAt:null,
        officialIndexLastState:s.lastOfficialIndexCheck?.state||'NOT_CHECKED',
        officialIndexLastAgeMs:s.lastOfficialIndexCheck?.sourceAgeMs??null,
        liveSourcesReady:entrySourcesReady&&decisionBookFresh&&index!==null
      };
      try{
        report=settlementFirstPaperStep(s,{market,index,one,five:m5,context,
          book:decisionBook,now:Date.now(),
          onPrediction:pos=>{s.pendingPredictionToCommit=pos}});
      }catch{
        report={status:'WATCH',notice:'Settlement-first paper evaluation failed safely; no unverified result claimed'};
      }
      // Read-only observation: confidence is computed AFTER the normal paper
      // step so it cannot veto buys, override 96c/stop exits or alter cash.
      if(s.open?.strategy==='V4_SETTLEMENT_FIRST'){
        const pos=s.open;
        const checkedAt=Date.now();
        let live;
        try{
          live=scoreHeldConfidence({position:pos,index,one,five:m5,
            context,book:decisionBook,now:checkedAt});
        }catch{
          live={status:'UNAVAILABLE',reason:'CONFIDENCE_EVALUATION_ERROR',
            value:null,calibrated:false,winProbability:null};
        }
        const previous=Array.isArray(pos.confidenceHistory)?
          pos.confidenceHistory.at(-1):null;
        if(live.status==='CURRENT'&&Number.isInteger(live.value)){
          live.deltaFromEntry=Number.isInteger(pos.entryConfidence?.value)?
            live.value-pos.entryConfidence.value:null;
          live.deltaFromPrevious=Number.isInteger(previous?.value)?
            live.value-previous.value:null;
          if(!Array.isArray(pos.confidenceHistory))pos.confidenceHistory=[];
          if(!previous||previous.value!==live.value||
             checkedAt-previous.at>=60000){
            pos.confidenceHistory.push({at:checkedAt,value:live.value});
            pos.confidenceHistory=pos.confidenceHistory.slice(-60);
          }
        }
        pos.liveConfidence=live;
      }
    }else{
      try{report=engine.step(market,one,m5,fresh,context)}
      catch(e){error='V2 evaluation failed: '+safeErr(e)}
    }
    // Exactly ONE active decision philosophy per V4 tick. Do not run the
    // legacy 7-check candidate probe during the settlement-first experiment.
    let shadowProbe=null;
    if(this.paperExperimentAllowed||continueV4Position){
      shadowProbe={version:SETTLEMENT_FIRST_VERSION,
        status:report.status||'WATCH',reason:report.notice||'',
        candidate:report.candidate||null,
        decision:s.lastV4SettlementDecision||null,
        calibratedProbability:null,executableFillVerified:false};
    }else{
      try{shadowProbe=engine.probe(market,one,m5,{fresh,context,at:Date.now()})}
      catch{shadowProbe={status:'UNAVAILABLE',reason:'Baseline shadow probe unavailable',
        candidate:null,calibratedProbability:null,executableFillVerified:false}}
    }
    // Never block decisions on Kalshi settlement-data availability.
    // Run AFTER step() to ensure the bot handles the current market first.
    // Chart reuses the engine's successfully fetched reference candles.
    // This avoids a separate set of Kraken calls being a single point of
    // failure for the user's website; never changes the trade decision.
    if(fresh&&market&&m5&&fiveCandles.length){
      s.marketSnapshot={
        asOf:now,
        source:'Same Kraken spot candles read by V4 engine (not Kalshi settlement)',
        spot:finite(tickerSpot),
        contract:{ticker:market.ticker,close_time:market.close_time,
          floor_strike:market.floor_strike,
          yes_ask_dollars:market.yes_ask_dollars,
          no_ask_dollars:market.no_ask_dollars,
          yes_bid_dollars:market.yes_bid_dollars,
          no_bid_dollars:market.no_bid_dollars,
          quoteObservedAt:s.lastQuoteRetrievedAt,
          quoteSource:'Kalshi REST proxy receipt time; may be cached; V4 PAPER fills use authenticated WS book'},
        freshness:{one:oneCandles.length>=25,three:!!context.three,five:true},
        primary:{five:viewStructure(context.five),three:viewStructure(context.three),
          ema21:finite(m5.e21),ema50:finite(m5.e50),vwap:finite(m5.vwap),
          support:finite(m5.support),resistance:finite(m5.resistance)},
        secondary:{rsi14:finite(m5.rsi),macd:finite(m5.macd),
          macdSignal:finite(m5.signal)},
        candles:{m1:smallCandles(oneCandles),
          m3:smallCandles(aggregate3m(oneCandles)),
          m5:smallCandles(fiveCandles)}
      };
    }else{
      // Do not display a prior healthy snapshot as if it were the current
      // Kraken or Kalshi reference after an endpoint failed.
      s.marketSnapshot=null;
    }
    // Persist actual bot decisions BEFORE any historical market-result scan.
    // The read-only viewer sees this tick without waiting for archival IO.
    s.lastMarketDataAt=fresh&&one&&context.three&&market?now:null;
    s.lastDecisionProcessingMs=Date.now()-now;
    // Commit the official-target prediction, synthetic bankroll and runtime
    // together FIRST. If that transaction fails, no "PAPER BUY" research
    // record is allowed to claim a simulated purchase succeeded.
    const tickMeta={lastTick:Date.now(),lastError:error,
      lastMarket:market?.ticker||null,lastNotice:report.notice||'',
      lastFeedOkay:!!(fresh&&one&&context.three&&market)};
    this.save(s,tickMeta);
    // Auxiliary research logs are intentionally NON-CRITICAL. Save the latest
    // research receipt afterward; a failed auxiliary write cannot roll back
    // an already committed paper bankroll and unique forecast.
    try{
      const research=recordResearchTick(this.ctx.storage.sql,{
        startedAt:now,finishedAt:Date.now(),market,
        quoteRetrievedAt:s.lastQuoteRetrievedAt,quoteObservedAt,spot:tickerSpot,
        one,five:m5,context,feedChecks,feedIssues,report,
        shadowProbe,engineState:s,lastError:error
      });
      s.lastResearchTickAt=research.observedAt;
      s.lastResearchError=null;
    }catch(e){
      s.lastResearchError=safeErr(e);
    }
    this.save(s,tickMeta);
    // Archiving is noncritical. It does not change the strategy or P&L.
    if(now-(s.lastWindowScanAt||0)>=SCAN_INTERVAL_MS){
      s.lastWindowScanAt=now;
      try{
        s.lastWindowScanCount=await this.captureOfficialWindows(now);
        s.lastWindowScanError=null;
        s.lastWindowScanOkayAt=Date.now();
      }catch(e){
        s.lastWindowScanError=safeErr(e);
      }
      // Re-save with the same CURRENT tick metadata, not stale runtime fields.
      this.save(s,tickMeta);
    }
    // Only official finalized outcomes resolve paper holdings.
    const settled=reconcilePending(s,this.ctx.storage.sql,Date.now());
    if(settled>0)this.save(s,tickMeta);
    try{reconcileSettlementPredictions(this.ctx.storage.sql,Date.now())}
    catch{ /* Official outcome scoring remains unresolved; never assume success. */ }
    // Research stream always follows critical paper accounting and journal IO.
    // NO stream data is fed into the existing V3-derived entry/exit engine.
    if(this.stream){
      const at=Date.now();
      try{
        const watch=this.stream.watchdog(at);
        if(watch==='RECONNECT_REQUIRED')
          appendStreamEvent(this.ctx.storage.sql,{
            kind:'STREAM_RECONNECT',ticker:market?.ticker||null,at,
            detail:'Stream silence; no assumed current quote'});
        const keyId=this.env.KALSHI_V4_READ_KEY_ID;
        const privatePem=this.env.KALSHI_V4_READ_PRIVATE_KEY;
        if(market&&typeof keyId==='string'&&typeof privatePem==='string'){
          const previous=this.stream.ticker;
          const started=await this.stream.ensure(market.ticker,{keyId,privatePem},Date.now());
          if(started)appendStreamEvent(this.ctx.storage.sql,{
            kind:'STREAM_SUBSCRIBED',ticker:market.ticker,at:Date.now(),
            detail:previous&&previous!==market.ticker?'Next 15-minute window':'Read-only subscription'});
          // A bounded public-REST comparison distinguishes broad outbound
          // Cloudflare routing failure from a WebSocket-specific failure.
          // Never send an API key/signature or read response bodies.
          const failed=this.stream.status(Date.now());
          if(failed.attempts>=3&&
              /^NETWORK_/.test(failed.lastFailure||'')&&
              Date.now()-(s.lastNetworkProbeAt||0)>=10*60*1000){
            s.lastNetworkProbeAt=Date.now();
            this.save(s,tickMeta); // persist cooldown BEFORE probing
            // All three probes are read-only, with fixed URLs and no
            // response-body ingestion. Parallel requests bound alarm latency.
            // The auth probe touches only the read::portfolio_balance GET
            // endpoint and saves *HTTP status only*, NEVER account balances.
            const [publicRest,authenticatedRest,webSocketHttps]=await Promise.allSettled([
              probeKalshiPublicRest(),
              probeKalshiSignedRead({keyId,privatePem}),
              probeKalshiWebsocketHostHttps()
            ]);
            const safe=(r,format)=>r.status==='fulfilled'?
              format(r.value):'DIAGNOSTIC_UNAVAILABLE';
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'NETWORK_REST_CHECK',ticker:market.ticker,at:Date.now(),
              detail:safe(publicRest,checks=>checks.map(x=>x.endpoint+'_'+x.result).join('|'))});
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'AUTH_REST_CHECK',ticker:market.ticker,at:Date.now(),
              detail:safe(authenticatedRest,code=>String(code).slice(0,100))});
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'WS_HOST_HTTPS_CHECK',ticker:market.ticker,at:Date.now(),
              detail:safe(webSocketHttps,checks=>checks.map(x=>x.endpoint+'_'+x.result).join('|'))});
          }
        }else if(market&&(!keyId||!privatePem)){
          if(this.streamLastFault!=='READ_CREDENTIALS_UNAVAILABLE'){
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'STREAM_CONFIG_MISSING',ticker:market.ticker,at,
              detail:'V4 read-only stream secrets absent'});
            this.streamLastFault='READ_CREDENTIALS_UNAVAILABLE';
          }
        }
      }catch(e){
        // Collecting stream history is never permitted to break V3-style
        // tick decisions, official outcomes or settlement reconciliation.
        appendStreamEvent(this.ctx.storage.sql,{
          kind:'STREAM_RESEARCH_ERROR',ticker:market?.ticker||null,
          at:Date.now(),detail:'Isolated stream path unavailable'});
      }
    }
    // Supplemental CF Benchmarks and Kalshi public-trades research only.
    // Never used for this tick's baseline signal or any simulated fill.
    if(this.researchStream){
      try{
        this.researchStream.watchdog(Date.now());
        const keyId=this.env.KALSHI_V4_READ_KEY_ID;
        const privatePem=this.env.KALSHI_V4_READ_PRIVATE_KEY;
        if(market&&typeof keyId==='string'&&typeof privatePem==='string')
          await this.researchStream.ensure(market.ticker,{keyId,privatePem},Date.now());
        else if(market&&(!keyId||!privatePem))
          appendResearchFeedEvent(this.ctx.storage.sql,'RESEARCH_STREAM_CONFIG_MISSING');
      }catch{
        // Research failure never changes the V3-derived shadow evaluation.
        try{appendResearchFeedEvent(this.ctx.storage.sql,'CF_CONNECT_ERROR')}catch{}
      }
    }
    // Isolated official REST depth archive; no influence on engine, paper, or P&L.
    // Kalshi REST does NOT provide exchange event timestamps or sequence.
    if(this.restBookCaptureEnabled&&this.stream&&market){
      const live=this.stream.status(Date.now());
      const usableWebSocket=live.connected===true&&
        live.quote?.valid===true&&live.quote?.fresh===true;
      const attemptAt=Date.now();
      if(!usableWebSocket&&attemptAt-(s.lastRestBookAt||0)>=REST_BOOK_INTERVAL_MS&&
         attemptAt>=(s.restBookBackoffUntil||0)){
        s.lastRestBookAt=attemptAt; // persist throttle BEFORE outbound request
        this.save(s,tickMeta);
        try{
          const result=await fetchOfficialRestBook(market.ticker);
          if(result.ok){
            appendRestBookSample(this.ctx.storage.sql,result.book);
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'REST_BOOK_SNAPSHOT',ticker:market.ticker,at:Date.now(),
              detail:'RECEIPT_ONLY'});
            s.lastRestBookStatus='REST_SNAPSHOT_RECORDED';
            s.lastRestBookError=null;
            s.lastRestBookReceivedAt=result.book.receivedAt;
          }else{
            s.lastRestBookStatus='REST_SNAPSHOT_UNAVAILABLE';
            s.lastRestBookError=result.reason;
            if(result.reason==='REST_BOOK_HTTP_429')
              s.restBookBackoffUntil=Date.now()+REST_BOOK_RETRY_AFTER_429_MS;
            appendStreamEvent(this.ctx.storage.sql,{
              kind:'REST_BOOK_FAULT',ticker:market.ticker,at:Date.now(),
              detail:result.reason});
          }
        }catch{
          s.lastRestBookStatus='REST_SNAPSHOT_UNAVAILABLE';
          s.lastRestBookError='REST_BOOK_ARCHIVE_ERROR';
          appendStreamEvent(this.ctx.storage.sql,{
            kind:'REST_BOOK_FAULT',ticker:market.ticker,at:Date.now(),
            detail:'REST_BOOK_ARCHIVE_ERROR'});
        }
        this.save(s,tickMeta);
      }
    }
  }
  async alarm(){
    const start=Date.now();
    try{await this.run()}catch(e){
      const s=this.record();
      this.save(s,{lastTick:Date.now(),lastError:'Uncaught cloud tick: '+safeErr(e)});
    }finally{
      const s=this.record();
      // Stable cadence measured from tick START, not end. No overlapping runs.
      if(s.monitoring)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,start+INTERVAL_MS));
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
        paperMode:this.paperExperimentAllowed?'enabled':'disabled',
        shadowOnly:!this.paperExperimentAllowed,
        continuingPreDisarmV4Position:s.open?.strategy==='V4_SETTLEMENT_FIRST'&&!this.paperExperimentAllowed,
        settlementPaperAllowed:this.paperExperimentAllowed,
        settlementModelVersion:SETTLEMENT_FIRST_VERSION,
        latestSettlementDecision:s.lastV4SettlementDecision||null,
        settlementPredictionStats:settlementPredictionStats(this.ctx.storage.sql),
        initial:s.initial,cash:s.cash,
        realized:s.realized,risk:s.risk,open:s.open,pending:s.pending.length,
        ...counts,lastTick:s.lastTick||null,lastError:s.lastError||null,
        lastMarket:s.lastMarket||null,lastNotice:s.lastNotice||null,
        lastDecisionProcessingMs:s.lastDecisionProcessingMs||null,
        lastQuoteRetrievedAt:s.lastQuoteRetrievedAt||null,
        lastFeedOkay:!!s.lastFeedOkay,feedChecks:s.lastFeedChecks||null,
        lastResearchTickAt:s.lastResearchTickAt||null,
        lastResearchError:s.lastResearchError||null,
        streamCaptureEnabled:!!this.stream,
        streamConnection:this.stream?this.stream.status(Date.now()):
          {connected:false,source:'NOT_CONFIGURED',reason:'V4 WebSocket feature flag disabled'},
        streamArchive:latestStreamStatus(this.ctx.storage.sql),
        restBookCaptureEnabled:this.restBookCaptureEnabled,
        restBookArchive:latestRestBookStatus(this.ctx.storage.sql),
        supplementaryResearchEnabled:!!this.researchStream,
        supplementaryResearchConnection:this.researchStream?this.researchStream.status():
          {connected:false,reason:'V4 research feed disabled pending validation'},
        supplementaryResearch:independentResearchStatus(this.ctx.storage.sql),
        fullBookArchiveEnabled:this.fullBookRecordingEnabled,
        additionalDataRecordingAuthorized:this.dataResearchAuthorized,
        additionalDataRecordingBlocked:!this.dataResearchAuthorized,
        fullBookArchive:fullBookArchiveStatus(this.ctx.storage.sql),
        lastRestBookAt:s.lastRestBookAt||null,
        lastRestBookReceivedAt:s.lastRestBookReceivedAt||null,
        lastRestBookStatus:s.lastRestBookStatus||'NOT_CAPTURED',
        lastRestBookError:s.lastRestBookError||null,
        policyVersion:this.paperExperimentAllowed?SETTLEMENT_FIRST_VERSION:'V4-SHADOW-FOUNDATION',
        dailyRisk:s.dailyRisk||null,
        dailyRegime:s.dailyRegime||null,
        recentTrades:s.trades.slice(0,10),
        paperResults:paperResults(this.ctx.storage.sql,RELEASE_TAG),
        lastWindowScanAt:s.lastWindowScanAt||null,
        lastWindowScanOkayAt:s.lastWindowScanOkayAt||null,
        lastWindowScanError:s.lastWindowScanError||null,
        marketSnapshot:s.marketSnapshot||null,
        settlementPhase:settlementClockPhase(
          s.marketSnapshot?.contract?.close_time||s.open?.closeTime||'',Date.now()),
        officialSettlementIndexAvailable:!!s.lastOfficialIndexCheck?.fresh&&
          Number.isSafeInteger(s.lastOfficialIndexCheck.at)&&
          Date.now()-s.lastOfficialIndexCheck.at<=30000,
        officialIndexFeedCheck:s.lastOfficialIndexCheck||{state:'NOT_YET_CHECKED'},
        paperFeedHealth:s.lastPaperFeedHealth||null,
        releaseMarkers:this.ctx.storage.sql.exec(
          'SELECT tag,first_engine_tick_at,pre_release_reference_at,description FROM release_markers ORDER BY first_engine_tick_at DESC LIMIT 5'
        ).toArray(),
        recentWindows:this.ctx.storage.sql.exec(
         'SELECT data FROM window_outcomes ORDER BY close_at DESC LIMIT 16'
        ).toArray().map(r=>JSON.parse(r.data))});
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
      const windows=sql.exec(
        'SELECT data FROM window_outcomes WHERE close_at<=? ORDER BY close_at DESC,ticker DESC LIMIT ? OFFSET ?',
        rawAnchor,rawLimit,rawOffset
      ).toArray().map(r=>JSON.parse(r.data));
      const counts=sql.exec(`SELECT
        (SELECT count(*) FROM events WHERE happened_at<=?) events,
        (SELECT count(*) FROM trades WHERE exit_at<=?) trades,
        (SELECT count(*) FROM decisions WHERE decided_at<=?) decisions,
        (SELECT count(*) FROM window_outcomes WHERE close_at<=?) windows`,
        rawAnchor,rawAnchor,rawAnchor,rawAnchor).toArray()[0];
      return json({paperOnly:true,readOnly:true,anchor:rawAnchor,offset:rawOffset,limit:rawLimit,
        totals:{...counts,paperResults:paperResults(sql,RELEASE_TAG),
          officialWindows:sql.exec("SELECT count(*) n FROM window_outcomes WHERE status='OFFICIAL_RESULT'").toArray()[0].n},
        events,trades,decisions,windows,
        releaseMarkers:sql.exec(
         'SELECT tag,first_engine_tick_at,pre_release_reference_at,description FROM release_markers ORDER BY first_engine_tick_at DESC LIMIT 5'
        ).toArray(),
        // Pending settlement is UNCONFIRMED, never counted as a win.
        pending:this.record().pending});
    }
    if(path==='/v1/research'&&req.method==='GET'){
      const q=new URL(req.url).searchParams;
      const rawLimit=q.get('limit')||'80',rawOffset=q.get('offset')||'0',
        rawAnchor=q.get('anchor');
      const valid=v=>/^\d{1,15}$/.test(v);
      if(!valid(rawLimit)||!valid(rawOffset)||
         (rawAnchor!==null&&!valid(rawAnchor)))
        return json({error:'Invalid research request'},400);
      try{
        const page=researchPage(this.ctx.storage.sql,{
          limit:Number(rawLimit),offset:Number(rawOffset),
          anchor:rawAnchor===null?null:Number(rawAnchor)});
        return json({paperOnly:true,readOnly:true,version:'V4',...page});
      }catch{return json({error:'Invalid research pagination'},400)}
    }
    if(path==='/v1/quotes'&&req.method==='GET'){
      const u=new URL(req.url),rawLimit=u.searchParams.get('limit')||'240',
        limit=Number(rawLimit),ticker=u.searchParams.get('ticker')||null;
      if(!/^\d{1,3}$/.test(rawLimit)||!Number.isInteger(limit)||limit<1||limit>600||
         (ticker&&!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(ticker)))
        return json({error:'Invalid V4 quote history request'},400);
      return json({readOnly:true,paperOnly:true,version:'V4',
        source:'REST proxy: quote receipt timestamp is not true exchange event time',
        quotes:recentQuotes(this.ctx.storage.sql,{ticker,limit})});
    }
    if(path==='/v1/stream'&&req.method==='GET'){
      const q=new URL(req.url).searchParams;
      const limitRaw=q.get('limit')||'60',anchorRaw=q.get('anchor'),
        beforeRaw=q.get('before'),ticker=q.get('ticker');
      const valid=v=>/^\d{1,15}$/.test(v);
      if(!valid(limitRaw)||(anchorRaw!==null&&!valid(anchorRaw))||
         (beforeRaw!==null&&!valid(beforeRaw)))
        return json({error:'Invalid stream archive request'},400);
      try{
        return json(streamPage(this.ctx.storage.sql,{
          limit:Number(limitRaw),anchor:anchorRaw===null?null:Number(anchorRaw),
          before:beforeRaw===null?null:Number(beforeRaw),ticker}));
      }catch{return json({error:'Invalid stream archive request'},400)}
    }
    if(path==='/v1/storage-inventory'&&req.method==='GET'){
      // Explicit authenticated viewer request only; no background inventory scans.
      // Returns table counts/age/size only, never licensed raw observations.
      try{return json(getV4StorageInventory(this.ctx.storage.sql))}
      catch{return json({error:'V4 storage inventory unavailable'},503)}
    }
    if(path==='/v1/cf-ws-verify'&&req.method==='GET'){
      // Called by the authenticated viewer on a SEPARATE named Durable Object,
      // never the V4 recording/decision instance. Does not record market values.
      if(this.env.V4_CF_WS_PROBE_ENABLED!=='true')
        return json({state:'WS_PROBE_DISABLED',websocketVerified:false,archived:false});
      const now=Date.now(),last=this.ctx.storage.kv.get('cf-ws-verification-last-at')||0;
      if(now-last<90000)
        return json({state:'WS_PROBE_COOLDOWN',nextEligibleAt:last+90000,
          websocketVerified:false,archived:false});
      this.ctx.storage.kv.put('cf-ws-verification-last-at',now);
      let result;
      try{
        result=await verifyCFWebSocket({
          keyId:this.env.KALSHI_V4_READ_KEY_ID,
          privatePem:this.env.KALSHI_V4_READ_PRIVATE_KEY,
          nowFn:Date.now,timeoutMs:10000
        });
      }catch{result={state:'WS_PROBE_ERROR',websocketVerified:false,archived:false}}
      return json({...result,checkedAt:Date.now(),readOnly:true,paperOnly:true});
    }
    if(path==='/v1/cf-access'&&req.method==='GET'){
      if(this.env.V4_CF_ACCESS_PROBE_ENABLED!=='true')
        return json({state:'DISABLED',validValuesVerified:false,readOnly:true,paperOnly:true});
      const now=Date.now(),cached=this.ctx.storage.kv.get('cf-access-result-v2-latest');
      if(cached&&Number.isSafeInteger(cached.checkedAt)&&now-cached.checkedAt<(cached.validValuesVerified?6*60*60*1000:5*60*1000))
        return json({...cached,readOnly:true,paperOnly:true,cached:true});
      const result=await checkCFValuesAccess({
        keyId:this.env.KALSHI_V4_READ_KEY_ID,
        privatePem:this.env.KALSHI_V4_READ_PRIVATE_KEY,now});
      const clean={...result,checkedAt:Date.now(),source:'KALSHI_AUTHENTICATED_CF_VALUES_REST'};
      this.ctx.storage.kv.put('cf-access-result-v2-latest',clean);
      return json({...clean,readOnly:true,paperOnly:true,cached:false});
    }
    if(path==='/v1/full-book'&&req.method==='GET'){
      const q=new URL(req.url).searchParams;
      const limit=q.get('limit')||'40',anchor=q.get('anchor'),
        before=q.get('before'),ticker=q.get('ticker');
      const valid=v=>/^\d{1,15}$/.test(v);
      if(!valid(limit)||Number(limit)>100||(anchor!==null&&!valid(anchor))||
         (before!==null&&!valid(before))||
         (ticker!==null&&!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(ticker)))
        return json({error:'Invalid raw book archive request'},400);
      try{return json(fullBookArchivePage(this.ctx.storage.sql,{
        limit:Number(limit),anchor:anchor===null?null:Number(anchor),
        before:before===null?null:Number(before),ticker
      }))}catch{return json({error:'Raw book history unavailable'},400)}
    }
    if((path==='/v1/benchmark'||path==='/v1/public-trades')&&req.method==='GET'){
      const q=new URL(req.url).searchParams,
        limit=q.get('limit')||'60',anchor=q.get('anchor'),
        before=q.get('before'),ticker=q.get('ticker');
      const valid=v=>/^\d{1,15}$/.test(v);
      if(!valid(limit)||Number(limit)>100||
        (anchor!==null&&!valid(anchor))||(before!==null&&!valid(before))||
        (ticker!==null&&!/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(ticker)))
        return json({error:'Invalid research-source request'},400);
      try{return json(independentResearchPage(this.ctx.storage.sql,{
        kind:path==='/v1/benchmark'?'benchmark':'trades',
        anchor:anchor===null?null:Number(anchor),
        before:before===null?null:Number(before),limit:Number(limit),ticker
      }))}catch{return json({error:'Research source page unavailable'},400)}
    }
    if(path==='/v1/rest-book'&&req.method==='GET'){
      const q=new URL(req.url).searchParams,limitRaw=q.get('limit')||'60',
        anchorRaw=q.get('anchor'),beforeRaw=q.get('before'),ticker=q.get('ticker');
      const valid=v=>/^\d{1,15}$/.test(v);
      if(!valid(limitRaw)||(anchorRaw!==null&&!valid(anchorRaw))||
         (beforeRaw!==null&&!valid(beforeRaw)))
        return json({error:'Invalid V4 REST book archive request'},400);
      try{
        return json(restBookPage(this.ctx.storage.sql,{
          limit:Number(limitRaw),anchor:anchorRaw===null?null:Number(anchorRaw),
          before:beforeRaw===null?null:Number(beforeRaw),ticker}));
      }catch{return json({error:'Invalid REST book pagination'},400)}
    }
    if(path==='/v1/quote-archive'&&req.method==='GET'){
      const q=new URL(req.url).searchParams,rawLimit=q.get('limit')||'100',
        rawOffset=q.get('offset')||'0',rawAnchor=q.get('anchor');
      const valid=v=>/^\d{1,15}$/.test(v);
      if(!valid(rawLimit)||!valid(rawOffset)||
         (rawAnchor!==null&&!valid(rawAnchor)))
        return json({error:'Invalid quote archive request'},400);
      try{
        return json({paperOnly:true,readOnly:true,version:'V4',
          ...quoteArchivePage(this.ctx.storage.sql,{
            limit:Number(rawLimit),offset:Number(rawOffset),
            anchor:rawAnchor===null?null:Number(rawAnchor)})});
      }catch{return json({error:'Invalid quote archive pagination'},400)}
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
      return json({error:'V4 foundation is hard-disarmed by code; paper entry activation is unavailable',
        paperOnly:true,armed:s.armed},409);
    else if(path==='/v1/stop'){
      // Stopping V4 monitoring must also terminate the paid outbound stream.
      // This is a server-admin action; no viewer/public endpoint exposes it.
      this.stream?.stop();
      this.researchStream?.stop();
      s.monitoring=false;s.armed=false;this.save(s);
      await this.ctx.storage.deleteAlarm();
      if(this.stream)appendStreamEvent(this.ctx.storage.sql,{
        kind:'STREAM_STOPPED',at:Date.now(),detail:'V4 monitoring stopped by admin'});
    }
    else return json({error:'Not found'},404);
    return json({ok:true,monitoring:s.monitoring,armed:s.armed});
  }
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path==='/health')return json({ok:true,service:'ETH-15 Scout Cloud V4 SHADOW',paperOnly:true});
    if(!env.SCOUT_ADMIN_TOKEN)return json({error:'Admin secret not configured'},503);
    if(req.headers.get('Authorization')!=='Bearer '+env.SCOUT_ADMIN_TOKEN)
      return json({error:'Unauthorized'},401);
    const stub=env.SCOUT_V4.getByName('v4-single-paper-scout');
    return stub.fetch(new Request('https://internal'+path,req));
  },
  async scheduled(_event,env,ctx){
    const stub=env.SCOUT_V4.getByName('v4-single-paper-scout');
    ctx.waitUntil(stub.fetch('https://internal/bootstrap'));
  }
};
