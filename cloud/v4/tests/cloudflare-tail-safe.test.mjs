import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSafeTailEvent,reportText,parseMinutes} from '../tools/read-only-cloudflare-tail.mjs';
import {v4AuditCode,appendStreamEvent,appendStreamSample} from '../src/stream-audit.js';

const at=1795200000000;
const ticker='KXETH15M-26NOV210015-15';
const mk=code=>JSON.stringify({eventTimestamp:at,scriptName:'eth-15-scout-cloud-v4test',
 logs:[{level:'info',message:['ETH15_V4_AUDIT|'+code]}],
 event:{request:{headers:{Authorization:'Bearer hidden'}}}});
const sql={exec:()=>({toArray:()=>[]})};

test('tail report accepts ONLY V4 branded, allowlisted diagnostic codes and drops raw event secrets',()=>{
 const r=parseSafeTailEvent(mk('AUTH_REST_CHECK|AUTH_REST_HTTP_200'));
 assert.equal(r.items[0].kind,'AUTH_REST_CHECK');
 assert.equal(r.items[0].code,'AUTH_REST_HTTP_200');
 const raw='Bearer hidden';
 const report=reportText({startedAt:'A',finishedAt:'B',total:1,items:r.items});
 assert.ok(!report.includes(raw));
 assert.ok(!report.includes(ticker));
 assert.match(report,/AUTH_REST_HTTP_200/);
 assert.equal(parseSafeTailEvent(mk('AUTH_REST_CHECK|AUTH_REST_KEY_abcdef')).items.length,0);
 assert.equal(parseSafeTailEvent(mk('FAKE_KIND|PRIVATE_KEY')).items.length,0);
 assert.equal(parseSafeTailEvent('{broken'),null);
});
test('tail permits an audit combined REST status but not any arbitrary sensitive suffix',()=>{
 const ok=parseSafeTailEvent(mk('NETWORK_REST_CHECK|PRIMARY_HTTP_200|COMPAT_HTTP_200'));
 assert.equal(ok.items.length,1);
 assert.equal(ok.items[0].code,'PRIMARY_HTTP_200|COMPAT_HTTP_200');
 const bad=parseSafeTailEvent(mk('NETWORK_REST_CHECK|PRIMARY_HTTP_200|COMPAT_HTTP_200_PRIVATE_KEY'));
 assert.equal(bad.items.length,0);
 const net=parseSafeTailEvent(mk('WS_HOST_HTTPS_CHECK|PRIMARY_NETWORK_DNS_FAILED|COMPAT_HTTP_401'));
 assert.equal(net.items.length,1);
});
test('only safe V4 fault reasons are mirrored, not arbitrary detail strings',()=>{
 assert.equal(v4AuditCode('STREAM_FAULT','NETWORK_CONNECT_FAILED'),'NETWORK_CONNECT_FAILED');
 assert.equal(v4AuditCode('STREAM_FAULT','private-secret-value'),'OTHER_REDACTED');
 assert.equal(v4AuditCode('AUTH_REST_CHECK','AUTH_REST_HTTP_401'),'AUTH_REST_HTTP_401');
 assert.equal(v4AuditCode('NETWORK_REST_CHECK','PRIMARY_HTTP_200|COMPAT_HTTP_200'),
  'PRIMARY_HTTP_200|COMPAT_HTTP_200');
 assert.equal(v4AuditCode('NETWORK_REST_CHECK','PRIMARY_HTTP_200|COMPAT_BEARER_SECRET'),'REDACTED');
 assert.equal(v4AuditCode('SOMETHING_ELSE','secret'),null);
});
test('V4 audit mirrored log follows durable SQL write and contains no ticker or raw exception',()=>{
 const lines=[];
 const real=console.info;
 try{
  console.info=(...a)=>lines.push(a.join(' '));
  appendStreamEvent(sql,{kind:'STREAM_FAULT',ticker,at,detail:'super-secret-exception'});
  appendStreamEvent(sql,{kind:'AUTH_REST_CHECK',ticker,at,detail:'AUTH_REST_HTTP_200'});
  appendStreamSample(sql,{quote:{
   ticker,source:'KALSHI_WEBSOCKET_ORDERBOOK',
   valid:true,fresh:true,receivedAt:at
  },at,kind:'snapshot'});
 }finally{console.info=real}
 assert.equal(lines.length,3);
 assert.ok(lines.every(x=>x.startsWith('ETH15_V4_AUDIT|')));
 assert.ok(lines.every(x=>!x.includes(ticker)));
 assert.ok(lines.every(x=>!x.includes('super-secret')));
 assert.ok(lines[0].includes('OTHER_REDACTED'));
 assert.equal(lines[1],'ETH15_V4_AUDIT|AUTH_REST_CHECK|AUTH_REST_HTTP_200');
 assert.equal(lines[2],'ETH15_V4_AUDIT|BOOK_SNAPSHOT|RECORDED');
});
test('capture time parameter bounded; no V3 worker name or unauthorized routes',()=>{
 assert.equal(parseMinutes([]),3);
 assert.equal(parseMinutes(['--minutes','5']),5);
 assert.throws(()=>parseMinutes(['--minutes','10']));
 assert.throws(()=>parseMinutes(['--worker','eth-15-scout-cloud-v3test']));
});


