/*
 * V4 Gate 5: deterministic out-of-sample evaluation. NO predictive model is
 * bundled here. This evaluator only scores forecasts produced BEFORE close
 * against independently verified final Kalshi outcomes.
 *
 * Important: early resale P&L is NOT the same as settlement accuracy.
 */
const ETH=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const fix=(v,p=6)=>v===null?null:Number(v.toFixed(p));
const validForecast=r=>ETH.test(r?.ticker||'')&&n(r?.pUp)!==null&&
 r.pUp>=0&&r.pUp<=1&&Number.isSafeInteger(r.producedAt)&&
 Number.isSafeInteger(r.closeAt)&&r.producedAt<r.closeAt&&
 typeof r.modelVersion==='string'&&r.modelVersion.length>2&&
 r.source==='V4_OUT_OF_SAMPLE_FORECAST';
const official=w=>ETH.test(w?.ticker||'')&&w.status==='OFFICIAL_RESULT'&&
 ['UP','DOWN'].includes(w.outcome);
function errorMetrics(records){
 let brier=0,logloss=0,count=0,marketBrier=0,marketCount=0;
 const bins=Array.from({length:10},(_,i)=>({
  index:i,count:0,meanForecast:null,observedUpRate:null,_p:0,_y:0}));
 for(const r of records){
  const truth=r.outcome==='UP'?1:0,prob=r.pUp;
  brier+=(prob-truth)**2;
  const safe=Math.max(1e-12,Math.min(1-1e-12,prob));
  logloss-=truth*Math.log(safe)+(1-truth)*Math.log(1-safe);
  count++;
  const idx=Math.min(9,Math.floor(prob*10));
  const b=bins[idx];b.count++;b._p+=prob;b._y+=truth;
  if(n(r.marketUp)!==null&&r.marketUp>=0&&r.marketUp<=1){
    marketBrier+=(r.marketUp-truth)**2;marketCount++;
  }
 }
 for(const b of bins){
  b.meanForecast=b.count?fix(b._p/b.count):null;
  b.observedUpRate=b.count?fix(b._y/b.count):null;
  delete b._p;delete b._y;
 }
 return {count,brier:count?fix(brier/count):null,
  logloss:count?fix(logloss/count):null,
  marketBrier:marketCount?fix(marketBrier/marketCount):null,
  marketCount,bins};
}
export function evaluateOfficialHoldout({forecasts=[],windows=[],targetRemaining=300,
 toleranceSeconds=60,minHoldout=30,minTotal=100,holdoutFraction=.25}={}){
 if(!Array.isArray(forecasts)||!Array.isArray(windows)||
  !Number.isInteger(targetRemaining)||targetRemaining<1||
  !Number.isInteger(toleranceSeconds)||toleranceSeconds<1||
  !Number.isInteger(minHoldout)||minHoldout<1||
  !Number.isInteger(minTotal)||minTotal<minHoldout||
  !Number.isFinite(holdoutFraction)||holdoutFraction<=0||holdoutFraction>=1)
  throw new TypeError('Invalid official holdout evaluation inputs');
 const byTicker=new Map();
 for(const w of windows)if(official(w))byTicker.set(w.ticker,w);
 // One predeclared clock point per market; prevents counting thousands of
 // correlated 1-second observations as thousands of independent outcomes.
 const eligible=new Map();
 for(const p of forecasts){
  if(!validForecast(p))continue;
  const w=byTicker.get(p.ticker);
  if(!w||Number.isFinite(w.closeAt)&&w.closeAt!==p.closeAt)continue;
  const remain=(p.closeAt-p.producedAt)/1000;
  if(Math.abs(remain-targetRemaining)>toleranceSeconds)continue;
  const current=eligible.get(p.ticker);
  if(!current||Math.abs(remain-targetRemaining)<
       Math.abs((current.closeAt-current.producedAt)/1000-targetRemaining))
   eligible.set(p.ticker,{...p,outcome:w.outcome});
 }
 const rows=[...eligible.values()].sort((a,b)=>a.closeAt-b.closeAt||
  a.ticker.localeCompare(b.ticker));
 const holdoutStart=Math.floor(rows.length*(1-holdoutFraction));
 const train=rows.slice(0,holdoutStart);
 const holdout=rows.slice(holdoutStart);
 const sufficient=rows.length>=minTotal&&holdout.length>=minHoldout;
 return {
  status:sufficient?'HOLDOUT_METRICS_UNCALIBRATED_EDGE_NOT_ESTABLISHED':'INSUFFICIENT_EVIDENCE',
  required:{minTotal,minHoldout,targetRemaining,toleranceSeconds,holdoutFraction},
  eligibleMarketWindows:rows.length,
  excludedForecasts:Math.max(0,forecasts.length-rows.length),
  trainingWindow:{count:train.length,
    startAt:train[0]?.closeAt||null,endAt:train.at(-1)?.closeAt||null},
  holdoutWindow:{count:holdout.length,
    startAt:holdout[0]?.closeAt||null,endAt:holdout.at(-1)?.closeAt||null},
  trainMetrics:sufficient?errorMetrics(train):null,
  holdoutMetrics:sufficient?errorMetrics(holdout):null,
  edgeConfirmed:false, // Statistical significance and execution edge need independent tests.
  warnings:[
   'A final-settlement direction score is not a fee-adjusted early-resale P&L.',
   'Only OFFICIAL_RESULT windows are scored; no Kraken-derived labels.',
   'One fixed decision horizon per ticker; multiple updates never count as independent wins.',
   'A successful holdout accuracy score does not establish executable order-book fills.',
   'No probability predictions are shipped or calibrated by this evaluator.'
  ]
 };
}
export function measureBookCoverage(samples,{ticker,startAt,endAt,maxGapMs=5000}){
 if(!ETH.test(ticker||'')||!Number.isSafeInteger(startAt)||
  !Number.isSafeInteger(endAt)||endAt<=startAt||!Number.isInteger(maxGapMs)||
  maxGapMs<1000)throw new TypeError('Invalid stream coverage query');
 const valid=(Array.isArray(samples)?samples:[]).filter(s=>
  s?.ticker===ticker&&s.valid===true&&s.fresh===true&&
  Number.isSafeInteger(s.receivedAt)&&s.receivedAt>=startAt&&s.receivedAt<=endAt)
  .sort((a,b)=>a.receivedAt-b.receivedAt);
 const unique=[...new Set(valid.map(s=>s.receivedAt))].sort((a,b)=>a-b);
 let gapCount=0,longestGapMs=0,coveredMs=0;
 let prior=startAt;
 for(const observed of [...unique,endAt]){
  const gap=observed-prior;
  if(gap>maxGapMs)gapCount++;
  longestGapMs=Math.max(longestGapMs,gap);
  coveredMs+=Math.min(gap,maxGapMs);
  prior=observed;
 }
 return {source:'V4_KALSHI_WEBSOCKET_BOOK',
  ticker,startAt,endAt,receivedSamples:unique.length,
  gapsOverThreshold:gapCount,longestGapMs,
  approximateCoverageFraction:fix(coveredMs/(endAt-startAt)),
  reliable:gapCount===0&&unique.length>=2,
  note:'Coverage proxy based on receipt cadence, not proof of unchanged exchange book or execution'};
}
