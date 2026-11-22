import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {freshPaperState} from '../src/v2.js';
import {settlementFirstPaperStep} from '../src/settlement-first-paper.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
const market={ticker,floor_strike:1800,close_time:new Date(T+450000).toISOString()};
const index={indexId:'ETHUSD_RTI',validValuesVerified:true,sourceAt:T-1000,price:1804};
const one={sd:1.2,last:1804,e8:1802,e21:1800,rNow:65,mNow:1,sNow:.25,three:2};
const five={rsi:60,e21:1800,e50:1799};
const context={three:{trend:'UP'},five:{trend:'UP'}};
const book={ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',valid:true,fresh:true,
 crossed:false,receivedAt:T-1000,yesBid:{price:.43,sizeFp:'20.00'},
 yesAsk:{price:.45,sizeFp:'20.00'},noBid:{price:.55,sizeFp:'20.00'},
 noAsk:{price:.57,sizeFp:'20.00'}};
test('confidence in BUY is frozen in position, journal event and primary research decision',()=>{
 const s={...freshPaperState(),armed:true,monitoring:true,events:[],
  decisions:[],blocked:[],pending:[],trades:[]};
 const predictions=[];
 const before=s.cash;
 const r=settlementFirstPaperStep(s,{market,index,one,five,context,book,now:T,
  onPrediction:p=>predictions.push(p)});
 assert.equal(r.status,'PAPER_BUY',r.notice);
 assert.equal(predictions.length,1);
 const buy=s.open;
 assert.ok(Number.isInteger(buy.entryConfidence?.value));
 assert.ok(buy.entryConfidence.value>=0&&buy.entryConfidence.value<=100);
 assert.equal(buy.entryConfidence.calibrated,false);
 assert.equal(buy.entryConfidence.winProbability,null);
 assert.equal(buy.liveConfidence.value,buy.entryConfidence.value);
 assert.equal(buy.confidenceHistory[0].value,buy.entryConfidence.value);
 assert.equal(predictions[0].entryConfidence.value,buy.entryConfidence.value);
 assert.equal(s.lastV4SettlementDecision.entryConfidenceScore,buy.entryConfidence.value);
 assert.ok(s.events[0].msg.includes('confidence '));
 assert.equal(s.cash,Number((before-buy.cost).toFixed(2)));
 assert.ok(buy.cost<=3);
 const bid=.96;
 const sold=settlementFirstPaperStep(s,{market,index,one,five,context,
  book:{...book,receivedAt:T+149000,yesBid:{price:bid,sizeFp:'20.00'}},
  now:T+150000});
 assert.equal(sold.status,'PAPER_SELL');
 assert.equal(s.trades[0].entryConfidence.value,buy.entryConfidence.value);
});
test('worker recomputes held score only as display-only evidence, after original risk/exit decision',()=>{
 const w=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const step=w.indexOf('report=settlementFirstPaperStep(s,{market,index,one');
 const held=w.indexOf('live=scoreHeldConfidence({position:pos',step);
 const saved=w.indexOf('this.save(s,tickMeta)',held);
 assert.ok(step>0&&held>step&&saved>held);
 assert.match(w,/const confidenceSourcesReady=s.open\?\.strategy==='V4_SETTLEMENT_FIRST'/);
 assert.match(w,/if\(entrySourcesReady\|\|confidenceSourcesReady\)/);
 assert.match(w,/pos\.confidenceHistory=pos\.confidenceHistory\.slice\(-60\)/);
 assert.match(w,/status:'UNAVAILABLE',reason:'CONFIDENCE_EVALUATION_ERROR'/);
 const code=readFileSync(root+'cloud/v4/src/buy-confidence.js','utf8');
 assert.doesNotMatch(code,/create_order|onPrediction|settlementFirstPaperStep|s\.cash=|closeEarly\(/);
 assert.match(code,/NOT_WIN_PROBABILITY/);
});
test('confidence dashboard has IDs, event wiring, stale handling and no trading interactions',()=>{
 const html=readFileSync(root+'v4/index.html','utf8');
 const app=readFileSync(root+'v4/app.js','utf8');
 const ui=readFileSync(root+'v4/confidence-ui.js','utf8');
 const css=readFileSync(root+'v4/style.css','utf8');
 for(const id of ['confidence-entry','confidence-live','confidence-trend','confidence-meter',
   'confidence-sparkline-path','confidence-note'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/confidence-ui\.js/);
 assert.match(app,/new CustomEvent\('v4:dashboard-confidence'/);
 assert.match(ui,/addEventListener\('v4:dashboard-confidence'/);
 assert.match(ui,/aria-valuenow/);
 assert.match(ui,/No current paper position/);
 assert.match(css,/\.confidence-panel/);
 assert.doesNotMatch(ui,/fetch\(|POST|place_order|\/portfolio\/orders|\bar(t|m)\b/);
});
test('UI changes 0-100 displayed live score up/down, then goes unavailable on stale source',()=>{
 const needed=['buy-confidence-panel','confidence-entry','confidence-live','confidence-trend',
   'confidence-quality','confidence-note','confidence-meter','confidence-meter-fill',
   'confidence-sparkline-path'];
 const els=new Map(needed.map(id=>[id,{textContent:'',style:{},
  attributes:{},classList:{toggle(){}},
  setAttribute(k,v){this.attributes[k]=v},
  removeAttribute(k){delete this.attributes[k]}}]));
 const listeners=new Map();
 const document={hidden:false,getElementById:id=>els.get(id),
  addEventListener:(name,cb)=>listeners.set(name,cb)};
 const script=readFileSync(root+'v4/confidence-ui.js','utf8');
 vm.runInNewContext(script,{document,setInterval(){}});
 const dispatch=(liveValue,asOf,kind='CURRENT')=>{
  listeners.get('v4:dashboard-confidence')({detail:{status:{open:{
   strategy:'V4_SETTLEMENT_FIRST',entryConfidence:{value:70},
   confidenceHistory:[{at:T-1000,value:70},{at:T,value:liveValue}],
   liveConfidence:{status:kind,value:liveValue,asOf,deltaFromPrevious:liveValue-70}
  }}}});
 };
 const now=Date.now();
 dispatch(82,now);
 assert.equal(els.get('confidence-entry').textContent,'70%');
 assert.equal(els.get('confidence-live').textContent,'82%');
 assert.match(els.get('confidence-trend').textContent,/\+12/);
 assert.equal(els.get('confidence-meter').attributes['aria-valuenow'],'82');
 dispatch(51,now);
 assert.equal(els.get('confidence-live').textContent,'51%');
 assert.match(els.get('confidence-trend').textContent,/-19/);
 dispatch(44,now-240000);
 assert.equal(els.get('confidence-live').textContent,'—');
 assert.equal(els.get('confidence-meter').attributes['aria-valuenow'],undefined);
 assert.match(els.get('confidence-quality').textContent,/stale/i);
});
