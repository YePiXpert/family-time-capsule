import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
import type { Provider } from '../src/provider.ts';
const image='data:image/jpeg;base64,/9j/2Q==';
function fixture(provider?:Provider) {
 const store=new Store(':memory:');
 let calls=0;
 const app=createApp(store,provider??(async(kind,input)=>{calls++;return {tokens:20,result:kind==='write'?{title:'公园',text:'一起散步。'}:{groups:[{photoIds:input.photos.map(p=>p.id),title:'公园',summary:'散步'}]}};}));
 const owner=store.enroll(store.ownerInvite().code,'主人手机');
 const member=store.enroll(store.invite('家人').code,'家人手机');
 const headers=(token=member.token)=>({authorization:`Bearer ${token}`});
 const input=()=>({requestId:randomUUID(),model:'deepseek-flash',photos:[{id:'a',date:'2020-01-01T12:00:00',image}]});
 return {store,app,owner,member,headers,input,calls:()=>calls};
}
test('invites are single-use, expiring and device-specific',async()=>{
 const f=fixture();
 const invite=f.store.invite('第二位');
 let response=await f.app.inject({method:'POST',url:'/api/v1/enroll',payload:{code:invite.code,deviceName:'手机'}});
 assert.equal(response.statusCode,201);
 response=await f.app.inject({method:'POST',url:'/api/v1/enroll',payload:{code:invite.code,deviceName:'另一台'}});
 assert.equal(response.statusCode,401);
 const expired=f.store.invite('过期');f.store.db.prepare('UPDATE invites SET expires_at=0 WHERE used=0').run();
 assert.throws(()=>f.store.enroll(expired.code,'手机'));
 f.store.revoke(f.member.member.deviceId!);
 assert.equal((await f.app.inject({url:'/api/v1/me',headers:f.headers()})).statusCode,401);
 await f.app.close();f.store.close();
});
test('owner endpoints enforce server-side role and tokens never appear in overview',async()=>{
 const f=fixture();
 assert.equal((await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers()})).statusCode,403);
 const response=await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers(f.owner.token)});
 assert.equal(response.statusCode,200);assert.ok(!response.body.includes('token_hash'));assert.ok(!response.body.includes(f.member.token));
 await f.app.close();f.store.close();
});
test('identical retries replay only to the same member without spending twice',async()=>{
 const f=fixture(),payload=f.input();
 for(let i=0;i<2;i++)assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(),payload})).statusCode,200);
 assert.equal(f.calls(),1);assert.equal(f.store.usage(f.member.member.id).photos,1);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(),payload:{...payload,context:'different'}})).statusCode,409);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(f.owner.token),payload})).statusCode,200);
 assert.equal(f.calls(),2);
 await f.app.close();f.store.close();
});
test('quota is checked before upstream; pause and model allowlist are enforced',async()=>{
 const f=fixture();
 f.store.editMember(f.member.member.id,{enabled:true,photoLimit:0,writeLimit:1});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(),payload:f.input()})).statusCode,429);
 assert.equal(f.calls(),0);
 f.store.setSettings({...f.store.settings(),paused:true});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(f.owner.token),payload:f.input()})).statusCode,503);
 f.store.setSettings({...f.store.settings(),paused:false});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(f.owner.token),payload:{...f.input(),model:'gpt-6-astra'}})).statusCode,400);
 await f.app.close();f.store.close();
});
test('concurrent duplicate requests do not repeat upstream work',async()=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 const f=fixture(async()=>{await wait;return {tokens:1,result:{title:'一起',text:'散步'}};});
 const payload=f.input();
 const first=f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload});
 await new Promise(resolve=>setTimeout(resolve,30));
 const second=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload});
 assert.equal(second.statusCode,409);assert.equal(second.json().code,'REQUEST_PENDING');
 release();assert.equal((await first).statusCode,200);
 await f.app.close();f.store.close();
});
test('invalid model output cannot omit, invent or duplicate photo IDs',async()=>{
 const f=fixture(async()=>({tokens:1,result:{groups:[{photoIds:['invented'],title:'x',summary:'x'}]}}));
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(),payload:f.input()})).statusCode,502);
 assert.equal(f.store.usage(f.member.member.id).calls,1);
 await f.app.close();f.store.close();
});
test('server restart cannot repeat an uncertain paid request',async()=>{
 const f=fixture();const id=randomUUID();
 f.store.reserve(f.member.member,id,'hash',1,0,'deepseek-flash');f.store.recover();
 assert.equal(f.store.reserve(f.member.member,id,'hash',1,0,'deepseek-flash'),'failed');
 await f.app.close();f.store.close();
});
