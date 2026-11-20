import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate3m,analyzeStructure,completedFresh,structuralEntry,
  structuralExit,buildDailyRegime} from '../src/structure.js';
import {freshPaperState,makeV2Engine} from '../src/v2.js';

const now=Date.now();
const floor3=Math.floor(now/180000)*180;
function bars(n,step,start,base=100,slope=.2){
  return Array.from({length:n},(_,i)=>{
    const c=base+i*slope,op=c-.1;
    return [start+i*step,op,c+.25,c-.25,c,c,10+i%5,1];
  });
}
const oneSignal={last:1795,prev:1794,e8:1794,e8prev:1793,e21:1792,
  rNow:60,rPrev:45,mNow:2,mPrev:-1,sNow:1,sPrev:0,three:1,sd:2};
const weakOne={last:1780,prev:1783,e8:1790,e8prev:1790,e21:1800,
  rNow:25,rPrev:40,mNow:-5,mPrev:-4,sNow:0,sPrev:0,three:-5,sd:2};
const slow={e21:1790,e50:1780,macd:2,signal:1,rsi:60};
function m(minutes=10){
  return {ticker:'KXETH15M-SWING-TEST',status:'active',
    close_time:new Date(Date.now()+minutes*60000).toISOString(),
    floor_strike:'1795',yes_ask_dollars:'0.60',yes_bid_dollars:'0.59',
    no_ask_dollars:'0.41',no_bid_dollars:'0.40',
    yes_ask_size_fp:'30',yes_bid_size_fp:'30'};
}
const three={trend:'UP',price:1795,prevClose:1794.5,range:1,
  e8:1794,e21:1793,rsi:60,
  bands:{lower:1788,upper:1801,mid:1795,width:.01},adDelta:15,
  support:null,resistance:null,tolerance:1,closedAt:1200};
const five={trend:'UP',price:1795,prevClose:1794,range:2,
  e8:1793,e21:1792,rsi:60,
  bands:{lower:1787,upper:1803},adDelta:20,
  support:null,resistance:null,tolerance:1};
const ctx=(closedAt=1200,th=three,fi=five,reg=null)=>({
  strict:true,oneClosedAt:closedAt,three:th,five:fi,
  regime:reg||{status:'unavailable',regime:'UNKNOWN',eventRisk:'unverified'}
});

test('3-minute candles aggregate only three consecutive CLOSED UTC-aligned one-minute bars',()=>{
  const ts=floor3-6*60;
  const input=bars(8,60,ts,100,.2);
  const out=aggregate3m(input);
  assert.equal(out.length,2);
  assert.equal(out[0][0],ts);
  assert.equal(out[0][6],input.slice(0,3).reduce((a,r)=>a+r[6],0));
  assert.equal(out[0][2],Math.max(...input.slice(0,3).map(r=>r[2])));
  assert.equal(out[0][4],input[2][4]);
  assert.equal(out[1][0],ts+180);
  assert.equal(aggregate3m(input.slice(0,2)).length,0);
});

test('3m structure computes completed trend, Bollinger, A/D without creating trade signals',()=>{
  const a=bars(75,180,floor3-75*180,100,.15);
  const s=analyzeStructure(a);
  assert.ok(s);assert.equal(s.trend,'UP');
  assert.ok(s.bands.upper>s.bands.mid&&s.bands.mid>s.bands.lower);
  assert.ok(s.adDelta>0);assert.ok(Number.isFinite(s.range));
});

test('stale and future timestamps cannot be treated as fresh completed candles',()=>{
  const fresh=bars(30,60,Math.floor(now/60000)*60-30*60,100,.1);
  assert.equal(completedFresh(fresh,1,now),true);
  const stale=bars(30,60,Math.floor(now/60000)*60-40*60);
  assert.equal(completedFresh(stale,1,now),false);
  const future=bars(30,60,Math.floor(now/60000)*60+6*60);
  assert.equal(completedFresh(future,1,now),false);
});

test('3m or 5m adverse primary trend overrides a bullish 1m signal',()=>{
  const down={...three,trend:'DOWN'};
  assert.equal(structuralEntry('UP',down,five).ok,false);
  assert.equal(structuralEntry('UP',three,{...five,trend:'DOWN'}).ok,false);
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(m(),oneSignal,slow,true,ctx(1200,down,five));
  assert.equal(s.open,null);
});

