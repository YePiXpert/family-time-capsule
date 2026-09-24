import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { unusedTranscribe, seedFamily, addMember } from './helpers.ts';
import { CLAIMS_PER_DEVICE, DEFAULT_BACKUP_LIMIT, Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
import { BackupStore, FAMILY_DIR, OBJECT_LIMIT } from '../src/backup-store.ts';

const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const oid=(n:number)=>n.toString(16).padStart(64,'0');
const octet={'content-type':'application/octet-stream'};
const KEY='0123456789abcdef',INDEX='QUJD';
function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'anan-backup-test-'));
 const store=new Store(':memory:'),backups=new BackupStore(dir);
 const app=createApp(store,async()=>{throw new Error('no provider in this test');},'test',backups,unusedTranscribe);
 const owner=seedFamily(store);
 const member=addMember(store,'家人','家人手机');
 const other=addMember(store,'外婆','外婆手机');
 const headers=(token=member.token,extra:Record<string,string>={})=>({authorization:`Bearer ${token}`,...extra});
 const put=(id:string,bytes:Buffer,token=member.token,digestHex=sha(bytes))=>app.inject({method:'PUT',url:`/api/v1/backup/objects/${id}`,headers:headers(token,{...octet,'x-object-sha256':digestHex}),payload:bytes});
 const publish=(token:string,objects?:string[],keyId=KEY,index=INDEX)=>app.inject({method:'PUT',url:'/api/v1/backup/manifest',headers:headers(token),payload:objects?{keyId,index,objects}:{keyId,index}});
 const prune=(token:string,keep:string[])=>app.inject({method:'POST',url:'/api/v1/backup/prune',headers:headers(token),payload:{keep}});
 const status=async(token=member.token)=>(await app.inject({url:'/api/v1/backup/status',headers:headers(token)})).json();
 const setLimit=(memberId:string,backupLimitBytes:number)=>store.editMember(memberId,{enabled:true,photoLimit:100,writeLimit:20,backupLimitBytes});
 const close=async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});};
 return {dir,store,backups,app,owner,member,other,headers,put,publish,prune,status,setLimit,close};
}
const familyPath=(dir:string,id:string)=>join(dir,FAMILY_DIR,'objects',id.slice(0,2),id);
const age=(f:ReturnType<typeof fixture>,...ids:string[])=>{const old=new Date(Date.now()-7200000);for(const id of ids)utimesSync(f.backups.objectPath(id),old,old);};

