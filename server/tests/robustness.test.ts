// 性能与健壮性回归（2026-09-25 重构）：每条都在修复前的代码上失败过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, request } from 'node:http';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { unusedTranscribe, seedFamily, PUBLIC_KEY, PROOF } from './helpers.ts';
import { PAIR_PENDING_LIMIT, PAIR_PENDING_PER_SOURCE, Store } from '../src/store.ts';
import { createApp, isProxyAddress, parseTrustProxy } from '../src/app.ts';
import { BackupStore } from '../src/backup-store.ts';
import { shutdown } from '../src/shutdown.ts';

function fixture(opts:{trustProxy?:string}={}) {
 const dir=mkdtempSync(join(tmpdir(),'anan-robust-'));
 const store=new Store(':memory:'),backups=new BackupStore(dir);
 backups.freeBytes=async()=>10*1024**3;
 const app=createApp(store,async()=>{throw new Error('no provider');},'test',backups,unusedTranscribe,opts);
 const owner=seedFamily(store);
 const close=async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});};
 return {dir,store,backups,app,owner,close};
}

// R1：鉴权在请求体解析之后。匿名请求能让服务把最多 15 MiB 的 JSON 整份解析进堆
// （[{},{},…] 15 MiB 实测单个请求 RSS +530 MiB，4 个并发 1.7 GiB，容器 mem_limit 768m）。
test('R1 unauthenticated requests to device routes are refused before the JSON body is parsed',async t=>{
 const f=fixture();t.after(f.close);
 // 坏 JSON + 无令牌：先鉴权应得 401；现在先解析，得 400。
 for(const url of ['/api/v1/ai/write','/api/v1/backup/prune','/api/v1/backup/objects/have']) {
  const res=await f.app.inject({method:'POST',url,headers:{'content-type':'application/json'},payload:'{'});
  assert.equal(res.statusCode,401,`${url} parsed the body before auth (got ${res.statusCode})`);
 }
});
test('R1 JSON bodies are capped far below the container memory budget; only manifest/prune need MiBs',async t=>{
 const f=fixture();t.after(f.close);
 const big='['+'{},'.repeat(2*1024*1024/3)+'{}]';
 // 匿名端点只需几百字节。
 for(const url of ['/api/v1/pair/requests','/api/v1/recovery/claim','/api/v1/family/activate']) {
  const res=await f.app.inject({method:'POST',url,headers:{'content-type':'application/json'},payload:big});
  assert.equal(res.statusCode,413,`${url} accepted a 2 MiB anonymous JSON body (got ${res.statusCode})`);
 }
});

// R2：SIGTERM 时正在处理的请求用 keep-alive 连接，响应之后连接转为空闲，app.close() 要等 Fastify 的
// keepAliveTimeout（72 s）才结束；docker stop 10 秒后 SIGKILL，store.close() 从来跑不到。
test('R2 app.close() finishes promptly after in-flight keep-alive requests complete',async t=>{
 const f=fixture();
 await f.app.listen({host:'127.0.0.1',port:0});
 const port=(f.app.server.address() as {port:number}).port;
 const agent=new Agent({keepAlive:true});
 t.after(async()=>{agent.destroy();await f.close();});
 const data=randomBytes(1024*1024),sha=createHash('sha256').update(data).digest('hex');
 const req=request({host:'127.0.0.1',port,agent,method:'PUT',path:`/api/v1/backup/objects/${sha}`,headers:{authorization:`Bearer ${f.owner.token}`,'content-type':'application/octet-stream','x-object-sha256':sha,'content-length':data.length}});
 const response=new Promise<number>((resolve,reject)=>{req.on('response',res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);});
 req.write(data.subarray(0,512*1024));
 await new Promise(r=>setTimeout(r,100));
 // 上传在途时开始关停（index.ts 的 SIGTERM 处理就是 app.close()）。
 const closed=f.app.close().then(()=>'closed');
 req.end(data.subarray(512*1024));
 assert.equal(await response,201);
 const outcome=await Promise.race([closed,new Promise(r=>setTimeout(()=>r('still open after 3 s'),3000))]);
 assert.equal(outcome,'closed');
});

