import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DEVICE_IDLE_MS, PAIR_CONFIRM_MS, PAIR_PENDING_LIMIT, PAIR_TTL_MS, Store, normalizeActivationCode } from '../src/store.ts';
import { createApp } from '../src/app.ts';
import { BackupStore } from '../src/backup-store.ts';
import { FAMILY_ID, KEY_ID, PROOF, PUBLIC_KEY, addMember, recoveryFor, seedFamily, unusedTranscribe } from './helpers.ts';

// 家庭与设备（PLAN-FAMILY-DEVICES.md）：服务端只管状态机，不解任何钥匙包；这里的钥匙包与公钥都是合成的。
const b64url=(n:number)=>randomBytes(n).toString('base64url');
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(t:TestContext,{family=true}={}) {
 const dir=mkdtempSync(join(tmpdir(),'anan-family-test-')),store=new Store(':memory:');
 const app=createApp(store,async()=>({tokens:1,result:{title:'公园',text:'一起散步。'}}),'test',new BackupStore(dir),unusedTranscribe);
 t.after(async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});});
 const admin=family?seedFamily(store,'爸爸','爸爸的手机'):undefined;
 const bearer=(token?:string)=>token?{authorization:`Bearer ${token}`}:{};
 const call=async(method:'GET'|'POST'|'PUT'|'DELETE'|'PATCH',url:string,payload?:unknown,token?:string)=>{
  const response=await app.inject({method,url,headers:bearer(token),...(payload===undefined?{}:{payload:payload as object})});
  return {status:response.statusCode,body:response.body?response.json():undefined};
 };
 /** 新手机登记申请：返回申请号、领取凭据与公钥（公钥只在「二维码」里给管理者）。 */
 const request=async(deviceName='妈妈的手机')=>{
  const claim=randomBytes(16).toString('hex'),publicKey=b64url(32);
  const created=await call('POST','/api/v1/pair/requests',{publicKey,deviceName,claimHash:sha(claim)});
  assert.equal(created.status,201,JSON.stringify(created.body));
  return {id:created.body.requestId as string,claim,publicKey,deviceName};
 };
 const approve=(id:string,member:{id:string;name?:string;role?:'admin'|'member'},token=admin!.token)=>call('POST',`/api/v1/pair/requests/${id}/approve`,{member,enc:b64url(32),ct:b64url(80)},token);
 const collect=(id:string,claim:string)=>call('POST',`/api/v1/pair/requests/${id}/collect`,{claim});
 /** 完整走一遍：申请 → 批准 → 领取 → 确认，返回新手机的令牌与成员。 */
 const join_=async(member:{id:string;name?:string;role?:'admin'|'member'},deviceName?:string,approver=admin!.token)=>{
  const r=await request(deviceName);
  assert.equal((await approve(r.id,member,approver)).status,200);
  const got=await collect(r.id,r.claim);assert.equal(got.status,200);
  assert.equal((await call('POST',`/api/v1/pair/requests/${r.id}/confirm`,{},got.body.token)).status,200);
  return {token:got.body.token as string,member:got.body.member,requestId:r.id};
 };
 return {store,app,admin,call,request,approve,collect,join:join_};
}

