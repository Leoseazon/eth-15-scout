/* ETH-15 Scout V3 completed-candle market structure.
 * Importance: hard guards > 3m/5m structure and zones > 1m trigger >
 * Bollinger/A-D supporting evidence > daily BTC/ETH context.
 * Kraken exchange volume and spot prices are directional proxies, NOT the
 * Kalshi settlement benchmark nor exchange-wide order flow.
 */
const finite = Number.isFinite;
const close = r => Number(r?.[4]);
const median = values => {
  const a=values.filter(finite).sort((x,y)=>x-y);
  return a.length ? a[Math.floor(a.length/2)] : NaN;
};
const avg = a => a.reduce((s,x)=>s+x,0)/a.length;
function ema(a,n){
  if(a.length<n||!a.every(finite))return NaN;
  let e=avg(a.slice(0,n)),k=2/(n+1);
  for(let i=n;i<a.length;i++)e+=k*(a[i]-e);
  return e;
}
function rsi(a,n=14){
  if(a.length<n+2||!a.every(finite))return NaN;
  let up=0,down=0;
  for(let i=1;i<=n;i++){const d=a[i]-a[i-1];up+=Math.max(0,d);down+=Math.max(0,-d)}
  up/=n;down/=n;
  for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];up=(up*(n-1)+Math.max(0,d))/n;down=(down*(n-1)+Math.max(0,-d))/n}
  return down===0?(up===0?50:100):100-100/(1+up/down);
}
export function completedFresh(rows,minutes,now=Date.now()){
  const end=Number(rows?.at(-1)?.[0])*1000;
  return rows?.length>=25 && finite(end) && end>0 && end<=now &&
    now-end <= Math.max(3,minutes*2+2)*60000;
}

