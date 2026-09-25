// 路由清单：拆分 app.ts 时不能丢路由，也不能让要登录的接口漏掉鉴权。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unusedTranscribe } from './helpers.ts';
import { Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
import { BackupStore } from '../src/backup-store.ts';

const ANONYMOUS = ['GET /healthz','GET /','GET /api/v1/status','POST /api/v1/family/activate','POST /api/v1/pair/requests','POST /api/v1/pair/requests/:id/collect','POST /api/v1/pair/requests/:id/cancel','POST /api/v1/recovery/claim'];
const SIGNED_IN = [
 'POST /api/v1/family/upgrade','GET /api/v1/family','GET /api/v1/pair/requests/:id','POST /api/v1/pair/requests/:id/approve','POST /api/v1/pair/requests/:id/confirm',
 'PUT /api/v1/admin/recovery','POST /api/v1/me/leave','GET /api/v1/me','GET /api/v1/ai/config','POST /api/v1/ai/write','POST /api/v1/ai/transcribe',
 'GET /api/v1/backup/status','POST /api/v1/backup/objects/have','PUT /api/v1/backup/objects/:id','GET /api/v1/backup/objects/:id','PUT /api/v1/backup/manifest','GET /api/v1/backup/manifest',
 'GET /api/v1/backup/manifests','DELETE /api/v1/backup/manifests/:deviceId','POST /api/v1/backup/prune','DELETE /api/v1/backup',
 'GET /api/v1/admin/overview','PUT /api/v1/admin/members/:id/profile','PATCH /api/v1/admin/members/:id','DELETE /api/v1/admin/members/:id/backup','DELETE /api/v1/admin/backup','DELETE /api/v1/admin/devices/:id','PUT /api/v1/admin/settings',
];
const ID='00000000-0000-4000-8000-000000000000';

test('all 36 routes are registered, and every signed-in route answers 401 without a token',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-routes-')),store=new Store(':memory:');
 const app=createApp(store,async()=>{throw new Error('unused');},'test',new BackupStore(dir),unusedTranscribe);
 t.after(async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});});
 await app.ready();
 assert.equal(ANONYMOUS.length+SIGNED_IN.length,36);
 for(const route of [...ANONYMOUS,...SIGNED_IN]){const [method,url]=route.split(' ') as [string,string];assert.ok(app.hasRoute({method:method as 'GET',url}),`missing ${route}`);}
 for(const route of SIGNED_IN){
  const [method,url]=route.split(' ') as [string,string];
  const res=await app.inject({method:method as 'GET',url:url.replace(/:id|:deviceId/,url.includes('/objects/')?'a'.repeat(64):ID),headers:{'content-type':'application/json'},payload:method==='GET'||method==='DELETE'?undefined:'{'});
  assert.equal(res.statusCode,401,`${route} answered ${res.statusCode} without a token`);
 }
});
