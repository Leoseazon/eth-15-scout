/* V4 settlement-average arithmetic, NOT an official resolution.
 * Values must come from official CF Benchmarks index observations.
 */
export function averageProgress({strike,readings,expectedCount=60}){
 if(!Number.isFinite(strike)||strike<=0||!Number.isInteger(expectedCount)||
   expectedCount<1||!Array.isArray(readings)||readings.length>expectedCount)
   throw new TypeError('Invalid average input');
 const values=readings.map(x=>Number(x));
 if(values.some(x=>!Number.isFinite(x)||x<=0))
   throw new TypeError('Invalid index observation');
 const observedCount=values.length,remainingCount=expectedCount-observedCount;
 const sum=values.reduce((a,b)=>a+b,0);
 return Object.freeze({
  observedCount,remainingCount,
  observedAverage:observedCount?sum/observedCount:null,
  requiredRemainingAverage:remainingCount?(strike*expectedCount-sum)/remainingCount:null,
  completedAverage:remainingCount===0?sum/expectedCount:null,
  officialOutcomeVerified:false
 });
}
