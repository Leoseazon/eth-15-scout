import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyHistoricalMarket,summarizeMarkets,auditHistorical90Days,DAY} from '../src/history-90d-audit.js';
const now=1795300000000,close=new Date(now-DAY).toISOString();
const market=(ticker,result,options={})=>({ticker,close_time:close,open_time:new Date(now-DAY-900000).toISOString(),
 floor_strike:1680.25,status:'finalized',result,rules_primary:'Rule text',
 ...options});
const A='KXETH15M-26NOV200000-00',B='KXETH15M-26NOV200015-15';
test('actual KXETH15M market is unit, requires finalized nonprovisional settlement and actual target',()=>{
 assert.equal(classifyHistoricalMarket(market(A,'yes'),now-2*DAY,now).result,'yes');
 assert.equal(classifyHistoricalMarket(market(A,'no',{status:'determined'}),now-2*DAY,now).result,null);
 assert.equal(classifyHistoricalMarket(market(A,'yes',{is_provisional:true}),now-2*DAY,now).result,null);
 assert.equal(classifyHistoricalMarket(market(A,'yes',{floor_strike:null}),now-2*DAY,now).hasTarget,false);
 assert.equal(classifyHistoricalMarket(market('BAD','yes'),now-2*DAY,now),null);
});
test('deduplicates same market across historical/live cutoff and counts UP/DOWN independently',()=>{
 const stats=summarizeMarkets([market(A,'no',{status:'determined'}),market(A,'yes'),
  market(B,'no'),market('BAD','yes')],{startAt:now-90*DAY,endAt:now});
 assert.equal(stats.markets,3);assert.equal(stats.unique,2);
 assert.equal(stats.duplicateTickers,1);assert.equal(stats.up,1);
 assert.equal(stats.down,1);assert.equal(stats.finalized,2);
 assert.equal(stats.missingTargets,0);
});
test('bounded two-tier historical collector never asserts complete if any tier pages inaccessible',async()=>{
 const calls=[];
 const fetcher=async url=>{
  calls.push(url);
  let data=url.endsWith('/historical/cutoff')?
    {market_settled_ts:new Date(now-30*DAY).toISOString()}:
    url.includes('/historical/markets')?
    {markets:[market(A,'yes')],cursor:''}:
    {markets:[market(B,'no')],cursor:''};
  return {ok:true,headers:{get:()=>null},json:async()=>data};
 };
 const result=await auditHistorical90Days({fetcher,now,days:90,maxPages:2});
 assert.equal(result.finalized,2);assert.equal(result.targetPresent,2);
 assert.equal(result.completenessVerified,true);
 assert.equal(result.upRate,.5);
 assert.ok(calls.every(x=>x.startsWith('https://external-api.kalshi.com/trade-api/v2')));
 assert.doesNotMatch(JSON.stringify(result),/1680.25/); // only aggregate outcomes; no raw index values
});
test('failure or pagination gap cannot be reported as a complete 90-day study',async()=>{
 const fetcher=async url=>{
  if(url.includes('historical/markets'))throw Error('Rate limited');
  return {ok:true,headers:{get:()=>null},
   json:async()=>url.includes('cutoff')?{}:{markets:[],cursor:''}};
 };
 const s=await auditHistorical90Days({fetcher,now});
 assert.equal(s.completenessVerified,false);
 assert.ok(s.errors.some(e=>e.includes('Rate limited')));
});
