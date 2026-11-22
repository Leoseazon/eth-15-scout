import test from 'node:test';
import assert from 'node:assert/strict';
import {KalshiBookStream,fixed,subscribeOrderbook,requestSnapshot} from '../src/kalshi-orderbook.js';

const ticker='KXETH15M-26NOV210015-15';
const other='KXETH15M-26NOV210030-30';
const at=1795200000000;
const snap=(seq=2,yes=[['0.3700','2.00'],['0.3500','1.00']],
  no=[['0.6000','3.00'],['0.5700','1.00']],market=ticker,sid=4)=>({
    type:'orderbook_snapshot',sid,seq,sending_ts_ms:at-10,
    msg:{market_ticker:market,clock:100,yes_dollars_fp:yes,no_dollars_fp:no}
  });
const delta=(seq,side,price,amount,market=ticker,clock=102,sid=4)=>({
    type:'orderbook_delta',sid,seq,sending_ts_ms:at-5,
    msg:{market_ticker:market,clock,side,price_dollars:price,delta_fp:amount,ts_ms:at-8}
  });

test('strict fixed point does not round, coerce missing, or accept >4-decimal prices',()=>{
  assert.equal(fixed('0.6000',4),6000);
  assert.equal(fixed('3.25',2),325);
  assert.equal(fixed('-1.25',2,{negative:true}),-125);
  for(const invalid of [null,1,'0.60001','NaN','1e-2','', ' 0.5']){
    assert.throws(()=>fixed(invalid,4));
  }
});
test('snapshot reconstructs bids, complementary asks and EXACT opposite-side depth',()=>{
  const b=new KalshiBookStream();
  assert.equal(b.apply(snap(),at).accepted,true);
  const v=b.view(ticker,at+100);
  assert.equal(v.valid,true);assert.equal(v.fresh,true);
  assert.deepEqual(v.yesBid,{price:0.37,sizeFp:'2.00'});
  assert.deepEqual(v.yesAsk,{price:0.4,sizeFp:'3.00'});
  assert.deepEqual(v.noBid,{price:0.6,sizeFp:'3.00'});
  assert.deepEqual(v.noAsk,{price:0.63,sizeFp:'2.00'});
  assert.equal(v.exchangeEventAt,null);
  assert.equal(v.sendingAt,at-10);
});
test('delta updates aggregated depth, deletes zero levels, and keeps contiguous seq',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  assert.equal(b.apply(delta(3,'yes','0.3700','-1.00'),at+30).accepted,true);
  assert.equal(b.view(ticker,at+40).yesBid.sizeFp,'1.00');
  assert.equal(b.apply(delta(4,'yes','0.3700','-1.00'),at+40).accepted,true);
  assert.equal(b.view(ticker,at+50).yesBid.price,0.35);
  assert.equal(b.gaps,0);
});
test('sequence gap invalidates ALL books until each is re-snapshotted',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  b.apply(snap(3,[['0.3000','1.00']],[['0.5000','1.00']],other),at);
  const bad=b.apply(delta(5,'yes','0.3700','1.00'),at+100);
  assert.equal(bad.accepted,false);
  assert.equal(b.needsResync,true);assert.equal(b.gaps,1);
  assert.equal(b.view(ticker,at+100).fresh,false);
  assert.equal(b.view(other,at+100).fresh,false);
  const restored=b.apply(snap(6),at+110);
  assert.equal(restored.accepted,true);
  assert.equal(b.view(ticker,at+120).valid,true);
  assert.equal(b.view(other,at+120).valid,false);
  assert.equal(b.needsResync,true);
  b.apply(snap(7,[['0.3000','1.00']],[['0.5000','1.00']],other),at+130);
  assert.equal(b.needsResync,false);
});
test('deltas are never applied before receiving a complete snapshot',()=>{
  const b=new KalshiBookStream();
  const r=b.apply(delta(3,'yes','0.3700','1.00'),at);
  assert.equal(r.accepted,false);
  assert.equal(r.reason,'SNAPSHOT_REQUIRED');
  assert.equal(b.view(ticker,at).valid,false);
});
test('new subscription sid invalidates prior book and requires a new snapshot',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  const r=b.apply(delta(1,'yes','0.3700','1.00',ticker,101,7),at+100);
  assert.equal(r.accepted,false);
  assert.equal(b.view(ticker,at+100).valid,false);
  b.apply(snap(2,[['0.5000','2.00']],[['0.4000','2.00']],ticker,7),at+110);
  assert.equal(b.view(ticker,at+120).yesBid.price,0.5);
});
test('negative depth, duplicate price in snapshots, and malformed prices fail closed',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  assert.equal(b.apply(delta(3,'yes','0.3700','-3.00'),at+100).accepted,false);
  assert.equal(b.view(ticker,at+100).valid,false);
  assert.equal(b.apply(snap(4,[['0.25','1.00'],['0.2500','2.00']]),at+110).accepted,false);
  assert.equal(b.view(ticker,at+110).valid,false);
  assert.equal(b.apply(snap(5,[['0.00000','1.00']]),at+120).accepted,false);
});
test('missing sides mean empty liquidity, never a fabricated 1-p quote',()=>{
  const b=new KalshiBookStream();const s=snap();
  delete s.msg.no_dollars_fp;
  b.apply(s,at);
  const q=b.view(ticker,at);
  assert.equal(q.noBid,null);assert.equal(q.yesAsk,null);
  assert.equal(q.yesBid.price,0.37);
  assert.equal(q.noAsk.price,0.63);
});
test('empty and locked books do not create a viable execution quote',()=>{
  const b=new KalshiBookStream();
  b.apply(snap(2,[],[]),at);
  assert.equal(b.view(ticker,at).fresh,true);
  assert.equal(b.walk(ticker,{side:'UP',action:'BUY',contracts:1,now:at}).executable,false);
  b.apply(snap(3,[['0.7000','2.00']],[['0.5000','3.00']]),at+1);
  assert.equal(b.view(ticker,at+2).reason,'LOCKED_OR_CROSSED');
});
test('age uses receipt, sending and event time independently, and fails closed when stale',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  assert.equal(b.view(ticker,at+6000).fresh,false);
  assert.equal(b.walk(ticker,{side:'DOWN',action:'BUY',contracts:1,now:at+6000}).executable,false);
  const packet=snap(3);
  packet.sending_ts_ms=at-60000;
  b.apply(packet,at+5);
  assert.equal(b.view(ticker,at+10).fresh,false);
  const packet2=delta(4,'yes','0.3700','1.00');
  packet2.msg.ts_ms=at-60000;
  packet2.sending_ts_ms=at+10;
  b.apply(packet2,at+11);
  assert.equal(b.view(ticker,at+12).fresh,false);
});
test('displayed book walk respects price priority, opposite-side price and partial-depth risk',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  const buyUp=b.walk(ticker,{side:'UP',action:'BUY',contracts:4,now:at});
  assert.equal(buyUp.executable,true);
  assert.equal(buyUp.grossDollars,1.63); // 3 at 40c, 1 at 43c
  assert.equal(buyUp.averagePrice,0.4075);
  const sellUp=b.walk(ticker,{side:'UP',action:'SELL',contracts:3,now:at});
  assert.equal(sellUp.executable,true);
  assert.equal(sellUp.grossDollars,1.09); // 2 at 37c, 1 at 35c
  const thin=b.walk(ticker,{side:'UP',action:'BUY',contracts:5,now:at});
  assert.equal(thin.executable,false);
  assert.equal(thin.availableContracts,4);
  const down=b.walk(ticker,{side:'DOWN',action:'BUY',contracts:2,now:at});
  assert.equal(down.grossDollars,1.26);
});
test('book clock does NOT stand in for seq; lower clock still applies with proper seq',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);
  assert.equal(b.apply(delta(3,'no','0.6000','-1.00',ticker,90),at+20).accepted,true);
  assert.equal(b.gaps,0);
  assert.equal(b.view(ticker,at+30).noBid.sizeFp,'2.00');
});
test('disconnect invalidates quote and commands are scoped to explicitly named markets',()=>{
  const b=new KalshiBookStream();b.apply(snap(),at);b.disconnected();
  assert.equal(b.view(ticker,at).fresh,false);
  assert.deepEqual(subscribeOrderbook(ticker,12),
    {id:12,cmd:'subscribe',params:{channels:['orderbook_delta'],market_tickers:[ticker]}});
  assert.deepEqual(requestSnapshot(4,ticker,13),
    {id:13,cmd:'update_subscription',params:{sids:[4],action:'get_snapshot',market_tickers:[ticker]}});
  assert.throws(()=>subscribeOrderbook('https://private.example/'));
  assert.throws(()=>requestSnapshot(0,ticker,1));
});
