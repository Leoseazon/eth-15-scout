/* V4 settlement-first PAPER ONLY state machine.
 * Uses a fresh authenticated Kalshi displayed book for price/size evidence.
 * NO real orders, no broker account, no AI training, no V3 strategy mutation.
 */
import {assessDailyRisk,entryBudget,PAPER_POLICY} from './v3-policy.js';
import {evaluateSettlementFirst,SETTLEMENT_FIRST_VERSION} from './settlement-first.js';
import {scoreBuyConfidence} from './buy-confidence.js';
const valid=n=>Number.isFinite(n);
const cents=n=>Math.ceil(Math.max(0,n)*100-1e-8)/100;
const dollar=n=>Number(n.toFixed(2));
const fee=(price,qty)=>cents(.07*qty*price*(1-price));
const dateKey=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const note=(s,at,type,msg,ticker='')=>(s.events??=[]).unshift({time:at,type,msg,ticker});
function risk(s,now){
 const day=dateKey(now);
 const realizedToday=(s.trades||[]).filter(t=>valid(t.exitAt)&&dateKey(t.exitAt)===day&&valid(t.pnl))
  .reduce((n,t)=>n+t.pnl,0);
 const pending=(s.pending||[]).filter(t=>dateKey(t.time)===day)
  .reduce((n,t)=>n+Math.max(0,t.cost||0),0);
 const openLoss=s.open?valid(s.open.markPnl)?Math.min(0,s.open.markPnl):-s.open.cost:0;
 const previousMode=s.dailyRisk?.day===day?s.dailyRisk.mode:'NORMAL';
 const r=assessDailyRisk({initial:s.initial,realizedToday,openLoss,pendingExposure:pending,
  previousMode,softGuardEnabled:true});
 s.dailyRisk={day,...r};
 return r;
}
function finishWindow(s,now){
 const w=s.window;
 if(!w||w.closed||w.entered||!w.seenArmed)return;
 w.closed=true;
 (s.decisions??=[]).unshift({ticker:w.ticker,time:now,status:'PASS',
  reason:w.reason||'No eligible context-aware settlement-side prediction'});
 note(s,now,'PASS',w.reason||'No eligible context-aware settlement-side prediction',w.ticker);
}
function toPending(s,now){
 if(!s.open)return;
 const pos=s.open;
 (s.pending??=[]).unshift({...pos,status:'PENDING_OFFICIAL_KALSHI'});
 s.open=null;
 note(s,now,'PENDING','Waiting for finalized Kalshi target-side resolution; NO guessed win/loss',pos.ticker);
}
function closeEarly(s,pos,book,bid,why,now){
 const size=Number((pos.side==='UP'?book.yesBid:book.noBid)?.sizeFp);
 if(!valid(size)||size<pos.qty)return false;
 const sellFee=fee(bid,pos.qty),proceeds=dollar(Math.max(0,pos.qty*bid-sellFee));
 const pnl=dollar(proceeds-pos.cost);
 s.cash=dollar(s.cash+proceeds);s.realized=dollar(s.realized+pnl);
 const exitAt=now,remainingSecondsAtExit=Math.max(0,Math.floor((Date.parse(pos.closeTime)-now)/1000));
 (s.trades??=[]).unshift({...pos,status:pnl>0?'WIN':pnl<0?'LOSS':'FLAT',
  exitType:'EARLY SALE',confirmed:true,exitPrice:bid,sellFee,proceeds,pnl,exitAt,
  remainingSecondsAtExit,reason:why,fillVerified:false,
  displayedBookSimulationOnly:true,officialOutcome:null,directionCorrect:null});
 s.open=null;
 note(s,now,'PAPER SELL',why+' '+pos.side+' '+pos.qty+' @ '+bid.toFixed(4)+
  ' gross; estimated P/L $'+pnl.toFixed(2)+'; displayed book only',pos.ticker);
 return true;
}
export function settlementFirstPaperStep(s,{market,index,one,five,context,book,
 now=Date.now(),onPrediction=null}={}){
 if(!s||typeof s!=='object')throw TypeError('Missing paper state');
 s.blocked??=[];s.pending??=[];s.trades??=[];s.decisions??=[];s.events??=[];
 const active=market&&/^KXETH15M-/.test(market.ticker||'')?market:null;
 if(s.open&&Number.isFinite(Date.parse(s.open.closeTime))&&now>=Date.parse(s.open.closeTime))
  toPending(s,now);
 if(s.window &&(!active||s.window.ticker!==active.ticker||now>=s.window.end)){
  finishWindow(s,now);s.window=null;
 }
 if(active&&!s.window&&s.armed){
  s.window={ticker:active.ticker,end:Date.parse(active.close_time),
   entered:s.blocked.includes(active.ticker),reason:'No eligible settlement setup',
   seenArmed:true,closed:false};
 }
 if(s.open){
  const pos=s.open;
  if(active?.ticker===pos.ticker&&book?.ticker===pos.ticker&&
     book?.source==='KALSHI_WEBSOCKET_ORDERBOOK'&&book.valid===true&&
     book.fresh===true&&book.receivedAt<=now&&now-book.receivedAt<=5000){
   const b=pos.side==='UP'?book.yesBid:book.noBid;
   const bid=Number(b?.price),size=Number(b?.sizeFp);
   const remaining=(Date.parse(pos.closeTime)-now)/60_000;
   if(valid(bid)&&bid>0&&bid<1&&valid(size)&&size>=pos.qty){
    const estimatedProceeds=pos.qty*bid-fee(bid,pos.qty);
    pos.markPnl=dollar(estimatedProceeds-pos.cost);
    const decline=(pos.entry-bid)/pos.entry;
    let why=null;
    if(remaining<=PAPER_POLICY.stopLossArmedMinutes&&decline>=.40)
     why='40% contract-price emergency stop (last 6 minutes)';
    else if(bid>=.96&&remaining>1)why='96c executable displayed bid exit';
    if(why&&closeEarly(s,pos,book,bid,why,now)){
     risk(s,now);
     s.lastV4SettlementDecision={at:now,side:pos.side,status:'PAPER_SELL',
      reason:why,modelVersion:SETTLEMENT_FIRST_VERSION};
     return {status:'PAPER_SELL',notice:why,ticker:pos.ticker};
    }
   }
  }
  risk(s,now);
  return {status:'HOLD',notice:'Paper position open; waiting for fresh valid bid, exit or official settlement',
   ticker:s.open?.ticker};
 }
 const r=risk(s,now);
 if(!s.armed)return {status:'DISABLED',notice:'Settlement-first paper trading disabled'};
 if(!r.canEnter)return {status:'WATCH',notice:'Daily $20 hard-risk pause'};
 if((s.pending||[]).length>=4)return {status:'WATCH',notice:'Too many unresolved simulated settlements'};
 if(!active)return {status:'WATCH',notice:'No active KXETH15M market'};
 if(s.blocked.includes(active.ticker))return {status:'WATCH',
  notice:'One-entry-per-market enforced',ticker:active.ticker};
 const d=evaluateSettlementFirst({market:active,index,one,five,context,book,now});
 s.lastV4SettlementDecision={at:now,status:d.status,side:d.side,reason:d.reason,
  target:d.target??null,indexValue:d.indexValue??null,
  normalizedDistance:d.normalizedDistance??null,nonCalibratedScore:d.score??null,
  contradictions:d.contradictionReasons??[],modelVersion:SETTLEMENT_FIRST_VERSION};
 if(d.status!=='CANDIDATE'){
  if(s.window){s.window.reason=d.reason;if(s.window.lastWatch!==d.reason){
   note(s,now,'WATCH',d.reason,active.ticker);s.window.lastWatch=d.reason;}}
  return {status:'WATCH',notice:'PASS / WATCH: '+d.reason,candidate:d};
 }
 let cap=d.ask<.20?.50:3;
 if(r.mode==='SOFT')cap=Math.min(cap,1.50);
 const budget=entryBudget(s.cash,s.risk,cap);
 let qty=Math.floor(budget/d.ask);
 while(qty>0&&qty*d.ask+fee(d.ask,qty)>budget)qty--;
 // Soft daily-loss mode: THREE distinct agreeing evidence families,
 // never 7 correlated checkboxes. Require stronger target geometry,
 // tighter spread, and 2x displayed liquidity than ordinary entries.
 if(r.mode==='SOFT'){
  const direction=d.side==='UP'?1:-1;
  const strong=d.familySupport===3&&d.geometry*direction>=.30&&
    d.momentum*direction>=.25&&d.structure*direction>=.25&&
    Math.abs(d.score)>=.72&&d.contradictionReasons.length===0&&
    valid(d.spread)&&d.spread<=.03&&
    valid(d.askDepth)&&d.askDepth>=2*qty&&
    valid(d.bidDepth)&&d.bidDepth>=2*qty;
  if(!strong||qty<1){
   const reason='SOFT risk: strong target, 3 agreeing families, <=3c spread and >=2x book depth required';
   if(s.window)s.window.reason=reason;
   return {status:'WATCH',notice:reason,candidate:d};
  }
 }
 if(qty<1||!valid(d.askDepth)||d.askDepth<qty||
    !valid(d.bidDepth)||d.bidDepth<qty){
  const reason='Insufficient fee-inclusive budget or displayed two-sided book depth';
  if(s.window)s.window.reason=reason;
  return {status:'WATCH',notice:reason,candidate:d};
 }
 const entryFee=fee(d.ask,qty),cost=dollar(qty*d.ask+entryFee);
 if(cost>s.cash||cost>3.000001)throw Error('Paper stake ceiling violated');
 const entryConfidence=scoreBuyConfidence({
  side:d.side,score:d.score,geometry:d.geometry,momentum:d.momentum,
  structure:d.structure,familySupport:d.familySupport,
  contradictionReasons:d.contradictionReasons,spread:d.spread,
  indexAgeMs:Math.max(0,now-d.indexSourceAt),
  bookAgeMs:Math.max(0,now-d.bookReceiptAt)
 });
 if(!entryConfidence)return {status:'WATCH',
  notice:'Buy-confidence inputs unavailable; no paper entry'};
 const pos={ticker:active.ticker,side:d.side,qty,entry:d.ask,entryFee,
  cost,time:now,target:d.target,indexValue:d.indexValue,
  indexSourceAt:d.indexSourceAt,closeTime:active.close_time,
  strategy:'V4_SETTLEMENT_FIRST',strategyVersion:SETTLEMENT_FIRST_VERSION,
  modelEvidence:{normalizedDistance:d.normalizedDistance,
   geometry:d.geometry,momentum:d.momentum,structure:d.structure,
   heuristicScore:d.score,contradictionReasons:d.contradictionReasons,
   familySupport:d.familySupport,bookReceiptAt:d.bookReceiptAt,
   remainingSeconds:d.remainingSeconds},
  entryQuoteSource:'KALSHI_WEBSOCKET_ORDERBOOK_DISPLAYED_ONLY',fillVerified:false,
  entryConfidence,
  liveConfidence:{...entryConfidence,status:'CURRENT',asOf:now,
    contractTicker:active.ticker,side:d.side,
    caveat:'Initial heuristic entry-confidence score, not probability of winning.'},
  confidenceHistory:[{at:now,value:entryConfidence.value}],
  calibratedProbability:null,markPnl:null};
 // Stage a unique settlement prediction before simulated debit. The caller
 // must COMMIT forecast and bankroll in one atomic storage transaction.
 try{
  if(typeof onPrediction!=='function')throw Error('Forecast journal callback unavailable');
  onPrediction(pos);
 }
 catch{
  note(s,now,'PAPER ENTRY BLOCKED','Forecast journal unavailable; no cash debited',active.ticker);
  return {status:'WATCH',notice:'Forecast journal unavailable; paper entry aborted'};
 }
 s.cash=dollar(s.cash-cost);s.open=pos;s.blocked.push(active.ticker);
 if(s.window)s.window.entered=true;
 note(s,now,'PAPER BUY','Settled-side hypothesis '+d.side+' '+qty+' @ '+
  d.ask.toFixed(4)+'; all-in $'+cost.toFixed(2)+
  '; confidence '+entryConfidence.value+'/100 (heuristic, not win odds)'+
  '; displayed book, not a confirmed execution',active.ticker);
 s.lastV4SettlementDecision={...s.lastV4SettlementDecision,status:'PAPER_BUY',qty,
  cost,entryFee,entry:d.ask,entryConfidenceScore:entryConfidence.value,
  confidenceVersion:entryConfidence.version};
 risk(s,now);
 return {status:'PAPER_BUY',notice:'Experimental settlement-first paper '+d.side+
  ' × '+qty+' @ '+d.ask.toFixed(4)+'; $'+cost.toFixed(2)+' with fees; '+
  'BUY confidence '+entryConfidence.value+'/100 (not win probability)',
  ticker:active.ticker,position:pos};
}
