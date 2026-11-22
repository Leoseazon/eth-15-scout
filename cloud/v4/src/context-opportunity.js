/* V4 context-aware settlement/value engine. PAPER ONLY.
 * Controlling slogan: target-centered, context-aware paper-trading decision engine,
 * win the official target-side prediction, maximize the trade's attainable net
 * profit, and control downside on every 15-minute round.
 *
 * A transparent UNCALI­BRATED distributional SCENARIO analysis, NOT a machine-
 * learned model, true win probability, guaranteed EV, or actual Kalshi fill.
 * No dependency on future candles/outcomes, external APIs, new services or secrets.
 * The actual official benchmark/target are mandatory and primary.
 */
import {EXPLORATORY_MIN_CENTRAL_EDGE,EXPLORATORY_MAX_ASK,
 EXPLORATORY_MAX_SPREAD} from './exploratory-policy.js';
export const CONTEXT_VALUE_VERSION='V4-CONTEXT-VALUE-PAPER-20261122';
// At least the first 60 seconds of each 15-minute market are observation-only.
// New paper entry is eligible from 14m remaining down to >90s remaining.
export const ENTRY_MIN_REMAINING_SECONDS=90;
export const ENTRY_MAX_REMAINING_SECONDS=14*60;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=Number.isFinite;
const round=x=>Number(x.toFixed(6));
const fee=(p,q)=>Math.ceil(Math.max(0,.07*q*p*(1-p))*100-1e-8)/100;
// Abramowitz-Stegun normal CDF approximation, max absolute error ~1e-7.
export function normalCDF(z){
 if(!finite(z))return null;
 const a=Math.abs(z),t=1/(1+.2316419*a);
 const poly=t*(.319381530+t*(-.356563782+t*(1.781477937+
  t*(-1.821255978+t*1.330274429))));
 const tail=(.3989422804014327*Math.exp(-a*a/2))*poly;
 return clamp(z>=0?1-tail:tail,0,1);
}
/** Deterministic scenario envelope of 60s final-AVERAGE vs official target.
 * 1m Kraken price-change sigma proxies unobserved official RTI volatility.
 * Gaussian/no-jump/drift assumptions are explicit and unvalidated.
 */
export function targetScenarioEnvelope({target,indexValue,one,five,context,remainingSeconds}={}){
 if(![target,indexValue,remainingSeconds,one?.sd,one?.last,one?.three,
  one?.e8,one?.e21,one?.rNow,one?.mNow,one?.sNow,
  five?.e21,five?.e50,five?.rsi].every(finite)||
  target<=0||indexValue<=0||one.sd<=0||
  remainingSeconds<=60||remainingSeconds>900||
  !['UP','DOWN','NEUTRAL'].includes(context?.three?.trend)||
  !['UP','DOWN','NEUTRAL'].includes(context?.five?.trend))
  return {status:'SCENARIO_INPUT_UNAVAILABLE',calibrated:false};
 const delta=indexValue-target,t=remainingSeconds/60;
 const basis=Math.abs(indexValue-one.last);
 // Separate official RTI and Kraken prices: a large unexplained basis is unsafe.
 if(basis>Math.max(3,4*one.sd))
  return {status:'OFFICIAL_INDEX_KRAKEN_BASIS_UNSAFE',calibrated:false,
   officialDistance:delta,basis,calibratedWinProbability:null};
 const s=one.sd;
 const fast=clamp(
  .40*Math.tanh((one.three/3)/s)+
  .25*Math.tanh((one.e8-one.e21)/(2*s))+
  .20*Math.tanh((one.rNow-50)/18)+
  .15*Math.tanh((one.mNow-one.sNow)/(2*s)),-1,1);
 const slow3=context.three.trend==='UP'?1:context.three.trend==='DOWN'?-1:0;
 const slow5=context.five.trend==='UP'?1:context.five.trend==='DOWN'?-1:0;
 const structure=(2*slow3+slow5)/3;
 const slowOsc=clamp((five.rsi-50)/20,-1,1);
 const cross=clamp((five.e21-five.e50)/(2*s),-1,1);
 const slow=clamp(.60*structure+.20*slowOsc+.20*cross,-1,1);
 // Drift is shrunk; recent momentum is not extrapolated for all 15 minutes.
 const drift=s*.17*(.72*fast+.28*slow)*Math.min(t,4);
 // Brownian motion expected value of final 60s AVERAGE, not one last tick.
 // For t>=1 min, integrated variance = (t-2/3) * sigma_1m^2.
 const baseSigma=s*Math.sqrt(Math.max(1/3,t-2/3));
 const uncertainty=.34*s*Math.sqrt(t)*
  (1+.35*Math.abs(fast-slow)/2+.15*clamp(basis/(3*s),0,1));
 const seen=[];
 for(const volMultiplier of [.85,1,1.5]){
  for(const driftStress of [-1,0,1]){
   const projected=delta+drift+driftStress*uncertainty;
   const p=normalCDF(projected/(baseSigma*volMultiplier));
   if(p===null)return {status:'SCENARIO_NUMERICS_INVALID',calibrated:false};
   seen.push(p);
  }
 }
 const central=normalCDF((delta+drift)/baseSigma);
 const pUpMin=Math.min(...seen),pUpMax=Math.max(...seen);
 return {status:'SCENARIOS_READY',version:CONTEXT_VALUE_VERSION,
  calibrated:false,distribution:'UNVALIDATED_GAUSSIAN_1M_KRAKEN_PROXY',
  settlementClock:'OFFICIAL_FINAL_60_SECONDS_AVERAGE',
  officialDistance:round(delta),expectedRemainingPriceNoise:round(baseSigma),
  trendDrift:round(drift),stressBand:round(uncertainty),
  fastMomentumContext:round(fast),slowStructureContext:round(slow),
  indexKrakenBasis:round(basis),scenarioCount:seen.length,
  UP:{central:round(central),lower:round(pUpMin),upper:round(pUpMax)},
  DOWN:{central:round(1-central),lower:round(1-pUpMax),upper:round(1-pUpMin)},
  caveat:'These are sensitivity-model scenario frequencies, NOT verified chances of winning.'};
}
/** Evaluate the opportunity at the displayed Kalshi ASK, including quantity
 * and conservative transaction fees. Returns metrics, NOT a buy order.
 */
