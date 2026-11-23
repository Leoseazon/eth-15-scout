import test from 'node:test';
import assert from 'node:assert/strict';
import {replayExitDecisionStudies as replay,
 finalizeExitStudies as finish,summarizeExitStudies as summary,
 EXIT_RESEARCH_VERSION,EXIT_RESEARCH_POLICY}
 from '../src/shadow-exit-counterfactual.js';
const entry=Date.parse('2026-11-23T03:05:00Z');
const close=Date.parse('2026-11-23T03:15:00Z');
const ticker='KXETH15M-26NOV222115-15';
const s=()=>({policy:'A_STRESS_RELAXED',ticker,closeAt:close,
 side:'UP',firstObservedAt:entry,ask:.40,quantity:7,
 allIn:2.92,actualFillVerified:false});
function tick(time,bid,idx=1752,{size=20,validBook=true,
 trend='UP',momentum=1,indexFresh=true}={}){
 return {id:time,source:'V4_ISOLATED_ENGINE_TICK',paperOnly:true,shadowOnly:true,
  observedAt:time,finishedAt:time+300,ticker,closeAt:close,
  feeds:{kraken1m:{ok:true}},
  kraken:{one:{sd:1,three:momentum},
   oneClosedAt:Math.floor(time/60000)*60000-60000,
   threeStructure:{trend,
    closedAt:Math.floor(time/180000)*180000-180000}},
  sampledExitBook:{source:'SAME_TICK_AUTHENTICATED_BOOK_SAMPLE',
   readOnly:true,executionAuthorized:false,
   actualFillVerified:false,observedAt:time+300,ticker,
   bookState:validBook?'FRESH_SAME_TICK':'NOT_VERIFIED',
   bookReceivedAt:time,
   upBid:{price:bid,depth:size},downBid:{price:1-bid,depth:size},
   indexState:indexFresh?'OFFICIAL_FRESH':'NOT_VERIFIED',
   indexPrice:indexFresh?idx:null,
   officialTarget:1750,indexSourceAt:indexFresh?time:null}};
}
const official=(side='UP')=>({ticker,closeAt:close,settledAt:close+1000,
 status:'OFFICIAL_RESULT',exchangeStatus:'finalized',
 outcome:side,source:'Kalshi official settled outcome'});
