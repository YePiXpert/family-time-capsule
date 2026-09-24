import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { BackupStore, FAMILY_DIR } from '../src/backup-store.ts';
import { Problem, Store } from '../src/store.ts';

const id=(n:number)=>n.toString(16).padStart(64,'0');
const sha256=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
function fixture(t:TestContext) {
 const root=mkdtempSync(join(tmpdir(),'anan-generation-')),store=new Store(':memory:');
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const live=new BackupStore(root),cli=new BackupStore(root);
 const put=(n:number,body:Buffer)=>live.receive(id(n),Readable.from([body]),{sha256:sha256(body)});
 return {root,store,live,cli,put};
}

test('CLI 清空后常驻实例刷新计数，后续直接上传不会累计已删除对象',async t=>{
 const f=fixture(t);
 await f.put(1,Buffer.alloc(20));
 f.cli.wipe(f.store);
 assert.equal(f.live.stat(id(1)),null);
 assert.deepEqual(f.live.usage(),{objects:0,bytes:0});
 await f.put(2,Buffer.alloc(7));
 assert.deepEqual(f.live.usage(),{objects:1,bytes:7});
 const scan=t.mock.method(f.live,'list',()=>{throw new Error('标记未变时不应扫描对象库');});
 try {assert.deepEqual(f.live.usage(),{objects:1,bytes:7});}
 finally {scan.mock.restore();}
});

for(const sameObject of [false,true])test(`CLI 清空期间在途上传按最新余量提交（${sameObject?'同一':'新'}对象）`,async t=>{
 const f=fixture(t),body=Buffer.alloc(20);
 await f.put(1,body);
 let started!:()=>void,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const stream=Readable.from((async function*(){yield body.subarray(0,1);started();await gate;yield body.subarray(1);})());
 const pending=f.live.receive(id(sameObject?1:2),stream,{sha256:sha256(body),quotaLeft:20});
 await waiting;
 f.cli.wipe(f.store);
 release();
 assert.deepEqual(await pending,{created:true,bytes:20});
 assert.deepEqual(f.live.usage(),{objects:1,bytes:20});
 const extra=Buffer.alloc(1);
 await assert.rejects(f.live.receive(id(3),Readable.from([extra]),{sha256:sha256(extra),quotaLeft:20-f.live.usage().bytes}),
  (error:unknown)=>error instanceof Problem&&error.code==='QUOTA_FULL');
 assert.deepEqual(f.live.usage(),{objects:1,bytes:20});
});

test('CLI 部分删除失败仍让常驻实例按剩余对象校准，不伪报清空成功',async t=>{
 const f=fixture(t);
 await f.put(1,Buffer.alloc(20));await f.put(2,Buffer.alloc(7));
 const original=fs.rmSync,failure=Object.assign(new Error('synthetic deletion failure'),{code:'EACCES'});
 const mock=t.mock.method(fs,'rmSync',(path:Parameters<typeof fs.rmSync>[0],options?:Parameters<typeof fs.rmSync>[1])=>{
  if(path===join(f.root,FAMILY_DIR)){original(f.live.objectPath(id(1)));throw failure;}
  return original(path,options);
 });
 syncBuiltinESMExports();
 try {assert.throws(()=>f.cli.wipe(f.store),error=>error===failure);}
 finally {mock.mock.restore();syncBuiltinESMExports();}
 assert.deepEqual(f.live.usage(),{objects:1,bytes:7});
 assert.deepEqual(f.cli.usage(),{objects:1,bytes:7});
 await f.put(3,Buffer.alloc(3));
 assert.deepEqual(f.live.usage(),{objects:2,bytes:10});
});
