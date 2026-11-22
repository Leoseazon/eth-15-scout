import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {verifyCFWebSocket} from '../src/cf-ws-probe.js';
const T=1770000000000;
const {privateKey}=generateKeyPairSync('ed25519');
const credentials={keyId:'test-only',privatePem:privateKey.export({format:'pem',type:'pkcs8'}).toString()};
const frame=()=>({type:'cfbenchmarks_value',sid:9,seq:4,sending_ts_ms:T,
 msg:{index_id:'ETHUSD_RTI',received_at:T-600,
  data:JSON.stringify({id:'ETHUSD_RTI',type:'value',time:T-1000,value:'1760.12345678'}),
  avg_60s_data:{value:'1760.12',window_size:3,
   window_start_ts_ms:T-60000,window_end_ts_exclusive:T}}});
class Socket{
 constructor({list=true,sendValue=true,bad=false,noAck=false,closed=false}={}){
  this.opts={list,sendValue,bad,noAck,closed};this.handlers={};this.sent=[];this.closed=false;
 }
 addEventListener(event,listener){this.handlers[event]=listener}
 accept(){this.accepted=true}
 emit(p){this.handlers.message?.({data:JSON.stringify(p)})}
 close(){this.closed=true}
 send(raw){
  const p=JSON.parse(raw);this.sent.push(p);
  if(p.id===1&&!this.opts.noAck)queueMicrotask(()=>
   this.emit({type:'subscribed',id:1,msg:{sid:9,channel:'cfbenchmarks_value'}}));
  if(p.id===2){
   queueMicrotask(()=>{
    if(this.opts.closed){this.handlers.close?.();return}
    this.emit({type:'cfbenchmarks_value_indexlist',sid:9,
     msg:{index_ids:this.opts.list?['ETHUSD_RTI','BRTI']:['BRTI']}});
    if(this.opts.sendValue&&this.opts.list){
     const p=frame();if(this.opts.bad)p.msg.data='not json';
     this.emit(p);
    }
   });
  }
 }
}
const make=ws=>verifyCFWebSocket({...credentials,fetcher:async()=>({status:101,webSocket:ws}),nowFn:()=>T});
test('one-shot subscription requires ACK, matching indexlist and fresh source-index frame',async()=>{
 const socket=new Socket(),result=await make(socket);
 assert.equal(result.state,'WS_ETH_INDEX_VERIFIED');
 assert.equal(result.websocketVerified,true);
 assert.equal(result.subscribed,true);assert.equal(result.indexAvailable,true);
 assert.equal(result.validValueReceived,true);
 assert.equal(result.value,1760.12345678);
 assert.equal(result.sourceAt,T-1000);
 assert.equal(result.sourceAgeSeconds,1);
 assert.equal(result.trailingAveragePresent,true);
 assert.equal(result.archived,false);
 assert.equal(socket.closed,true);
 assert.deepEqual(socket.sent,[{id:1,cmd:'subscribe',
  params:{channels:['cfbenchmarks_value'],index_ids:['ETHUSD_RTI']}},
  {id:2,cmd:'update_subscription',params:{sid:9,action:'indexlist'}}]);
});
test('rejected indexlist cannot be mistaken for valid entitlement',async()=>{
 const ws=new Socket({list:false}),result=await make(ws);
 assert.equal(result.state,'WS_ETH_INDEX_NOT_LISTED');
 assert.equal(result.websocketVerified,false);
 assert.equal(result.indexAvailable,false);
 assert.equal(ws.closed,true);
});
test('malformed value fails independently from acknowledged and listed index',async()=>{
 const ws=new Socket({bad:true}),result=await verifyCFWebSocket({...credentials,
  fetcher:async()=>({status:101,webSocket:ws}),nowFn:()=>T,timeoutMs:1000});
 assert.equal(result.state,'WS_INVALID_ETH_VALUE_FRAMES');
 assert.equal(result.subscribed,true);assert.equal(result.indexAvailable,true);
 assert.equal(result.websocketVerified,false);
});
test('subscription acknowledgment alone is never sufficient',async()=>{
 const ws=new Socket({sendValue:false});
 const result=await verifyCFWebSocket({...credentials,
  fetcher:async()=>({status:101,webSocket:ws}),nowFn:()=>T,timeoutMs:1000});
 assert.equal(result.state,'WS_NO_FRESH_ETH_VALUE');
 assert.equal(result.websocketVerified,false);
});
test('HTTP 403 entitlement failure and absent key reveal no credentials',async()=>{
 const noKey=await verifyCFWebSocket({});assert.equal(noKey.state,'WS_CREDENTIALS_UNAVAILABLE');
 const forbidden=await verifyCFWebSocket({...credentials,
  fetcher:async()=>({status:403,body:{cancel:async()=>{}}}),nowFn:()=>T});
 assert.equal(forbidden.state,'WS_HANDSHAKE_HTTP_403');
 assert.equal(forbidden.websocketVerified,false);
 assert.doesNotMatch(JSON.stringify(forbidden),/PRIVATE KEY|SIGNATURE|test-only/);
});
test('timeout before subscribed response never certifies WebSocket access',async()=>{
 const ws=new Socket({noAck:true});
 const result=await verifyCFWebSocket({...credentials,
  fetcher:async()=>({status:101,webSocket:ws}),nowFn:()=>T,timeoutMs:1000});
 assert.equal(result.state,'WS_NO_SUBSCRIPTION_ACK');
 assert.equal(result.websocketVerified,false);
 assert.equal(ws.closed,true);
});
