import test from 'node:test';
import assert from 'node:assert/strict';
import view,{packStructure,directQuoteTicker,publicContract} from '../viewer-worker.js';
import {checkCredentials,credentialsConfigured,newSession,sessionValid,REMEMBER_DAYS} from '../viewer-auth.js';

const loginSecrets={
  SCOUT_LOGIN_USER:'only-owner',
  SCOUT_LOGIN_PASSWORD:'a-very-long-local-only-demo-password-1234',
  SCOUT_SESSION_SECRET:'d'.repeat(64)
};
const env=(limit=true)=>({...loginSecrets,
  LOGIN_RATE_LIMIT:{limit:async()=>({success:limit})},
  SCOUT_V4:{getByName:name=>{
    assert.equal(name,'v4-single-paper-scout');
    return {fetch:async()=>Response.json({paperOnly:true,readOnly:true,
      events:[{id:'event1',time:1795130000000,type:'WATCH',msg:'Watching'}],
      trades:[],decisions:[],pending:[],totals:{events:1,trades:0,decisions:0}})}
  }}
});
const origin='https://leoseazon.github.io';
const post=(body)=>new Request('https://viewer.example/api/v4/login',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify(body)});
const credentials={username:loginSecrets.SCOUT_LOGIN_USER,password:loginSecrets.SCOUT_LOGIN_PASSWORD};

test('credentials are server-only and required for sessions',async()=>{
  assert.equal(credentialsConfigured(env()),true);
  assert.equal(credentialsConfigured({}),false);
  assert.equal(await checkCredentials(env(),credentials.username,credentials.password),true);
  assert.equal(await checkCredentials(env(),'wrong',credentials.password),false);
  assert.equal(await checkCredentials(env(),credentials.username,'wrong'),false);
});
test('login issues a read-only 30-day session when remember enabled',async()=>{
  const r=await view.fetch(post({...credentials,remember:true}),env());
  assert.equal(r.status,200);
  const result=await r.json();
  assert.equal(result.paperOnly,true);
  assert.equal(result.readOnly,true);
  assert.equal(typeof result.token,'string');
  assert.ok(result.expiresAt-Date.now()<=REMEMBER_DAYS*86400000);
  assert.ok(result.expiresAt-Date.now()>29*86400000);
  assert.equal(await sessionValid('Bearer '+result.token,loginSecrets.SCOUT_SESSION_SECRET),true);
  assert.equal(await sessionValid('Bearer '+result.token,'x'.repeat(64)),false);
  assert.equal(await sessionValid('Bearer '+result.token+'tamper',loginSecrets.SCOUT_SESSION_SECRET),false);
  assert.equal(await sessionValid('Bearer '+result.token,loginSecrets.SCOUT_SESSION_SECRET,
    result.expiresAt+1000),false);
  const keyless=await view.fetch(new Request('https://viewer.example/api/v4/journal'),env());
  assert.equal(keyless.status,401);
  const journal=await view.fetch(new Request(
    'https://viewer.example/api/v4/journal?limit=30&offset=20',{headers:{
      Authorization:'Bearer '+result.token,Origin:origin
    }}),env());
  assert.equal(journal.status,200);
  const data=await journal.json();
  assert.equal(data.readOnly,true);
  assert.equal(data.events[0].type,'WATCH');
});
test('login without remembering expires next day; same password never rotates on refresh',async()=>{
  const short=await newSession(loginSecrets.SCOUT_SESSION_SECRET,false);
  assert.ok(short.expiresAt-Date.now()<86401000);
  assert.equal(await sessionValid('Bearer '+short.token,loginSecrets.SCOUT_SESSION_SECRET),true);
  assert.equal(await sessionValid('Bearer '+short.token,loginSecrets.SCOUT_SESSION_SECRET,
    Date.now()+86400001),false);
});
test('wrong credentials rejected and attempt limiter enforced',async()=>{
  const wrong=await view.fetch(post({...credentials,password:'wrong'}),env());
  assert.equal(wrong.status,401);
  assert.match((await wrong.json()).error,/Incorrect/);
  const blocked=await view.fetch(post(credentials),env(false));
  assert.equal(blocked.status,429);
  const noSetup=await view.fetch(post(credentials),{});
  assert.equal(noSetup.status,503);
});
test('viewer refuses unauthorized origin and methods; health remains public',async()=>{
  const wrongOrigin=await view.fetch(new Request('https://viewer.example/api/v4/login',{
    method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},
    body:JSON.stringify(credentials)
  }),env());
  assert.equal(wrongOrigin.status,403);
  const postJournal=await view.fetch(new Request('https://viewer.example/api/v4/journal',{
    method:'POST'
  }),env());
  assert.equal(postJournal.status,404);
  const health=await view.fetch(new Request('https://viewer.example/health'),{});
  assert.equal(health.status,200);
  assert.equal((await health.json()).paperOnly,true);
});
test('journal page accepts valid pagination, rejects bad offset',async()=>{
  const signed=await newSession(loginSecrets.SCOUT_SESSION_SECRET,true);
  const headers={Authorization:'Bearer '+signed.token,Origin:origin};
  const ok=await view.fetch(new Request(
    'https://viewer.example/api/v4/journal?limit=30&offset=20&anchor=1795130000000',
    {headers}),env());
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).version,'V4');
  const bad=await view.fetch(new Request(
    'https://viewer.example/api/v4/journal?offset=broken',{headers}),env());
  assert.equal(bad.status,400);
});
test('viewer indicators never fabricate absent market structure',()=>{
  assert.equal(packStructure(null),null);
  const v=packStructure({closedAt:111,trend:'NEUTRAL',price:100,rsi:50,
    e8:101,e21:102,adDelta:NaN,bands:null,support:null,resistance:null});
  assert.equal(v.trend,'NEUTRAL');
  assert.equal(v.adDelta,null);
  assert.equal(v.price,100);
});