test('空服务只能凭部署端的一次性激活码开家庭，先到先得不再成立',async t=>{
 const f=fixture(t,{family:false});
 assert.deepEqual((await f.call('GET','/api/v1/status')).body,{initialized:false,family:false});
 const body=(code:string)=>({activationCode:code,memberId:randomUUID(),memberName:'爸爸',deviceName:'爸爸的手机',publicKey:PUBLIC_KEY,familyId:FAMILY_ID,keyId:KEY_ID,recovery:recoveryFor()});
 // 没有激活码、瞎编的激活码都开不了。
 assert.equal((await f.call('POST','/api/v1/family/activate',body('ABCDE-FGHJK-MNPQR-STVWX-YZ012'))).status,403);
 const stale=f.store.issueActivationCode();
 const code=f.store.issueActivationCode();
 assert.match(code,/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
 // 再生成一枚，上一枚作废。
 assert.equal((await f.call('POST','/api/v1/family/activate',body(stale))).status,403);
 // 手抄时的大小写、空格、O/0 与 I/L/1 都认。
 const typed=code.toLowerCase().replace(/-/g,' ');
 assert.equal(normalizeActivationCode(typed),normalizeActivationCode(code));
 const opened=await f.call('POST','/api/v1/family/activate',body(typed));
 assert.equal(opened.status,201);assert.equal(opened.body.member.role,'admin');assert.equal(opened.body.member.name,'爸爸');
 assert.ok(!JSON.stringify(opened.body).includes('password'));
 // 用过即废；家庭已建好后再开一次是 409，也不能再发激活码。
 assert.equal((await f.call('POST','/api/v1/family/activate',body(code))).status,409);
 assert.throws(()=>f.store.issueActivationCode(),/已经有家庭/);
 assert.deepEqual((await f.call('GET','/api/v1/status')).body,{initialized:true,family:true});
 const family=await f.call('GET','/api/v1/family',undefined,opened.body.token);
 assert.equal(family.body.familyId,FAMILY_ID);assert.equal(family.body.keyId,KEY_ID);assert.equal(family.body.recoveryVersion,1);
 assert.equal(family.body.me.role,'admin');assert.equal(family.body.me.deviceId,opened.body.member.deviceId);
 // 服务端只存恢复证明的哈希与密文钥匙包。
 assert.equal(f.store.family()!.recoveryVerifier,sha(PROOF));
});

test('过期的激活码开不了家庭',async t=>{
 const f=fixture(t,{family:false});
 const code=f.store.issueActivationCode(Date.now()-25*3600*1000);
 assert.equal((await f.call('POST','/api/v1/family/activate',{activationCode:code,memberId:randomUUID(),memberName:'爸爸',deviceName:'手机',publicKey:PUBLIC_KEY,familyId:FAMILY_ID,keyId:KEY_ID,recovery:recoveryFor()})).status,403);
});

test('1.0.8 的主人库升级：主人变管理者，旧令牌照常可用，凭它建一次家庭',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-family-upgrade-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'ai.sqlite'),owner='00000000-0000-4000-8000-000000000001',token=b64url(32);
 const raw=new Database(file);
 raw.exec(`CREATE TABLE members(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,photo_limit INTEGER NOT NULL DEFAULT 100,write_limit INTEGER NOT NULL DEFAULT 20,username TEXT,password_hash TEXT,backup_limit_bytes INTEGER NOT NULL DEFAULT 21474836480);
  CREATE TABLE devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
  INSERT INTO members(id,name,role,username,password_hash) VALUES('${owner}','主人','owner','主人','scrypt2:x');`);
 // 两年前登记的设备：迁移时记为刚用过，不会因为从没记过最后使用时间就一上来过期。
 raw.prepare('INSERT INTO devices VALUES(?,?,?,?,0,?)').run(randomUUID(),owner,'主人手机',sha(token),Date.now()-2*365*86400000);
 raw.close();
 const store=new Store(file),app=createApp(store,async()=>({tokens:1,result:{title:'公园',text:'一起散步。'}}),'test',new BackupStore(join(dir,'backup')),unusedTranscribe);
 t.after(async()=>{await app.close();store.close();});
 const me=await app.inject({url:'/api/v1/me',headers:{authorization:`Bearer ${token}`}});
 assert.equal(me.statusCode,200);assert.equal(me.json().member.role,'admin');assert.ok(!('username' in me.json().member));
 assert.deepEqual((await app.inject({url:'/api/v1/status'})).json(),{initialized:true,family:false});
 assert.equal((await app.inject({url:'/api/v1/family',headers:{authorization:`Bearer ${token}`}})).statusCode,404);
 const payload={publicKey:PUBLIC_KEY,familyId:FAMILY_ID,keyId:KEY_ID,recovery:recoveryFor()};
 const upgraded=await app.inject({method:'POST',url:'/api/v1/family/upgrade',headers:{authorization:`Bearer ${token}`},payload});
 assert.equal(upgraded.statusCode,200);assert.equal(upgraded.json().familyId,FAMILY_ID);
 assert.equal((store.db.prepare('SELECT public_key FROM devices').get() as {public_key:string}).public_key,PUBLIC_KEY);
 // 只有一次。
 assert.equal((await app.inject({method:'POST',url:'/api/v1/family/upgrade',headers:{authorization:`Bearer ${token}`},payload})).statusCode,409);
 // 再开一次库什么也不变。
 store.close();const again=new Store(file);
 assert.equal(again.members()[0]!.role,'admin');assert.equal(again.family()!.familyId,FAMILY_ID);again.close();
});