// All 3 members must be consecutive CLOSED 1-minute bars aligned to UTC.
export function aggregate3m(rows){
  const byBucket=new Map();
  for(const row of rows||[]){
    const ts=Number(row?.[0]),o=Number(row?.[1]),hi=Number(row?.[2]),
      lo=Number(row?.[3]),cl=Number(row?.[4]),vol=Number(row?.[6]);
    if(![ts,o,hi,lo,cl,vol].every(finite)||hi<Math.max(o,cl)||lo>Math.min(o,cl)||vol<0)continue;
    const aligned=Math.floor(ts/60)*60;
    if(Math.abs(ts-aligned)>1)continue;
    const key=Math.floor(aligned/180)*180;
    if(!byBucket.has(key))byBucket.set(key,new Map());
    byBucket.get(key).set(aligned,row);
  }
  const out=[];
  for(const [start,m] of [...byBucket].sort((a,b)=>a[0]-b[0])){
    const bars=[m.get(start),m.get(start+60),m.get(start+120)];
    if(bars.some(b=>!b))continue;
    const volume=bars.reduce((v,b)=>v+Number(b[6]),0);
    const high=Math.max(...bars.map(x=>Number(x[2])));
    const low=Math.min(...bars.map(x=>Number(x[3])));
    out.push([start,Number(bars[0][1]),high,low,Number(bars[2][4]),
      volume ? bars.reduce((s,b)=>s+Number(b[5]||b[4])*Number(b[6]),0)/volume : Number(bars[2][4]),
      volume]);
  }
  return out;
}
function bands(a,n=20){
  if(a.length<n)return null;
  const recent=a.slice(-n),mean=avg(recent);
  if(!recent.every(finite))return null;
  const sd=Math.sqrt(avg(recent.map(x=>(x-mean)**2)));
  return {mid:mean,upper:mean+2*sd,lower:mean-2*sd,width:mean>0?4*sd/mean:NaN};
}
function adDelta(rows,n=5){
  if(rows.length<n*2)return NaN;
  const calc = bars => bars.reduce((s,r)=>{
    const high=Number(r[2]),low=Number(r[3]),price=close(r),vol=Number(r[6]);
    if(![high,low,price,vol].every(finite)||vol<0)return s;
    return s+(high>low?((2*price-high-low)/(high-low))*vol:0);
  },0);
  // Local A/D *change*, not absolute cumulative number, which is arbitrary.
  return calc(rows.slice(-n));
}
function findZones(rows, price, candleRange){
  const a=rows.slice(-85);
  const tolerance=Math.max(price*.0007,candleRange*.65,0.5);
  const support=[],resistance=[];
  // Only complete swing pivots, with two bars on each side.
  for(let i=2;i<a.length-2;i++){
    const h=Number(a[i][2]),l=Number(a[i][3]);
    if(a.slice(i-2,i+3).every((r,k)=>k===2||l<=Number(r[3])))support.push(l);
    if(a.slice(i-2,i+3).every((r,k)=>k===2||h>=Number(r[2])))resistance.push(h);
  }
  const cluster=points=>{
    const groups=[];
    for(const value of points.sort((x,y)=>x-y)){
      const prev=groups.at(-1);
      if(prev && Math.abs(value-prev.center)<=tolerance){
        prev.values.push(value);prev.center=avg(prev.values);
      }else groups.push({center:value,values:[value]});
    }
    return groups.filter(g=>g.values.length>=2).map(g=>({
      center:g.center,lower:g.center-tolerance,upper:g.center+tolerance,
      touches:g.values.length
    }));
  };
  // Preserve confirmed zones only, and avoid using future bars.
  const s=cluster(support).filter(z=>z.center<=price+tolerance).sort((a,b)=>b.center-a.center)[0]||null;
  const r=cluster(resistance).filter(z=>z.center>=price-tolerance).sort((a,b)=>a.center-b.center)[0]||null;
  return {support:s,resistance:r,tolerance};
}
export function analyzeStructure(rows){
  if(!Array.isArray(rows)||rows.length<25)return null;
  const a=rows.filter(r=>[r?.[0],r?.[2],r?.[3],r?.[4],r?.[6]].every(v=>finite(Number(v))));
  if(a.length<25)return null;
  const cs=a.map(close);const price=cs.at(-1),e8=ema(cs,8),e21=ema(cs,21),osc=rsi(cs);
  const ranges=a.slice(-20).map(r=>Number(r[2])-Number(r[3]));
  const range=median(ranges),band=bands(cs);
  const level=findZones(a,price,range);
  if(![price,e8,e21,osc,range].every(finite)||!band)return null;
  const trend=price>e8&&e8>e21&&osc>=52?'UP':
    price<e8&&e8<e21&&osc<=48?'DOWN':'NEUTRAL';
  return {closedAt:Number(a.at(-1)[0]),price,prev:cs.at(-2),
    e8,e21,rsi:osc,trend,range,bands:band,adDelta:adDelta(a),
    support:level.support,resistance:level.resistance,tolerance:level.tolerance,
    prevClose:cs.at(-2),prevPrevClose:cs.at(-3)};
}
export function structuralEntry(side,three,five,{allowOpposingFive=false,allowSingleBreakout=false}={}){
  if(!three||!five)return {ok:false,reason:'3m/5m structure unavailable'};
  // Primary trend veto; a 1m signal cannot overrule the completed 3m trend.
  if(three.trend!=='NEUTRAL'&&three.trend!==side)
    return {ok:false,reason:'3m trend opposes entry'};
  if(five.trend!=='NEUTRAL'&&five.trend!==side&&!allowOpposingFive)
    return {ok:false,reason:'5m trend opposes entry'};
  const level=side==='UP'?five.resistance:five.support;
  const price=three.price,tol=Math.max(five.tolerance,three.range*.65);
  // Nearby 5m resistance (UP) / support (DOWN) requires a real 3m breakout.
  if(level){
    // Continue treating the zone as relevant just AFTER a shallow breach.
    // Otherwise a single unconfirmed one-candle pierce evades the veto.
    const near=side==='UP'?
      price>=level.lower-tol&&price<=level.upper+2*tol:
      price<=level.upper+tol&&price>=level.lower-2*tol;
    // Near expiry, a sufficiently decisive ONE *completed* 3m close beyond
    // the barrier can qualify only under the separately verified 80–89c gate.
    // Never bypass resistance/support while price remains inside its zone.
    const decisiveOne=allowSingleBreakout&&
      (side==='UP'?three.price>level.upper+tol*.5:
       three.price<level.lower-tol*.5);
    const breakout=decisiveOne||(side==='UP'?
      three.price>level.upper&&three.prevClose>level.upper:
      three.price<level.lower&&three.prevClose<level.lower);
    if(near&&!breakout)return {ok:false,reason:'Nearby 5m support/resistance barrier'};
  }
  const local=side==='UP'?three.resistance:three.support;
  const localDistance=local?(side==='UP'?local.lower-price:price-local.upper):Infinity;
  const localBarrier=!!local&&localDistance>=-three.tolerance&&
    localDistance<=three.tolerance;
  const b=three.bands;
  const stretched=side==='UP'?price>b.upper:price<b.lower;
  const adAgainst=side==='UP'?three.adDelta<0:three.adDelta>0;
  // Strong 5m zone is a primary veto; 3m barrier, Bollinger and A/D
  // add caution only. None can independently create an entry.
  const caution=localBarrier||(stretched&&adAgainst);
  return {ok:true,secondaryCaution:!!caution,
    reason:localBarrier?'Near short-term 3m barrier':
      stretched&&adAgainst?'Bollinger stretch with opposing A/D pressure':'Structure acceptable'};
}
export function structuralExit(side,three,five){
  if(!three||!five)return {confirm:false,nearSupport:false,reason:'Structure unavailable'};
  const badThree=side==='UP'?three.price<three.e8&&three.trend==='DOWN':
    three.price>three.e8&&three.trend==='UP';
  const badFive=side==='UP'?five.trend==='DOWN':five.trend==='UP';
  const majorZone=side==='UP'?five.support:five.resistance;
  const minorZone=side==='UP'?three.support:three.resistance;
  const zone=majorZone||minorZone;
  const margin=majorZone?five.tolerance:three.tolerance;
  const near=zone?(side==='UP'?three.price>=zone.lower-margin&&three.price<=zone.upper+margin:
    three.price<=zone.upper+margin&&three.price>=zone.lower-margin):false;
  const broken=zone?(side==='UP'?three.price<zone.lower-margin && three.prevClose<zone.lower-margin:
    three.price>zone.upper+margin && three.prevClose>zone.upper+margin):false;
  // A/D and Bollinger do not trigger exits; hard stops remain elsewhere.
  return {confirm:badThree&&(badFive||broken)&&(!near||broken),
    nearSupport:near&&!broken,reason:broken?'Confirmed 3m zone breakdown':
      badThree&&badFive?'3m and 5m reversal aligned':'Normal pullback or inconclusive reversal'};
}
export function buildDailyRegime(ethHourly,btcHourly,day,now=Date.now()){
  if(!completedFresh(ethHourly,60,now)||!completedFresh(btcHourly,60,now)||
     ethHourly.length<26||btcHourly.length<26)
    return {day,at:now,status:'unavailable',regime:'UNKNOWN',eventRisk:'unverified'};
  const change=rows=>{
    const c=rows.map(close);
    return (c.at(-1)/c.at(-25)-1)*100;
  };
  const eth24=change(ethHourly),btc24=change(btcHourly);
  const c=ethHourly.slice(-25).map(close);
  const hourlyMoves=c.slice(1).map((x,i)=>Math.abs(x/c[i]-1)*100);
  const maxHourly=Math.max(...hourlyMoves);
  const volume=ethHourly.slice(-24).reduce((s,r)=>s+Number(r[6]||0),0);
  const priorVolume=ethHourly.slice(-48,-24).reduce((s,r)=>s+Number(r[6]||0),0);
  const volumeRatio=priorVolume>0?volume/priorVolume:null;
  const regime=eth24>1&&btc24>1?'RISK_ON':eth24< -1&&btc24< -1?'RISK_OFF':'MIXED';
  return {day,at:now,status:'ready',regime,eth24,btc24,
    volumeRatio,volatility:maxHourly>3?'HIGH':'NORMAL',
    eventRisk:'unverified', // Macro release calendar NOT connected or verified
    source:'Kraken completed hourly ETH/USD and BTC/USD bars'};
}
