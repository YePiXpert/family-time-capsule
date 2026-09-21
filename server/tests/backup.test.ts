import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { DEFAULT_BACKUP_LIMIT, Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/passwords.ts';
import { BackupStore, FAMILY_DIR, OBJECT_LIMIT } from '../src/backup-store.ts';

const PW='12345678',HASH=await hashPassword(PW);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const oid=(n:number)=>n.toString(16).padStart(64,'0');
const octet={'content-type':'application/octet-stream'};
const KEY='0123456789abcdef',INDEX='QUJD';
function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'anan-backup-test-'));
 const store=new Store(':memory:'),backups=new BackupStore(dir);
 const app=createApp(store,async()=>{throw new Error('no provider in this test');},'test',backups);
 const owner=store.setup('主人',HASH,'主人手机');
 store.createMember('家人',HASH);const member=store.attach(store.byUsername('家人')!.id,'家人手机');
 store.createMember('外婆',HASH);const other=store.attach(store.byUsername('外婆')!.id,'外婆手机');
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
 assert.deepEqual(await f.status(f.other.token),status);
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
 // 换成更小的内容不需要余量。
 const shrunk=randomBytes(300);
 assert.equal((await f.put(oid(5),shrunk)).statusCode,200);assert.equal(f.backups.stat(oid(5)),300);
 assert.equal((await f.put(oid(6),randomBytes(10))).statusCode,201);
 assert.equal((await f.put(oid(8),randomBytes(500))).statusCode,413);
 // 外婆的手机传的也算在同一份配额里。
 assert.equal((await f.put(oid(9),randomBytes(200),f.other.token)).json().code,'QUOTA_FULL');
 assert.equal((await f.put(oid(9),randomBytes(100),f.other.token)).statusCode,201);
 assert.equal((await f.status()).bytes,410);
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
 assert.deepEqual(backups.migrateMemberSpaces(),{members:2,moved:3,duplicates:1});
 assert.deepEqual(backups.list().map(r=>[r.id,r.bytes]).sort(),[[oid(1),1],[oid(2),2],[oid(0xab00),3]].sort());
 assert.ok(!existsSync(join(dir,M1))&&!existsSync(join(dir,M2)));
 assert.deepEqual(readdirSync(dir).sort(),[FAMILY_DIR,'tmp']);
 assert.deepEqual(backups.migrateMemberSpaces(),{members:0,moved:0,duplicates:0});
 assert.equal(backups.usage().bytes,6);
 backups.sweepTemp();
 assert.deepEqual(readdirSync(join(dir,'tmp')),['fresh.part']);
 // 启动时按 0 宽限：监听前没有上传在途，刚崩溃留下的也要清。
 backups.sweepTemp(0);
 assert.deepEqual(readdirSync(join(dir,'tmp')),[]);
 rmSync(dir,{recursive:true,force:true});
});