test('家人不能升级建家庭，也不能开扫码后的申请或批准',async t=>{
 const f=fixture(t);
 const member=addMember(f.store,'外婆','外婆的手机');
 assert.equal((await f.call('POST','/api/v1/family/upgrade',{publicKey:PUBLIC_KEY,familyId:FAMILY_ID,keyId:KEY_ID,recovery:recoveryFor()},member.token)).status,403);
 const r=await f.request();
 assert.equal((await f.call('GET',`/api/v1/pair/requests/${r.id}`,undefined,member.token)).status,403);
 assert.equal((await f.approve(r.id,{id:randomUUID(),name:'妈妈',role:'member'},member.token)).status,403);
 // 没登录的更不行。
 assert.equal((await f.call('GET',`/api/v1/pair/requests/${r.id}`)).status,401);
});

test('扫码加一位新家人：批准时绑定家庭、成员、设备与批准者，新手机凭领取凭据拿令牌，确认后清掉钥匙包',async t=>{
 const f=fixture(t);
 const r=await f.request('妈妈的手机');
 // 管理者看到的公钥与二维码里的一致，封包要用的字段都在。
 const seen=await f.call('GET',`/api/v1/pair/requests/${r.id}`,undefined,f.admin!.token);
 assert.equal(seen.status,200);assert.equal(seen.body.publicKey,r.publicKey);assert.equal(seen.body.deviceName,'妈妈的手机');
 assert.equal(seen.body.familyId,FAMILY_ID);assert.equal(seen.body.keyId,KEY_ID);assert.equal(seen.body.status,'pending');
 // 还没批准：新手机等着。
 assert.equal((await f.collect(r.id,r.claim)).status,202);
 const memberId=randomUUID();
 const approved=await f.approve(r.id,{id:memberId,name:'妈妈',role:'member'});
 assert.equal(approved.status,200);
 assert.deepEqual(approved.body.binding,{familyId:FAMILY_ID,requestId:r.id,memberId,role:'member',deviceId:seen.body.deviceId,deviceName:'妈妈的手机',approverDeviceId:f.admin!.member.deviceId,keyId:KEY_ID,expiresAt:seen.body.expiresAt});
 // 同一条申请不能批两次（重放）。
 assert.equal((await f.approve(r.id,{id:memberId})).status,409);
 // 领取凭据不对：当作没有这条申请。
 assert.equal((await f.collect(r.id,'00'.repeat(16))).status,404);
 const first=await f.collect(r.id,r.claim);
 assert.equal(first.status,200);assert.equal(first.body.status,'approved');
 assert.deepEqual(first.body.binding,approved.body.binding);assert.equal(first.body.member.id,memberId);assert.equal(first.body.member.role,'member');
 assert.ok(first.body.enc&&first.body.ct);
 // 断网重领：发一枚新令牌，旧的那枚作废（只认最后一枚）。
 const second=await f.collect(r.id,r.claim);
 assert.equal((await f.call('GET','/api/v1/me',undefined,first.body.token)).status,401);
 assert.equal((await f.call('GET','/api/v1/me',undefined,second.body.token)).status,200);
 // 确认之前服务端还留着钥匙包；确认后清掉，再领是 410。
 assert.ok((f.store.db.prepare('SELECT ct FROM pair_requests WHERE id=?').get(r.id) as {ct:string|null}).ct);
 assert.equal((await f.call('POST',`/api/v1/pair/requests/${r.id}/confirm`,{},second.body.token)).status,200);
 assert.equal((f.store.db.prepare('SELECT ct FROM pair_requests WHERE id=?').get(r.id) as {ct:string|null}).ct,null);
 assert.equal((await f.collect(r.id,r.claim)).status,410);
 // 确认可以重试，不出错。
 assert.equal((await f.call('POST',`/api/v1/pair/requests/${r.id}/confirm`,{},second.body.token)).status,200);
 // 新手机能用家庭接口，但不是管理者。
 const family=await f.call('GET','/api/v1/family',undefined,second.body.token);
 assert.equal(family.body.me.name,'妈妈');assert.equal(family.body.me.role,'member');
 assert.deepEqual(family.body.members.map((m:{name:string})=>m.name).sort(),['妈妈','爸爸']);
 assert.equal((await f.call('GET','/api/v1/admin/overview',undefined,second.body.token)).status,403);
 // 设备的公钥只取自申请。
 assert.equal((f.store.db.prepare('SELECT public_key FROM devices WHERE id=?').get(seen.body.deviceId) as {public_key:string}).public_key,r.publicKey);
});

