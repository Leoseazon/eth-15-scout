/* One-shot public market-outcome audit for GitHub Actions; aggregate stdout only.
 * This does not fetch or retain index ticks, order-book depth, user account data,
 * credentials, or any real-money order operations.
 */
import {auditHistorical90Days} from '../src/history-90d-audit.js';
try{
 const result=await auditHistorical90Days({days:90,maxPages:16,maxRecords:18000});
 console.log('KXETH15M_90DAY_AUDIT_SUMMARY='+JSON.stringify(result));
 if(result.finalized===0)process.exitCode=2;
}catch(e){
 console.error('KXETH15M_90DAY_AUDIT_FAILED='+String(e?.message||e).slice(0,160));
 process.exitCode=2;
}