test('objects round-trip byte for byte in the family space; repeats are idempotent and temp files never linger',async()=>{
 const f=fixture();const bytes=randomBytes(300000);
 const first=await f.put(oid(1),bytes);
 assert.equal(first.statusCode,201);assert.deepEqual(first.json(),{id:oid(1),bytes:300000});
 assert.equal((await f.put(oid(1),bytes)).statusCode,200);
 const got=await f.app.inject({url:`/api/v1/backup/objects/${oid(1)}`,headers:f.headers()});
 assert.equal(got.statusCode,200);assert.equal(got.headers['content-type'],'application/octet-stream');assert.equal(got.headers['content-length'],'300000');
 assert.ok(got.rawPayload.equals(bytes));
 assert.ok(existsSync(familyPath(f.dir,oid(1))));
 assert.ok(!existsSync(join(f.dir,f.member.member.id)));
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
 // 一家人一个空间：外婆的手机读得到家人传的对象，状态也是全家的。
 assert.equal((await f.app.inject({url:`/api/v1/backup/objects/${oid(1)}`,headers:f.headers(f.other.token)})).statusCode,200);
 const status=await f.status();
 assert.equal(status.objects,1);assert.equal(status.bytes,300000);assert.equal(status.keyId,null);assert.equal(status.manifests,0);assert.equal(status.limitBytes,DEFAULT_BACKUP_LIMIT);assert.ok(status.freeBytes>0);
 // freeBytes 每次都现查磁盘，两次调用之间可能差几 KB（CI 上偶发），不逐字节比。
 const {freeBytes:_ownFree,...shared}=status;const {freeBytes:otherFree,...otherShared}=await f.status(f.other.token);
 assert.deepEqual(otherShared,shared);assert.ok(otherFree>0);
 await f.close();
});
test('two devices uploading the same object at once count it once and keep the first bytes',async()=>{
 const f=fixture();const bytes=randomBytes(200000);
 // 两台手机同时传同一份（同 id 同字节）：校验后「查有没有—落盘—记数」是一段同步代码，不会交错。
 const [a,b]=await Promise.all([f.put(oid(7),bytes),f.put(oid(7),bytes,f.other.token)]);
 assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,201]);
 const status=await f.status();
 assert.equal(status.objects,1);assert.equal(status.bytes,200000);
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
 await f.close();
});
test('mismatched, empty or malformed uploads are rejected and leave nothing behind',async()=>{
 const f=fixture();const bytes=randomBytes(1000);
 const wrong=await f.put(oid(2),bytes,f.member.token,sha(Buffer.from('other')));
 assert.equal(wrong.statusCode,400);assert.equal(wrong.json().code,'OBJECT_CORRUPT');
 assert.equal(f.backups.stat(oid(2)),null);
 assert.equal((await f.put(oid(2),Buffer.alloc(0))).statusCode,400);
 assert.equal((await f.app.inject({method:'PUT',url:`/api/v1/backup/objects/${oid(2)}`,headers:f.headers(f.member.token,octet),payload:bytes})).statusCode,400);
 assert.equal((await f.app.inject({method:'PUT',url:'/api/v1/backup/objects/not-hex',headers:f.headers(f.member.token,{...octet,'x-object-sha256':sha(bytes)}),payload:bytes})).statusCode,400);
 assert.equal((await f.app.inject({method:'PUT',url:`/api/v1/backup/objects/${oid(2)}`,headers:f.headers(f.member.token,{'content-type':'text/plain','x-object-sha256':sha(bytes)}),payload:'plain text'})).statusCode,415);
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
 await f.close();
});
test('oversize uploads get 413 whether or not the length was declared',async()=>{
 const f=fixture();const big=Buffer.alloc(OBJECT_LIMIT+1,7);
 const declared=await f.put(oid(3),big);
 assert.equal(declared.statusCode,413);assert.equal(declared.json().code,'TOO_LARGE');
 const undeclared=await f.app.inject({method:'PUT',url:`/api/v1/backup/objects/${oid(3)}`,headers:f.headers(f.member.token,{...octet,'x-object-sha256':sha(big)}),payload:Readable.from([big.subarray(0,OBJECT_LIMIT),big.subarray(OBJECT_LIMIT)])});
 assert.equal(undeclared.statusCode,413);assert.equal(undeclared.json().code,'TOO_LARGE');
 assert.equal(f.backups.stat(oid(3)),null);
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
 await f.close();
});
test("the family quota is the owner's limit shared by everyone; a repeat succeeds unless it grows past it; the disk floor is enforced",async()=>{
 const f=fixture();
 // 成员自己的配额列不再起作用，全家看主人的。
 f.setLimit(f.member.member.id,1);f.setLimit(f.owner.member.id,1000);
 assert.equal((await f.status()).limitBytes,1000);
 const over=await f.put(oid(4),randomBytes(2000));
 assert.equal(over.statusCode,413);assert.equal(over.json().code,'QUOTA_FULL');
 const streamed=randomBytes(2000);
 const late=await f.app.inject({method:'PUT',url:`/api/v1/backup/objects/${oid(4)}`,headers:f.headers(f.member.token,{...octet,'x-object-sha256':sha(streamed)}),payload:Readable.from([streamed])});
 assert.equal(late.statusCode,413);assert.equal(late.json().code,'QUOTA_FULL');
 assert.equal(f.backups.stat(oid(4)),null);
 const fits=randomBytes(800);
 assert.equal((await f.put(oid(5),fits)).statusCode,201);
 f.setLimit(f.owner.member.id,500);
 assert.equal((await f.put(oid(5),fits)).statusCode,200);
 // 同 id 换成更大的内容：预检（有 Content-Length）与收完复核（流式、无长度）都要按多出的字节拒掉，原对象不动。
 const grown=randomBytes(1200);
 const declaredGrowth=await f.put(oid(5),grown);
 assert.equal(declaredGrowth.statusCode,413);assert.equal(declaredGrowth.json().code,'QUOTA_FULL');
 const streamedGrowth=await f.app.inject({method:'PUT',url:`/api/v1/backup/objects/${oid(5)}`,headers:f.headers(f.member.token,{...octet,'x-object-sha256':sha(grown)}),payload:Readable.from([grown])});
 assert.equal(streamedGrowth.statusCode,413);assert.equal(streamedGrowth.json().code,'QUOTA_FULL');
 assert.equal(f.backups.stat(oid(5)),800);
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
 // 同 id 换成更小的内容仍先到为准：丢弃临时文件，原对象与已用配额不变。
 const shrunk=randomBytes(300);
 assert.equal((await f.put(oid(5),shrunk)).statusCode,200);assert.equal(f.backups.stat(oid(5)),800);
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
 assert.equal((await f.status()).bytes,800);
 // 恢复上限后余量仍是 200，继续验证全家的配额记账。
 f.setLimit(f.owner.member.id,1000);
 assert.equal((await f.put(oid(6),randomBytes(10))).statusCode,201);
 assert.equal((await f.put(oid(8),randomBytes(500))).statusCode,413);
 // 外婆的手机传的也算在同一份配额里。
 assert.equal((await f.put(oid(9),randomBytes(200),f.other.token)).json().code,'QUOTA_FULL');
 assert.equal((await f.put(oid(9),randomBytes(100),f.other.token)).statusCode,201);
 assert.equal((await f.status()).bytes,910);
 f.backups.freeBytes=async()=>0;
 const full=await f.put(oid(7),randomBytes(10));
 assert.equal(full.statusCode,507);assert.equal(full.json().code,'SERVER_FULL');
 await f.close();
});
test('a device may run two uploads at once; the third is told to wait, other devices are unaffected',async()=>{
 const f=fixture();
 const bodies=[randomBytes(5000),randomBytes(6000)],streams=bodies.map(()=>new Readable({read(){}}));
 const pending=streams.map((stream,i)=>f.app.inject({method:'PUT',url:`/api/v1/backup/objects/${oid(10+i)}`,headers:f.headers(f.member.token,{...octet,'x-object-sha256':sha(bodies[i]!)}),payload:stream}));
 await new Promise(resolve=>setTimeout(resolve,50));
 const third=await f.put(oid(12),randomBytes(10));
 assert.equal(third.statusCode,429);assert.equal(third.json().code,'BUSY');
 assert.equal((await f.put(oid(13),randomBytes(10),f.other.token)).statusCode,201);
 // 同一成员的另一台手机是另一条通道。
 const tablet=f.store.attach(f.member.member.id,'家人平板');
 assert.equal((await f.put(oid(14),randomBytes(10),tablet.token)).statusCode,201);
 streams.forEach((stream,i)=>{stream.push(bodies[i]);stream.push(null);});
 for(const response of await Promise.all(pending))assert.equal(response.statusCode,201);
 assert.equal((await f.put(oid(12),randomBytes(10))).statusCode,201);
 await f.close();
});
test('have sees the whole family; prune spares fresh objects, keep, and every object any device manifest registers',async()=>{
 const f=fixture();const a=randomBytes(100),b=randomBytes(200);
 assert.equal((await f.put(oid(20),a)).statusCode,201);assert.equal((await f.put(oid(21),b)).statusCode,201);
 assert.equal((await f.put(oid(22),randomBytes(50),f.other.token)).statusCode,201);
 const have=await f.app.inject({method:'POST',url:'/api/v1/backup/objects/have',headers:f.headers(),payload:{ids:[oid(20),oid(21),oid(22),oid(23)]}});
 assert.deepEqual(have.json(),{missing:[oid(23)]});
 assert.deepEqual((await f.prune(f.member.token,[oid(20)])).json(),{removed:0,bytes:0});
 age(f,oid(20),oid(21),oid(22));
 // 各台设备清单登记的对象都由服务端护住：家人漏了 keep、外婆传错 keep 都删不掉对方清单指着的东西。
 assert.equal((await f.publish(f.other.token,[oid(22)])).statusCode,200);
 assert.equal((await f.publish(f.member.token,[oid(20),oid(21)])).statusCode,200);
 assert.deepEqual((await f.prune(f.member.token,[])).json(),{code:'INVALID_INPUT',message:'远端已有清单，keep 不能为空。'});
 assert.deepEqual((await f.prune(f.member.token,[oid(20)])).json(),{removed:0,bytes:0});
 assert.deepEqual((await f.prune(f.other.token,[oid(22)])).json(),{removed:0,bytes:0});
 assert.equal(f.backups.stat(oid(21)),200);assert.equal(f.backups.stat(oid(20)),100);
 // 家人的新清单不再登记 21，它才随 keep 之外的对象一起被收走；22 仍由外婆的清单护着。
 assert.equal((await f.publish(f.member.token,[oid(20)])).statusCode,200);
 assert.deepEqual((await f.prune(f.member.token,[oid(20)])).json(),{removed:1,bytes:200});
 assert.equal(f.backups.stat(oid(20)),100);assert.equal(f.backups.stat(oid(21)),null);assert.equal(f.backups.stat(oid(22)),50);
 // 外婆退出（删自己设备的清单）后顺手收走没人指着的 22；家人不能删外婆的清单，主人可以。
 const forbidden=await f.app.inject({method:'DELETE',url:`/api/v1/backup/manifests/${f.other.member.deviceId}`,headers:f.headers()});
 assert.equal(forbidden.statusCode,403);
 const left=await f.app.inject({method:'DELETE',url:`/api/v1/backup/manifests/${f.other.member.deviceId}`,headers:f.headers(f.other.token)});
 assert.deepEqual(left.json(),{ok:true,pruned:{removed:1,bytes:50}});
 assert.equal((await f.app.inject({method:'DELETE',url:`/api/v1/backup/manifests/${f.other.member.deviceId}`,headers:f.headers(f.owner.token)})).statusCode,404);
 assert.equal((await f.app.inject({method:'DELETE',url:`/api/v1/backup/manifests/${f.member.member.deviceId}`,headers:f.headers(f.owner.token)})).statusCode,200);
 assert.equal((await f.status()).manifests,0);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/backup/objects/have',headers:f.headers(),payload:{ids:['nope']}})).statusCode,400);
 assert.equal((await f.app.inject({method:'DELETE',url:'/api/v1/backup/manifests/not-a-device',headers:f.headers()})).statusCode,400);
 await f.close();
});
test('each device publishes its own manifest; GET falls back to the newest of the member; the family list shows them all',async()=>{
 const f=fixture();
 assert.equal((await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers()})).statusCode,404);
 assert.deepEqual((await f.app.inject({url:'/api/v1/backup/manifests',headers:f.headers()})).json(),[]);
 const index=randomBytes(100).toString('base64'),keyId='00ff00ff00ff00ff';
 // Build 71 的手机不传 objects 也照样发布。
 const put=await f.publish(f.member.token,undefined,keyId,index);
 assert.equal(put.statusCode,200);assert.ok(Number.isFinite(Date.parse(put.json().updatedAt)));
 const got=(await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers()})).json();
 assert.deepEqual(got,{deviceId:f.member.member.deviceId,keyId,index,updatedAt:put.json().updatedAt});
 assert.equal((await f.status()).keyId,keyId);assert.equal((await f.status()).manifestUpdatedAt,put.json().updatedAt);
 assert.equal((await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers(f.other.token)})).statusCode,404);
 for(const bad of [{keyId:'short',index},{keyId,index:'not base64!'},{keyId,index:'A'.repeat(90001)},{keyId,index,extra:1},{keyId,index,objects:['nope']}])
  assert.equal((await f.app.inject({method:'PUT',url:'/api/v1/backup/manifest',headers:f.headers(),payload:bad})).statusCode,400);
 assert.equal((await f.publish(f.member.token,[oid(1),oid(2)],keyId,index)).statusCode,200);
 assert.deepEqual(f.store.manifestOf(f.member.member.deviceId!)!.objects,[oid(1),oid(2)]);
 assert.equal((await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers()})).json().objects,undefined);
 // 同一成员的第二台手机有自己的一份；第三台还没发布过的拿到成员名下最新的那份。
 const tablet=f.store.attach(f.member.member.id,'家人平板');
 await new Promise(resolve=>setTimeout(resolve,5));
 const tabletPut=await f.publish(tablet.token,[oid(3)],keyId,'REVGRw==');
 assert.equal((await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers(tablet.token)})).json().index,'REVGRw==');
 assert.equal((await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers()})).json().index,index);
 const fresh=f.store.attach(f.member.member.id,'家人新手机');
 assert.deepEqual((await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers(fresh.token)})).json(),{deviceId:tablet.member.deviceId,keyId,index:'REVGRw==',updatedAt:tabletPut.json().updatedAt});
 const all=(await f.app.inject({url:'/api/v1/backup/manifests',headers:f.headers(f.other.token)})).json();
 assert.deepEqual(all.map((m:{deviceId:string;deviceName:string;memberId:string;keyId:string;index:string})=>[m.deviceId,m.deviceName,m.memberId,m.keyId,m.index]),[[tablet.member.deviceId,'家人平板',f.member.member.id,keyId,'REVGRw=='],[f.member.member.deviceId,'家人手机',f.member.member.id,keyId,index]]);
 assert.ok(all.every((m:{updatedAt:string;objects?:unknown})=>Number.isFinite(Date.parse(m.updatedAt))&&m.objects===undefined));
 assert.equal((await f.status()).manifests,2);
 await f.close();
});
test('a member deletes only their manifests; the owner can drop a member, wipe the family and set the quota',async()=>{
 const f=fixture();
 assert.equal((await f.put(oid(30),randomBytes(10))).statusCode,201);
 assert.equal((await f.put(oid(32),randomBytes(20),f.other.token)).statusCode,201);
 assert.equal((await f.publish(f.member.token,[oid(30)])).statusCode,200);
 assert.equal((await f.publish(f.other.token,[oid(32)])).statusCode,200);
 age(f,oid(30));
 // Build 71 的「删除远端备份」：只作废自己名下的清单，对象是全家的，没人指着的才收走。
 assert.deepEqual((await f.app.inject({method:'DELETE',url:'/api/v1/backup',headers:f.headers()})).json(),{ok:true,pruned:{removed:1,bytes:10}});
 let status=await f.status();
 assert.equal(status.objects,1);assert.equal(status.manifests,1);assert.equal(status.keyId,KEY);
 assert.equal(f.backups.stat(oid(32)),20);
 assert.equal((await f.put(oid(31),randomBytes(10))).statusCode,201);
 const memberId=f.member.member.id;
 assert.equal((await f.app.inject({method:'PATCH',url:`/api/v1/admin/members/${f.owner.member.id}`,headers:f.headers(),payload:{enabled:true,photoLimit:1,writeLimit:1,backupLimitBytes:123}})).statusCode,403);
 assert.equal((await f.app.inject({method:'PATCH',url:`/api/v1/admin/members/${f.owner.member.id}`,headers:f.headers(f.owner.token),payload:{enabled:true,photoLimit:1,writeLimit:1,backupLimitBytes:123}})).statusCode,200);
 assert.equal((await f.status()).limitBytes,123);
 assert.equal((await f.app.inject({method:'PATCH',url:`/api/v1/admin/members/${f.owner.member.id}`,headers:f.headers(f.owner.token),payload:{enabled:true,photoLimit:2,writeLimit:2}})).statusCode,200);
 assert.equal(f.store.memberById(f.owner.member.id).backup_limit_bytes,123);
 const overview=(await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers(f.owner.token)})).json();
 assert.deepEqual(overview.backup,{objects:2,bytes:30,limitBytes:123,manifests:1});assert.ok(overview.backupFreeBytes>0);
 assert.deepEqual(overview.members.find((m:{id:string})=>m.id===memberId).manifests,[]);
 assert.deepEqual(overview.members.find((m:{id:string})=>m.id===f.other.member.id).manifests.map((m:{deviceId:string;deviceName:string})=>[m.deviceId,m.deviceName]),[[f.other.member.deviceId,'外婆手机']]);
 assert.equal((await f.app.inject({method:'DELETE',url:`/api/v1/admin/members/${f.other.member.id}/backup`,headers:f.headers()})).statusCode,403);
 assert.deepEqual((await f.app.inject({method:'DELETE',url:`/api/v1/admin/members/${f.other.member.id}/backup`,headers:f.headers(f.owner.token)})).json(),{ok:true,pruned:{removed:0,bytes:0}});
 assert.equal((await f.status()).manifests,0);assert.equal(f.backups.stat(oid(32)),20);
 assert.equal((await f.app.inject({method:'DELETE',url:`/api/v1/admin/members/00000000-0000-4000-8000-000000000000/backup`,headers:f.headers(f.owner.token)})).statusCode,404);
 // 主人清空全家：清单与对象一起没了，家庭目录留着可以继续用。
 assert.equal((await f.publish(f.other.token,[oid(32)])).statusCode,200);
 assert.equal((await f.app.inject({method:'DELETE',url:'/api/v1/admin/backup',headers:f.headers()})).statusCode,403);
 assert.deepEqual((await f.app.inject({method:'DELETE',url:'/api/v1/admin/backup',headers:f.headers(f.owner.token)})).json(),{ok:true});
 status=await f.status();
 assert.equal(status.objects,0);assert.equal(status.manifests,0);assert.equal(status.keyId,null);
 assert.equal((await f.put(oid(33),randomBytes(10))).statusCode,201);
 assert.ok(existsSync(familyPath(f.dir,oid(33))));
 await f.close();
});
test('backup routes require a login',async()=>{
 const f=fixture();
 for(const [method,url] of [['GET','/api/v1/backup/status'],['POST','/api/v1/backup/objects/have'],['PUT',`/api/v1/backup/objects/${oid(1)}`],['GET',`/api/v1/backup/objects/${oid(1)}`],['PUT','/api/v1/backup/manifest'],['GET','/api/v1/backup/manifest'],['GET','/api/v1/backup/manifests'],['DELETE',`/api/v1/backup/manifests/${f.member.member.deviceId}`],['POST','/api/v1/backup/prune'],['DELETE','/api/v1/backup'],['DELETE','/api/v1/admin/backup']] as const)
  assert.equal((await f.app.inject({method,url,headers:method==='PUT'&&url.includes('objects')?{...octet,'x-object-sha256':oid(1)}:{},payload:method==='GET'||method==='DELETE'?undefined:url.includes('objects/')&&method==='PUT'?Buffer.from('x'):{}})).statusCode,401,`${method} ${url}`);
 await f.close();
});
test('Build 70/71 databases migrate their per-member manifests into legacy device rows; a device publish retires them',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-backup-migrate-'));
 const M1='00000000-0000-4000-8000-000000000001',M2='00000000-0000-4000-8000-000000000002';
 const seed=(file:string,withObjects:boolean)=>{
  const raw=new Database(file);
  raw.exec(`CREATE TABLE members(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,photo_limit INTEGER NOT NULL DEFAULT 100,write_limit INTEGER NOT NULL DEFAULT 20,username TEXT,password_hash TEXT);INSERT INTO members(id,name,role,username,password_hash) VALUES('${M1}','旧成员','owner','旧成员','x');INSERT INTO members(id,name,role,username,password_hash) VALUES('${M2}','旧家人','member','旧家人','x');`);
  raw.exec(withObjects
   ?`CREATE TABLE backup_manifests(member_id TEXT PRIMARY KEY REFERENCES members(id),key_id TEXT NOT NULL,index_b64 TEXT NOT NULL,updated_at INTEGER NOT NULL,objects_json TEXT);INSERT INTO backup_manifests VALUES('${M2}','0123456789abcdef','QUJD',1758000000000,'["${oid(9)}"]');INSERT INTO backup_manifests VALUES('${M1}','0123456789abcdef','REVG',1758000001000,NULL);`
   // Build 70 首版的清单表没有 objects_json 列，已有的一行要能读出来（视为没登记对象）。
   :`CREATE TABLE backup_manifests(member_id TEXT PRIMARY KEY REFERENCES members(id),key_id TEXT NOT NULL,index_b64 TEXT NOT NULL,updated_at INTEGER NOT NULL);INSERT INTO backup_manifests VALUES('${M2}','0123456789abcdef','QUJD',1758000000000);`);
  raw.close();
 };
 const first=join(dir,'first.sqlite');seed(first,false);
 let store=new Store(first);
 assert.equal(store.members()[0]!.backup_limit_bytes,DEFAULT_BACKUP_LIMIT);
 assert.equal(store.latestManifestOf(M1),undefined);
 assert.deepEqual(store.latestManifestOf(M2),{deviceId:`legacy:${M2}`,memberId:M2,deviceName:null,keyId:'0123456789abcdef',index:'QUJD',updatedAt:1758000000000,objects:[]});
 assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='backup_manifests'").get(),undefined);
 store.close();
 // 再开一次什么也不发生。
 store=new Store(first);assert.equal(store.manifestCount(),1);store.close();
 const second=join(dir,'second.sqlite');seed(second,true);
 store=new Store(second);
 assert.deepEqual(store.manifests().map(m=>[m.deviceId,m.index,m.objects]),[[`legacy:${M1}`,'REVG',[]],[`legacy:${M2}`,'QUJD',[oid(9)]]]);
 assert.deepEqual([...store.manifestObjects()],[oid(9)]);
 // 旧家人的一台手机发布自己的清单后，成员名下迁来的那份就作废；旧成员的仍在。
 const phone=store.attach(M2,'旧家人手机');
 store.putManifest(phone.member.deviceId!,M2,'0123456789abcdef','QUJD',[oid(10)]);
 assert.deepEqual(store.manifests().map(m=>[m.deviceId,m.deviceName]),[[phone.member.deviceId,'旧家人手机'],[`legacy:${M1}`,null]]);
 assert.deepEqual(store.latestManifestOf(M2)!.objects,[oid(10)]);
 assert.equal(store.manifestOf(`legacy:${M2}`),undefined);
 assert.deepEqual([...store.manifestObjects()],[oid(10)]);
 store.deleteMemberManifests(M1);assert.equal(store.manifestCount(),1);
 store.close();
 rmSync(dir,{recursive:true,force:true});
});
test('per-member object directories move into the family space once; duplicates collapse and stale temp files are swept',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-backup-space-'));
 const M1='00000000-0000-4000-8000-000000000001',M2='00000000-0000-4000-8000-000000000002';
 const seed=(member:string,id:string,content:string)=>{mkdirSync(join(dir,member,'objects',id.slice(0,2)),{recursive:true});writeFileSync(join(dir,member,'objects',id.slice(0,2),id),content);};
 seed(M1,oid(1),'a');seed(M1,oid(2),'bb');seed(M2,oid(2),'bb');seed(M2,oid(0xab00),'ccc');
 mkdirSync(join(dir,M2,'objects','zz'),{recursive:true});writeFileSync(join(dir,M2,'objects','zz','junk'),'x');
 mkdirSync(join(dir,'tmp'),{recursive:true});writeFileSync(join(dir,'tmp','fresh.part'),'a');writeFileSync(join(dir,'tmp','stale.part'),'b');
 const old=new Date(Date.now()-7200000);utimesSync(join(dir,'tmp','stale.part'),old,old);
 const backups=new BackupStore(dir);
 assert.deepEqual(backups.migrateMemberSpaces(),{members:2,moved:3,duplicates:1,failed:1});
 assert.deepEqual(backups.list().map(r=>[r.id,r.bytes]).sort(),[[oid(1),1],[oid(2),2],[oid(0xab00),3]].sort());
 assert.ok(!existsSync(join(dir,M1)));
 // 不认识的文件原地保留；已搬好的对象不残留在成员目录。
 assert.equal(readFileSync(join(dir,M2,'objects','zz','junk'),'utf8'),'x');
 assert.deepEqual(readdirSync(join(dir,M2)),['objects']);
 assert.deepEqual(readdirSync(join(dir,M2,'objects')),['zz']);
 assert.deepEqual(readdirSync(join(dir,M2,'objects','zz')),['junk']);
 assert.deepEqual(readdirSync(dir).sort(),[FAMILY_DIR,M2,'tmp'].sort());
 assert.deepEqual(backups.migrateMemberSpaces(),{members:1,moved:0,duplicates:0,failed:1});
 rmSync(join(dir,M2),{recursive:true,force:true});
 assert.deepEqual(backups.migrateMemberSpaces(),{members:0,moved:0,duplicates:0,failed:0});
 assert.deepEqual(readdirSync(dir).sort(),[FAMILY_DIR,'tmp']);
 assert.equal(backups.usage().bytes,6);
 backups.sweepTemp();
 assert.deepEqual(readdirSync(join(dir,'tmp')),['fresh.part']);
 // 启动时按 0 宽限：监听前没有上传在途，刚崩溃留下的也要清。
 backups.sweepTemp(0);
 assert.deepEqual(readdirSync(join(dir,'tmp')),[]);
 rmSync(dir,{recursive:true,force:true});
});

