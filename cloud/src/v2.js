/* Original V2 strategy functions ported from main/paperbot.js and index.html.
 * Deliberately unchanged trading logic; no live Kalshi account or orders.
 * The surrounding cloud scheduler and storage are new. See README.
 */
import {PAPER_POLICY, entryBudget, entryGate, profitExitGate, assessDailyRisk} from './v3-policy.js';
import {structuralEntry, structuralExit} from './structure.js';
import {EARLY_POLICY,signalFamilies,settlementRewardQuality,earlyCountertrendGate,opportunityScore} from './early-opportunity.js';
import {LATE_VALUE_POLICY,lateValueGate} from './late-value.js';
import {HONEY_POLICY,honeyPotGate,honeyStopTriggered} from './honey-pot.js';

export const freshPaperState = () => ({
  initial:100,cash:100,realized:0,armed:false,risk:PAPER_POLICY.defaultRiskPercent,open:null,pending:[],
  trades:[],decisions:[],events:[],window:null,blocked:[]
});
const fee = (price, qty) => Math.ceil(Math.max(0, 0.07 * qty * price * (1 - price)) * 100 - 1e-8) / 100;
const money = x => Number.isFinite(x) ? (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2) : '—';
const cents = x => Number.isFinite(x) ? (x * 100).toFixed(1) + '¢' : '—';
function ema(a,n){if(a.length<n) return NaN;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e+=k*(a[i]-e);return e}

function emaSeries(a,n){const out=Array(a.length).fill(NaN);if(a.length<n)return out;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n;out[n-1]=e;let k=2/(n+1);for(let i=n;i<a.length;i++){e+=k*(a[i]-e);out[i]=e}return out}

function rsi(a,n=14){if(a.length<n+2)return NaN;let up=0,dn=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];up+=Math.max(0,d);dn+=Math.max(0,-d)}up/=n;dn/=n;for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];up=(up*(n-1)+Math.max(0,d))/n;dn=(dn*(n-1)+Math.max(0,-d))/n}return dn===0?(up===0?50:100):100-100/(1+up/dn)}

export function indicators(rows){const c=rows.map(r=>+r[4]);const e21=ema(c,21),e50=ema(c,50);const es12=emaSeries(c,12),es26=emaSeries(c,26);const m=c.map((_,i)=>Number.isFinite(es12[i])&&Number.isFinite(es26[i])?es12[i]-es26[i]:NaN);const valid=m.filter(Number.isFinite);const sig=ema(valid,9);let pv=0,vol=0;for(const r of rows.slice(-96)){const v=+r[6],p=(+r[2]+ +r[3]+ +r[4])/3;pv+=p*v;vol+=v};const last=c[c.length-1], prev=c[c.length-2],mVal=valid[valid.length-1];const ranges=rows.slice(-20).map(r=>Number(r[2])-Number(r[3])).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);const medRange=ranges.length?ranges[Math.floor(ranges.length/2)]:NaN;const recent=rows.slice(-70),lows=[],highs=[];for(let i=3;i<recent.length-3;i++){const low=+recent[i][3],high=+recent[i][2];if(recent.slice(i-3,i+4).every((r,j)=>j===3||low<=+r[3]))lows.push(low);if(recent.slice(i-3,i+4).every((r,j)=>j===3||high>=+r[2]))highs.push(high)}const support=lows.filter(x=>x<last).sort((a,b)=>b-a)[0];const resistance=highs.filter(x=>x>last).sort((a,b)=>a-b)[0];const rv=rsi(c);return {range:medRange,last,prev,e21,e50,rsi:rv,macd:mVal,signal:sig,vwap:vol?pv/vol:NaN,support,resistance};}

function bestMarket(j){const now=Date.now();const arr=(j.markets||[]).filter(m=>m.ticker?.startsWith('KXETH15M-')&&['open','active'].includes(m.status)&&new Date(m.close_time).getTime()>now-5000).sort((a,b)=>new Date(a.close_time)-new Date(b.close_time));return arr[0]||null}

