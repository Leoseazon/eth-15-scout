import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);

test('live Kalshi contract is FIRST, paper account second, all else follows',()=>{
 const positions=['id="live-action"','id="contract-id"','id="up-quote"',
   'id="down-quote"','id="performance"','id="overview"',
   'class="main-grid"','id="activity"'].map(t=>html.indexOf(t));
 assert.ok(positions.every(x=>x>=0),'a required live/control section is absent');
 assert.ok(positions.every((x,i)=>i===0||x>positions[i-1]),
  'live contract, quotes and account must precede charts and activity');
 assert.ok(html.indexOf('id="observation-progress"')>html.indexOf('id="performance"'));
 assert.ok(html.includes('id="up-bid"')&&html.includes('id="down-bid"'));
});
test('every id is unique and all DOM targets and aria labels resolve',()=>{
 assert.equal(ids.length,new Set(ids).size);
 const idSet=new Set(ids);
 const target=[...js.matchAll(/\b(?:txt|cls|\$)\('([a-zA-Z][a-zA-Z0-9_-]+)'/g)]
   .map(m=>m[1]);
 for(const id of target)assert.ok(idSet.has(id),'JS references missing DOM target: '+id);
 for(const m of html.matchAll(/aria-labelledby="([^"]+)"/g))
  for(const name of m[1].split(/\s+/))
   assert.ok(idSet.has(name),'missing aria-labelledby target: '+name);
});
test('account balance, quotes and trade panels are hidden before sign-in',()=>{
 assert.match(css,/body\.unauthenticated\s+#live-action\s*\{\s*display:none/);
 assert.match(css,/body\.unauthenticated\s+#performance\s*\{\s*display:none/);
 assert.match(css,/body\.unauthenticated\s+#overview/);
 assert.match(css,/body\.unauthenticated\s+\.main-grid/);
 assert.match(css,/body\.unauthenticated\s+#activity/);
});
test('market quotes and current decision have explicit stale defenses',()=>{
 assert.match(js,/const quoteFresh=/);
 assert.match(js,/quotesUsable=active&&contractCurrent&&quoteFresh/);
 assert.match(js,/Engine feed is stale/);
 assert.match(js,/txt\('up-bid'/);
 assert.match(js,/txt\('down-bid'/);
 assert.match(js,/renderLiveAction\(data\)/);
});
test('original release and revised 50–100 observation remain separately marked',()=>{
 assert.match(js,/V3-OBSERVATION-50-100-20261119/);
 assert.match(js,/V3-TIME40-6M-20261120/);
 assert.match(js,/revisedCohort/);
 assert.match(html,/Nov 19, 2026 · approx\. 11:40 PM CT/);
 assert.match(html,/id="release-first-tick"/);
 assert.match(html,/id="revised-first-tick"/);
});
test('realized trade counters and official settlement phase have DOM targets',()=>{
 for(const id of ['wins-count','losses-count','settlement-phase'])
   assert.ok(ids.includes(id),'missing new audit display '+id);
 assert.match(js,/paperResults/);
 assert.match(js,/RTI_60_SECOND_AVERAGING_UNVERIFIED/);
 assert.match(html,/Rolling volume-weighted price/);
});
test('Official Kalshi outcome journal is shown ONLY when a finalized result is verified',()=>{
 assert.match(html,/<section class="outcome-section"[^>]*hidden>/);
 assert.match(css,/\.outcome-section\[hidden\]\{display:none!important\}/);
 assert.match(js,/officialPanel\.hidden=!\(Number\.isSafeInteger\(allOfficial\)&&allOfficial>0\)/);
 assert.match(js,/data\.activity\?\.journalTotals\?\.officialWindows/);
 assert.match(html,/id="pending-stake-value"/);
});
test('night mode and mobile breakpoints preserved',()=>{
 assert.match(css,/--bg:#0b121e/);
 for(const width of [380,480,600,770,840,1160])
  assert.ok(css.includes('@media(max-width:'+width+'px)'),
    'mobile or compact breakpoint not covered: '+width);
 assert.match(html,/PAPER ONLY/);
});
