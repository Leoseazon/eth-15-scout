import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getV4StorageInventory} from '../src/storage-inventory.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const T=1770000000000;
test('storage inventory is strict read-only metadata for all V4 research archives',()=>{
 const queries=[];
 const sql={databaseSize:2097152,exec:(statement,...params)=>{
  queries.push([statement,...params]);
  return {toArray:()=>[{n:200,first_at:T-86400000,last_at:T}]};
 }};
 const r=getV4StorageInventory(sql,{now:T});
 assert.equal(r.readOnly,true);assert.equal(r.paperOnly,true);
 assert.equal(r.databaseBytes,2097152);
 assert.equal(r.autoDeletionConfigured,false);
 assert.equal(r.retentionPeriodDays,null);
 assert.equal(r.currentDataPolicy,'NO_AUTOMATIC_EXPIRATION_IN_V4_CODE');
 assert.ok(r.datasets.length>=10);
 assert.ok(r.datasets.some(x=>x.table==='v4_stream_samples'));
 assert.ok(r.datasets.some(x=>x.table==='research_ticks'));
 assert.ok(r.datasets.some(x=>x.table==='v4_cf_values'));
 assert.ok(r.datasets.some(x=>x.table==='v4_book_frames'));
 assert.deepEqual(r.datasets[0].earliestAt,T-86400000);
 assert.deepEqual(r.datasets[0].latestAt,T);
 for(const [q,...args] of queries){
  assert.match(q,/^SELECT COUNT\(\*\) AS n,MIN\(/);
  assert.doesNotMatch(q,/DELETE|DROP|UPDATE|VACUUM|ALTER|INSERT|CREATE|PRAGMA/i);
  assert.deepEqual(args,[]);
 }
});
test('storage inventory handles empty tables and unknown database size without inventing retention',()=>{
 const sql={exec:()=>({toArray:()=>[{n:0,first_at:null,last_at:null}]})};
 const r=getV4StorageInventory(sql,{now:T});
 assert.equal(r.databaseBytes,null);
 assert.equal(r.datasets[0].records,0);
 assert.equal(r.datasets[0].earliestAt,null);
 assert.equal(r.datasets[0].latestAt,null);
});
test('V4 retention inventory endpoint is behind the private viewer and cannot delete history',()=>{
 const worker=readFileSync(root+'cloud/v4/src/worker.js','utf8');
 const viewer=readFileSync(root+'cloud/v4/viewer-worker.js','utf8');
 const ui=readFileSync(root+'v4/storage-inventory-ui.js','utf8');
 const html=readFileSync(root+'v4/index.html','utf8');
 assert.match(worker,/path==='\/v1\/storage-inventory'/);
 assert.match(viewer,/path==='\/api\/v4\/storage-inventory'/);
 assert.match(viewer,/sessionValid\(/);
 assert.match(ui,/\/api\/v4\/storage-inventory/);
 assert.match(html,/storage-inventory-ui\.js/);
 assert.doesNotMatch(ui,/\/api\/v4\/(arm|stop|pause)/);
});