// R3：磁盘满时 auth() 每小时一次的 last_used_at 写入失败，整个请求 500——连只读的下载（换机恢复）也不行。
// 用 query_only 模拟写不进（真实 ENOSPC 复现见 bench/db-full.ts）。
test('R3 a failed last-used touch does not turn read-only requests into 500s',async t=>{
 const f=fixture();t.after(f.close);
 f.store.db.prepare('UPDATE devices SET last_used_at=?').run(Date.now()-2*3600000);
 f.store.db.pragma('query_only = ON');
 const res=await f.app.inject({url:`/api/v1/backup/objects/${'a'.repeat(64)}`,headers:{authorization:`Bearer ${f.owner.token}`}});
 assert.equal(res.statusCode,404,`download path failed with ${res.statusCode} ${res.body}`);
});

// R4：接收对象时磁盘写满，原样抛 ENOSPC，路由回 500「服务暂时不可用」而不是 507 SERVER_FULL。需要 root 挂 tmpfs。
test('R4 disk full while receiving an object is reported as SERVER_FULL, and leaves no temp file',async t=>{
 const mount=join(tmpdir(),`anan-full-${process.pid}`);mkdirSync(mount,{recursive:true});
 if(spawnSync('mount',['-t','tmpfs','-o','size=2m','tmpfs',mount]).status!==0){rmSync(mount,{recursive:true,force:true});t.skip('needs root to mount a 2 MiB tmpfs');return;}
 t.after(()=>{spawnSync('umount',[mount]);rmSync(mount,{recursive:true,force:true});});
 const backups=new BackupStore(join(mount,'b'));
 const data=randomBytes(3*1024*1024),sha=createHash('sha256').update(data).digest('hex');
 await assert.rejects(backups.receive(sha,Readable.from([data.subarray(0,1<<20),data.subarray(1<<20,2<<20),data.subarray(2<<20)]),{declared:data.length,sha256:sha}),(e:unknown)=>{
  assert.equal((e as {code?:string}).code,'SERVER_FULL',`got ${(e as Error).message}`);return true;
 });
 assert.deepEqual(readdirSync(join(mount,'b','tmp')),[]);
});

// R5：配对申请从不删除，匿名接口（每分钟 30 次、可自行取消）一天能攒 4 万行；每次配对操作两次全表扫描。
test('R5 closed pair requests are purged and pair lookups do not scan the whole table',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());seedFamily(store);
 const ins=store.db.prepare("INSERT INTO pair_requests(id,device_id,public_key,device_name,claim_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,'cancelled',?,?)");
 const longAgo=Date.now()-30*86400000;
 for(let i=0;i<1000;i++)ins.run(randomUUID(),randomUUID(),PUBLIC_KEY,'手机','ab'.repeat(32),longAgo,longAgo+600000);
 store.createPair({publicKey:PUBLIC_KEY,deviceName:'新手机',claimHash:'cd'.repeat(32)});
 const plan=(store.db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) n FROM pair_requests WHERE status='pending'").all() as {detail:string}[]).map(r=>r.detail).join();
 assert.doesNotMatch(plan,/^SCAN pair_requests$/,'pending count scans every pair request ever made');
 const left=(store.db.prepare("SELECT COUNT(*) n FROM pair_requests WHERE status!='pending'").get() as {n:number}).n;
 assert.ok(left<1000,`${left} month-old closed pair requests are still stored`);
});

// P1：每次 reserve() 数 status='processing' 全表扫描 requests；一年上限 36.5 万行时单次 33 ms（加索引后 0.2 ms）。
test('P1 hot request-table queries use an index',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const plan=(sql:string,...p:unknown[])=>(store.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...p) as {detail:string}[]).map(r=>r.detail).join(' | ');
 assert.doesNotMatch(plan("SELECT COUNT(*) n FROM requests WHERE status='processing'"),/SCAN requests/);
 assert.match(plan('SELECT COUNT(*) n FROM requests WHERE member_id=? AND created_at>?','m',0),/created_at>\?/);
});

