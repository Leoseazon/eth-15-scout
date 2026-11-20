import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePending} from '../src/paper-ledger.js';

const pos=(ticker='KXETH15M-TEST')=>({ticker,side:'DOWN',qty:4,
 cost:2.59,entryFee:.07,entry:.63,time:1000,
 closeTime:'2026-11-20T06:00:00Z'});
const official=(ticker='KXETH15M-TEST')=>({ticker,
 status:'OFFICIAL_RESULT',exchangeStatus:'finalized',
 outcome:'DOWN',reportedDirection:'DOWN',officialResult:'no',
 settledAt:2000});
function makeSql({settlements={},finished=[]}={}){
 const done=new Set(finished),writes=new Map();
 return {writes,exec(statement,ticker){
   if(statement.startsWith('SELECT ticker FROM trades'))
     return {toArray:()=>done.has(ticker)?[{ticker}]:[]};
   if(statement.startsWith('SELECT status,data FROM window_outcomes')){
     const w=settlements[ticker];
     return {toArray:()=>w?[{status:w.status,data:JSON.stringify(w)}]:[]};
   }
   throw Error('Unexpected query in mock: '+statement);
 }};
}
test('confirmed exchange win pays out stake once, never uses market outcome for early sale',()=>{
 const p=pos(),sql=makeSql({settlements:{[p.ticker]:official()}});
 const state={cash:95.59,realized:.65,trades:[],pending:[p],events:[]};
 assert.equal(reconcilePending(state,sql,3000),1);
 assert.equal(state.pending.length,0);
 assert.equal(state.cash,99.59);
 assert.equal(state.realized,2.06); // .65 + (4.00 - 2.59)
 assert.equal(state.trades[0].pnl,1.41);
 assert.equal(state.trades[0].status,'WIN');
 assert.equal(state.events[0].type,'PAPER SETTLED');
 assert.equal(reconcilePending(state,sql,4000),0);
 assert.equal(state.cash,99.59);
});
test('unverified / provisional settlement cannot release pending paper funds',()=>{
 const p=pos(),w={...official(),status:'REPORTED',exchangeStatus:'determined'};
 const sql=makeSql({settlements:{[p.ticker]:w}});
 const state={cash:95.59,realized:.65,trades:[],pending:[p],events:[]};
 assert.equal(reconcilePending(state,sql,3000),0);
 assert.equal(state.cash,95.59);assert.equal(state.realized,.65);
 assert.equal(state.pending.length,1);
});
test('already finalized ticker cannot receive payout again',()=>{
 const p=pos(),sql=makeSql({finished:[p.ticker],settlements:{[p.ticker]:official()}});
 const state={cash:95.59,realized:.65,trades:[],pending:[p],events:[]};
 assert.equal(reconcilePending(state,sql,3000),1);
 assert.equal(state.pending.length,0);
 assert.equal(state.cash,95.59);
 assert.equal(state.realized,.65);
 assert.equal(state.trades.length,0);
});