// 回归：用 49 小时后的时钟排除上传 claim 的保护，单独检验未知清单。
const afterClaimsExpire=(t:TestContext)=>{
 const now=Date.now();t.mock.method(Date,'now',()=>now+49*3600000);
};
test('A-1 upload probe never deletes manifests and still revokes only its own device',()=>{
 const script=readFileSync(new URL('../scripts/probe-upload-limit.py',import.meta.url),'utf8');
 assert.doesNotMatch(script,/request\([^\n]*['"]DELETE['"]/);
 assert.match(script,/UPDATE devices SET revoked=1 WHERE id=\?/);
 assert.match(script,/login\['member'\]\['deviceId'\]/);
});
test('A-2 an old phone omitting objects stops the entire prune, including unreferenced objects',async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(100),Buffer.alloc(100));await f.put(oid(101),Buffer.alloc(50));
 await f.publish(f.member.token);age(f,oid(100),oid(101));afterClaimsExpire(t);
 assert.deepEqual((await f.prune(f.other.token,[oid(999)])).json(),{removed:0,bytes:0});
 assert.equal(f.backups.stat(oid(100)),100);assert.equal(f.backups.stat(oid(101)),50);
 assert.deepEqual(f.store.db.prepare('SELECT objects_json FROM backup_manifests_v2').get(),{objects_json:null});
});
test('A-2 a NULL legacy registration stops the entire prune',async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(102),Buffer.alloc(100));age(f,oid(102));
 f.store.db.prepare('INSERT INTO backup_manifests_v2 VALUES(?,?,?,?,?,NULL)').run(`legacy:${f.member.member.id}`,f.member.member.id,KEY,INDEX,Date.now());
 afterClaimsExpire(t);
 assert.deepEqual((await f.prune(f.other.token,[oid(999)])).json(),{removed:0,bytes:0});
 assert.equal(f.backups.stat(oid(102)),100);
});
test('A-2 explicit empty objects is known and fully registered manifests still allow collection',async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(103),Buffer.alloc(100));await f.put(oid(104),Buffer.alloc(50));
 await f.publish(f.member.token,[oid(103)]);await f.publish(f.other.token,[]);
 age(f,oid(103),oid(104));afterClaimsExpire(t);
 assert.deepEqual((await f.prune(f.other.token,[oid(999)])).json(),{removed:1,bytes:50});
 assert.equal(f.backups.stat(oid(103)),100);assert.equal(f.backups.stat(oid(104)),null);
 assert.deepEqual(f.store.db.prepare('SELECT objects_json FROM backup_manifests_v2 WHERE device_id=?').get(f.other.member.deviceId),{objects_json:'[]'});
});
for(const route of ['member','device','admin-member'])test(`A-2 ${route} deletion sweep stops while another manifest has unknown references`,async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(105),Buffer.alloc(100));await f.publish(f.member.token);
 await f.publish(f.other.token,[]);age(f,oid(105));afterClaimsExpire(t);
 const url=route==='member'?'/api/v1/backup':route==='device'?`/api/v1/backup/manifests/${f.other.member.deviceId}`:`/api/v1/admin/members/${f.other.member.id}/backup`;
 const result=await f.app.inject({method:'DELETE',url,headers:f.headers(route==='admin-member'?f.owner.token:f.other.token)});
 assert.deepEqual(result.json(),{ok:true,pruned:{removed:0,bytes:0}});
 assert.equal(f.store.manifestCount(),1);assert.equal(f.backups.stat(oid(105)),100);
});
for(const via of ['have','put'])test(`A-3 ${via} claims protect an unpublished upload beyond one hour, then expire`,async t=>{
 const f=fixture();t.after(f.close);
 // 直接存文件，模拟已有对象，避免 PUT 的 claim 掩盖 have 的缺陷。
 if(via==='have') {
  await f.backups.receive(oid(106),Readable.from([Buffer.alloc(100)]),{sha256:sha(Buffer.alloc(100))});
  const result=await f.app.inject({method:'POST',url:'/api/v1/backup/objects/have',headers:f.headers(),payload:{ids:[oid(106),oid(107)]}});
  assert.deepEqual(result.json(),{missing:[oid(107)]});
 } else assert.equal((await f.put(oid(106),Buffer.alloc(100))).statusCode,201);
 age(f,oid(106));
 const now=Date.now();t.mock.method(Date,'now',()=>now+2*3600000);
 assert.deepEqual((await f.prune(f.other.token,[])).json(),{removed:0,bytes:0});
 assert.equal(f.backups.stat(oid(106)),100);
 t.mock.method(Date,'now',()=>now+49*3600000);
 assert.deepEqual((await f.prune(f.other.token,[])).json(),{removed:1,bytes:100});
 assert.equal(f.backups.stat(oid(106)),null);
 assert.deepEqual(f.store.db.prepare('SELECT * FROM backup_object_claims').all(),[]);
});