test('换手机是给已有家人加设备：不新建家人；新增家人同名要改名',async t=>{
 const f=fixture(t);
 const mom=await f.join({id:randomUUID(),name:'妈妈',role:'member'});
 const r=await f.request('妈妈的新手机');
 // 想「新增」一个也叫妈妈的：拒绝并提示走「已有家人」。
 const dup=await f.approve(r.id,{id:randomUUID(),name:'妈妈',role:'member'});
 assert.equal(dup.status,409);assert.equal(dup.body.code,'NAME_TAKEN');
 // 被拒之后申请仍挂着，改选「给妈妈加一台手机」。
 assert.equal((await f.approve(r.id,{id:mom.member.id})).status,200);
 const got=await f.collect(r.id,r.claim);
 assert.equal(got.body.member.id,mom.member.id);
 assert.equal(f.store.members().filter(m=>m.name==='妈妈').length,1);
 // 新增家人时必须带称呼与角色。
 const r2=await f.request();
 assert.equal((await f.approve(r2.id,{id:randomUUID()})).status,400);
 // 停用的家人不能加设备。
 f.store.editMember(mom.member.id,{enabled:false,photoLimit:1,writeLimit:1});
 assert.equal((await f.approve(r2.id,{id:mom.member.id})).status,409);
});

test('二维码过期、被取消，或批准后 24 小时没确认：都拿不到令牌，没确认的设备作废',async t=>{
 const f=fixture(t);
 const now=Date.now();
 // 过期：10 分钟后再批准是 409，领取是 410。
 const late=await f.request();
 t.mock.method(Date,'now',()=>now+PAIR_TTL_MS+1000);
 assert.equal((await f.approve(late.id,{id:randomUUID(),name:'舅舅',role:'member'})).status,409);
 assert.equal((await f.collect(late.id,late.claim)).status,410);
 t.mock.restoreAll();
 // 新手机自己取消（凭领取凭据）；取消后批不了。
 const cancelled=await f.request();
 assert.equal((await f.call('POST',`/api/v1/pair/requests/${cancelled.id}/cancel`,{claim:'00'.repeat(16)})).status,404);
 assert.equal((await f.call('POST',`/api/v1/pair/requests/${cancelled.id}/cancel`,{claim:cancelled.claim})).status,200);
 assert.equal((await f.approve(cancelled.id,{id:randomUUID(),name:'舅舅',role:'member'})).status,409);
 assert.equal((await f.collect(cancelled.id,cancelled.claim)).status,410);
 // 管理者在批准后、确认前取消：那台设备作废。
 const undone=await f.request();
 assert.equal((await f.approve(undone.id,{id:randomUUID(),name:'舅舅',role:'member'})).status,200);
 const got=await f.collect(undone.id,undone.claim);
 assert.equal((await f.call('POST',`/api/v1/pair/requests/${undone.id}/cancel`,{},f.admin!.token)).status,200);
 assert.equal((await f.call('GET','/api/v1/me',undefined,got.body.token)).status,401);
 // 批准了但新手机一直没确认（比如钥匙串写不进去）：24 小时后令牌失效、申请收掉。
 const stuck=await f.request();
 assert.equal((await f.approve(stuck.id,{id:randomUUID(),name:'姑姑',role:'member'})).status,200);
 const token=(await f.collect(stuck.id,stuck.claim)).body.token;
 assert.equal((await f.call('GET','/api/v1/me',undefined,token)).status,200);
 const later=Date.now()+PAIR_CONFIRM_MS+1000;t.mock.method(Date,'now',()=>later);
 assert.equal((await f.call('GET','/api/v1/me',undefined,token)).status,401);
 assert.equal((await f.collect(stuck.id,stuck.claim)).status,410);
 assert.equal((await f.call('POST',`/api/v1/pair/requests/${stuck.id}/confirm`,{},token)).status,401);
});

