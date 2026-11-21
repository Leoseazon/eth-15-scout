/*
 * ETH-15 Scout V4 — read-only, LOCAL-ONLY Cloudflare diagnostics collector.
 * Uses the owner's existing Wrangler login or optional preexisting scoped
 * token in process env. DOES NOT deploy, change secrets, or query V3.
 * Never saves or prints raw Cloudflare event objects.
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const WORKER='eth-15-scout-cloud-v4test';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const TAG='ETH15_V4_AUDIT|';
const KINDS=new Set(['STREAM_FAULT','NETWORK_REST_CHECK','AUTH_REST_CHECK',
 'WS_HOST_HTTPS_CHECK','STREAM_SUBSCRIBED','BOOK_SNAPSHOT','STREAM_CONFIG_MISSING']);
const SUMMARY=/^PRIMARY_(?:HTTP_[1-5][0-9]{2}|NETWORK_(?:CONNECT_FAILED|DNS_FAILED|TLS_FAILED|TIMEOUT|CONNECTION_LOST|FETCH_REJECTED))\|COMPAT_(?:HTTP_[1-5][0-9]{2}|NETWORK_(?:CONNECT_FAILED|DNS_FAILED|TLS_FAILED|TIMEOUT|CONNECTION_LOST|FETCH_REJECTED))$/;
const FAULTS=new Set([
 'NETWORK_CONNECT_FAILED','NETWORK_DNS_FAILED','NETWORK_TLS_FAILED','NETWORK_TIMEOUT',
 'NETWORK_CONNECTION_LOST','NETWORK_FETCH_REJECTED','HANDSHAKE_HTTP_401',
 'HANDSHAKE_HTTP_403','HANDSHAKE_HTTP_429','HANDSHAKE_HTTP_500',
 'HANDSHAKE_HTTP_502','HANDSHAKE_HTTP_503','HANDSHAKE_HTTP_504',
 'HANDSHAKE_HTTP_UNKNOWN','UPGRADE_SOCKET_MISSING','KEY_IMPORT_FAILED',
 'KEY_PEM_BOUNDARIES_INVALID','KEY_PEM_BASE64_INVALID',
 'KEY_SIGNING_FAILED','CREDENTIALS_MISSING_OR_INVALID','SOCKET_CLOSED',
 'SOCKET_ERROR','STREAM_SILENCE','WS_FALLBACK_PRIMARY_SELECTED',
 'WS_FALLBACK_COMPAT_SELECTED','SUBSCRIPTION_SEND_FAILED',
 'SOCKET_SETUP_FAILED','KALSHI_SUBSCRIPTION_ERROR','INVALID_BOOK_FRAME',
 'SEQUENCE_GAP','STREAM_RESEARCH_ERROR','WATCHDOG_RESYNC_FAILED',
 'OTHER_REDACTED'
]);

function acceptableCode(kind,code){
 if(kind==='STREAM_FAULT')return FAULTS.has(code);
 if(kind==='STREAM_SUBSCRIBED')return code==='SUBSCRIBED';
 if(kind==='BOOK_SNAPSHOT')return code==='RECORDED';
 if(kind==='STREAM_CONFIG_MISSING')return code==='CONFIG_MISSING';
 if(kind==='NETWORK_REST_CHECK'||kind==='WS_HOST_HTTPS_CHECK')
  return SUMMARY.test(code)||code==='REDACTED';
 if(kind==='AUTH_REST_CHECK')
  return /^AUTH_REST_HTTP_[1-5][0-9]{2}$/.test(code)||
   /^AUTH_REST_NETWORK_(?:CONNECT_FAILED|DNS_FAILED|TLS_FAILED|TIMEOUT|CONNECTION_LOST|FETCH_REJECTED)$/.test(code)||
   ['AUTH_REST_KEY_IMPORT_FAILED','AUTH_REST_KEY_PEM_BASE64_INVALID',
    'AUTH_REST_KEY_PEM_BOUNDARIES_INVALID','AUTH_REST_KEY_SIGNING_FAILED',
    'AUTH_REST_CREDENTIALS_MISSING_OR_INVALID','REDACTED'].includes(code);
 return false;
}

export function parseSafeTailEvent(raw){
 if(typeof raw!=='string'||raw.length>250_000)return null;
 let envelope;
 try{envelope=JSON.parse(raw)}catch{return null}
 if(!envelope||typeof envelope!=='object')return null;
 const stamp=Number.isSafeInteger(envelope.eventTimestamp)&&envelope.eventTimestamp>0&&
  envelope.eventTimestamp<8.64e15?envelope.eventTimestamp:null;
 const timestamp=stamp!==null?new Date(stamp).toISOString():null;
 const result=[];
 for(const entry of Array.isArray(envelope.logs)?envelope.logs.slice(0,150):[]){
  const args=Array.isArray(entry.message)?entry.message:
   typeof entry.message==='string'?[entry.message]:[];
  for(const value of args){
   if(typeof value!=='string'||!value.startsWith(TAG)||value.length>200)continue;
   const parts=value.split('|');
   // Two-part network summaries include an additional delimiter.
   const kind=parts[1],code=parts.slice(2).join('|');
   if(!KINDS.has(kind)||!acceptableCode(kind,code))continue;
   result.push({timestamp,kind,code});
  }
 }
 return {totalInvocation:1,items:result};
}

export function reportText({startedAt,finishedAt,total,items,tailOk=true}){
 const counts=new Map();
 for(const item of items){
  const key=item.kind+' / '+item.code;
  counts.set(key,(counts.get(key)||0)+1);
 }
 const lines=[
  'ETH-15 SCOUT V4 — LOCAL READ-ONLY CLOUDFLARE DIAGNOSTICS',
  'Worker: '+WORKER,
  'Collected UTC: '+startedAt+' to '+finishedAt,
  'Source: Wrangler real-time tail; partial observation only, not durable SQLite history',
  'V3 touched: NO',
  'Raw logs, keys, signatures, balances, and contract prices: NOT EXPORTED',
  'Tail session: '+(tailOk?'FINISHED':'FAILED_OR_INTERRUPTED'),
  'Invocation envelopes observed: '+total,
  'Safe diagnostic messages observed: '+items.length,'',
  'Diagnostic code counts:',
  ...([...counts.entries()].sort((a,b)=>b[1]-a[1])
    .map(([key,n])=>'  '+String(n).padStart(4)+'  '+key)),
  ...(counts.size===0?['  NONE — inconclusive; live logs may not have arrived during capture.']:[]),
  '', 'Latest sanitized events (up to 30):',
  ...items.slice(-30).reverse().map(x=>'  '+(x.timestamp||'UNKNOWN_TIME')+'  '+x.kind+'  '+x.code),
  ...(items.length===0?['  No safe events captured.']:[]),
  '', 'A successful subscription or REST 200 is NOT proof of a valid book snapshot.',
  'A BOOK_SNAPSHOT / RECORDED event means a valid/fresh snapshot was stored,',
  'but completeness and multi-market continuity still require separate verification.'
 ];
 return lines.join('\n')+'\n';
}

export function parseMinutes(argv){
 if(argv.length===0)return 3;
 if(argv.length!==2||argv[0]!=='--minutes'||!/^[1-9][0-9]?$/.test(argv[1]))
  throw new Error('Use --minutes 1 through 8');
 const n=Number(argv[1]);
 if(n<1||n>8)throw new Error('Use --minutes 1 through 8');
 return n;
}

export async function capture({minutes=3,runner=spawn}={}){
 if(!Number.isInteger(minutes)||minutes<1||minutes>8)
  throw new Error('Capture minutes must be between 1 and 8');
 const bin=join(ROOT,'node_modules','wrangler','bin','wrangler.js');
 if(!existsSync(bin))
  throw new Error('Wrangler not installed in the V4 cloud folder. Run npm.cmd install in cloud first.');
 const startedAt=new Date().toISOString();
 const child=runner(process.execPath,[bin,'tail',WORKER,'--format','json'],{
  cwd:ROOT,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']
 });
 let total=0,items=[],failed=false;
 child.stderr.on('data',()=>{}); // Intentionally never display or persist stderr.
 const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
 lines.on('line',line=>{
  const event=parseSafeTailEvent(line);
  if(!event)return;
  total+=event.totalInvocation;
  if(items.length<2000)items.push(...event.items.slice(0,30));
 });
 const timeout=setTimeout(()=>{try{child.kill('SIGTERM')}catch{}},minutes*60_000);
 const result=await new Promise(resolve=>{
  child.on('error',()=>{failed=true;resolve(1)});
  child.on('close',code=>resolve(code));
 });
 clearTimeout(timeout);
 if(result!==0&&total===0)failed=true;
 const text=reportText({startedAt,finishedAt:new Date().toISOString(),
  total,items,tailOk:!failed});
 const dir=existsSync(join(homedir(),'Downloads'))?join(homedir(),'Downloads'):homedir();
 const filepath=join(dir,'ETH15-V4-Cloudflare-ReadOnly-Report.txt');
 await writeFile(filepath,text,{encoding:'utf8',mode:0o600});
 process.stdout.write('Read-only V4 report saved to: '+filepath+'\n');
 process.stdout.write('Safe events: '+items.length+'; invocation envelopes: '+total+'\n');
 if(failed){
  process.stdout.write('Tail did not produce a usable session. Check Wrangler login/permission.\n');
  process.exitCode=1;
 }
 return {filepath,total,items,failed};
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 try{await capture({minutes:parseMinutes(process.argv.slice(2))})}
 catch{process.stderr.write('Read-only V4 diagnostic could not start. Check local install and command syntax.\n');process.exitCode=1}
}