test('A-3 claims survive SQLite reopen, renew per device in batches, and protect deletion sweeps',async t=>{
 const f=fixture();t.after(f.close);
 const ids=Array.from({length:5000},(_,i)=>oid(1000+i));
 const have=()=>f.app.inject({method:'POST',url:'/api/v1/backup/objects/have',headers:f.headers(),payload:{ids}});
 assert.equal((await have()).statusCode,200);
 const now=Date.now();t.mock.method(Date,'now',()=>now+47*3600000);
 assert.equal((await have()).statusCode,200);
 assert.deepEqual(f.store.db.prepare('SELECT COUNT(*) n, MIN(claimed_at) oldest FROM backup_object_claims WHERE device_id=?').get(f.member.member.deviceId),{n:5000,oldest:now+47*3600000});
 await f.backups.receive(ids[0]!,Readable.from([Buffer.alloc(100)]),{sha256:sha(Buffer.alloc(100))});age(f,ids[0]!);
 // 另一台设备发布或退出不能解除上传设备的占位。
 await f.publish(f.other.token,[]);
 const file=join(f.dir,'claims.sqlite');await f.store.db.backup(file);
 const reopened=new Store(file),app=createApp(reopened,async()=>{throw new Error('no provider');},'test',f.backups,unusedTranscribe);
 try {
  t.mock.method(Date,'now',()=>now+49*3600000);
  const left=await app.inject({method:'DELETE',url:'/api/v1/backup',headers:f.headers(f.other.token)});
  assert.deepEqual(left.json(),{ok:true,pruned:{removed:0,bytes:0}});
  assert.equal(f.backups.stat(ids[0]!),100);
 } finally {await app.close();reopened.close();}
});
for(const via of ['admin','wipe'])test(`A-3 ${via} family wipe removes all claims`,async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(108),Buffer.alloc(100));
 await f.app.inject({method:'POST',url:'/api/v1/backup/objects/have',headers:f.headers(f.other.token),payload:{ids:[oid(109)]}});
 assert.equal((f.store.db.prepare('SELECT COUNT(*) n FROM backup_object_claims').get() as {n:number}).n,2);
 if(via==='admin')assert.equal((await f.app.inject({method:'DELETE',url:'/api/v1/admin/backup',headers:f.headers(f.owner.token)})).statusCode,200);
 else f.backups.wipe(f.store);
 assert.deepEqual(f.store.db.prepare('SELECT * FROM backup_object_claims').all(),[]);
 assert.equal(f.backups.stat(oid(108)),null);
});

