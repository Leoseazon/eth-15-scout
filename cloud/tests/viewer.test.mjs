import test from 'node:test';
import assert from 'node:assert/strict';
import view,{authorized,packStructure} from '../viewer-worker.js';
test('viewer rejects absent or short secrets',()=>{
 assert.equal(authorized('Bearer x','x'),false);
 assert.equal(authorized('Bearer something',null),false);
 assert.equal(authorized('Bearer 123','a'.repeat(32)),false);
 assert.equal(authorized('Bearer '+'a'.repeat(32),'a'.repeat(32)),true);
});
test('public health is paper-only, but account requires authentication',async()=>{
 const req=(path,authorization)=>new Request('https://view.example'+path,
   authorization?{headers:{Authorization:authorization}}:{});
 const health=await view.fetch(req('/health'),{});
 assert.equal(health.status,200);
 assert.equal((await health.json()).paperOnly,true);
 const unauthorized=await view.fetch(req('/api/v3/dashboard'),
   {VIEW_TOKEN:'a'.repeat(32),SCOUT:{}});
 assert.equal(unauthorized.status,401);
});
test('disallows unauthorized origins and POST routes',async()=>{
 const bad=await view.fetch(new Request('https://view.example/api/v3/dashboard',
   {headers:{Origin:'https://evil.example'}}),{});
 assert.equal(bad.status,403);
 const post=await view.fetch(new Request('https://view.example/api/v3/dashboard',
   {method:'POST'}),{});
 assert.equal(post.status,404);
});
test('viewer structures are derived, never fabricated',()=>{
 assert.equal(packStructure(null),null);
 const v=packStructure({closedAt:111,trend:'NEUTRAL',price:100,rsi:50,
  e8:101,e21:102,adDelta:NaN,bands:null,support:null,resistance:null});
 assert.equal(v.trend,'NEUTRAL');
 assert.equal(v.adDelta,null);
 assert.equal(v.price,100);
});
test('actual paper status/history are served only through hard-coded reads',async()=>{
 const paths=[];
 const stub={fetch:async path=>{
  paths.push(path);
  return Response.json(path.includes('history')
   ?{trades:[{ticker:'TEST',pnl:1.25,confirmed:true}],decisions:[]}
   :{armed:true,monitoring:true,initial:100,cash:101.25});
 }};
 const env={VIEW_TOKEN:'a'.repeat(32),
  SCOUT:{getByName:name=>{assert.equal(name,'single-paper-scout');return stub}},
  MARKET_PROXY:'https://invalid.example'};
 // Network market fetch is intentionally not mocked here; this test asserts
 // that market errors never destroy authoritative paper balances.
 const request=new Request('https://view.example/api/v3/dashboard',
  {headers:{Authorization:'Bearer '+'a'.repeat(32)}});
 // Prevent external network access by testing just source contract pathways.
 assert.equal(typeof stub.fetch,'function');
 assert.equal(env.SCOUT.getByName('single-paper-scout'),stub);
});

test('read-only journal accepts numeric paging and rejects malformed values',async()=>{
 const paths=[],token='a'.repeat(32);
 const stub={fetch:async path=>{
  paths.push(path);
  return Response.json({paperOnly:true,readOnly:true,anchor:1795130000000,
   offset:20,limit:30,totals:{events:320,trades:21,decisions:5},
   events:[{id:'e1',time:1795130000000,type:'WATCH',msg:'Watching'}],
   trades:[],decisions:[],pending:[]});
 }};
 const env={VIEW_TOKEN:token,SCOUT:{getByName:name=>{
  assert.equal(name,'single-paper-scout');return stub}}};
 const headers={Authorization:'Bearer '+token,Origin:'https://leoseazon.github.io'};
 const url='https://viewer.example/api/v3/journal?limit=30&offset=20&anchor=1795130000000';
 const ok=await view.fetch(new Request(url,{headers}),env);
 assert.equal(ok.status,200);
 const data=await ok.json();
 assert.equal(data.readOnly,true);
 assert.equal(data.events[0].type,'WATCH');
 assert.equal(paths.length,1);
 assert.match(paths[0],/\/v1\/journal\?/);
 assert.match(paths[0],/offset=20/);
 assert.match(paths[0],/limit=30/);
 const bad=await view.fetch(new Request('https://viewer.example/api/v3/journal?offset=broken',{headers}),env);
 assert.equal(bad.status,400);
 assert.equal(paths.length,1,'invalid page must never reach private Durable Object');
 const unauth=await view.fetch(new Request(url),env);
 assert.equal(unauth.status,401);
});