test('不需要登录的申请接口有上限与限流；申请本身不带任何权限',async t=>{
 const f=fixture(t);
 for(let i=0;i<PAIR_PENDING_LIMIT;i++){
  f.store.createPair({publicKey:b64url(32),deviceName:`手机${i}`,claimHash:sha(String(i))});
 }
 const full=await f.call('POST','/api/v1/pair/requests',{publicKey:b64url(32),deviceName:'又一台',claimHash:sha('x')});
 assert.equal(full.status,429);
 // 同一地址一分钟内最多登记 10 次（前面那一次也算）。
 f.store.db.prepare("UPDATE pair_requests SET status='cancelled'").run();
 const statuses=[];
 for(let i=0;i<10;i++)statuses.push((await f.call('POST','/api/v1/pair/requests',{publicKey:b64url(32),deviceName:'手机',claimHash:sha(String(i))})).status);
 assert.deepEqual(statuses,[...Array(9).fill(201),429]);
 // 公钥、手机名、领取凭据格式都要对。
 f.store.db.prepare('DELETE FROM pair_requests').run();
 const bad=createApp(f.store,async()=>({tokens:1,result:{title:'公园',text:'一起散步。'}}),'test',new BackupStore(mkdtempSync(join(tmpdir(),'anan-family-bad-'))),unusedTranscribe);
 t.after(()=>bad.close());
 for(const payload of [{publicKey:'short',deviceName:'手机',claimHash:sha('a')},{publicKey:b64url(32),deviceName:'',claimHash:sha('a')},{publicKey:b64url(32),deviceName:'手机',claimHash:'zz'},{publicKey:b64url(32),deviceName:'手机',claimHash:sha('a'),role:'admin'}])
  assert.equal((await bad.inject({method:'POST',url:'/api/v1/pair/requests',payload})).statusCode,400);
 // 还没有家庭的服务不收申请。
 const empty=new Store(':memory:');t.after(()=>empty.close());
 assert.throws(()=>empty.createPair({publicKey:b64url(32),deviceName:'手机',claimHash:sha('a')}),/还没有家庭/);
});

for(const action of ['revoke','disable'] as const) {
 test(`批准后${action}的手机不能再领取钥匙包，重新启用家人也不会恢复未完成的批准`,async t=>{
  const f=fixture(t),memberId=randomUUID(),r=await f.request('外婆的手机');
  assert.equal((await f.approve(r.id,{id:memberId,name:'外婆',role:'member'})).status,200);
  const first=await f.collect(r.id,r.claim);assert.equal(first.status,200);
  const stopped=action==='revoke'
   ?await f.call('DELETE',`/api/v1/admin/devices/${first.body.member.deviceId}`,undefined,f.admin!.token)
   :await f.call('PATCH',`/api/v1/admin/members/${memberId}`,{enabled:false,photoLimit:1,writeLimit:1},f.admin!.token);
  assert.equal(stopped.status,200);
  const denied=await f.collect(r.id,r.claim);
  assert.equal(denied.status,410);assert.equal(denied.body.code,'PAIR_CLOSED');
  assert.ok(!('token' in denied.body));assert.ok(!('ct' in denied.body));
  assert.equal((await f.call('GET','/api/v1/me',undefined,first.body.token)).status,401);
  const closed=f.store.db.prepare('SELECT status,enc,ct FROM pair_requests WHERE id=?').get(r.id) as {status:string;enc:string|null;ct:string|null};
  assert.deepEqual(closed,{status:'cancelled',enc:null,ct:null});
  if(action==='disable') {
   assert.equal((await f.call('PATCH',`/api/v1/admin/members/${memberId}`,{enabled:true,photoLimit:1,writeLimit:1},f.admin!.token)).status,200);
   assert.equal((await f.collect(r.id,r.claim)).status,410);
   assert.equal((await f.call('GET','/api/v1/me',undefined,first.body.token)).status,401);
  }
  const replacement=await f.join({id:memberId},'外婆的新手机');
  assert.equal((await f.call('GET','/api/v1/me',undefined,replacement.token)).status,200);
 });
}

