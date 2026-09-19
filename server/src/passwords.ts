import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
// 家人规模的账号密码：node:crypto 内置 scrypt，无新增依赖。
// 参数写进哈希串（scrypt2:N:r:p:salt:key），将来升成本只改下面三个常量，旧哈希照常验证并在下次登录时升级。
const N=32768,r=8,p=1,KEYLEN=32;
/** Build 67 的旧格式 scrypt:salt:key 用的是固定参数。 */
const LEGACY={N:16384,r:8,p:1};
const derive=(password:string,salt:Buffer,cost:{N:number;r:number;p:number})=>new Promise<Buffer>((resolve,reject)=>{scrypt(password,salt,KEYLEN,{...cost,maxmem:256*1024*1024},(error,key)=>error?reject(error):resolve(key));});
export async function hashPassword(password:string) {
 const salt=randomBytes(16),key=await derive(password,salt,{N,r,p});
 return `scrypt2:${N}:${r}:${p}:${salt.toString('hex')}:${key.toString('hex')}`;
}
function parse(stored:string|null|undefined):{cost:{N:number;r:number;p:number};salt:Buffer;key:Buffer}|null {
 const parts=(stored??'').split(':');
 if(parts[0]==='scrypt'&&parts.length===3)return {cost:LEGACY,salt:Buffer.from(parts[1]!,'hex'),key:Buffer.from(parts[2]!,'hex')};
 if(parts[0]==='scrypt2'&&parts.length===6) {
  const cost={N:Number(parts[1]),r:Number(parts[2]),p:Number(parts[3])};
  if(![cost.N,cost.r,cost.p].every(n=>Number.isSafeInteger(n)&&n>0)||(cost.N&(cost.N-1))!==0)return null;
  return {cost,salt:Buffer.from(parts[4]!,'hex'),key:Buffer.from(parts[5]!,'hex')};
 }
 return null;
}
export async function verifyPassword(password:string,stored:string|null|undefined) {
 const parsed=parse(stored);
 if(!parsed||!parsed.salt.length||!parsed.key.length)return false;
 const key=await derive(password,parsed.salt,parsed.cost);
 return key.length===parsed.key.length&&timingSafeEqual(key,parsed.key);
}
/** 旧格式或成本低于当前常量的哈希，在下次验证通过后重新派生。 */
export function needsRehash(stored:string|null|undefined) {
 const parsed=parse(stored);
 return !parsed||parsed.cost.N<N||parsed.cost.r<r||parsed.cost.p<p||!(stored??'').startsWith('scrypt2:');
}
// 用户名不存在时也跑一遍同代价的派生，登录耗时不在「用户是否存在」上泄漏信息。
let dummyHash:Promise<string>|undefined;
export const timingDummy=(password:string)=>(dummyHash??=hashPassword(randomBytes(24).toString('hex'))).then(hash=>verifyPassword(password,hash));