test('planned collector timeout is a completed capture window, not a Cloudflare failure',()=>{
 const report=reportText({
  startedAt:'2026-11-21T07:51:16Z',
  finishedAt:'2026-11-21T07:54:16Z',
  total:0,items:[],tailOk:true,stoppedByTimer:true,
  connectedBanner:false,failureCode:'NONE'});
 assert.match(report,/Tail session: CAPTURE_WINDOW_COMPLETED/);
 assert.match(report,/Connection banner observed: NO_OR_UNRECOGNIZED/);
 assert.match(report,/NONE — inconclusive/);
 assert.doesNotMatch(report,/Tail session: FAILED_OR_INTERRUPTED/);
});
test('diagnostic collector can report a read-only auth/permission error without exposing stderr',()=>{
 const report=reportText({
  startedAt:'a',finishedAt:'b',total:0,items:[],
  tailOk:false,stoppedByTimer:false,connectedBanner:false,
  failureCode:'AUTH_OR_PERMISSION_ERROR'});
 assert.match(report,/Tail session: FAILED_OR_INTERRUPTED/);
 assert.match(report,/AUTH_OR_PERMISSION_ERROR/);
 assert.doesNotMatch(report,/Bearer|private key|secret material/i);
});
test('only actual Wrangler JSON event envelopes count as invocation records',()=>{
 assert.equal(parseSafeTailEvent(JSON.stringify({status:'connected'})),null);
 assert.equal(parseSafeTailEvent(JSON.stringify({logs:[],message:'fake'})),null);
 const actual=JSON.stringify({logs:[],eventTimestamp:1795200000000});
 assert.equal(parseSafeTailEvent(actual).totalInvocation,1);
});


test('V4 REST depth event mirror retains only source-label codes, never book prices or account fields',()=>{
 const recorded=parseSafeTailEvent(mk('REST_BOOK_SNAPSHOT|RECEIPT_ONLY'));
 assert.equal(recorded.items.length,1);
 assert.equal(recorded.items[0].kind,'REST_BOOK_SNAPSHOT');
 const fault=parseSafeTailEvent(mk('REST_BOOK_FAULT|REST_BOOK_HTTP_429'));
 assert.equal(fault.items[0].code,'REST_BOOK_HTTP_429');
 assert.equal(v4AuditCode('REST_BOOK_SNAPSHOT','0.4200 private key'),'RECEIPT_ONLY');
 assert.equal(v4AuditCode('REST_BOOK_FAULT','raw exception private key'),'REDACTED');
 assert.equal(parseSafeTailEvent(mk('REST_BOOK_FAULT|PRIVATE_KEY_0.4200')).items.length,0);
 assert.equal(v4AuditCode('STREAM_FAULT','WS_UPGRADE_RUNTIME_UNSUPPORTED'),'WS_UPGRADE_RUNTIME_UNSUPPORTED');
 assert.equal(v4AuditCode('STREAM_FAULT','WS_UPGRADE_HEADER_REJECTED'),'WS_UPGRADE_HEADER_REJECTED');
});
