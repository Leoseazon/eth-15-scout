/* Read-only V4 research storage inventory. No query returns raw licensed
 * market data. No DELETE, UPDATE, VACUUM, ALTER or retention writes.
 * Run on demand, not on every price tick or alarm. Record dates are UNIX ms.
 */
const TABLES=Object.freeze([
 ['research_ticks','started_at'],
 ['research_book_samples','received_at'],
 ['quote_observations','observed_at'],
 ['v4_stream_samples','received_at'],
 ['v4_stream_events','at'],
 ['v4_rest_book_samples','received_at'],
 ['v4_cf_values','received_at'],
 ['v4_public_trades','received_at'],
 ['v4_book_frames','received_at'],
 ['v4_research_feed_events','at'],
 ['window_outcomes','observed_at'],
 ['trades','exit_at'],
 ['decisions','decided_at'],
 ['events','happened_at']
]);
const timestamp=value=>Number.isSafeInteger(value)&&value>=1000000000000?value:null;
function stats(sql,table,column){
 // Table and column names are fixed code literals, never supplied by users.
 const result=sql.exec('SELECT COUNT(*) AS n,MIN('+column+
  ') AS first_at,MAX('+column+') AS last_at FROM '+table).toArray()[0]||{};
 return {table,records:Number(result.n)||0,
  earliestAt:timestamp(result.first_at),latestAt:timestamp(result.last_at)};
}
export function getV4StorageInventory(sql,{now=Date.now()}={}){
 if(!sql||typeof sql.exec!=='function')throw TypeError('V4 SQL unavailable');
 const datasets=TABLES.map(([table,col])=>stats(sql,table,col));
 const size=Number(sql.databaseSize);
 return {readOnly:true,paperOnly:true,verifiedAt:now,
  databaseBytes:Number.isSafeInteger(size)&&size>=0?size:null,
  autoDeletionConfigured:false,retentionPeriodDays:null,
  currentDataPolicy:'NO_AUTOMATIC_EXPIRATION_IN_V4_CODE',
  source:'V4_DURABLE_OBJECT_SQLITE_METADATA_ONLY',
  note:'Shows stored rows, earliest and latest recorded timestamps. No market samples are exported. Cloudflare limits, account deletion and faults may still affect availability.',
  datasets};
}
