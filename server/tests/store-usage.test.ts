import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, Problem } from '../src/store.ts';
import { MODEL_ID } from '../src/ai-model.ts';
import { seedFamily, addMember } from './helpers.ts';

for(const scope of ['member','global'])test(`failed attempts count toward the ${scope} daily call cap`,t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const member=seedFamily(store).member,day=new Date().toISOString().slice(0,10);
 const insert=store.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 const failed=(memberId:string,n:number)=>{
  // 避开每分钟限流，只验证每日上限；失败行保留原先预留的额度。
  for(let i=0;i<n;i++)insert.run(memberId,`failed-${i}`,'fingerprint',day,1,1,MODEL_ID,'failed',Date.now()-120000,7,'UPSTREAM');
 };
 if(scope==='member')failed(member.id,199);
 else {
  for(let i=0;i<5;i++)failed(addMember(store,`家人${i}`,'手机').member.id,199);
  failed(member.id,4);
 }
 // 昨天的调用不占今天的次数。
 insert.run(member.id,'yesterday','fingerprint','2000-01-01',1,1,MODEL_ID,'failed',0,7,'UPSTREAM');
 const before=scope==='member'?199:999;
 assert.deepEqual(store.usage(),{photos:0,writes:0,calls:before,tokens:0});
 assert.equal(store.reserve(member,'last','fingerprint',1,1,MODEL_ID),'new');
 assert.equal(store.usage().calls,before+1);assert.equal(store.usage().writes,1);
 store.finish(member.id,'last',null,'UPSTREAM');
 assert.deepEqual(store.usage(),{photos:0,writes:0,calls:before+1,tokens:0});
 assert.equal(store.reserve(member,'last','fingerprint',1,1,MODEL_ID),'failed');
 assert.throws(()=>store.reserve(member,'over','fingerprint',1,1,MODEL_ID),(e:unknown)=>e instanceof Problem&&e.code==='QUOTA_EXCEEDED');
 assert.equal(store.usage().calls,before+1);
});