test('A-11 已存在的对象先到为准，其他家人不能用不同字节覆盖',async t=>{
 const f=fixture();t.after(f.close);
 const a=Buffer.from('原来的密文'),b=Buffer.from('后来传入的不同密文');
 assert.equal((await f.put(oid(201),a)).statusCode,201);
 assert.equal((await f.put(oid(201),b,f.other.token)).statusCode,200);
 assert.deepEqual(readFileSync(f.backups.objectPath(oid(201))),a);
 assert.deepEqual(await f.backups.receive(oid(201),Readable.from([b]),{sha256:sha(b)}),{bytes:b.length,created:false});
 assert.deepEqual(readFileSync(f.backups.objectPath(oid(201))),a);
 assert.deepEqual(readdirSync(join(f.dir,'tmp')),[]);
});

test('A-16 同成员设备 B 撤下本机清单，设备 A 的清单仍在',async t=>{
 const f=fixture();t.after(f.close);
 const b=f.store.attach(f.member.member.id,'家人手机 B');
 await f.publish(f.member.token,[]);await f.publish(b.token,[]);
 const result=await f.app.inject({method:'DELETE',url:`/api/v1/backup/manifests/${b.member.deviceId}`,headers:f.headers(b.token)});
 assert.equal(result.statusCode,200);
 assert.ok(f.store.manifestOf(f.member.member.deviceId!));
 assert.equal(f.store.manifestOf(b.member.deviceId!),undefined);
});
test('A-8 主人撤销设备只退出全家合并，备份仍可恢复且对象受保护',async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(202),Buffer.alloc(12));await f.publish(f.member.token,[oid(202)]);
 await f.publish(f.other.token,[]);
 const saved=f.store.manifestOf(f.member.member.deviceId!)!;
 age(f,oid(202));
 const result=await f.app.inject({method:'DELETE',url:`/api/v1/admin/devices/${f.member.member.deviceId}`,headers:f.headers(f.owner.token)});
 await t.test('撤销后同成员的新设备仍能取回清单',async()=>{
  const replacement=f.store.attach(f.member.member.id,'家人的新手机');
  assert.equal(f.store.manifestOf(replacement.member.deviceId!),undefined);
  const restored=await f.app.inject({url:'/api/v1/backup/manifest',headers:f.headers(replacement.token)});
  assert.equal(restored.statusCode,200);
  assert.deepEqual(restored.json(),{deviceId:saved.deviceId,keyId:KEY,index:INDEX,updatedAt:new Date(saved.updatedAt).toISOString()});
  // 手机端换机恢复只走全家列表：同成员的新手机要看得到旧机那份，别人看不到。
  const own=await f.app.inject({url:'/api/v1/backup/manifests',headers:f.headers(replacement.token)});
  assert.deepEqual(own.json().map((m:{deviceId:string})=>m.deviceId).sort(),[saved.deviceId,f.other.member.deviceId].sort());
 });
 await t.test('撤销后越过宽限并过期 claim，清单独占的对象仍在',async()=>{
  afterClaimsExpire(t);
  assert.deepEqual([...f.store.claimedObjects()],[]);
  const pruned=await f.prune(f.other.token,[oid(999)]);
  assert.equal(pruned.statusCode,200);
  assert.equal(f.backups.stat(oid(202)),12);
  assert.deepEqual(pruned.json(),{removed:0,bytes:0});
  assert.deepEqual([...f.store.manifestObjects()],[oid(202)]);
 });
 await t.test('撤销响应、合并列表与主人管理页各自遵守契约',async()=>{
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.json(),{ok:true});
  assert.deepEqual(f.store.manifestOf(f.member.member.deviceId!),saved);
  const listed=await f.app.inject({url:'/api/v1/backup/manifests',headers:f.headers(f.owner.token)});
  assert.equal(listed.statusCode,200);
  assert.deepEqual(listed.json().map((m:{deviceId:string})=>m.deviceId),[f.other.member.deviceId]);
  const overview=await f.app.inject({url:'/api/v1/admin/overview',headers:f.headers(f.owner.token)});
  assert.equal(overview.statusCode,200);
  assert.equal(overview.json().backup.manifests,2);
  assert.deepEqual(overview.json().members.find((m:{id:string})=>m.id===f.member.member.id).manifests.map((m:{deviceId:string})=>m.deviceId),[saved.deviceId]);
 });
});
test('A-8 没有设备行的 legacy 清单仍列入全家合并',async t=>{
 const f=fixture();t.after(f.close);
 const legacy=`legacy:${f.member.member.id}`;
 f.store.putManifest(legacy,f.member.member.id,KEY,INDEX,[oid(203)]);
 assert.equal(f.store.db.prepare('SELECT id FROM devices WHERE id=?').get(legacy),undefined);
 await f.publish(f.other.token,[]);
 const listed=await f.app.inject({url:'/api/v1/backup/manifests',headers:f.headers(f.owner.token)});
 assert.equal(listed.statusCode,200);
 assert.deepEqual(listed.json().map((m:{deviceId:string})=>m.deviceId).sort(),[legacy,f.other.member.deviceId].sort());
 assert.equal(listed.json().find((m:{deviceId:string})=>m.deviceId===legacy).index,INDEX);
});
test('A-8 管理者停用一台设备只撤销令牌，保留其设备清单',async t=>{
 const f=fixture();t.after(f.close);
 await f.publish(f.member.token,[]);
 const result=await f.app.inject({method:'DELETE',url:`/api/v1/admin/devices/${f.member.member.deviceId}`,headers:f.headers(f.owner.token)});
 assert.equal(result.statusCode,200);
 assert.ok(f.store.manifestOf(f.member.member.deviceId!));
 assert.equal((await f.app.inject({url:'/api/v1/backup/manifests',headers:f.headers()})).statusCode,401);
});