const chicagoDay = ts => new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(ts));

export function makeV2Engine(state) {
  let notice = '';
  const persist = () => {}; // Committed atomically by the cloud object after each tick.
  const note = (type,msg,ticker='',extra={}) => {
    state.events.unshift({time:Date.now(),type,msg,ticker,...extra});
  };
  const secondsLeft=(closeTime,at)=>{
    const close=Date.parse(closeTime);
    return Number.isFinite(close)&&Number.isFinite(at)?Math.max(0,Math.ceil((close-at)/1000)):null;
  };
  const clockLabel=seconds=>seconds===null?'time remaining unknown':
    Math.floor(seconds/60)+'m '+String(seconds%60).padStart(2,'0')+'s remaining';

function quote(m,side,bidask) {
 const key=(side==='UP'?'yes_':'no_')+(bidask==='ask'?'ask_dollars':'bid_dollars');
 const n=Number(m?.[key]);
 return m?.[key] != null && n>0 && n<1 ? n : NaN;
}

function depth(m,side,bidask) {
 // Kalshi's market schema publishes YES-side sizes. NO ask = YES bid; NO bid = YES ask.
 const key=side==='UP'?(bidask==='ask'?'yes_ask_size_fp':'yes_bid_size_fp'):(bidask==='ask'?'yes_bid_size_fp':'yes_ask_size_fp');
 const v=m?.[key];const n=v==null?NaN:Number(v);return Number.isFinite(n)&&n>=0?n:NaN;
}

function cleanArray(a) { return a.filter(Number.isFinite); }

function fastScan(rows) {
 const c=rows.map(x=>Number(x[4])).filter(Number.isFinite);
 if(c.length<50) return null;
 const e8=emaSeries(c,8),e21=emaSeries(c,21),e6=emaSeries(c,6),e13=emaSeries(c,13);
 const macd=c.map((_,i)=>Number.isFinite(e6[i])&&Number.isFinite(e13[i])?e6[i]-e13[i]:NaN);
 const signal=emaSeries(cleanArray(macd),5);
 const last=c.length-1;
 const rNow=rsi(c,9),rPrev=rsi(c.slice(0,-3),9);
 const mNow=macd[last],mPrev=macd[last-2],sNow=signal[signal.length-1],sPrev=signal[signal.length-3];
 if(![rNow,rPrev,mNow,mPrev,sNow,sPrev,e8[last],e8[last-2],e21[last]].every(Number.isFinite))return null;
 const returns=c.slice(-31).map((x,i,a)=>i>0?x-a[i-1]:0).slice(1);
 const avg=returns.reduce((a,b)=>a+b,0)/returns.length;
 const sd=Math.sqrt(returns.reduce((a,b)=>a+(b-avg)**2,0)/returns.length);
 return {last:c[last],prev:c[last-2],e8:e8[last],e8prev:e8[last-2],e21:e21[last],rNow,rPrev,mNow,mPrev,sNow,sPrev,
   three:c[last]-c[last-3],sd};
}

function judge(side,m1,m5,market,remaining) {
 const d=side==='UP'?1:-1;
 const yes = test => d===1?test:!test;
 let checks=[];
 checks.push({name:'1m price vs EMA8',ok:yes(m1.last>m1.e8)});
 checks.push({name:'1m EMA8 vs EMA21',ok:yes(m1.e8>m1.e21)});
 checks.push({name:'1m RSI9 direction',ok:d*(m1.rNow-m1.rPrev)>=2});
 checks.push({name:'1m RSI9 side of 50',ok:yes(m1.rNow>50)});
 checks.push({name:'1m MACD vs signal',ok:yes(m1.mNow>m1.sNow)});
 checks.push({name:'1m 3-candle move',ok:d*m1.three>0});
 checks.push({name:'1m MACD acceleration',ok:d*((m1.mNow-m1.sNow)-(m1.mPrev-m1.sPrev))>0});
 // Reversal entry requires a turn, not just a pre-existing trend.
 const cross=d===1?
   (m1.last>m1.e8 && m1.prev<=m1.e8prev)||(m1.mNow>m1.sNow&&m1.mPrev<=m1.sPrev)||(m1.rNow>50&&m1.rPrev<=50):
   (m1.last<m1.e8 && m1.prev>=m1.e8prev)||(m1.mNow<m1.sNow&&m1.mPrev>=m1.sPrev)||(m1.rNow<50&&m1.rPrev>=50);
 const turn=Boolean(cross || (d*(m1.rNow-m1.rPrev)>=6 && d*m1.three>0 && d*(m1.mNow-m1.sNow)>0));
 const passed=checks.filter(c=>c.ok).length;
 // Spot is NOT the official CF Benchmarks ETH index. This checks plausibility only.
 const target=Number(market.floor_strike);
 const plausible=Number.isFinite(target)&&m1.sd>0 &&
   Math.abs(m1.last-target)<=Math.max(3,2.75*m1.sd*Math.sqrt(Math.max(1,remaining)));
 const alignment=m5 && (side==='UP'?m5.rsi>30:m5.rsi<70);
 return {side,passed,checks,turn,plausible,alignment,
   detail:checks.filter(c=>c.ok).map(x=>x.name).join(', ')};
}

function priceBucketOf(p){return p<.35?'Under 35¢':p<.70?'35–69¢':'70¢ and up'}

function recentLearning(priceBucket) {
 const a=state.trades.filter(x=>x.confirmed&&x.bucket===priceBucket).slice(0,16);
 const n=a.length,net=a.reduce((sum,x)=>sum+x.pnl,0);
 return {n,net,extra:(n>=8&&net<0)?1:0};
}

function chooseCandidate(m,one,m5,remaining,rejections=[],context=null,riskMode='NORMAL'){
 const target=Number(m.floor_strike);
 if(!Number.isFinite(target)||!one||!m5)return null;
 // FAIL CLOSED in V3: direct calls cannot skip higher-priority structure.
 if(!context?.three||!context?.five||!Number.isFinite(context?.oneClosedAt)){
   rejections.push('Incomplete fresh 1m/3m/5m structure');return null;
 }
 const ranked=[];
 for(const side of ['UP','DOWN']){
   const price=quote(m,side,'ask'),bid=quote(m,side,'bid');
   const askSize=depth(m,side,'ask'),bidSize=depth(m,side,'bid');
   if(!Number.isFinite(price)||!Number.isFinite(bid)||!Number.isFinite(askSize)||!Number.isFinite(bidSize))continue;
   const spread=price-bid;
   // No fixed contract-price floor or ceiling; the real filter is quote quality, fees and setup.
   if(!(price>0&&price<1&&bid>=0&&bid<=price&&spread<=Math.min(.065,Math.max(.035,price*.10))))continue;
   const signal=judge(side,one,m5,m,remaining);
   const d=side==='UP'?1:-1;
   const slowTrend=d===1?(m5.e21>m5.e50&&m5.macd>m5.signal&&m5.rsi>=52&&m5.rsi<=78)
                       :(m5.e21<m5.e50&&m5.macd<m5.signal&&m5.rsi<=48&&m5.rsi>=22);
   const directionOk=d*(one.last-target)>=-Math.max(2,one.sd*2.5);
   const reachDist=Math.abs(one.last-target)<=Math.max(10,6*one.sd*Math.sqrt(Math.max(remaining,1)));
   const learn=recentLearning(priceBucketOf(price));
 const families=signalFamilies(signal.checks);
 // Price, RSI and MACD are correlated; require two evidence families,
 // not multiple copies of one price movement.
 if(families.breadth<2||!families.price){
   rejections.push(side+': requires a price-direction signal plus momentum/acceleration evidence');continue;
 }
 const regime=context?.regime;
 const macroAgainst=regime?.status==='ready'&&
   ((side==='UP'&&regime.regime==='RISK_OFF')||
    (side==='DOWN'&&regime.regime==='RISK_ON')||regime.volatility==='HIGH');
 const countertrendFive=['UP','DOWN'].includes(context.five.trend)&&context.five.trend!==side;
 // 80-89c late-value trades use a smaller paper stake, fresh independent
 // signals and strike cushion; 5m trend may lag and is contextual.
 const lateBudget=entryBudget(state.cash,state.risk,LATE_VALUE_POLICY.maxStakeWithFees);
 let lateQty=Math.floor(lateBudget/price);
 while(lateQty>0&&lateQty*price+fee(price,lateQty)>lateBudget)lateQty--;
 const lateProof=lateValueGate({side,price,remaining,
   passed:signal.passed,families,onePrice:one.last,strike:target,
   volatility:one.sd,threeTrend:context.three.trend,
   spread,askSize,bidSize,expectedQty:lateQty,riskMode,
   highVolRegime:regime?.status==='ready'&&regime.volatility==='HIGH'});
 const late=lateProof.ok&&signal.passed>=
   (remaining<3?PAPER_POLICY.lateValueFinalChecks:PAPER_POLICY.lateValueEarlierChecks)
   +learn.extra;
 let early=false;
 if(countertrendFive&&!late){
   const budget=entryBudget(state.cash,state.risk,EARLY_POLICY.maxStakeIncludingFees);
   const expectedQty=Math.floor(budget/price);
   const exception=earlyCountertrendGate({side,price,remaining,spread,
     fastChecks:signal.passed,turned:signal.turn,families,
     threeTrend:context.three.trend,fiveTrend:context.five.trend,
     strikePlausible:signal.plausible,directionReachable:directionOk&&reachDist,
     sufficientDepth:expectedQty>=1&&
       askSize>=EARLY_POLICY.minDepthMultiple*expectedQty&&
       bidSize>=EARLY_POLICY.minDepthMultiple*expectedQty,
     macroAgainst});
   if(!exception.ok||signal.passed<EARLY_POLICY.minFastChecks+learn.extra||
     riskMode!=='NORMAL'){
     rejections.push(side+': guarded early reversal unavailable ('+
       (exception.ok?'learning or risk restriction':exception.reason)+')');
     continue;
   }
   early=true;
 }
 const structure=structuralEntry(side,context.three,context.five,
   {allowOpposingFive:early||late,allowSingleBreakout:late&&remaining<=5});
 // Even an early exceptional setup NEVER bypasses 3m trend or
 // 3m/5m pivot resistance/support. A local caution also vetoes it.
 if(!structure.ok||((early||late)&&structure.secondaryCaution)){
   rejections.push(side+': '+(structure.ok?'Guarded trade blocked by local 3m caution':structure.reason));
   continue;
 }
 const addedConfirmation=structure.secondaryCaution||macroAgainst?1:0;
 const reversal=signal.turn&&signal.plausible&&signal.alignment&&
   signal.passed>=4+learn.extra+addedConfirmation;
 const momentum=slowTrend&&directionOk&&reachDist&&
   signal.passed>=5+learn.extra+addedConfirmation;
 if(!reversal&&!momentum&&!late){
   rejections.push(side+': insufficient diversified reversal/momentum evidence');
   continue;
 }
 const gate=entryGate({price,remaining,passed:signal.passed,slowTrend,
   plausible:signal.plausible||late,alignment:signal.alignment,spread,
   lateValueVerified:late});
 if(!gate.ok){rejections.push(side+': '+gate.reason);continue;}
 if(riskMode==='SOFT'){
     // A soft daily-loss breach does NOT block every setup, but a one-minute
     // signal, favorable Bollinger reading, or daily regime can never waive
     // higher-priority structure, liquidity, and fee limitations.
     const aligned=context.three.trend===side&&context.five.trend===side;
     const budget=entryBudget(state.cash,state.risk,PAPER_POLICY.softMaxStakeIncludingFees);
     const expectedQty=Math.floor(budget/price);
     const minDepth=Math.max(2,PAPER_POLICY.softMinimumDepthMultiple*expectedQty);
     if(signal.passed<PAPER_POLICY.softRequiredChecks||!slowTrend||
        !aligned||!signal.plausible||!signal.alignment||
        structure?.secondaryCaution||!Number.isFinite(spread)||
        spread>PAPER_POLICY.softMaxSpread||
        expectedQty<1||askSize<minDepth||bidSize<minDepth){
       rejections.push(side+': 12% soft-loss mode requires 7/7 checks, fully aligned 3m/5m, no structural caution, spread <=3c and 2x book depth');
       continue;
     }
   }
   const strategy=late?'LATE-VALUE':early?'EARLY-REVERSAL':reversal?'REVERSAL':'MOMENTUM';
 const quality=settlementRewardQuality({price,entryFeePerContract:fee(price,1),
   remaining});
 if(!quality.ok){rejections.push(side+': '+quality.reason);continue;}
 // Ranking expresses relative opportunity, NOT a calibrated probability.
 const edgeQuality=opportunityScore({passed:signal.passed,families,
   turned:signal.turn,strategy,spread,quality,remaining,price,
   strikeDirectionFavorable:d*(one.last-target)>=0});
 ranked.push({side,price,bid,signal,strategy,score:edgeQuality,askSize,bidSize,
   breakEven:quality.breakEvenProbability,maxNetSettlementReward:quality.reward,
   signalFamilies:families.breadth,early,
   maxStakeCap:late?LATE_VALUE_POLICY.maxStakeWithFees:
     early?EARLY_POLICY.maxStakeIncludingFees:PAPER_POLICY.maxStakeIncludingFees});
 }
 ranked.sort((a,b)=>b.score-a.score);
 return ranked[0]||null;
}

// Isolated paper experiment: require 4 of 7 fresh 1m checks; 3m/5m
// TREND agreement is not required. Retain strict quote/risk/strike checks.
// Never start a position inside the official final RTI averaging minute.
function chooseHoney(m,one,remaining,rejections=[],riskMode='NORMAL'){
 const sideCandidates=[];
 for(const side of ['UP','DOWN']){
   const price=quote(m,side,'ask'),bid=quote(m,side,'bid');
   if(!Number.isFinite(price)||!Number.isFinite(bid)){
     rejections.push(side+': honey-pot quote unavailable');continue;
   }
   const askSize=depth(m,side,'ask'),bidSize=depth(m,side,'bid');
   const signal=judge(side,one,null,m,remaining);
   const proof=honeyPotGate({side,price,secondsRemaining:remaining*60,
     fastChecks:signal.passed,
     spread:price-bid,askSize,bidSize,krakenPrice:one.last,
     strike:Number(m.floor_strike),oneMinuteVolatility:one.sd,riskMode});
   if(!proof.ok){rejections.push(side+': '+proof.reason);continue;}
   const expected=price+fee(price,1);
   if(expected>HONEY_POLICY.maxAllInStake||expected>state.cash){
     rejections.push(side+': fee-inclusive honey-pot budget unavailable');
     continue;
   }
   sideCandidates.push({side,price,bid,
     signal,
     strategy:'HONEY-POT',maxStakeCap:HONEY_POLICY.maxAllInStake,
     signalFamilies:signalFamilies(signal.checks).breadth,
     maxNetSettlementReward:Number((1-expected).toFixed(2)),
     breakEven:expected,score:proof.margin/proof.requiredMargin,
     askSize,bidSize});
 }
 sideCandidates.sort((a,b)=>b.score-a.score);
 return sideCandidates[0]||null;
}

function decisionComplete(window,reason='No qualifying setup') {
 if (!window || window.entered || window.finished || !window.seenArmed) return;
 window.finished=true;
 state.decisions.unshift({ticker:window.ticker,time:Date.now(),status:'PASS',reason:window.reason||reason});
 // Keep every pass record for learning and audit.
 note('PASS',window.reason||reason,window.ticker);
 persist(); // Save PASS immediately, even if the market feed fails next.
}

function enter(m,side,signal,now,price,strategy='REVERSAL',riskMode='NORMAL',maxStakeCap=PAPER_POLICY.maxStakeIncludingFees,evidence=null) {
 if(state.open || state.pending.length>=4 || state.blocked.includes(m.ticker)) return false;
 if(riskMode==='HARD')return false;
 const budget=entryBudget(state.cash,state.risk,
   Math.min(maxStakeCap,riskMode==='SOFT'?PAPER_POLICY.softMaxStakeIncludingFees:PAPER_POLICY.maxStakeIncludingFees));
 let qty=Math.floor(budget/price);
 while(qty>0 && qty*price+fee(price,qty)>budget)qty--;
 if(qty<1 || !Number.isFinite(depth(m,side,'ask')) || depth(m,side,'ask')<qty) return false;
 const entryFee=fee(price,qty),cost=Number((qty*price+entryFee).toFixed(2));
 if(cost>state.cash)return false;
 state.cash=Number((state.cash-cost).toFixed(2));
 const bucket=priceBucketOf(price);
 const remainingSecondsAtEntry=secondsLeft(m.close_time,now);
 const position={ticker:m.ticker,side,qty,entry:price,entryFee,cost,time:now,
   remainingSecondsAtEntry,target:Number(m.floor_strike),closeTime:m.close_time,priceBucket:bucket,bucket,
   checks:signal.checks.map(c=>[c.name,c.ok]),score:signal.passed,strategy,
   strategyVersion:'V3-80C-EIGHTMIN-20261120',
   signalFamilies:evidence?.signalFamilies??null,
   maximumSettlementRewardPerContract:evidence?.maxNetSettlementReward??null,
   breakEvenSettlementProbability:evidence?.breakEven??null,
   status:'OPEN',bestBid:NaN,highestProfit:0};
 state.open=position;
 state.blocked.push(m.ticker);
 // Retain one-entry-per-contract history for the whole paper journal.
 if(state.window?.ticker===m.ticker)state.window.entered=true;
 note('PAPER BUY',strategy+' '+side+' '+qty+' contracts @ '+cents(price)+' + '+money(entryFee)+' fee; spent '+money(cost)+' · '+clockLabel(remainingSecondsAtEntry),m.ticker,{remainingSeconds:remainingSecondsAtEntry,closeTime:m.close_time});
 notice='SIMULATED BUY ('+strategy+'): '+side+' '+qty+' × '+cents(price)+' = '+money(cost)+' including fee';
 persist();return true;
}

function closeEarly(pos,bid,why,m) {
 const capacity=depth(m,pos.side,'bid');
 if(!Number.isFinite(capacity)||capacity<pos.qty || !Number.isFinite(bid))return false;
 const sellFee=fee(bid,pos.qty);
 const received=Number((pos.qty*bid-sellFee).toFixed(2));
 if(received<0)return false;
 const exitAt=Date.now();
 const remainingSecondsAtExit=secondsLeft(pos.closeTime,exitAt);
 const pnl=Number((received-pos.cost).toFixed(2));
 state.cash=Number((state.cash+received).toFixed(2));
 state.realized=Number((state.realized+pnl).toFixed(2));
 const tr={...pos,status:pnl>0?'WIN':pnl<0?'LOSS':'FLAT',exitPrice:bid,sellFee,proceeds:received,pnl,exitAt,remainingSecondsAtExit,
   confirmed:true,exitType:'EARLY SALE',reason:why};
 state.trades.unshift(tr);
 state.open=null;
 note('PAPER SELL','Closed '+(pnl>0?'WIN':pnl<0?'LOSS':'FLAT')+': '+pos.side+' '+pos.qty+' @ '+cents(bid)+'; received '+money(received)+'; P/L '+money(pnl)+' — '+why+' · '+clockLabel(remainingSecondsAtExit),pos.ticker,{remainingSeconds:remainingSecondsAtExit,closeTime:pos.closeTime});
 notice='PAPER SELL '+pos.side+' '+money(pnl)+' ('+why+')';
 persist();return true;
}

function toPending(pos) {
 state.pending.unshift({...pos,status:'PENDING'});
 // Retain pending settlements until resolved.
 state.open=null;
 note('PENDING','Contract closed; official outcome not verified. No profit/loss assumed.',pos.ticker);
 notice='Pending official result for '+pos.ticker+'. Confirm UP or DOWN after settlement.';
 persist();
}

  function updateDailyRisk(now=Date.now()) {
    const day=chicagoDay(now);
    const realizedToday=state.trades.filter(t=>
      Number.isFinite(t.exitAt)&&chicagoDay(t.exitAt)===day&&Number.isFinite(t.pnl)
    ).reduce((total,t)=>total+t.pnl,0);
    const openLoss=state.open?(Number.isFinite(state.open.markPnl)?
      Math.min(0,state.open.markPnl):-Number(state.open.cost||0)):0;
    // Pending positions are NOT assumed settled. Account for potential loss
    // of their existing stake until official settlement verifies the result.
    const pendingExposure=state.pending.filter(p=>
      Number.isFinite(p.time)&&chicagoDay(p.time)===day
    ).reduce((total,p)=>total+Number(p.cost||0),0);
    const previousMode=state.dailyRisk?.day===day?state.dailyRisk.mode:'NORMAL';
    const next=assessDailyRisk({initial:state.initial,realizedToday,openLoss,
      pendingExposure,previousMode});
    state.dailyRisk={day,...next};
    return state.dailyRisk;
  }

  function step(m,one,m5,fresh=true,context=null) {
    const now=Date.now();
    if(state.window && ((m && state.window.ticker!==m.ticker) || now>state.window.end)){
      decisionComplete(state.window); state.window=null;
    }
    if(state.open && now>=new Date(state.open.closeTime).getTime()) toPending(state.open);
    updateDailyRisk(now);
    if(!m || !m5 || !fresh){
      return {notice:'Waiting for fresh Kalshi and Kraken data; no simulated entry.'};
    }
    if((state.armed||state.open) && (!state.window||state.window.ticker!==m.ticker))
      state.window={ticker:m.ticker,end:new Date(m.close_time).getTime(),entered:state.blocked.includes(m.ticker),reason:'No qualifying paper trade setup',seenArmed:false};
    if(state.armed&&state.window)state.window.seenArmed=true;
    const remaining=(new Date(m.close_time).getTime()-now)/60000;
    if(state.open&&m.ticker===state.open.ticker){
      const pos=state.open,bid=quote(m,pos.side,'bid'),bidDepth=depth(m,pos.side,'bid');
      pos.bestBid=bid;
      const proceeds=Number.isFinite(bid)&&Number.isFinite(bidDepth)&&bidDepth>=pos.qty?pos.qty*bid-fee(bid,pos.qty):NaN;
      pos.markPnl=Number.isFinite(proceeds)?Number((proceeds-pos.cost).toFixed(2)):NaN;
      if(Number.isFinite(proceeds)){
        const gain=(bid-pos.entry)/pos.entry;
        let why=null;
        const targetAction=profitExitGate(bid,remaining);
        // Order of importance: hard stop > 96¢ target > confirmed structure
        // deterioration. Secondary bands/A-D and macro never force exits.
        // Priority above 40% regular stop, 96c profit and final-minute hold.
        // Uses the executable BID; no fill is claimed without sufficient depth.
        if(pos.strategy==='HONEY-POT'&&honeyStopTriggered(pos.entry,bid))
          why='HONEY-POT stop: executable bid >10c below purchase price';
        else if(remaining<PAPER_POLICY.stopLossArmedMinutes &&
           gain<=-PAPER_POLICY.contractStopLossFraction)
          why='Stop loss (−40% contract-price movement; final 6 minutes only)';
        else if(targetAction==='SELL')why='96¢ bid take-profit';
        else if(targetAction==='HOLD_PENDING'){
          notice='Final minute: 96¢+ bid, holding for official settlement (not inferred from Kraken).';
          pos.reversalConfirmations=0;
        }else if(one&&remaining<7&&context?.three&&context?.five&&
          Number.isFinite(context?.oneClosedAt)){
          const q=judge(pos.side,one,m5,m,remaining);
          const structural=structuralExit(pos.side,context.three,context.five);
          if(q.passed<=1&&structural.confirm){
            // Two distinct CLOSED one-minute candles; repeated 30-second
            // observations of one candle cannot trigger a panic exit.
            if(pos.lastReversalCandleTs!==context.oneClosedAt){
              pos.reversalConfirmations=(pos.reversalConfirmations||0)+1;
              pos.lastReversalCandleTs=context.oneClosedAt;
            }
            if(pos.reversalConfirmations>=2)
              why='Confirmed two-candle reversal and 3m/5m structure failure';
          }else{
            pos.reversalConfirmations=0;
            pos.lastReversalCandleTs=null;
          }
        }
        if(why)closeEarly(pos,bid,why,m);
      }else if(remaining<=0)toPending(pos);
    }
    // Refresh risk AFTER marking an open position or recording its exit.
    // If the marked drawdown hits the 20% hard limit, latch that halt for today.
    const dailyRisk=updateDailyRisk(Date.now());
    const freshRemaining=(new Date(m.close_time).getTime()-Date.now())/60000;
    if(state.armed&&!state.open&&freshRemaining>1&&freshRemaining<=PAPER_POLICY.maxEntryMinutes&&one){
      if(!dailyRisk.canEnter)notice='Daily 20% paper risk hard stop reached. No new positions today.';
      else if(state.blocked.includes(m.ticker))notice='No repeat entry for this 15-minute contract.';
      else {
        const rejected=[];
        const c=freshRemaining<PAPER_POLICY.minEntryMinutes?
           chooseHoney(m,one,freshRemaining,rejected,dailyRisk.mode):
           chooseCandidate(m,one,m5,freshRemaining,rejected,context,dailyRisk.mode);
        if(c){
          if(enter(m,c.side,c.signal,Date.now(),c.price,c.strategy,dailyRisk.mode,c.maxStakeCap,c))state.window.entered=true;
          else {
            notice='Qualified '+c.strategy+' setup, but quote depth or fee-adjusted bankroll prevented a simulated fill.';
            state.window.reason=notice;
          }
        }else{
          notice='PASS / WATCH: '+(rejected.length?rejected.join('; ').slice(0,300):'no contract meets reversal/trend, target-reachability, liquidity and quote-quality requirements.');
          state.window.reason=notice;
        }
      }
    }else if(!state.armed&&!state.open)notice='Paper bot paused. No new purchases.';
    // PASS is final only when the market expires. While it remains active,
    // WATCH records a change in rejection reason and the engine keeps scanning.
    if(state.armed && state.window && !state.window.entered && !state.open &&
       notice && !notice.startsWith('Paper bot paused') && state.window.lastWatch!==notice){
      note('WATCH',notice,m.ticker);
      state.window.lastWatch=notice;
      state.window.reason=notice;
    }
    return {notice,remaining,marketTicker:m.ticker};
  }
  return {step,fastScan};
}
