/* ETH-15 Scout V4 read-only viewer authentication.
 * Credentials remain Cloudflare-encrypted secrets, never website code.
 * Session tokens are signed with HMAC-SHA256 and may be stored only by the
 * viewer browser. They cannot authorize paper trading control or real trades.
 */
const enc=new TextEncoder();
const SESSION_AUD='eth15-scout-v4-viewer';
const DAY=86400;
export const REMEMBER_DAYS=30;

function b64url(bytes){
  let s='';
  for(const byte of bytes)s+=String.fromCharCode(byte);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeB64url(s){
  if(typeof s!=='string'||!/^[\w-]+$/.test(s))throw new Error('Bad session');
  const bin=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
  return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
function equal(a,b){
  // Constant-time comparison for equal-length digests.
  let mismatch=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)
    mismatch|=(a[i]||0)^(b[i]||0);
  return mismatch===0;
}
async function sha(s){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));
}
async function signingKey(secret){
  if(typeof secret!=='string'||secret.length<48)throw new Error('Viewer auth not configured');
  return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
}
export function credentialsConfigured(env){
  return typeof env?.SCOUT_LOGIN_USER==='string'&&env.SCOUT_LOGIN_USER.length>=3&&
    typeof env?.SCOUT_LOGIN_PASSWORD==='string'&&env.SCOUT_LOGIN_PASSWORD.length>=16&&
    typeof env?.SCOUT_SESSION_SECRET==='string'&&env.SCOUT_SESSION_SECRET.length>=48;
}
export async function checkCredentials(env,username,password){
  if(!credentialsConfigured(env)||typeof username!=='string'||typeof password!=='string'||
      username.length>128||password.length>256)return false;
  const [claimed,actual]=await Promise.all([sha(password),sha(env.SCOUT_LOGIN_PASSWORD)]);
  const [nameClaimed,nameActual]=await Promise.all([sha(username),sha(env.SCOUT_LOGIN_USER)]);
  return equal(claimed,actual)&&equal(nameClaimed,nameActual);
}
export async function newSession(secret,remember=true,now=Date.now()){
  const iat=Math.floor(now/1000),exp=iat+(remember?REMEMBER_DAYS:1)*DAY;
  const payload=b64url(enc.encode(JSON.stringify({v:1,aud:SESSION_AUD,iat,exp})));
  const signature=b64url(new Uint8Array(await crypto.subtle.sign(
    'HMAC',await signingKey(secret),enc.encode(payload))));
  return {token:payload+'.'+signature,expiresAt:exp*1000};
}
export async function sessionValid(authorization,secret,now=Date.now()){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')||
      authorization.length>2048||typeof secret!=='string'||secret.length<48)return false;
  try{
    const token=authorization.slice(7),parts=token.split('.');
    if(parts.length!==2||parts.some(p=>p.length<10))return false;
    const [data,sig]=parts;
    const expected=new Uint8Array(await crypto.subtle.sign(
      'HMAC',await signingKey(secret),enc.encode(data)));
    if(!equal(expected,decodeB64url(sig)))return false;
    const obj=JSON.parse(new TextDecoder().decode(decodeB64url(data)));
    const nowSec=Math.floor(now/1000);
    return obj?.v===1&&obj?.aud===SESSION_AUD&&Number.isSafeInteger(obj.iat)&&
      Number.isSafeInteger(obj.exp)&&obj.iat<=nowSec+60&&obj.exp>nowSec&&
      obj.exp-obj.iat<=REMEMBER_DAYS*DAY;
  }catch{return false}
}