for(const action of ['revoked','disabled'] as const) {
 test(`旧库残留的 approved 申请也不能向${action}手机下发钥匙包`,async t=>{
  const f=fixture(t),memberId=randomUUID(),r=await f.request();
  const approved=await f.approve(r.id,{id:memberId,name:'妈妈',role:'member'});
  assert.equal(approved.status,200);
  if(action==='revoked')f.store.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(approved.body.binding.deviceId);
  else f.store.db.prepare('UPDATE members SET enabled=0 WHERE id=?').run(memberId);
  const denied=await f.collect(r.id,r.claim);
  assert.equal(denied.status,410);assert.equal(denied.body.code,'PAIR_CLOSED');
  assert.ok(!('token' in denied.body));assert.ok(!('ct' in denied.body));
  if(action==='disabled') {
   assert.equal((await f.call('PATCH',`/api/v1/admin/members/${memberId}`,{enabled:true,photoLimit:1,writeLimit:1},f.admin!.token)).status,200);
   assert.equal((await f.collect(r.id,r.claim)).status,410);
  }
 });
}

test('所有管理者手机都没了：凭恢复证明选「我是谁」，登记新管理者手机，挂着的配对作废',async t=>{
 const f=fixture(t);
 const mom=await f.join({id:randomUUID(),name:'妈妈',role:'admin'});
 const pending=await f.request();
 const approvedOnly=await f.request();
 await f.approve(approvedOnly.id,{id:randomUUID(),name:'舅舅',role:'member'});
 const uncle=(await f.collect(approvedOnly.id,approvedOnly.claim)).body.token;
 // 错的恢复码：一句话，不透露任何信息。
 const wrong=await f.call('POST','/api/v1/recovery/claim',{proof:'cd'.repeat(32)});
 assert.equal(wrong.status,403);assert.equal(wrong.body.code,'RECOVERY_INVALID');
 // 第一步只列出管理者。
 const step1=await f.call('POST','/api/v1/recovery/claim',{proof:PROOF});
 assert.equal(step1.status,200);assert.deepEqual(step1.body.admins.map((a:{name:string})=>a.name).sort(),['妈妈','爸爸']);
 // 只能以管理者身份找回。
 const member=addMember(f.store,'外婆','外婆的手机');
 assert.equal((await f.call('POST','/api/v1/recovery/claim',{proof:PROOF,memberId:member.member.id,deviceName:'新手机',publicKey:PUBLIC_KEY})).status,400);
 const done=await f.call('POST','/api/v1/recovery/claim',{proof:PROOF,memberId:f.admin!.member.id,deviceName:'爸爸的新手机',publicKey:PUBLIC_KEY});
 assert.equal(done.status,200);
 assert.equal(done.body.familyId,FAMILY_ID);assert.equal(done.body.keyId,KEY_ID);
 assert.deepEqual(done.body.recovery,{envelope:recoveryFor().envelope,version:1});
 assert.equal(done.body.member.role,'admin');
 assert.equal((await f.call('GET','/api/v1/admin/overview',undefined,done.body.token)).status,200);
 // 挂着的申请与批准未确认的设备都作废；已确认的家人手机不受影响。
 assert.equal((await f.collect(pending.id,pending.claim)).status,410);
 assert.equal((await f.call('GET','/api/v1/me',undefined,uncle)).status,401);
 assert.equal((await f.call('GET','/api/v1/me',undefined,mom.token)).status,200);
});

test('恢复接口严格限流',async t=>{
 const f=fixture(t);
 const statuses=[];
 for(let i=0;i<6;i++)statuses.push((await f.call('POST','/api/v1/recovery/claim',{proof:'cd'.repeat(32)})).status);
 assert.deepEqual(statuses,[403,403,403,403,403,429]);
});

test('重新生成恢复码：版本只能加一、钥匙指纹要对，旧恢复码立刻失效；家人不能换',async t=>{
 const f=fixture(t);
 const member=addMember(f.store,'外婆','外婆的手机');
 const next={keyId:KEY_ID,version:2,...recoveryFor('ef'.repeat(32))};
 assert.equal((await f.call('PUT','/api/v1/admin/recovery',next,member.token)).status,403);
 assert.equal((await f.call('PUT','/api/v1/admin/recovery',{...next,keyId:'fedcba9876543210'},f.admin!.token)).status,409);
 assert.equal((await f.call('PUT','/api/v1/admin/recovery',{...next,version:3},f.admin!.token)).status,409);
 assert.equal((await f.call('PUT','/api/v1/admin/recovery',next,f.admin!.token)).status,200);
 assert.equal((await f.call('POST','/api/v1/recovery/claim',{proof:PROOF})).status,403);
 assert.equal((await f.call('POST','/api/v1/recovery/claim',{proof:'ef'.repeat(32)})).status,200);
 // 另一位管理者拿着旧版本号再换：提示刚被换过。
 assert.equal((await f.call('PUT','/api/v1/admin/recovery',next,f.admin!.token)).status,409);
 assert.equal((await f.call('GET','/api/v1/family',undefined,member.token)).body.recoveryVersion,2);
});