const variant=(rows,name)=>replay([s()],rows).find(x=>x.variant===name);
test('frozen exit research is never trade-capable',()=>{
 assert.equal(Object.isFrozen(EXIT_RESEARCH_POLICY),true);
 const r=replay([s()],[tick(entry+15000,.8)]);
 assert.equal(r.length,2);
 assert.equal(r[0].version,EXIT_RESEARCH_VERSION);
 assert.equal(r[0].executionAuthorized,false);
 assert.equal(r[0].actualFillVerified,false);
});
test('96c existing take-profit is preserved for BOTH and requires a verified top bid',()=>{
 const r=replay([s()],[tick(entry+15000,.96)]);
 for(const x of r){
  assert.equal(x.firstObservedExit.kind,'TAKE_PROFIT_96C');
  assert.ok(x.firstObservedExit.hypotheticalNet>0);
  assert.equal(x.firstObservedExit.fillVerified,false);
 }
});
test('96c quote with too little depth or stale book is never an assumed sale',()=>{
 for(const r of [
  tick(entry+15000,.96,1752,{size:3}),
  tick(entry+15000,.96,1752,{validBook:false})
 ]){
  assert.equal(variant([r],'BASELINE_EXIT').firstObservedExit,null);
  assert.equal(variant([r],'BASELINE_EXIT').excludedSnapshots,1);
 }
});
test('adaptive profit-protect requires 2 coherent adverse target+bid+trend samples',()=>{
 const a=tick(entry+15000,.82,1752);
 const b=tick(entry+30000,.79,1751, {trend:'DOWN',momentum:-1});
 assert.equal(variant([a,b],'BASELINE_EXIT').firstObservedExit,null);
 const x=variant([a,b],'ADAPTIVE_EXIT');
 assert.equal(x.firstObservedExit.kind,'PROFIT_PROTECT_78C_REVERSAL');
 assert.equal(x.firstObservedExit.observedBid,.79);
 assert.ok(x.firstObservedExit.hypotheticalNet>0);
});
test('no adaptive exit on pure indicator contradiction without verified official gap deterioration',()=>{
 const a=tick(entry+15000,.82,1752);
 const b=tick(entry+30000,.79,1752,{trend:'DOWN',momentum:-1});
 assert.equal(variant([a,b],'ADAPTIVE_EXIT').firstObservedExit,null);
});
test('no adaptive exit when price rises and official target gap worsens',()=>{
 const a=tick(entry+15000,.78,1752);
 const b=tick(entry+30000,.85,1751,{trend:'DOWN',momentum:-1});
 assert.equal(variant([a,b],'ADAPTIVE_EXIT').firstObservedExit,null);
});
test('old closed Kraken 1m/3m candles cannot justify adaptive SELL',()=>{
 const a=tick(entry+15000,.82,1752);
 for(const corruption of ['one','three','feed']){
  const b=tick(entry+30000,.79,1751,{trend:'DOWN',momentum:-1});
  if(corruption==='one')b.kraken.oneClosedAt-=60000;
  if(corruption==='three')b.kraken.threeStructure.closedAt-=180000;
  if(corruption==='feed')b.feeds.kraken1m.ok=false;
  assert.equal(variant([a,b],'ADAPTIVE_EXIT').firstObservedExit,null);
 }
});
test('no adaptive exit when 3m is NEUTRAL or 1m momentum supports position',()=>{
 const a=tick(entry+15000,.82,1752);
 for(const cfg of [{trend:'NEUTRAL',momentum:-1},
  {trend:'DOWN',momentum:1}]){
  assert.equal(variant([a,tick(entry+30000,.79,1751,cfg)],
   'ADAPTIVE_EXIT').firstObservedExit,null);
 }
});
test('25 percent contract drawdown plus verified adverse two-tick reversal cuts risk',()=>{
 const a=tick(entry+15000,.33,1751.8);
 const b=tick(entry+30000,.30,1751,{trend:'DOWN',momentum:-1});
 const x=variant([a,b],'ADAPTIVE_EXIT');
 assert.equal(x.firstObservedExit.kind,'EARLY_RISK_CUT_25PCT_REVERSAL');
 assert.equal(variant([a,b],'BASELINE_EXIT').firstObservedExit,null);
});
test('baseline final-six-minute 40% stop is preserved in both comparisons',()=>{
 const a=tick(close-250000,.24,1748);
 const r=replay([s()],[a]);
 assert.ok(r.every(x=>x.firstObservedExit.kind==='EMERGENCY_STOP_40PCT'));
});
test('last-minute 96c quote alone is not an early sale under either control',()=>{
 const a=tick(close-45000,.96);
 const r=replay([s()],[a]);
 assert.ok(r.every(x=>x.firstObservedExit===null));
});
test('missing intervening quote breaks two-tick confirmation',()=>{
 const a=tick(entry+15000,.82,1752);
 const missing=tick(entry+30000,.80,1751.6,{validBook:false});
 const b=tick(entry+45000,.79,1751,{trend:'DOWN',momentum:-1});
 assert.equal(variant([a,missing,b],'ADAPTIVE_EXIT').firstObservedExit,null);
});
test('missing official index on either leg prevents adaptive exit, but NOT baseline 96c',()=>{
 const a=tick(entry+15000,.82,1752,{indexFresh:false});
 const b=tick(entry+30000,.79,1751,{trend:'DOWN',momentum:-1});
 assert.equal(variant([a,b],'ADAPTIVE_EXIT').firstObservedExit,null);
 assert.equal(variant([tick(entry+45000,.96,1751,{indexFresh:false})],
  'BASELINE_EXIT').firstObservedExit.kind,'TAKE_PROFIT_96C');
});
test('official settlement is joined AFTER first signal and triggers; no cherry picking',()=>{
 const records=replay([s()],[tick(entry+15000,.96)]);
 assert.ok(finish(records,[{...official(),status:'PENDING'}]).every(
  x=>x.directionCorrect===null));
 const z=finish(records,[official('DOWN')]);
 assert.ok(z.every(x=>x.directionCorrect===false));
 assert.ok(z.every(x=>x.hypotheticalPolicyNet>0));
 assert.ok(z.every(x=>x.reportedAccounting.includes('not verified fills')));
});
test('without an exit quote, hold-to-official results remain hypothetical only',()=>{
 const f=finish(replay([s()],[]),[official('UP')]);
 assert.ok(f.every(x=>x.hypotheticalPolicyNet===4.08));
 assert.ok(f.every(x=>x.officialOutcome==='UP'));
 assert.equal(summary(f).policyComparison['A_STRESS_RELAXED|BASELINE_EXIT'].signals,1);
});
test('C2 quality-only entry above half-dollar is explicitly UNSCORABLE, not a losing trade',()=>{
 const c={...s(),policy:'C2_EVIDENCE',quantity:0,
  allIn:null,actualFillVerified:false};
 const r=replay([c],[]);
 assert.equal(r.length,1);
 assert.equal(r[0].status,'UNSCORABLE');
 assert.equal(r[0].actualFillVerified,false);
});
test('research input data remains immutable through scoring and result join',()=>{
 const signals=[s()],rows=[tick(entry+15000,.96)],off=[official()];
 const before=JSON.stringify({signals,rows,off});
 summary(finish(replay(signals,rows),off));
 assert.equal(JSON.stringify({signals,rows,off}),before);
});
