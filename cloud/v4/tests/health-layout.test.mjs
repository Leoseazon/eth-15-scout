import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const T=1795320000000,ticker='KXETH15M-26NOV211800-00';
function runUI(){
 let now=T;const listeners=new Map(),intervals=[];
 class Clock extends Date{static now(){return now}}
 const make=()=>({textContent:'',dataset:{},hidden:false,open:false,children:[],
  append(...items){this.children.push(...items)},replaceChildren(){this.children=[]}});
 const ids=['v4-health','v4-health-state','v4-health-message','v4-health-age',
   'v4-health-detail','v4-health-list','v4-health-details'];
 const elements=new Map(ids.map(id=>[id,make()]));
 const document={hidden:false,getElementById:id=>elements.get(id)||null,
  createElement:()=>make(),addEventListener:(event,fn)=>listeners.set(event,fn)};
 vm.runInNewContext(readFileSync(root+'v4/health-ui.js','utf8'),{
  document,Date:Clock,setInterval:(cb,ms)=>intervals.push({cb,ms})});
 return {elements,intervals,emit:(event,detail)=>listeners.get(event)?.({detail}),
  now:v=>{now=v},refresh:()=>intervals.forEach(x=>x.cb())};
}
function good(){
 const feeds={};for(const name of ['kalshi','kraken1m','kraken5m','krakenTicker'])
  feeds[name]={ok:true,checkedAt:T-1000};
 return {paperOnly:true,readOnly:true,receivedAt:T,status:{
  monitoring:true,armed:true,paperMode:'enabled',settlementPaperAllowed:true,
  lastTick:T-1000,lastMarket:ticker,pending:0,
  streamConnection:{connected:true,needResync:false,targetTicker:ticker,
   quote:{ticker,valid:true,fresh:true,receivedAt:T-1000}},
  feedChecks:feeds,
  officialIndexFeedCheck:{at:T-1000,state:'HTTP_200_VALID_ETH_INDEX',fresh:true}
 }};
}
test('health defaults neutral and healthy sources show green with no expanding list',()=>{
 const h=runUI();
 assert.equal(h.elements.get('v4-health').dataset.level,'idle');
 assert.deepEqual(h.intervals.map(x=>x.ms),[15000]);
 h.emit('v4:dashboard-health',good());
 assert.equal(h.elements.get('v4-health').dataset.level,'healthy');
 assert.equal(h.elements.get('v4-health-details').hidden,true);
});
test('real processing error and frozen engine are red, raw error messages not leaked',()=>{
 const h=runUI(),d=good();d.status.lastError='SECRET stack trace or credential';
 h.emit('v4:dashboard-health',d);
 assert.equal(h.elements.get('v4-health').dataset.level,'error');
 assert.doesNotMatch(h.elements.get('v4-health-message').textContent,/SECRET/);
 const stalled=good();stalled.status.lastTick=T-90000;
 h.emit('v4:dashboard-health',stalled);
 assert.equal(h.elements.get('v4-health').dataset.level,'error');
 assert.match(h.elements.get('v4-health-message').textContent,/heartbeat is stale/);
});
test('short WebSocket rollover warning escalates to red and clears on verified recovery',()=>{
 const h=runUI(),d=good();d.status.streamConnection.connected=false;
 h.emit('v4:dashboard-health',d);
 assert.equal(h.elements.get('v4-health').dataset.level,'warning');
 h.now(T+31000);h.refresh();
 assert.equal(h.elements.get('v4-health').dataset.level,'error');
 const recovered=good();recovered.status.lastTick=T+30000;
 recovered.status.streamConnection.quote.receivedAt=T+30000;
 h.emit('v4:dashboard-health',recovered);
 assert.equal(h.elements.get('v4-health').dataset.level,'healthy');
});
test('viewer failure is red; after restoration green; logout neutral',()=>{
 const h=runUI();h.emit('v4:dashboard-health',good());
 h.emit('v4:dashboard-error');
 assert.equal(h.elements.get('v4-health').dataset.level,'error');
 h.emit('v4:dashboard-health',good());
 assert.equal(h.elements.get('v4-health').dataset.level,'healthy');
 h.emit('v4:dashboard-reset');
 assert.equal(h.elements.get('v4-health').dataset.level,'idle');
});
test('disabled paper mode and off-by-design research archives do not create false alarms',()=>{
 const h=runUI(),d=good();d.status.paperMode='disabled';
 d.status.settlementPaperAllowed=false;d.status.streamConnection.connected=false;
 h.emit('v4:dashboard-health',d);
 assert.equal(h.elements.get('v4-health').dataset.level,'idle');
});
test('active failed 1m feed, unavailable confidence and official verification are diagnosed',()=>{
 const h=runUI(),d=good();d.status.feedChecks.kraken1m.ok=false;
 d.status.open={strategy:'V4_SETTLEMENT_FIRST',liveConfidence:{status:'UNAVAILABLE'}};
 d.status.lastWindowScanError='private error';
 h.emit('v4:dashboard-health',d);
 assert.equal(h.elements.get('v4-health').dataset.level,'warning');
 assert.equal(h.elements.get('v4-health-details').hidden,false);
 assert.ok(h.elements.get('v4-health-list').children.length>=2);
 h.now(T+31000);h.refresh();
 assert.equal(h.elements.get('v4-health').dataset.level,'error');
});
test('no extra HTTP, secret storage, synthetic order controls or HTML injection',()=>{
 const ui=readFileSync(root+'v4/health-ui.js','utf8');
 assert.doesNotMatch(ui,/\bfetch\s*\(|XMLHttpRequest|new WebSocket|localStorage|sessionStorage|innerHTML\s*=/);
 assert.match(ui,/setInterval\(\(\)=>\{if\(!document.hidden\)render\(\)\},15000\)/);
});
test('trade-first hierarchy and unique critical DOM IDs survived reorganization',()=>{
 const html=readFileSync(root+'v4/index.html','utf8');
 const js=readFileSync(root+'v4/app.js','utf8');
 const css=readFileSync(root+'v4/style.css','utf8');
 const ids=['v4-health','live-action','signals','performance','overview','activity',
  'v4-quote-history','v4-research-history'];
 const offsets=ids.map(id=>html.indexOf('id="'+id+'"'));
 assert.ok(offsets.every((x,i)=>x>=0&&(i===0||x>offsets[i-1])),JSON.stringify(offsets));
 for(const id of ['v4-health-message','v4-health-details','v4-health-list',
  'live-exit-bid','mode-badge','updated-label'])
  assert.equal(html.split('id="'+id+'"').length-1,1,id);
 assert.match(html,/health-ui\.js/);
 assert.match(css,/\.health-strip\[data-level="error"\]/);
 assert.match(js,/v4:dashboard-health/);
 assert.match(js,/v4:dashboard-error/);
 assert.match(js,/v4:dashboard-reset/);
 assert.match(js,/book\.ticker===open\.ticker/);
});