// 每次先重扫盘取得真值，再禁止 usage 偷扫；两者必须独立且相等。
function assertUsage(t:TestContext,backups:BackupStore) {
 const rows=backups.list(),truth={objects:rows.length,bytes:rows.reduce((n,r)=>n+r.bytes,0)};
 const scan=t.mock.method(backups,'list',()=>{throw new Error('usage 不应扫描对象库');});
 try { assert.deepEqual(backups.usage(),truth); } finally { scan.mock.restore(); }
}
test('A-15 上传、重传、prune 与 wipe 的计数等于重扫盘真值，usage 不扫盘',async t=>{
 const f=fixture();t.after(f.close);
 assertUsage(t,f.backups);
 for(const [n,size] of [[210,10],[211,20],[212,30]]) {
  await f.put(oid(n!),Buffer.alloc(size!));assertUsage(t,f.backups);
 }
 const before=f.backups.list();
 await f.put(oid(210),Buffer.from('x'));
 assert.deepEqual(f.backups.list(),before);assertUsage(t,f.backups);
 age(f,oid(210),oid(211),oid(212));
 assert.deepEqual(f.backups.prune(new Set([oid(210)])),{removed:2,bytes:50});assertUsage(t,f.backups);
 f.backups.wipe(f.store);assertUsage(t,f.backups);assert.deepEqual(f.backups.list(),[]);
 assert.deepEqual(f.backups.usage(),{objects:0,bytes:0});
});
test('A-15 构造、迁移和显式 recount 后计数等于重扫盘真值',async t=>{
 const f=fixture();t.after(f.close);
 await f.put(oid(213),Buffer.alloc(7));
 const reopened=new BackupStore(f.dir);assertUsage(t,reopened);
 const old=join(f.dir,f.member.member.id,'objects',oid(214).slice(0,2));
 mkdirSync(old,{recursive:true});writeFileSync(join(old,oid(214)),Buffer.alloc(19));
 reopened.migrateMemberSpaces();assertUsage(t,reopened);
 assert.deepEqual(reopened.usage(),{objects:2,bytes:26});
 writeFileSync(reopened.objectPath(oid(215)),Buffer.alloc(9));
 reopened.recount();assertUsage(t,reopened);
 assert.deepEqual(reopened.usage(),{objects:3,bytes:35});
});

