import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeFullBookFrame,appendFullBookFrame,ensureFullBookArchive,fullBookArchivePage} from '../src/full-book-archive.js';
const T=1770000000000,ticker='KXETH15M-26NOV221200-15';
const snapshot={type:'orderbook_snapshot',sid:4,seq:11,sending_ts_ms:T+10,
 msg:{market_ticker:ticker,clock:1,ts_ms:T,
  yes_dollars_fp:[['0.4000','2.00'],['0.3900','1.00']],
  no_dollars_fp:[['0.5900','3.00']]}};
const delta={type:'orderbook_delta',sid:4,seq:12,sending_ts_ms:T+30,
 msg:{market_ticker:ticker,clock:2,ts_ms:T+20,side:'yes',
  price_dollars:'0.4000',delta_fp:'-0.50'}};
test('optional book archive preserves timestamped snapshot ladders and signed deltas',()=>{
 const s=sanitizeFullBookFrame(snapshot,T+50),d=sanitizeFullBookFrame(delta,T+60);
 assert.equal(s.kind,'orderbook_snapshot');assert.equal(s.yesDollarsFp[0][1],'2.00');
 assert.equal(s.noDollarsFp[0][0],'0.5900');
 assert.equal(s.sourceEventAt,T);assert.equal(d.deltaFp,'-0.50');
 assert.equal(d.seq,12);assert.equal(d.sourceEventAt,T+20);
});
test('raw archive rejects malformed/surplus snapshots, unsafe tickers, and bad deltas',()=>{
 assert.throws(()=>sanitizeFullBookFrame({...snapshot,msg:{...snapshot.msg,yes_dollars_fp:[['bad','1.00']]}},T+50));
 assert.throws(()=>sanitizeFullBookFrame({...snapshot,msg:{...snapshot.msg,market_ticker:'BAD'}},T+50));
 assert.throws(()=>sanitizeFullBookFrame({...delta,msg:{...delta.msg,delta_fp:'not a number'}},T+50));
 assert.throws(()=>sanitizeFullBookFrame({...snapshot,seq:-1},T+50));
 assert.throws(()=>sanitizeFullBookFrame({...snapshot,msg:{...snapshot.msg,yes_dollars_fp:Array(5001).fill(['0.4000','1.00'])}},T+50));
});
test('raw book storage uses separate append-only V4 SQL and anchored reads',()=>{
 const sql={exec:(query,...args)=>{
  if(query.includes('SELECT COALESCE(MAX(id)'))return {toArray:()=>[{n:7}]};
  if(query.includes('SELECT id,payload FROM v4_book_frames'))return {toArray:()=>[]};
  sql.calls.push([query,...args]);return {toArray:()=>[]};
 },calls:[]};
 ensureFullBookArchive(sql);
 appendFullBookFrame(sql,delta,T+80);
 assert.ok(sql.calls.some(x=>x[0].startsWith('CREATE TABLE IF NOT EXISTS v4_book_frames')));
 assert.ok(sql.calls.some(x=>x[0].startsWith('INSERT INTO v4_book_frames')));
 const page=fullBookArchivePage(sql,{ticker,limit:40});
 assert.equal(page.anchor,7);assert.deepEqual(page.items,[]);
 assert.throws(()=>fullBookArchivePage(sql,{limit:200}));
});
