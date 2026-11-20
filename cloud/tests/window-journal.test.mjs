import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialWindow,windowEndpointUrl,parseList,LOOKBACK_MS} from '../src/window-journal.js';
const now=Date.parse('2026-11-20T05:15:00Z');
const mk=(p={})=>({ticker:'KXETH15M-26NOV200500-00',close_time:'2026-11-20T05:00:00Z',
  status:'finalized',result:'yes',floor_strike:1800,settlement_ts:'2026-11-20T05:03:00Z',
  ...p});
test('official finalized Kalshi yes is UP and no is DOWN, regardless of V3 activity',()=>{
 const up=parseOfficialWindow(mk(),now);
 const down=parseOfficialWindow(mk({ticker:'KXETH15M-26NOV200515-15',result:'no'}),now);
 assert.equal(up.outcome,'UP');assert.equal(up.status,'OFFICIAL_RESULT');
 assert.equal(down.outcome,'DOWN');assert.equal(down.status,'OFFICIAL_RESULT');
 assert.equal(up.source,'Kalshi public market API (official exchange result)');
 assert.equal(up.closeAt,Date.parse('2026-11-20T05:00:00Z'));
});
test('result never becomes OFFICIAL before exchange settlement',()=>{
 for(const status of ['closed','open','paused','unopened','determined','disputed','settled']){
  const item=parseOfficialWindow(mk({status}),now);
  assert.equal(item.outcome,null);
  assert.equal(item.status,'REPORTED');
 }
 const provisional=parseOfficialWindow(mk({is_provisional:true}),now);
 assert.equal(provisional.outcome,null);
 assert.equal(provisional.status,'REPORTED');
 const pending=parseOfficialWindow(mk({result:''}),now);
 assert.equal(pending.status,'PENDING');
 const voided=parseOfficialWindow(mk({result:'void'}),now);
 assert.equal(voided.status,'VOID');
});
test('rejects other series, broken dates and future-only markets',()=>{
 assert.equal(parseOfficialWindow(mk({ticker:'KXBTC15M-TEST'}),now),null);
 assert.equal(parseOfficialWindow(mk({close_time:'not-a-date'}),now),null);
 assert.equal(parseOfficialWindow(mk({close_time:'2027-01-01T00:00:00Z'}),now),null);
 assert.equal(parseOfficialWindow(null,now),null);
});
test('Kalshi market query scans all 15m markets, including untraded, via close window',()=>{
 const url=new URL(windowEndpointUrl(now));
 assert.equal(url.pathname,'/trade-api/v2/markets');
 assert.equal(url.searchParams.get('series_ticker'),'KXETH15M');
 assert.equal(url.searchParams.get('mve_filter'),'exclude');
 assert.equal(url.searchParams.get('limit'),'500');
 assert.equal(Number(url.searchParams.get('min_close_ts')),
  Math.floor((now-LOOKBACK_MS)/1000));
 assert.equal(Number(url.searchParams.get('max_close_ts')),
  Math.floor((now-10000)/1000));
});
test('parse list includes confirmed, pending and reported, but not future windows',()=>{
 const markets=[mk(),mk({ticker:'KXETH15M-26NOV200445-45',result:'',status:'closed'}),
   mk({ticker:'KXETH15M-26NOV200530-30',close_time:'2026-11-20T05:30:00Z'})];
 const found=parseList({markets},now);
 assert.equal(found.length,2);
 assert.equal(found[0].outcome,'UP');
 assert.equal(found[1].status,'PENDING');
});