test('迁移加固：单个对象搬运失败不挡其他对象，残留原地保留并可重试',t=>{
 const f=fixture();t.after(f.close);
 const bad='ab'.repeat(32),good='cd'.repeat(32);
 const memberDir=join(f.dir,f.member.member.id);
 for(const [id,content] of [[bad,'bad'],[good,'good']]) {
  const dir=join(memberDir,'objects',id!.slice(0,2));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,id!),content!);
 }
 // 目标前缀被文件占住，确定性模拟 mkdir／rename 失败，不依赖 root 的权限语义。
 const blocked=join(f.dir,FAMILY_DIR,'objects','ab');writeFileSync(blocked,'blocked');
 assert.deepEqual(f.backups.migrateMemberSpaces(),{members:1,moved:1,duplicates:0,failed:1});
 assert.equal(readFileSync(join(memberDir,'objects','ab',bad),'utf8'),'bad');
 assert.equal(readFileSync(f.backups.objectPath(good),'utf8'),'good');assertUsage(t,f.backups);
 rmSync(blocked);
 assert.deepEqual(f.backups.migrateMemberSpaces(),{members:1,moved:1,duplicates:0,failed:0});
 assert.ok(!existsSync(memberDir));assertUsage(t,f.backups);
});
test('迁移加固：不合法的文件保留在原目录，不递归删掉',t=>{
 const f=fixture();t.after(f.close);
 const dir=join(f.dir,f.member.member.id,'objects','zz');mkdirSync(dir,{recursive:true});
 const junk=join(dir,'junk');writeFileSync(junk,'必须保留');
 assert.deepEqual(f.backups.migrateMemberSpaces(),{members:1,moved:0,duplicates:0,failed:1});
 assert.equal(readFileSync(junk,'utf8'),'必须保留');assertUsage(t,f.backups);
});
for(const action of ['profile','device','settings'] as const) test(`权限加固：家人调用 ${action} 管理入口返回 403`,async t=>{
 const f=fixture();t.after(f.close);
 const request=action==='profile'
  ?{method:'PUT' as const,url:`/api/v1/admin/members/${f.other.member.id}/profile`,payload:{name:'外婆',role:'admin'}}
  :action==='device'?{method:'DELETE' as const,url:`/api/v1/admin/devices/${f.other.member.deviceId}`}
  :{method:'PUT' as const,url:'/api/v1/admin/settings',payload:{paused:true,globalPhotos:1,globalWrites:1}};
 const result=await f.app.inject({...request,headers:f.headers()});
 assert.equal(result.statusCode,403);assert.equal(result.json().code,'ADMIN_ONLY');
});