test('至少留一位管理者和一台管理者手机；改称呼不动旧落款',async t=>{
 const f=fixture(t);
 const dad=f.admin!;
 // 唯一的管理者不能停用、不能降级；他唯一的手机不能停用（也不能停用正在用的这台）。
 assert.equal((await f.call('PATCH',`/api/v1/admin/members/${dad.member.id}`,{enabled:false,photoLimit:1,writeLimit:1},dad.token)).status,400);
 assert.equal((await f.call('PUT',`/api/v1/admin/members/${dad.member.id}/profile`,{name:'爸爸',role:'member'},dad.token)).status,400);
 assert.throws(()=>f.store.revoke(dad.member.deviceId!),/最后一台管理者手机/);
 // 萌萌也成了管理者之后，都可以了。
 const mengmeng=await f.join({id:randomUUID(),name:'萌萌',role:'admin'});
 assert.equal((await f.call('DELETE',`/api/v1/admin/devices/${dad.member.deviceId}`,undefined,mengmeng.token)).status,200);
 assert.equal((await f.call('GET','/api/v1/me',undefined,dad.token)).status,401);
 // 现在萌萌的是最后一台管理者手机。
 assert.throws(()=>f.store.revoke(mengmeng.member.deviceId),/最后一台管理者手机/);
 // 改称呼：重名拒绝；角色可改。
 assert.equal((await f.call('PUT',`/api/v1/admin/members/${dad.member.id}/profile`,{name:'萌萌',role:'admin'},mengmeng.token)).status,409);
 assert.equal((await f.call('PUT',`/api/v1/admin/members/${dad.member.id}/profile`,{name:'老爸',role:'member'},mengmeng.token)).status,200);
 assert.equal(f.store.memberById(dad.member.id).name,'老爸');
 // 停用家人：他名下所有设备都失效。
 const grandma=await f.join({id:randomUUID(),name:'外婆',role:'member'},'外婆的手机',mengmeng.token);
 assert.equal((await f.call('PATCH',`/api/v1/admin/members/${grandma.member.id}`,{enabled:false,photoLimit:1,writeLimit:1},mengmeng.token)).status,200);
 assert.equal((await f.call('GET','/api/v1/me',undefined,grandma.token)).status,401);
});

test('一年没用过的手机要重新批准；最后使用时间至多每小时记一次',async t=>{
 const f=fixture(t);
 const member=addMember(f.store,'外婆','外婆的手机'),now=Date.now();
 const used=()=> (f.store.db.prepare('SELECT last_used_at FROM devices WHERE id=?').get(member.member.deviceId) as {last_used_at:number}).last_used_at;
 const start=used();
 t.mock.method(Date,'now',()=>now+30*60*1000);
 assert.equal((await f.call('GET','/api/v1/me',undefined,member.token)).status,200);
 assert.equal(used(),start);
 t.mock.restoreAll();t.mock.method(Date,'now',()=>now+2*3600*1000);
 assert.equal((await f.call('GET','/api/v1/me',undefined,member.token)).status,200);
 assert.equal(used(),now+2*3600*1000);
 t.mock.restoreAll();t.mock.method(Date,'now',()=>now+2*3600*1000+DEVICE_IDLE_MS+1);
 assert.equal((await f.call('GET','/api/v1/me',undefined,member.token)).status,401);
});

