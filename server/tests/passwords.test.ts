import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/passwords.ts';
const PW='桉桉成长记2026';
test('password hashes round-trip, reject wrong or malformed input, and use random salts',async()=>{
 const hash=await hashPassword(PW);
 assert.equal(await verifyPassword(PW,hash),true);
 assert.equal(await verifyPassword('wrong-password',hash),false);
 assert.equal(await verifyPassword(PW,'not-a-valid-hash'),false);
 assert.equal(await verifyPassword(PW,'scrypt:zz:yy'),false);
 assert.equal(await verifyPassword(PW,null),false);
 const again=await hashPassword(PW);
 assert.notEqual(hash,again);
 assert.equal(await verifyPassword(PW,again),true);
});
