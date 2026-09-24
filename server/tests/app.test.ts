import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupStore } from '../src/backup-store.ts';
import { unusedTranscribe, seedFamily, addMember } from './helpers.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
import type { Provider } from '../src/provider.ts';
function fixture(provider?:Provider) {
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'anan-app-test-'));
 let calls=0;
 const app=createApp(store,provider??(async()=>{calls++;return {tokens:20,result:{title:'公园',text:'一起散步。'}};}),'test',new BackupStore(dir),unusedTranscribe);
 app.addHook('onClose',async()=>{rmSync(dir,{recursive:true,force:true});});
 const owner=seedFamily(store);
 const member=addMember(store,'家人','家人手机');
 const headers=(token=member.token)=>({authorization:`Bearer ${token}`});
 const input=()=>({requestId:randomUUID(),model:'mimo-v2.6-pro',photos:[],writingMode:'polish',context:'我们一起去公园。'});
 return {store,app,owner,member,headers,input,calls:()=>calls};
}
test('admin endpoints enforce server-side role and tokens never appear in overview',async()=>{
 const f=fixture();
 assert.equal((await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers()})).statusCode,403);
 // 用户名密码的入口都没了。
 for(const url of ['/api/v1/setup','/api/v1/login','/api/v1/admin/members'])assert.equal((await f.app.inject({method:'POST',url,headers:f.headers(f.owner.token),payload:{}})).statusCode,404);
 const response=await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers(f.owner.token)});
 assert.equal(response.statusCode,200);assert.ok(!response.body.includes('password_hash'));assert.ok(!response.body.includes(f.member.token));
 await f.app.close();f.store.close();
});
test('identical retries replay only to the same member without spending twice',async()=>{
 const f=fixture(),payload=f.input();
 for(let i=0;i<2;i++)assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload})).statusCode,200);
 assert.equal(f.calls(),1);assert.equal(f.store.usage(f.member.member.id).photos,0);assert.equal(f.store.usage(f.member.member.id).writes,1);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...payload,context:'different'}})).statusCode,409);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(f.owner.token),payload})).statusCode,200);
 assert.equal(f.calls(),2);
 await f.app.close();f.store.close();
});
test('quota is checked before upstream; pause and model allowlist are enforced',async()=>{
 const f=fixture();
 f.store.editMember(f.member.member.id,{enabled:true,photoLimit:0,writeLimit:0});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:f.input()})).statusCode,429);
 assert.equal(f.calls(),0);
 f.store.setSettings({...f.store.settings(),paused:true});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(f.owner.token),payload:f.input()})).statusCode,503);
 f.store.setSettings({...f.store.settings(),paused:false});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(f.owner.token),payload:{...f.input(),model:'unknown-model'}})).statusCode,400);
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
test('failed upstream requests do not burn the daily quota',async()=>{
 let fail=true;
 const f=fixture(async()=>{if(fail){fail=false;throw new Error('upstream down');}return {tokens:5,result:{title:'公园',text:'散步。'}};});
 f.store.editMember(f.member.member.id,{enabled:true,photoLimit:1,writeLimit:1});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:f.input()})).statusCode,502);
 assert.equal(f.store.usage(f.member.member.id).photos,0);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:f.input()})).statusCode,200);
 assert.equal(f.store.usage(f.member.member.id).photos,0);assert.equal(f.store.usage(f.member.member.id).writes,1);
 const me=await f.app.inject({url:'/api/v1/me',headers:f.headers()});
 assert.equal(me.json().usage.calls,2);assert.equal(me.json().usage.writes,1);
 const overview=await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers(f.owner.token)});
 assert.equal(overview.json().usage.calls,2);assert.equal(overview.json().usage.writes,1);
 assert.equal(overview.json().members.find((m:{id:string})=>m.id===f.member.member.id).usage.calls,2);
 await f.app.close();f.store.close();
});
test('server restart cannot repeat an uncertain paid request',async()=>{
 const f=fixture();const id=randomUUID();
 f.store.reserve(f.member.member,id,'hash',0,1,'mimo-v2.6-pro');f.store.recover();
 assert.equal(f.store.reserve(f.member.member,id,'hash',0,1,'mimo-v2.6-pro'),'failed');
 await f.app.close();f.store.close();
});
test('recap drafts a year note from text only and counts as one write',async()=>{
 const f=fixture(async()=>({tokens:9,result:{title:'这一年想说的话',text:'慢慢长大，慢慢来。'}}));
 const payload=()=>({requestId:randomUUID(),writingMode:'recap',photos:[],context:'这一年共有 3 条记录。\n第一次：第一次挥手'});
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...payload(),photos:[{}]}})).statusCode,400);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...payload(),context:'   '}})).statusCode,400);
 const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:payload()});
 assert.equal(response.statusCode,200);
 assert.equal(response.json().text,'慢慢长大，慢慢来。');
 assert.equal(f.store.usage(f.member.member.id).writes,1);
 assert.equal(f.store.usage(f.member.member.id).photos,0);
 await f.app.close();f.store.close();
});

