/* Separate main CONSERVATIVE CONTROL paper portfolio.
 * Deliberately independent of the opportunistic engine's bankroll,
 * open position, risk latch, one-buy blocklist and unsettled predictions.
 * Uses the same authenticated as-of snapshot, but private storage key.
 * Does NOT write to the main trades/decisions/settlement-predictions tables.
 * This is a paper simulation with displayed quotes, not verified fills.
 */
import {freshPaperState} from './v2.js';
import {settlementFirstPaperStep} from './settlement-first-paper.js';
import {buildPaperSettlement} from './settlement-accounting.js';
export const CONSERVATIVE_CONTROL_VERSION='V4-CONSERVATIVE-INDEPENDENT-20261123-v1';
export const CONSERVATIVE_CONTROL_STORAGE_KEY='research.conservative.paper.v1';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validTicker=t=>typeof t==='string'&&/^KXETH15M-[A-Za-z0-9-]{5,80}$/.test(t);
const dayNow=n=>Number.isSafeInteger(n)&&n>1000000000000;
const dollar=n=>Number(n.toFixed(2));
export function newConservativePortfolio(now=Date.now()){
 return {...freshPaperState(),version:CONSERVATIVE_CONTROL_VERSION,
  initial:100,cash:100,risk:3,realized:0,armed:false,
  monitoring:true,createdAt:now,paperOnly:true,
  trades:[],decisions:[],events:[],blocked:[],pending:[],
  open:null,window:null,entries:0,exits:0,officialSettlements:0,
  firstFullTickAt:null,lastFullTickAt:null,lastReason:'NOT_STARTED'};
}
export function loadConservativePortfolio(storage,now=Date.now()){
 const raw=storage.get(CONSERVATIVE_CONTROL_STORAGE_KEY);
 if(raw===undefined||raw===null)return newConservativePortfolio(now);
 if(raw.version!==CONSERVATIVE_CONTROL_VERSION||
    !finite(raw.initial)||raw.initial<=0||
    !finite(raw.cash)||raw.cash<0||
    !finite(raw.realized)||!Array.isArray(raw.trades)||
    !Array.isArray(raw.pending)||!Array.isArray(raw.blocked)||
    !Array.isArray(raw.decisions)||!Array.isArray(raw.events)||
    raw.open!==null&&(!validTicker(raw.open?.ticker)||
      !finite(raw.open.cost))||
    !Number.isSafeInteger(raw.entries)||!Number.isSafeInteger(raw.exits)||
    !Number.isSafeInteger(raw.officialSettlements))
   throw Error('CONSERVATIVE_CONTROL_STATE_INVALID');
 return structuredClone(raw);
}
export function prepareConservativePortfolio(existing,{monitoring=true,enabled=true}={}){
 if(existing?.version!==CONSERVATIVE_CONTROL_VERSION)
  throw Error('CONSERVATIVE_CONTROL_BAD_VERSION');
 const x=structuredClone(existing);
 x.monitoring=monitoring===true;x.armed=x.monitoring&&enabled===true;
 return x;
}
export function evaluateConservativePortfolio(existing,inputs){
 if(existing?.version!==CONSERVATIVE_CONTROL_VERSION)
  throw Error('CONSERVATIVE_CONTROL_BAD_VERSION');
 const x=structuredClone(existing);
 // This is the same original paper state machine and exact CONSERVATIVE
 // entry rules, but the controls' own cash/position/risk/blocked state.
 const r=settlementFirstPaperStep(x,{...inputs,
  profile:'CONSERVATIVE',priorOfficialIndex:null,
  onPrediction:()=>{}});
 if(r.status==='PAPER_BUY')x.entries++;
 if(r.status==='PAPER_SELL')x.exits++;
 x.lastFullTickAt=inputs.now;
 if(x.firstFullTickAt===null)x.firstFullTickAt=inputs.now;
 x.lastReason=r.notice||r.status;
 // Bound auxiliary state ONLY. Main state is never accessed.
 x.trades=x.trades.slice(0,150);
 x.decisions=x.decisions.slice(0,250);
 x.events=x.events.slice(0,350);
 x.blocked=x.blocked.slice(-200);
 return {next:x,report:r,summary:conservativePortfolioSummary(x,r)};
}
export function conservativePortfolioSummary(x,r=null){
 if(!x||x.version!==CONSERVATIVE_CONTROL_VERSION)
   return {version:CONSERVATIVE_CONTROL_VERSION,status:'UNAVAILABLE',
    executionAuthorized:false,realFillsVerified:false};
 return {version:CONSERVATIVE_CONTROL_VERSION,paperOnly:true,
  researchControl:true,executionAuthorized:false,realFillsVerified:false,
  status:r?.status||'SAVED',
  reason:r?.notice||x.lastReason,
  bankrollInitial:x.initial,cash:x.cash,realized:x.realized,
  riskMode:x.dailyRisk?.mode||'NOT_ASSESSED',
  open:x.open?{ticker:x.open.ticker,side:x.open.side,
   entry:x.open.entry,qty:x.open.qty,cost:x.open.cost}:null,
  pending:x.pending.length,
  entries:x.entries,earlyExits:x.exits,
  officialSettlements:x.officialSettlements,
  completed:x.trades.length,
  mostRecentTrade:x.trades[0]||null,
  mostRecentDecision:x.lastV4SettlementDecision||null};
}
export function settleConservativePortfolio(existing,sql,now=Date.now()){
 if(existing?.version!==CONSERVATIVE_CONTROL_VERSION||
    !dayNow(now)||!sql?.exec)throw Error('CONSERVATIVE_CONTROL_SETTLE_INVALID');
 const x=structuredClone(existing);
 const pending=[];
 let finalized=0;
 for(const p of x.pending){
  if(!validTicker(p?.ticker)){pending.push(p);continue}
  if(x.trades.some(t=>t.ticker===p.ticker)){finalized++;continue}
  const row=sql.exec('SELECT status,data FROM window_outcomes WHERE ticker=?',
   p.ticker).toArray()[0];
  if(row?.status!=='OFFICIAL_RESULT'){pending.push(p);continue}
  let official;
  try{official=JSON.parse(row.data)}catch{pending.push(p);continue}
  const trade=buildPaperSettlement(p,official,now);
  if(!trade){pending.push(p);continue}
  x.cash=dollar(x.cash+trade.proceeds);
  x.realized=dollar(x.realized+trade.pnl);
  x.trades.unshift({...trade,controlVersion:CONSERVATIVE_CONTROL_VERSION});
  x.officialSettlements++;
  finalized++;
 }
 x.pending=pending;
 x.trades=x.trades.slice(0,150);
 return {next:x,finalized};
}
export function saveConservativePortfolio(storage,portfolio){
 if(portfolio?.version!==CONSERVATIVE_CONTROL_VERSION)
  throw Error('CONSERVATIVE_CONTROL_INVALID_SAVE');
 storage.put(CONSERVATIVE_CONTROL_STORAGE_KEY,structuredClone(portfolio));
}