export function priceAwareOpportunity({side,book,scenario,remainingSeconds,
 budget=3,riskMode='NORMAL',mode='CONSERVATIVE'}={}){
 const fail=reason=>({side,status:'REJECT',reason});
 if(!['UP','DOWN'].includes(side)||scenario?.status!=='SCENARIOS_READY')
  return fail('SCENARIO_UNAVAILABLE');
 if(!finite(remainingSeconds)||remainingSeconds<=ENTRY_MIN_REMAINING_SECONDS||
   remainingSeconds>ENTRY_MAX_REMAINING_SECONDS)
  return fail('OUTSIDE_ENTRY_CLOCK');
 const a=side==='UP'?book?.yesAsk:book?.noAsk;
 const b=side==='UP'?book?.yesBid:book?.noBid;
 const ask=Number(a?.price),bid=Number(b?.price);
 const askDepth=Number(a?.sizeFp),bidDepth=Number(b?.sizeFp);
 if(![ask,bid,askDepth,bidDepth,budget].every(finite)||ask<=0||ask>1||
  bid<0||bid>ask||askDepth<1||bidDepth<1||budget<=0)
  return fail('INVALID_OR_EMPTY_BOOK');
 if(ask>.87)return fail('PRICE_ABOVE_87C_HARD_BUY_LIMIT');
 if(mode==='EXPLORATORY'&&(riskMode!=='NORMAL'||ask>EXPLORATORY_MAX_ASK))
  return fail('EXPLORATORY_RISK_OR_PREMIUM_RESTRICTION');
 const spread=ask-bid;
 const maxSpread=mode==='EXPLORATORY'?EXPLORATORY_MAX_SPREAD:ask>.85?.03:.05;
 if(spread<-1e-8||Math.round(spread*10000)>Math.round(maxSpread*10000))
  return fail('SPREAD_TOO_WIDE');
 const cap=ask<.20?.50:3;
 const room=Math.min(budget,cap,riskMode==='SOFT'?1.50:3);
 let qty=Math.floor((room+1e-8)/ask);
 while(qty>0&&qty*ask+fee(ask,qty)>room+1e-8)qty--;
 if(qty<1||askDepth<qty||bidDepth<qty)return fail('BUDGET_OR_BOOK_DEPTH_INSUFFICIENT');
 const orderFee=fee(ask,qty),allIn=qty*ask+orderFee;
 const p=scenario[side];
 const lowerEdge=p.lower-allIn/qty;
 const centralEdge=p.central-allIn/qty;
 const lowerScenarioProfit=qty*p.lower-allIn;
 const centralScenarioProfit=qty*p.central-allIn;
 const uncertainty=p.upper-p.lower;
 // A conservative premium contract must have extra room after fees.
 // This is a risk allowance, not a vote among indicators.
 const baseEdgeHurdle=ask>.85?.07:ask>=.75?.05:.035;
 // Under a loss-triggered SOFT state, demand a larger margin. However,
 // a fixed 20-percentage-point margin would mathematically prohibit every
 // >=85c contract (its total upside is <=15c before fees), contradicting
 // the explicit exceptional 85.01-87c policy. Premium SOFT entries therefore
 // require an exceptional 10-point cushion, while all lower prices require
 // at least 12 points, on top of tighter liquidity and a reduced stake.
 const edgeHurdle=riskMode==='SOFT'?
   (ask>.85?.10:Math.max(.12,baseEdgeHurdle+.035)):baseEdgeHurdle;
 if(mode==='EXPLORATORY'){
  // Separate paper sample, never a qualified conservative-value trade.
  // The central edge is UNCALIBRATED and NOT a verified expected return.
  if(centralEdge+1e-9<EXPLORATORY_MIN_CENTRAL_EDGE)
   return {...fail('EXPLORATORY_CENTRAL_SCENARIO_VALUE_INSUFFICIENT'),
    ask,bid,spread,quantity:qty,allIn:round(allIn),
    centralScenario:round(p.central),centralEdge:round(centralEdge),
    requiredCentralEdge:EXPLORATORY_MIN_CENTRAL_EDGE};
 }else if(lowerEdge+1e-9<edgeHurdle){
  return {...fail('CONSERVATIVE_SCENARIO_VALUE_INSUFFICIENT'),
   ask,bid,spread,quantity:qty,allIn:round(allIn),breakEven:round(allIn/qty),
   lowerScenario:round(p.lower),centralScenario:round(p.central),
   conservativeEdge:round(lowerEdge),requiredEdge:edgeHurdle};
 }
 return {side,status:'QUALIFIED',reason:mode==='EXPLORATORY'?
  'EXPLORATORY_CENTRAL_SCENARIO_PAPER_SAMPLE':'TARGET_CENTERED_SCENARIO_VALUE_AFTER_FEES',
  researchMode:mode,conservativeValuePassed:mode!=='EXPLORATORY',
  version:CONTEXT_VALUE_VERSION,ask,bid,askDepth,bidDepth,spread,
  qty,allIn:round(allIn),orderFee:round(orderFee),riskMode,
  breakEven:round(allIn/qty),maxLoss:round(allIn),
  profitIfSettlesCorrect:round(qty-allIn),requiredEdge:edgeHurdle,
  conservativeEdge:round(lowerEdge),centralEdge:round(centralEdge),
  lowerScenario:round(p.lower),centralScenario:round(p.central),
  upperScenario:round(p.upper),scenarioRange:round(uncertainty),
  lowerScenarioNetProfit:round(lowerScenarioProfit),
  centralScenarioNetProfit:round(centralScenarioProfit),
  rankUtility:round(mode==='EXPLORATORY'?centralScenarioProfit:lowerScenarioProfit),
  calibratedProbability:null,
  note:mode==='EXPLORATORY'?
   'Research-only paper sample. Central scenario is uncalibrated; this failed the conservative lower-bound test.':
   'Scenario economics are uncalibrated; this is experimental paper-only research.'};
}
/** Evaluate BOTH sides at the SAME official target, then take the largest
 * conservative net opportunity (if any). Not a cheap/expensive band vote.
 */