// P2：GET /backup/status、/backup/manifests、/admin/overview 每次把全部清单的 objects_json（每份 50k id ≈ 3.3 MB）解析一遍，
// 然后丢掉：6 份时每次 36–48 ms 同步阻塞。视图不应该碰 objects_json。
test('P2 manifest views do not parse the registered object lists',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const {member}=seedFamily(store);
 store.putManifest(member.deviceId!,member.id,'0123456789abcdef','QUJD',['a'.repeat(64)]);
 const parse=JSON.parse;let parsed=0;
 JSON.parse=((text:string,...rest:unknown[])=>{if(typeof text==='string'&&text.startsWith('["'))parsed++;return (parse as (...a:unknown[])=>unknown)(text,...rest);}) as typeof JSON.parse;
 try {
  const latest=store.latestManifest(),active=store.activeManifests(member.id),all=store.manifests();
  assert.equal(latest?.deviceId,member.deviceId);assert.equal(active.length,1);assert.equal(all.length,1);
 } finally {JSON.parse=parse;}
 assert.equal(parsed,0,`objects_json parsed ${parsed} times just to list manifests`);
});

// R6：AI 请求在等上游时收到 SIGTERM，app.close() 会一直等下去（上游最长 100 秒），docker stop 只能 SIGKILL。
test('R6 shutdown drops requests still waiting after the grace period and closes the database',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-robust-'));
 const store=new Store(':memory:'),backups=new BackupStore(dir);
 let release=()=>{};const hanging=new Promise<never>((_,reject)=>{release=()=>reject(new Error('stopped'));});
 const app=createApp(store,()=>hanging,'test',backups,unusedTranscribe);
 const owner=seedFamily(store);
 t.after(()=>{release();rmSync(dir,{recursive:true,force:true});});
 await app.listen({host:'127.0.0.1',port:0});
 const port=(app.server.address() as {port:number}).port;
 const pending=fetch(`http://127.0.0.1:${port}/api/v1/ai/write`,{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),model:'gpt-6-astra',writingMode:'polish',context:'今天去了公园。'})}).then(r=>r.status,()=>'dropped');
 await new Promise(r=>setTimeout(r,100));
 const started=Date.now();
 await shutdown(app,store,300);
 assert.ok(Date.now()-started<2000,`shutdown took ${Date.now()-started} ms`);
 assert.equal(store.db.open,false);
 assert.equal(await pending,'dropped');
});

// R1 的另一面：收紧请求体之后，最大的合法清单（90000 字符索引 + 5 万个对象 id）和整份 keep 仍然收得下。
test('R1 the largest legal manifest and prune bodies still fit their route limits',async t=>{
 const f=fixture();t.after(f.close);
 const headers={authorization:`Bearer ${f.owner.token}`};
 const objects=Array.from({length:50000},(_,i)=>createHash('sha256').update(String(i)).digest('hex'));
 const manifest=await f.app.inject({method:'PUT',url:'/api/v1/backup/manifest',headers,payload:{keyId:'0123456789abcdef',index:'A'.repeat(90000),objects}});
 assert.equal(manifest.statusCode,200,manifest.body);
 const prune=await f.app.inject({method:'POST',url:'/api/v1/backup/prune',headers,payload:{keep:objects}});
 assert.equal(prune.statusCode,200,prune.body);
});

