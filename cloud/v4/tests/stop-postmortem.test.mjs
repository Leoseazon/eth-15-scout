import test from 'node:test';
import assert from 'node:assert/strict';
import '../../../v4/stop-postmortem.js';
const audit=globalThis.ScoutStopAudit.analyzeStopHistory;
const at=Date.parse('2026-11-21T05:00:00Z');
const ticker='KXETH15M-26NOV210015-15';
const trade={ticker,side:'UP',exitAt:at,entry:.50,exitPrice:.25,
  pnl:-1.10,cost:2.00,remainingSecondsAtExit:200,
  closeTime:new Date(at+200000).toISOString(),
  reason:'Stop loss (−40% contract-price movement; final 6 minutes only)'};
const sample=(sec,bid)=>({ticker,observed_at:at+sec*1000,
  close_at:at+200000,yes_bid:bid,no_bid:.40});

test('later REST price recovery is OBSERVED, never a paper fill or proven P&L',()=>{
 const r=audit([trade],[sample(31,.38),sample(61,.52),sample(121,.57)],
  [{ticker,closeAt:at+200000,status:'OFFICIAL_RESULT',outcome:'UP'}]);
 assert.equal(r.stoppedTrades,1);
 assert.equal(r.realizedStopNetPnl,-1.10);
 assert.equal(r.officialDirectionCorrectCount,1);
 assert.equal(r.observedQuoteRecoveries,1);
 assert.deepEqual(r.stops[0].horizons.map(x=>x.seconds),[30,60,120]);
 assert.equal(r.stops[0].horizons[0].reachedEntryPrice,false);
 assert.equal(r.stops[0].horizons[1].reachedEntryPrice,true);
 assert.equal(r.stops[0].horizons[2].verifiedFill,false);
 assert.equal(r.stops[0].settlementDirectionCorrect,true);
});
test('missing horizon quotes and settlement stay UNKNOWN rather than inferred',()=>{
 const r=audit([trade],[],[{ticker,closeAt:at+200000,status:'PENDING',outcome:'UP'}]);
 assert.equal(r.stoppedTrades,1);
 assert.equal(r.observedQuoteRecoveries,0);
 assert.equal(r.stops[0].settlementDirectionCorrect,null);
 assert.ok(r.stops[0].horizons.every(h=>h.status==='UNAVAILABLE'));
});
test('do not use pre-horizon bid, too-late bid, wrong ticker, or post-close quotes',()=>{
 const r=audit([trade],[sample(29,.96),sample(59,.96),
  sample(90,.96),{...sample(61,.96),ticker:'KXBTC15M-26NOV210015-15'}]);
 assert.equal(r.stops[0].horizons[0].status,'UNAVAILABLE');
 assert.equal(r.stops[0].horizons[1].status,'UNAVAILABLE');
});
test('expired market cannot be counted as a post-exit resale opportunity',()=>{
 const position={...trade,closeTime:new Date(at+50000).toISOString()};
 const r=audit([position],[sample(31,.98),sample(60,.98)],[
  {ticker,closeAt:at+50000,status:'OFFICIAL_RESULT',outcome:'UP'}]);
 assert.equal(r.stops[0].horizons[0].status,'OBSERVED_REST_UNVERIFIED_EXECUTION');
 assert.equal(r.stops[0].horizons[1].status,'CONTRACT_EXPIRED');
 assert.equal(r.stops[0].horizons[2].status,'CONTRACT_EXPIRED');
});
test('exclude non-stop exits; preserve trade-level loss and side-specific quote fields',()=>{
 const down={...trade,side:'DOWN',exitBid:.3};
 const quotes=[{...sample(30,.9),no_bid:.56}];
 const r=audit([down,{...trade,reason:'96¢ bid take-profit'}],quotes);
 assert.equal(r.stoppedTrades,1);
 assert.equal(r.stops[0].horizons[0].bid,.56);
 assert.equal(r.stops[0].horizons[0].reachedEntryPrice,true);
});
