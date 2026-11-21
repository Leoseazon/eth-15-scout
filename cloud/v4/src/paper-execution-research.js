/*
 * V4 Gate 4 — RESEARCH-ONLY fee-aware displayed book execution scenarios.
 * No order path, no balance change, no claim of real execution. Do not activate
 * paper positions until independent live data, fee schedule and replay signoff.
 */
const round2=v=>Math.round((v+Number.EPSILON)*100)/100;
const feeCents=(gross,qty,price)=>{
 // Kalshi published general taker fee: ceil(0.07 * C * P * (1-P)) to cents.
 // Series-specific exemptions/multipliers must be verified before release.
 return Math.ceil(0.07*qty*price*(1-price)*100-1e-8);
};
export const EXECUTION_ASSUMPTIONS=Object.freeze({
 version:'V4-BOOK-PAPER-RESEARCH-20261121',
 maxStakeAllIn:3,initialBankroll:100,
 feeModel:'GENERAL_TAKER_FORMULA_PROVISIONAL_NOT_SERIES_VERIFIED',
 latencyModel:'NO_NETWORK_LATENCY_MODEL',
 fillStatus:'HYPOTHETICAL_DISPLAYED_BOOK_ONLY'
});
export function hypotheticalTaker(book,{ticker,side,action,contracts,now=Date.now(),
  slipCents=0,maxAgeMs=5000}){
 if(!['UP','DOWN'].includes(side)||!['BUY','SELL'].includes(action)||
  !Number.isSafeInteger(contracts)||contracts<1||contracts>200||
  !Number.isInteger(slipCents)||slipCents<0||slipCents>5)
   throw new TypeError('Invalid research taker scenario');
 if(!book||typeof book.walk!=='function')
   throw new TypeError('Verified order book required');
 const walk=book.walk(ticker,{side,action,contracts,now,maxAgeMs});
 if(walk.executable!==true||!Array.isArray(walk.levels))
  return {status:'NO_QUOTE_OR_DEPTH',executable:false,
    reason:walk.reason||'UNKNOWN',contracts,side,action,
    verifiedFill:false,feeVerified:false};
 let grossCents=0,fee=0;
 const levels=[];
 for(const level of walk.levels){
  const price=level.price+(action==='BUY'?1:-1)*slipCents/100;
  if(!Number.isFinite(price)||price<=0||price>=1)
   return {status:'INVALID_SLIPPAGE',executable:false,
     reason:'Slipped price outside tradable range',verifiedFill:false};
  const gross=level.contracts*price;
  const cents=feeCents(gross,level.contracts,price);
  grossCents+=Math.round(gross*10000)/100; // cents (price to 1e-4)
  fee+=cents;
  levels.push({contracts:level.contracts,price,feeDollars:round2(cents/100)});
 }
 const grossDollars=round2(grossCents/100);
 const feesDollars=round2(fee/100);
 const cashFlow=round2((action==='BUY'?-grossDollars:grossDollars)-feesDollars);
 return {status:'HYPOTHETICAL',executable:false,
  displayedDepthAvailable:true,source:'KALSHI_WEBSOCKET_ORDERBOOK',
  verifiedFill:false,feeVerified:false,latencyVerified:false,
  side,action,contracts,levels,grossDollars,feesDollars,
  cashFlow,allInCost:action==='BUY'?-cashFlow:null,
  netProceeds:action==='SELL'?cashFlow:null,
  slipCents,assumptions:EXECUTION_ASSUMPTIONS};
}
export function findBudgetedHypotheticalEntry(book,{
 ticker,side,budget=3,now=Date.now(),slipCents=0,maxContracts=100}){
 if(!Number.isFinite(budget)||budget<=0||budget>3||
  !Number.isInteger(maxContracts)||maxContracts<1||maxContracts>200)
  throw new TypeError('V4 hypothetical entry budget exceeds safety boundary');
 let best=null;
 for(let qty=1;qty<=maxContracts;qty++){
  const result=hypotheticalTaker(book,{
    ticker,side,action:'BUY',contracts:qty,now,slipCents});
  if(result.status!=='HYPOTHETICAL')break;
  if(result.allInCost>budget)break;
  best=result;
 }
 return best||{status:'NO_BUDGETED_DISPLAYED_FILL',
  verifiedFill:false,feeVerified:false,executable:false};
}
export function hypotheticalRoundTrip(book,{ticker,side,contracts,now=Date.now(),slipCents=0}){
 const buy=hypotheticalTaker(book,{
  ticker,side,action:'BUY',contracts,now,slipCents});
 const sell=hypotheticalTaker(book,{
  ticker,side,action:'SELL',contracts,now,slipCents});
 if(buy.status!=='HYPOTHETICAL'||sell.status!=='HYPOTHETICAL')
  return {status:'UNAVAILABLE',buy,sell,verifiedFill:false};
 return {status:'HYPOTHETICAL',buy,sell,
  feeAdjustedPnl:round2(buy.cashFlow+sell.cashFlow),
  verifiedFill:false,feeVerified:false,latencyVerified:false,
  note:'Two displayed book walks at the same instant, not realizable as a guaranteed pair'};
}
