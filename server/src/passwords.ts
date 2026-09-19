import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
// 家人规模的账号密码：node:crypto 内置 scrypt，固定参数存进哈希串，无新增依赖。
const N=16384,r=8,p=1,KEYLEN=32;
const derive=(password:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>{scrypt(password,salt,KEYLEN,{N,r,p},(error,key)=>error?reject(error):resolve(key));});
export async function hashPassword(password:string) {
 const salt=randomBytes(16),key=await derive(password,salt);
 return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password:string,stored:string|null|undefined) {
 const [scheme,saltHex,keyHex]=(stored??'').split(':');
 if(scheme!=='scrypt'||!saltHex||!keyHex)return false;
 const key=await derive(password,Buffer.from(saltHex,'hex')),expected=Buffer.from(keyHex,'hex');
 return key.length===expected.length&&timingSafeEqual(key,expected);
}
// 用户名不存在时也跑一遍同代价的派生，登录耗时不在「用户是否存在」上泄漏信息。
let dummyHash:Promise<string>|undefined;
export const timingDummy=(password:string)=>(dummyHash??=hashPassword(randomBytes(24).toString('hex'))).then(hash=>verifyPassword(password,hash));
