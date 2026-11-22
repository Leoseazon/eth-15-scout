/* V4 standalone PAPER settlement-forecast ledger.
 * Primary score is correctly forecast FINALIZED KXETH15M outcome,
 * including positions sold early. This is NOT the realized paper P&L ledger.
 */
const ETH=/^KXETH15M-[A-Za-z0-9-]{5,80}$/;
const validTime=t=>Number.isSafeInteger(t)&&t>=1000000000000;
export function ensureSettlementPredictions(sql){
 sql.exec(`CREATE TABLE IF NOT EXISTS v4_settlement_predictions (
  ticker TEXT PRIMARY KEY, predicted_side TEXT NOT NULL,
  predicted_at INTEGER NOT NULL, model_version TEXT NOT NULL,
  target REAL NOT NULL,index_value REAL NOT NULL,index_source_at INTEGER NOT NULL,
  price REAL NOT NULL,fee REAL NOT NULL,stake REAL NOT NULL,qty INTEGER NOT NULL,
  direction_correct INTEGER,official_outcome TEXT,official_observed_at INTEGER,
  payload TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_v4_prediction_time ON v4_settlement_predictions(predicted_at DESC);`);
}
export function appendSettlementPrediction(sql,pos){
 if(!ETH.test(pos?.ticker||'')||!['UP','DOWN'].includes(pos.side)||
   !validTime(pos.time)||!validTime(pos.indexSourceAt)||
   !Number.isFinite(pos.target)||pos.target<=0||
   !Number.isFinite(pos.indexValue)||pos.indexValue<=0||
   !Number.isFinite(pos.entry)||pos.entry<=0||pos.entry>=1||
   !Number.isFinite(pos.entryFee)||pos.entryFee<0||
   !Number.isFinite(pos.cost)||pos.cost<=0||pos.cost>3.000001||
   !Number.isSafeInteger(pos.qty)||pos.qty<1||
   typeof pos.strategyVersion!=='string')throw TypeError('Unsafe paper prediction');
 // Unique ticker prevents double entry. Throw on duplicate instead of
 // silently recording paper cash changes without a unique forecast row.
 sql.exec('INSERT INTO v4_settlement_predictions(ticker,predicted_side,predicted_at,'+
  'model_version,target,index_value,index_source_at,price,fee,stake,qty,payload)'+
  ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  pos.ticker,pos.side,pos.time,pos.strategyVersion,pos.target,pos.indexValue,
  pos.indexSourceAt,pos.entry,pos.entryFee,pos.cost,pos.qty,
  JSON.stringify({ticker:pos.ticker,side:pos.side,time:pos.time,
   target:pos.target,indexValue:pos.indexValue,indexSourceAt:pos.indexSourceAt,
   entry:pos.entry,cost:pos.cost,qty:pos.qty,strategyVersion:pos.strategyVersion,
   evidence:pos.modelEvidence||null,
   entryConfidence:pos.entryConfidence||null,
   executionVerified:false,calibratedProbability:null}));
}
export function reconcileSettlementPredictions(sql,now=Date.now()){
 const rows=sql.exec(
  'SELECT p.ticker,p.predicted_side,w.outcome,w.status,w.observed_at '+
  'FROM v4_settlement_predictions p JOIN window_outcomes w ON w.ticker=p.ticker '+
  'WHERE p.official_outcome IS NULL AND w.status=? ORDER BY w.observed_at ASC LIMIT 200',
  'OFFICIAL_RESULT').toArray();
 let n=0;
 for(const w of rows){
  if(!ETH.test(w.ticker)||!['UP','DOWN'].includes(w.predicted_side)||
     !['UP','DOWN'].includes(w.outcome))continue;
  sql.exec('UPDATE v4_settlement_predictions SET direction_correct=?,'+
   'official_outcome=?,official_observed_at=? WHERE ticker=? AND official_outcome IS NULL',
   Number(w.predicted_side===w.outcome),w.outcome,
   validTime(w.observed_at)?w.observed_at:now,w.ticker);
  n++;
 }
 return n;
}
export function settlementPredictionStats(sql){
 const row=sql.exec(
  'SELECT COUNT(*) totalPredictions,'+
  'COALESCE(SUM(CASE WHEN official_outcome IS NOT NULL THEN 1 ELSE 0 END),0) verified,'+
  'COALESCE(SUM(CASE WHEN direction_correct=1 THEN 1 ELSE 0 END),0) correct,'+
  'COALESCE(SUM(CASE WHEN direction_correct=0 THEN 1 ELSE 0 END),0) incorrect,'+
  'COALESCE(SUM(CASE WHEN predicted_side=? THEN 1 ELSE 0 END),0) upPredictions,'+
  'COALESCE(SUM(CASE WHEN predicted_side=? THEN 1 ELSE 0 END),0) downPredictions '+
  'FROM v4_settlement_predictions','UP','DOWN').toArray()[0]||{};
 const verified=Number(row.verified)||0,correct=Number(row.correct)||0;
 return {...row,accuracyOnVerified:verified?Number((correct/verified).toFixed(4)):null,
  source:'FINALIZED_KALSHI_RESULTS_ONLY',
  scoreDefinition:'Correct settlement side independent of early profitable paper sale',
  paperOnly:true,calibrated:false};
}