test('fixed MiMo configuration preserves quotas and normalizes previous app selections',async()=>{
 let actualModel='';
 const f=fixture(async(input)=>{actualModel=input.model;return {tokens:1,result:{title:'记录',text:'照片中的画面。'}};});
 f.store.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify({paused:false,defaultModel:'gpt-6-astra',enabledModels:['gpt-6-astra'],globalPhotos:123,globalWrites:17}));
 const config=(await f.app.inject({url:'/api/v1/ai/config',headers:f.headers()})).json();
 assert.deepEqual(config.thinkingPolicy,{question:'disabled',ask:'disabled',polish:'disabled',recap:'enabled',editor:'enabled'});
 assert.equal(config.defaultModel,'mimo-v2.6-pro');assert.equal(config.reasoningEffort,'per-mode');
 assert.deepEqual(config.models,[{id:'mimo-v2.6-pro',label:'MiMo 2.6 Pro'}]);
 assert.equal(config.globalPhotos,123);assert.equal(config.globalWrites,17);
 const update=await f.app.inject({method:'PUT',url:'/api/v1/admin/settings',headers:f.headers(f.owner.token),payload:{paused:false,defaultModel:'gpt-5.6-luna',enabledModels:['gpt-5.6-luna'],globalPhotos:90,globalWrites:9}});
 assert.equal(update.statusCode,200);assert.deepEqual(f.store.settings().enabledModels,['mimo-v2.6-pro']);
 assert.equal(f.store.settings().globalPhotos,90);
 for(const model of ['mimo-v2.6-flash','mimo-v2.5','deepseek-flash','gpt-5.6-luna',undefined]){
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...f.input(),model}});
  assert.equal(response.statusCode,200);assert.equal(actualModel,'mimo-v2.6-pro');assert.equal(response.json().model,'mimo-v2.6-pro');
 }
 await f.app.close();f.store.close();
});

test('polish carries only the stored text with an explicit length ceiling',async()=>{
 let seen:unknown;
 const f=fixture(async(input)=>{seen=input;return {tokens:2,result:{title:'一起散步',text:'今天我们去公园走了走。'}};});
 const polish=()=>({requestId:randomUUID(),model:'mimo-v2.6-pro',photos:[],writingMode:'polish' as const,context:'标题：原稿\n正文：\n我们一起去公园。'});
 const ok=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:polish()});
 assert.equal(ok.statusCode,200);assert.equal((seen as {photos:unknown[]}).photos.length,0);
 assert.equal(f.store.usage(f.member.member.id).writes,1);assert.equal(f.store.usage(f.member.member.id).photos,0);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...polish(),photos:[{}]}})).statusCode,400);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...polish(),context:'   '}})).statusCode,400);
 const tooLong=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...polish(),context:'字'.repeat(2201)}});
 assert.equal(tooLong.statusCode,400);assert.equal(tooLong.json().code,'POLISH_TOO_LONG');
 assert.equal(f.store.usage(f.member.member.id).writes,1);
 // 上限只看正文：长标题加 2000 字正文仍然通过，正文多一个字就被拒绝。
 const longTitle={...polish(),context:`标题：${'题'.repeat(300)}\n正文：\n${'字'.repeat(2000)}`};
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:longTitle})).statusCode,200);
 const bodyOver=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...polish(),context:`正文：\n${'字'.repeat(2001)}`}});
 assert.equal(bodyOver.statusCode,400);assert.equal(bodyOver.json().code,'POLISH_TOO_LONG');
 assert.equal(f.store.usage(f.member.member.id).writes,2);
 await f.app.close();f.store.close();
});