test('每设备对象占位低于上限与恰好到上限都通过，重复 id 不计新增，超一条整批拒绝',async t=>{
 const f=fixture();t.after(f.close);const device=f.member.member.deviceId!,now=Date.now();
 const count=()=> (f.store.db.prepare('SELECT COUNT(*) n FROM backup_object_claims WHERE device_id=?').get(device) as {n:number}).n;
 f.store.claimObjects(device,[oid(1),oid(1)],now);assert.equal(count(),1);
 const insert=f.store.db.prepare('INSERT INTO backup_object_claims(device_id,object_id,claimed_at) VALUES(?,?,?)');
 f.store.db.transaction(()=>{for(let n=2;n<CLAIMS_PER_DEVICE-1;n++)insert.run(device,oid(n),now);})();
 f.store.claimObjects(device,[oid(CLAIMS_PER_DEVICE-1)],now);assert.equal(count(),CLAIMS_PER_DEVICE-1);
 // 还差一条时提交两条：整批回滚，已有占位也不能被部分续期。
 const rejected=await f.app.inject({method:'POST',url:'/api/v1/backup/objects/have',headers:f.headers(),payload:{ids:[oid(1),oid(CLAIMS_PER_DEVICE),oid(CLAIMS_PER_DEVICE+1)]}});
 assert.equal(rejected.statusCode,413);assert.equal(rejected.json().code,'QUOTA_FULL');assert.equal(rejected.json().message,'远端对象数量已到上限，请联系管理者。');assert.equal(count(),CLAIMS_PER_DEVICE-1);
 assert.equal((f.store.db.prepare('SELECT claimed_at FROM backup_object_claims WHERE device_id=? AND object_id=?').get(device,oid(1)) as {claimed_at:number}).claimed_at,now);
 assert.equal(f.store.db.prepare('SELECT 1 FROM backup_object_claims WHERE device_id=? AND object_id=?').get(device,oid(CLAIMS_PER_DEVICE)),undefined);
 f.store.claimObjects(device,[oid(CLAIMS_PER_DEVICE),oid(CLAIMS_PER_DEVICE),oid(1)],now);assert.equal(count(),CLAIMS_PER_DEVICE);
 f.store.claimObjects(device,[oid(1),oid(1)],now+1);assert.equal(count(),CLAIMS_PER_DEVICE);
 assert.throws(()=>f.store.claimObjects(device,[oid(CLAIMS_PER_DEVICE+1)],now),e=>(e as {status:number;code:string}).status===413&&(e as {code:string}).code==='QUOTA_FULL');
 // 其他设备有自己的上限；原有过期清理仍能释放行数。
 f.store.claimObjects(f.other.member.deviceId!,[oid(CLAIMS_PER_DEVICE+1)],now);
 f.store.claimObjects(device,[oid(CLAIMS_PER_DEVICE+1)],now+48*60*60*1000+2);assert.equal(count(),1);
});