for(const state of ['pending','revoked','idle','missing'] as const) {
 test(`其他管理者的手机${state}时，不能退出、停用或降级最后一台有效管理者手机`,async t=>{
  const f=fixture(t),dad=f.admin!;
  const otherId=randomUUID();
  if(state==='pending') {
   const r=await f.request();
   assert.equal((await f.approve(r.id,{id:otherId,name:'妈妈',role:'admin'})).status,200);
  } else {
   f.store.insertMember(otherId,'妈妈','admin');
   if(state!=='missing') {
    const other=f.store.attach(otherId,'妈妈的手机');
    if(state==='revoked')f.store.revoke(other.member.deviceId!);
    else f.store.db.prepare('UPDATE devices SET last_used_at=? WHERE id=?').run(Date.now()-DEVICE_IDLE_MS-1000,other.member.deviceId);
   }
  }
  for(const result of [
   await f.call('POST','/api/v1/me/leave',{},dad.token),
   await f.call('PATCH',`/api/v1/admin/members/${dad.member.id}`,{enabled:false,photoLimit:1,writeLimit:1},dad.token),
   await f.call('PUT',`/api/v1/admin/members/${dad.member.id}/profile`,{name:'老爸',role:'member'},dad.token),
  ]) {
   assert.equal(result.status,400);assert.equal(result.body.code,'LAST_ADMIN_DEVICE');
  }
  const unchanged=f.store.memberById(dad.member.id);
  assert.equal(unchanged.enabled,1);assert.equal(unchanged.role,'admin');assert.equal(unchanged.name,'爸爸');
  assert.equal((await f.call('GET','/api/v1/admin/overview',undefined,dad.token)).status,200);
 });
}

test('另一位管理者有有效手机时，可以停用或降级管理者；普通资料更新不受影响',async t=>{
 for(const action of ['disable','demote'] as const) {
  const f=fixture(t),dad=f.admin!;
  const mom=await f.join({id:randomUUID(),name:'妈妈',role:'admin'});
  const changed=action==='disable'
   ?await f.call('PATCH',`/api/v1/admin/members/${dad.member.id}`,{enabled:false,photoLimit:1,writeLimit:1},mom.token)
   :await f.call('PUT',`/api/v1/admin/members/${dad.member.id}/profile`,{name:'老爸',role:'member'},mom.token);
  assert.equal(changed.status,200);
  assert.equal((await f.call('GET','/api/v1/admin/overview',undefined,mom.token)).status,200);
  assert.equal((await f.call('PATCH',`/api/v1/admin/members/${mom.member.id}`,{enabled:true,photoLimit:2,writeLimit:2},mom.token)).status,200);
  assert.equal((await f.call('PUT',`/api/v1/admin/members/${mom.member.id}/profile`,{name:'萌萌',role:'admin'},mom.token)).status,200);
 }
});

test('部署端最后一招：把一位家人升为管理者',async t=>{
 const f=fixture(t);
 const grandma=addMember(f.store,'外婆','外婆的手机');
 assert.equal(f.store.promote('外婆').role,'admin');
 assert.equal((await f.call('GET','/api/v1/admin/overview',undefined,grandma.token)).status,200);
 assert.throws(()=>f.store.promote('没有的人'),/不存在/);
});

test('管理页看得到每台手机的最后使用时间与待确认状态，看不到令牌或钥匙包',async t=>{
 const f=fixture(t);
 const r=await f.request();
 await f.approve(r.id,{id:randomUUID(),name:'妈妈',role:'member'});
 const got=await f.collect(r.id,r.claim);
 const overview=await f.call('GET','/api/v1/admin/overview',undefined,f.admin!.token);
 const device=overview.body.devices.find((d:{name:string})=>d.name==='妈妈的手机');
 assert.equal(device.pending,1);assert.ok(device.last_used_at>0);assert.equal(device.approved_by,f.admin!.member.deviceId);
 const text=JSON.stringify(overview.body);
 assert.ok(!text.includes(got.body.token));assert.ok(!text.includes(got.body.ct));assert.ok(!text.includes('token_hash'));
});

test('一台手机退出家庭：作废自己的令牌；最后一台管理者手机不能自己退',async t=>{
 const f=fixture(t);
 const grandma=await f.join({id:randomUUID(),name:'外婆',role:'member'});
 assert.equal((await f.call('POST','/api/v1/me/leave',{},grandma.token)).status,200);
 assert.equal((await f.call('GET','/api/v1/me',undefined,grandma.token)).status,401);
 const refused=await f.call('POST','/api/v1/me/leave',{},f.admin!.token);
 assert.equal(refused.status,400);assert.equal(refused.body.code,'LAST_ADMIN_DEVICE');
 assert.equal((await f.call('POST','/api/v1/me/leave',{})).status,401);
});