test('Kalshi public contract quote validates ticker and never fabricates prices',()=>{
  assert.equal(directQuoteTicker('KXETH15M-26NOV200000-00'),
    'https://external-api.kalshi.com/trade-api/v2/markets/KXETH15M-26NOV200000-00');
  assert.equal(directQuoteTicker('https://evil.example/'),null);
  assert.equal(directQuoteTicker('KXBTC15M-26NOV200000-00'),null);
  assert.equal(directQuoteTicker('KXETH15M-../secrets'),null);
  assert.equal(directQuoteTicker(null),null);
  const now=Date.parse('2026-11-20T05:15:00Z');
  const body={ticker:'KXETH15M-26NOV200530-30',
    close_time:'2026-11-20T05:30:00Z',status:'open',
    floor_strike:1781.42,yes_bid_dollars:'0.4300',
    yes_ask_dollars:'0.4500',no_bid_dollars:'0.5500',
    no_ask_dollars:'0.5700'};
  const quote=publicContract(body,now);
  assert.equal(quote.floor_strike,1781.42);
  assert.equal(quote.yes_ask_dollars,'0.4500');
  assert.equal(quote.yes_bid_dollars,'0.4300');
  assert.equal(quote.no_ask_dollars,'0.5700');
  assert.equal(quote.no_bid_dollars,'0.5500');
  assert.equal(quote.quoteObservedAt,now);
  assert.equal(publicContract({...body,status:'settled'},now),null);
  assert.equal(publicContract({...body,close_time:'2026-11-20T05:00:00Z'},now),null);
  const incomplete=publicContract({...body,yes_ask_dollars:undefined},now);
  assert.equal(incomplete.yes_ask_dollars,null);
  assert.equal(incomplete.no_ask_dollars,'0.5700');
});