export function bestContextualOpportunity(args){
 const scenario=targetScenarioEnvelope(args);
 if(scenario.status!=='SCENARIOS_READY')
  return {status:'WATCH',reason:scenario.status,scenario,options:[]};
 const options=['UP','DOWN'].map(side=>priceAwareOpportunity({...args,side,scenario}));
 const qualified=options.filter(x=>x.status==='QUALIFIED').sort(
  (a,b)=>b.rankUtility-a.rankUtility||b.conservativeEdge-a.conservativeEdge);
 if(qualified.length)return {status:'CANDIDATE',
  reason:'BEST_CONTEXTUAL_TARGET_SIDE_VALUE',researchMode:'CONSERVATIVE',
  selected:qualified[0],scenario,options};
 if(args?.allowExploration===true){
  // Original conservative strategy already rejected both sides.
  // Separate $1-capped research sample tests central-scenario hypotheses.
  const exploratory=['UP','DOWN'].map(side=>priceAwareOpportunity({
   ...args,side,scenario,mode:'EXPLORATORY'}));
  const available=exploratory.filter(x=>x.status==='QUALIFIED').sort(
   (a,b)=>b.centralScenarioNetProfit-a.centralScenarioNetProfit);
  if(available.length)return {status:'CANDIDATE',
   reason:'EXPLORATORY_PAPER_SAMPLE_NOT_CONSERVATIVE_TRADE',
   researchMode:'EXPLORATORY',selected:available[0],
   scenario,options,exploratoryOptions:exploratory};
 }
 return {status:'WATCH',
  reason:'NO_RISK_ADJUSTED_VALUE_AT_CURRENT_ASK',scenario,options};
}