test('auth revoked mid-flight returns 401 but cannot overwrite the completed request',async()=>{
 const f=fixture(async()=>{f.store.revoke(f.member.member.deviceId!);return {tokens:33,result:{title:'公园',text:'一起散步。'}};});
 const payload=f.input();
 const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload});
 assert.equal(response.statusCode,401);assert.equal(response.json().code,'AUTH_REQUIRED');
 const row=f.store.db.prepare('SELECT status,tokens FROM requests WHERE member_id=? AND id=?').get(f.member.member.id,payload.requestId) as {status:string;tokens:number|null};
 assert.equal(row.status,'completed');assert.equal(row.tokens,33);
 await f.app.close();f.store.close();
});
// 文本模式走同一条额度、缓存与重放路径。
for(const writingMode of ['ask','question','editor'] as const)test(`${writingMode} uses one write, no photos and replays without spending again`,async()=>{
 const {editorContext,editorResult}=await import('./helpers.ts');
 const result=writingMode==='ask'?{questions:['谁在旁边？'],first:false}:writingMode==='question'?{question:'谁在旁边？'}:editorResult;
 let calls=0;
 const f=fixture(async()=>{calls++;return {result,tokens:7};});
 try {
  const payload={requestId:randomUUID(),writingMode,context:writingMode==='editor'?JSON.stringify(editorContext):'落款：爸爸。今天她笑了。'};
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload});
  assert.equal(response.statusCode,200,response.body);
  const {requestId,model,...actual}=response.json();assert.deepEqual(actual,result);
  assert.equal(f.store.usage(f.member.member.id).writes,1);assert.equal(f.store.usage(f.member.member.id).photos,0);
  const replay=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload});
  assert.equal(replay.body,response.body);assert.equal(calls,1);assert.equal(f.store.usage(f.member.member.id).writes,1);
  assert.equal((await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...payload,context:payload.context+' '}})).statusCode,409);
 } finally {await f.app.close();f.store.close();}
});
for(const [writingMode,message] of Object.entries({ask:'请先写几句再让 AI 追问。',question:'请提供最近的记录标题。',editor:'请先送这一年的记录清单。'}))test(`${writingMode} rejects blank context before quota`,async()=>{
 const f=fixture();
 try {
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{requestId:randomUUID(),writingMode,context:'  ',photos:[]}});
  assert.equal(response.statusCode,400);assert.deepEqual(response.json(),{code:'INVALID_INPUT',message});
  assert.equal(f.calls(),0);assert.equal(f.store.usage(f.member.member.id).writes,0);
 } finally {await f.app.close();f.store.close();}
});
test('editor rejects invalid JSON and record shapes before calling provider',async()=>{
 const {editorContext}=await import('./helpers.ts'),f=fixture();
 try {
  for(const context of ['not json','null','{}',JSON.stringify({...editorContext,records:[]}),JSON.stringify({...editorContext,records:[{...editorContext.records[0],id:'字'.repeat(101)}]})]){
   const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{requestId:randomUUID(),writingMode:'editor',context}});
   assert.equal(response.statusCode,400);assert.equal(response.json().code,'INVALID_INPUT');
  }
  assert.equal(f.calls(),0);assert.equal(f.store.usage(f.member.member.id).writes,0);
 } finally {await f.app.close();f.store.close();}
});
test('context limits are 4000 normally and 60000 for editor, with original JSON forwarded',async()=>{
 const {editorContext,editorResult}=await import('./helpers.ts');
 let received='';
 const f=fixture(async(input)=>{received=input.context;return {result:editorResult,tokens:1};});
 try {
  for(const writingMode of ['ask','question','polish','recap','editor']){
   const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{requestId:randomUUID(),writingMode,context:'字'.repeat(writingMode==='editor'?60001:4001)}});
   assert.equal(response.statusCode,400);assert.deepEqual(response.json(),{code:'INVALID_INPUT',message:writingMode==='editor'?'这一年的记录太多，请分月送。':'内容太长'});
  }
  const records=structuredClone(editorContext.records);records[0]!.text+='字'.repeat(2300);records[1]!.text+='字'.repeat(2300);
  const context=JSON.stringify({...editorContext,records});assert.ok(context.length>5000&&context.length<60000);
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{requestId:randomUUID(),writingMode:'editor',context}});
  assert.equal(response.statusCode,200,response.body);assert.equal(received,context);
 } finally {await f.app.close();f.store.close();}
});
test('invalid text results return 502 without consuming quota',async()=>{
 const f=fixture(async()=>({result:{questions:['温馨吗？'],first:false},tokens:3}));
 try {
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{requestId:randomUUID(),writingMode:'ask',context:'今天她笑了'}});
  assert.equal(response.statusCode,502);assert.equal(response.json().message,'AI 问得不合规矩，请重试。');
  assert.equal(f.store.usage(f.member.member.id).writes,0);
 } finally {await f.app.close();f.store.close();}
});
test('ask accepts exactly 4000 context characters and editor accepts exactly 60000',async()=>{
 const {editorContext,editorResult}=await import('./helpers.ts');
 const f=fixture(async(input)=>({result:input.writingMode==='editor'?editorResult:{questions:['谁在旁边？'],first:false},tokens:1}));
 try {
  const base=JSON.stringify(editorContext);
  for(const [writingMode,context] of [['ask','字'.repeat(4000)],['editor',base+' '.repeat(60000-base.length)]]){
   const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{requestId:randomUUID(),writingMode,context}});
   assert.equal(response.statusCode,200,response.body);
  }
 } finally {await f.app.close();f.store.close();}
});