test('5m resistance can veto UP entry, 5m support can veto DOWN entry',()=>{
  const barrier={...five,resistance:{center:1796,lower:1795.5,upper:1796.5,touches:3}};
  assert.equal(structuralEntry('UP',three,barrier).ok,false);
  assert.match(structuralEntry('UP',three,barrier).reason,/resistance/);
  assert.equal(structuralEntry('UP',three,five).ok,true);
});

test('Bollinger and A/D only add a secondary caution, never authorize an entry',()=>{
  const stretched={...three,price:1806,adDelta:-10};
  const z=structuralEntry('UP',stretched,five);
  assert.equal(z.ok,true);
  assert.equal(z.secondaryCaution,true);
  assert.equal(structuralEntry('UP',{...stretched,adDelta:10},five).secondaryCaution,false);
  const s=freshPaperState();s.armed=true;
  const caution={...three,bands:{...three.bands,upper:1794},adDelta:-10};
  makeV2Engine(s).step(m(),{...oneSignal,rNow:48,rPrev:45},slow,true,ctx(1200,caution,five));
  // A/D cannot itself produce a buy, even with a high score elsewhere.
  assert.equal(s.open,null);
});

test('no fresh 3m/5m context means NO NEW PAPER ENTRY even with strong 1m signals',()=>{
  const s=freshPaperState();s.armed=true;
  makeV2Engine(s).step(m(),oneSignal,slow,true,{strict:true});
  assert.equal(s.open,null);
  assert.match(s.window?.reason||'',/structure/);
});

test('discretionary exit requires 3m/5m confirmation AND two DISTINCT completed 1m candles',()=>{
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  engine.step(m(10),oneSignal,slow,true,ctx());
  assert.ok(s.open);
  const th={...three,trend:'DOWN',price:1780,e8:1785};
  const fi={...five,trend:'DOWN'};
  const quote=m(6);quote.yes_bid_dollars='0.50';
  engine.step(quote,weakOne,slow,true,ctx(1260,th,fi));
  assert.ok(s.open);assert.equal(s.open.reversalConfirmations,1);
  engine.step(quote,weakOne,slow,true,ctx(1260,th,fi));
  assert.ok(s.open);assert.equal(s.open.reversalConfirmations,1);
  engine.step(quote,weakOne,slow,true,ctx(1320,th,fi));
  assert.equal(s.open,null);
  assert.match(s.trades[0].reason,/two-candle reversal/);
});

test('nearby support delays discretionary exits but NOT hard stop',()=>{
  const support={center:1780,lower:1778,upper:1782,touches:3};
  const th={...three,trend:'DOWN',price:1780,prevClose:1781,e8:1785};
  const fi={...five,trend:'DOWN',support,tolerance:1};
  assert.equal(structuralExit('UP',th,fi).confirm,false);
  assert.equal(structuralExit('UP',th,fi).nearSupport,true);
  const s=freshPaperState();s.armed=true;
  const engine=makeV2Engine(s);
  engine.step(m(10),oneSignal,slow,true,ctx());
  assert.ok(s.open);
  const quote=m(6);quote.yes_bid_dollars='0.49';
  engine.step(quote,weakOne,slow,true,ctx(1260,th,fi));
  engine.step(quote,weakOne,slow,true,ctx(1320,th,fi));
  assert.ok(s.open);
  quote.yes_bid_dollars='0.34'; // down >40%: hard loss exit no delay
  engine.step(quote,weakOne,slow,true,ctx(1380,th,fi));
  assert.equal(s.open,null);
  assert.match(s.trades[0].reason,/Stop loss/);
});

test('daily BTC/ETH regime uses completed hourly data and is NOT a macro-event claim',()=>{
  const end=Math.floor(now/3600000)*3600;
  const eth=bars(52,3600,end-52*3600,1700,3.5);
  const btc=bars(52,3600,end-52*3600,80000,70);
  const r=buildDailyRegime(eth,btc,'2026-11-19',now);
  assert.equal(r.status,'ready');
  assert.equal(r.regime,'RISK_ON');
  assert.equal(r.eventRisk,'unverified');
  assert.ok(r.eth24>1&&r.btc24>1);
  const missing=buildDailyRegime([],[], '2026-11-19',now);
  assert.equal(missing.status,'unavailable');
});
