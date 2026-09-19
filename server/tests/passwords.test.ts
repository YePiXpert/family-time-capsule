import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword, needsRehash } from '../src/passwords.ts';
const PW='桉桉成长记2026';
/** Build 67 的旧格式：固定 N=16384、r=8、p=1，串里不带参数。 */
const legacyHash=(password:string)=>{const salt=randomBytes(16);return `scrypt:${salt.toString('hex')}:${scryptSync(password,salt,32,{N:16384,r:8,p:1}).toString('hex')}`;};
test('password hashes round-trip, reject wrong or malformed input, and use random salts',async()=>{
 const hash=await hashPassword(PW);
 assert.match(hash,/^scrypt2:32768:8:1:[0-9a-f]{32}:[0-9a-f]{64}$/);
 assert.equal(await verifyPassword(PW,hash),true);
 assert.equal(await verifyPassword('wrong-password',hash),false);
 assert.equal(await verifyPassword(PW,'not-a-valid-hash'),false);
 assert.equal(await verifyPassword(PW,'scrypt:zz:yy'),false);
 assert.equal(await verifyPassword(PW,'scrypt2:1000:8:1:00:00'),false);
 assert.equal(await verifyPassword(PW,null),false);
 assert.equal(needsRehash(hash),false);
 const again=await hashPassword(PW);
 assert.notEqual(hash,again);
 assert.equal(await verifyPassword(PW,again),true);
});
test('legacy scrypt hashes still verify and are flagged for rehash',async()=>{
 const old=legacyHash(PW);
 assert.equal(await verifyPassword(PW,old),true);
 assert.equal(await verifyPassword('wrong-password',old),false);
 assert.equal(needsRehash(old),true);
 assert.equal(needsRehash(null),true);
 assert.equal(needsRehash('scrypt2:16384:8:1:'+'00'.repeat(16)+':'+'00'.repeat(32)),true);
});