for(const writingMode of [undefined,'generate','letter'])test(`removed or missing writingMode ${writingMode} returns 400 before upstream`,async()=>{
 const f=fixture();
 try {
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...f.input(),writingMode}});
  assert.equal(response.statusCode,400);assert.equal(response.json().code,'INVALID_INPUT');
  assert.equal(f.calls(),0);assert.equal(f.store.usage(f.member.member.id).writes,0);
 } finally {await f.app.close();f.store.close();}
});
test('removed group route returns the normal 404 without upstream work',async()=>{
 const f=fixture();
 try {
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/group',headers:f.headers(),payload:f.input()});
  assert.equal(response.statusCode,404);assert.equal(f.calls(),0);
 } finally {await f.app.close();f.store.close();}
});
for(const writingMode of ['polish','recap','ask','question','editor'])test(`${writingMode} rejects non-empty photos before upstream`,async()=>{
 const f=fixture();
 try {
  const response=await f.app.inject({method:'POST',url:'/api/v1/ai/write',headers:f.headers(),payload:{...f.input(),writingMode,photos:[{}]}});
  assert.equal(response.statusCode,400);
  assert.deepEqual(response.json(),{code:'INVALID_INPUT',message:'AI 不再接收照片，请只发送文字。'});
  assert.equal(f.calls(),0);assert.equal(f.store.usage(f.member.member.id).writes,0);
 } finally {await f.app.close();f.store.close();}
});