test('V4 stream archive remains session-gated and permanently GET-only',async()=>{
 const signed=await newSession(loginSecrets.SCOUT_SESSION_SECRET,true);
 const seen=[];
 const e=env();
 e.SCOUT_V4={getByName:()=>({fetch:async url=>{
   seen.push(String(url));
   return Response.json({paperOnly:true,readOnly:true,items:[],
     anchor:100,before:60,nextBefore:null,limit:40,total:0});
 }})};
 const root='https://viewer.example/api/v4/stream';
 const unauthorized=await view.fetch(new Request(root),e);
 assert.equal(unauthorized.status,401);
 const post=await view.fetch(new Request(root,{
  method:'POST',headers:{Origin:origin,
   Authorization:'Bearer '+signed.token}}),e);
 assert.equal(post.status,404);
 const headers={Origin:origin,Authorization:'Bearer '+signed.token};
 const invalid=await view.fetch(new Request(root+'?ticker=https://evil.test&limit=100',
  {headers}),e);
 assert.equal(invalid.status,400);
 const valid=await view.fetch(new Request(root+'?limit=40&before=60&anchor=100',
  {headers}),e);
 assert.equal(valid.status,200);
 assert.equal((await valid.json()).readOnly,true);
 assert.equal(seen.length,1);
 assert.match(seen[0],/\/v1\/stream\?/);
 assert.doesNotMatch(seen[0],/\/v1\/start|\/v1\/stop|\/v1\/arm/);
});


test('REST book archive is GET-only, session-gated and reaches V4 local Durable Object only',async()=>{
 const signed=await newSession(loginSecrets.SCOUT_SESSION_SECRET,true);
 const seen=[];
 const e=env();
 e.SCOUT_V4={getByName:name=>{
  assert.equal(name,'v4-single-paper-scout');
  return {fetch:async url=>{
   seen.push(String(url));
   return Response.json({paperOnly:true,readOnly:true,
    source:'KALSHI_OFFICIAL_REST_ORDERBOOK',isWebSocket:false,
    items:[],total:0,anchor:0,before:null,nextBefore:null,limit:20});
  }};
 }};
 const u='https://viewer.example/api/v4/rest-book';
 assert.equal((await view.fetch(new Request(u),e)).status,401);
 const head={Origin:origin,Authorization:'Bearer '+signed.token};
 assert.equal((await view.fetch(new Request(u,{method:'POST',headers:head}),e)).status,404);
 assert.equal((await view.fetch(new Request(u+'?ticker=https://evil.invalid', {headers:head}),e)).status,400);
 const ok=await view.fetch(new Request(u+'?limit=20',{headers:head}),e);
 assert.equal(ok.status,200);
 const p=await ok.json();
 assert.equal(p.paperOnly,true);
 assert.equal(p.readOnly,true);
 assert.equal(p.isWebSocket,false);
 assert.equal(seen.length,1);
 assert.match(seen[0],/https:\/\/internal\/v1\/rest-book\?limit=20/);
 assert.doesNotMatch(seen[0],/\/v1\/arm|\/v1\/start|\/v1\/stop/);
});

test('dashboard keeps core data when an optional archive throws or sends malformed JSON',async()=>{
 const e=env();
 e.SCOUT_V4.getByName=()=>({fetch:async url=>{
  const path=new URL(url).pathname;
  if(path==='/v1/stream')throw Error('internal failure');
  if(path==='/v1/rest-book')return new Response('invalid');
  if(path==='/v1/status')return Response.json({paperMode:'disabled',
   marketSnapshot:{asOf:Date.now(),candles:{m5:[{}]}}});
  return Response.json({});
 }});
 const {token}=await newSession(e.SCOUT_SESSION_SECRET,false);
 const response=await view.fetch(new Request('https://viewer.example/api/v4/dashboard',
  {headers:{Authorization:'Bearer '+token}}),e);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.status.paperMode,'disabled');
 assert.equal(data.streamAvailable,false);
 assert.equal(data.restBookAvailable,false);
});

test('dashboard reports required read failures without exposing exception text',async()=>{
 const e=env();
 e.SCOUT_V4.getByName=()=>({fetch:async url=>{
  if(new URL(url).pathname==='/v1/status')throw Error('private exception');
  return Response.json({});
 }});
 const {token}=await newSession(e.SCOUT_SESSION_SECRET,false);
 const response=await view.fetch(new Request('https://viewer.example/api/v4/dashboard',
  {headers:{Authorization:'Bearer '+token}}),e);
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:'V4 engine read unavailable',failedReads:['status']});
});