// 审计 2026-09-26 A1：匿名灌请求能把所有人挡在门外。
const pair=(app:ReturnType<typeof fixture>['app'],remoteAddress:string,headers:Record<string,string>={})=>app.inject({method:'POST',url:'/api/v1/pair/requests',remoteAddress,headers,payload:{publicKey:PUBLIC_KEY,deviceName:'x',claimHash:'a'.repeat(64)}});
// 全服务 20 条挂起名额曾是一份：一个地址守着自己每分钟 10 次的额度，两分钟就占满 10 分钟。
test('A1 one anonymous address, staying under its own rate limit, cannot lock new phones out of pairing',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=fixture();t.after(f.close);
 const flood=[];
 for(let i=0;i<10;i++)flood.push((await pair(f.app,'203.0.113.9')).statusCode);
 t.mock.timers.tick(61_000);
 for(let i=0;i<10;i++)flood.push((await pair(f.app,'203.0.113.9')).statusCode);
 assert.equal(flood.filter(status=>status===201).length,PAIR_PENDING_PER_SOURCE);
 const legit=await pair(f.app,'198.51.100.7');
 assert.equal(legit.statusCode,201,`a real new phone from another address got ${legit.statusCode} ${legit.body}`);
 // 来源地址只存带键哈希，离开 pending 就清掉；收掉一条，这个地址又能登记。
 const rows=f.store.db.prepare("SELECT id,source FROM pair_requests WHERE status='pending'").all() as {id:string;source:string}[];
 assert.ok(rows.every(row=>/^[a-f0-9]{64}$/.test(row.source)&&!row.source.includes('203.0.113')));
 f.store.cancelPair(rows[0]!.id);
 assert.equal((f.store.db.prepare('SELECT source FROM pair_requests WHERE id=?').get(rows[0]!.id) as {source:string|null}).source,null);
 t.mock.timers.tick(61_000);
 assert.equal((await pair(f.app,rows[0]!.source===rows[1]!.source?'203.0.113.9':'198.51.100.7')).statusCode,201);
 // 全服务上限还在。
 f.store.db.prepare("UPDATE pair_requests SET source=NULL").run();
 for(let i=0;i<PAIR_PENDING_LIMIT;i++)try{f.store.createPair({publicKey:PUBLIC_KEY,deviceName:'x',claimHash:'b'.repeat(64)});}catch{}
 assert.equal((await pair(f.app,'192.0.2.200')).statusCode,429);
});
// 恢复接口先计数后核对：每分钟 10 个垃圾证明，管理者手里对的恢复码就一直 429。
test('A1 junk recovery proofs cannot make the correct recovery code 429; failures are still throttled',async t=>{
 const f=fixture();t.after(f.close);
 const junk=[];
 for(let i=0;i<12;i++)junk.push((await f.app.inject({method:'POST',url:'/api/v1/recovery/claim',remoteAddress:`203.0.113.${i}`,payload:{proof:'cd'.repeat(32)}})).statusCode);
 assert.deepEqual(junk,[...Array(10).fill(403),429,429]);
 const owner=await f.app.inject({method:'POST',url:'/api/v1/recovery/claim',remoteAddress:'198.51.100.7',payload:{proof:PROOF}});
 assert.equal(owner.statusCode,200,`the admin's correct recovery proof got ${owner.statusCode} ${owner.body}`);
 // 管理者自己抄错一个词：照样被限流，改对了立刻通过。
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/recovery/claim',remoteAddress:'198.51.100.7',payload:{proof:'ef'.repeat(32)}})).statusCode,429);
 assert.equal((await f.app.inject({method:'POST',url:'/api/v1/recovery/claim',remoteAddress:'198.51.100.7',payload:{proof:PROOF}})).statusCode,200);
});
// 反代后面所有人共用反代的地址：按地址的名额只有在认可信反代的 X-Forwarded-For 时才分得开。
test('A1 TRUST_PROXY: only the listed proxy may name the client address; default ignores forwarded headers',async t=>{
 for(const bad of ['true','1','*','10.0.0.0/33','192.0.2.1/8/1','example.invalid'])assert.throws(()=>parseTrustProxy(bad),/TRUST_PROXY/,bad);
 assert.equal(parseTrustProxy(undefined),false);assert.equal(parseTrustProxy(' '),false);
 assert.deepEqual(parseTrustProxy('192.0.2.10, 2001:db8::/32,loopback'),['192.0.2.10','2001:db8::/32','loopback']);
 const proxied=fixture({trustProxy:'192.0.2.10'});t.after(proxied.close);
 for(let i=0;i<PAIR_PENDING_PER_SOURCE;i++)assert.equal((await pair(proxied.app,'192.0.2.10',{'x-forwarded-for':'203.0.113.9'})).statusCode,201);
 assert.equal((await pair(proxied.app,'192.0.2.10',{'x-forwarded-for':'203.0.113.9'})).statusCode,429);
 // 客户端自己塞的转发头挡在反代追加的那一跳后面，改不了身份。
 assert.equal((await pair(proxied.app,'192.0.2.10',{'x-forwarded-for':'198.51.100.7, 203.0.113.9'})).statusCode,429);
 assert.equal((await pair(proxied.app,'192.0.2.10',{'x-forwarded-for':'198.51.100.7'})).statusCode,201);
 // 不在名单里的连接写转发头没用。
 for(let i=0;i<PAIR_PENDING_PER_SOURCE;i++)await pair(proxied.app,'198.51.100.99',{'x-forwarded-for':`192.0.2.${100+i}`});
 assert.equal((await pair(proxied.app,'198.51.100.99',{'x-forwarded-for':'192.0.2.250'})).statusCode,429);
 const direct=fixture();t.after(direct.close);
 for(let i=0;i<PAIR_PENDING_PER_SOURCE;i++)await pair(direct.app,'192.0.2.10',{'x-forwarded-for':`203.0.113.${i}`});
 assert.equal((await pair(direct.app,'192.0.2.10',{'x-forwarded-for':'203.0.113.200'})).statusCode,429);
});
test('A1 without TRUST_PROXY a loopback or private connection is the proxy itself: no per-address share',async t=>{
 const f=fixture();t.after(f.close);
 for(const proxy of ['127.0.0.1','10.1.2.3','::ffff:192.168.1.5']) {
  const codes:number[]=[];
  for(let i=0;i<PAIR_PENDING_PER_SOURCE+1;i++)codes.push((await pair(f.app,proxy)).statusCode);
  assert.deepEqual(codes,codes.map(()=>201),proxy);
 }
 assert.equal(isProxyAddress('192.0.2.10'),false);
 assert.equal(isProxyAddress('fd00::1'),true);
 assert.equal(isProxyAddress('203.0.113.9'),false);
});
test('A1 an existing database gains the pair source column; old pending rows only count toward the global cap',t=>{
 const dir=mkdtempSync(join(tmpdir(),'anan-robust-migrate-')),file=join(dir,'ai.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new Database(file);
 old.exec('CREATE TABLE pair_requests(id TEXT PRIMARY KEY,device_id TEXT NOT NULL UNIQUE,public_key TEXT NOT NULL,device_name TEXT NOT NULL,claim_hash TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,member_id TEXT,approved_by TEXT,enc TEXT,ct TEXT,binding_json TEXT)');
 old.prepare("INSERT INTO pair_requests(id,device_id,public_key,device_name,claim_hash,status,created_at,expires_at) VALUES(?,?,?,'旧手机',?,'pending',?,?)").run(randomUUID(),randomUUID(),PUBLIC_KEY,'ab'.repeat(32),Date.now(),Date.now()+600000);
 old.close();
 const store=new Store(file);t.after(()=>store.close());seedFamily(store);
 assert.ok((store.db.prepare('PRAGMA table_info(pair_requests)').all() as {name:string}[]).some(column=>column.name==='source'));
 for(let i=0;i<PAIR_PENDING_PER_SOURCE;i++)store.createPair({publicKey:PUBLIC_KEY,deviceName:'新手机',claimHash:'cd'.repeat(32)},'203.0.113.9');
 assert.throws(()=>store.createPair({publicKey:PUBLIC_KEY,deviceName:'新手机',claimHash:'cd'.repeat(32)},'203.0.113.9'),/申请太多/);
 assert.equal((store.db.prepare("SELECT COUNT(*) n FROM pair_requests WHERE status='pending'").get() as {n:number}).n,PAIR_PENDING_PER_SOURCE+1);
});
