import test from 'node:test';
import assert from 'node:assert/strict';
import view,{packStructure} from '../viewer-worker.js';
import {checkCredentials,credentialsConfigured,newSession,sessionValid,REMEMBER_DAYS} from '../viewer-auth.js';

const loginSecrets={
  SCOUT_LOGIN_USER:'only-owner',
  SCOUT_LOGIN_PASSWORD:'a-very-long-local-only-demo-password-1234',
  SCOUT_SESSION_SECRET:'d'.repeat(64)
};
const env=(limit=true)=>({...loginSecrets,
  LOGIN_RATE_LIMIT:{limit:async()=>({success:limit})},
  SCOUT:{getByName:name=>{
    assert.equal(name,'single-paper-scout');
    return {fetch:async()=>Response.json({paperOnly:true,readOnly:true,
      events:[{id:'event1',time:1795130000000,type:'WATCH',msg:'Watching'}],
      trades:[],decisions:[],pending:[],totals:{events:1,trades:0,decisions:0}})}
  }}
});
const origin='https://leoseazon.github.io';
const post=(body)=>new Request('https://viewer.example/api/v3/login',{
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
  const keyless=await view.fetch(new Request('https://viewer.example/api/v3/journal'),env());
  assert.equal(keyless.status,401);
  const journal=await view.fetch(new Request(
    'https://viewer.example/api/v3/journal?limit=30&offset=20',{headers:{
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
  const wrongOrigin=await view.fetch(new Request('https://viewer.example/api/v3/login',{
    method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},
    body:JSON.stringify(credentials)
  }),env());
  assert.equal(wrongOrigin.status,403);
  const postJournal=await view.fetch(new Request('https://viewer.example/api/v3/journal',{
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
    'https://viewer.example/api/v3/journal?limit=30&offset=20&anchor=1795130000000',
    {headers}),env());
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).version,'V3');
  const bad=await view.fetch(new Request(
    'https://viewer.example/api/v3/journal?offset=broken',{headers}),env());
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
