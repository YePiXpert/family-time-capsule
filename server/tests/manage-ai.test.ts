import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { manageAI } from '../src/manage-ai.ts';
import { seedFamily, addMember } from './helpers.ts';

test('AI pause, resume and global limit preserve other persisted settings',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const settings={...store.settings(),globalPhotos:123,globalWrites:17};store.setSettings(settings);
 assert.equal(manageAI(store,['pause']),'已暂停全家 AI。');
 assert.deepEqual(store.settings(),{...settings,paused:true});
 manageAI(store,['limit','global','0']);
 assert.deepEqual(store.settings(),{...settings,paused:true,globalWrites:0});
 assert.equal(manageAI(store,['resume']),'已恢复全家 AI。');
 assert.deepEqual(store.settings(),{...settings,globalWrites:0});
});
test('AI member limit matches the exact name and preserves other member fields',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());seedFamily(store,'爸爸');
 const member=addMember(store,'妈妈','手机').member;
 store.editMember(member.id,{enabled:false,photoLimit:37,writeLimit:8,backupLimitBytes:12345});
 const before=store.memberById(member.id),owner=store.findExactByName('爸爸');
 assert.equal(manageAI(store,['limit','妈妈','0']),'「妈妈」每日文案上限已设为 0 次。');
 assert.deepEqual(store.memberById(member.id),{...before,write_limit:0});
 assert.deepEqual(store.findExactByName('爸爸'),owner);
 assert.throws(()=>manageAI(store,['limit','妈','10']),/不存在或重名/);
 // 旧库可能重名，不能悄悄改其中一人。
 store.db.prepare('INSERT INTO members(id,name,role) VALUES(?,?,?)').run('duplicate','妈妈','member');
 assert.throws(()=>manageAI(store,['limit','妈妈','10']),/不存在或重名/);
 assert.equal(store.memberById(member.id).write_limit,0);
});
test('AI commands reject malformed arguments without changing settings or members',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());seedFamily(store,'爸爸');
 const settings=store.settings(),members=store.members();
 const invalid=[[],['unknown'],['status','extra'],['pause','extra'],['resume','extra'],['limit'],['limit','global'],['limit','global','1','extra']];
 for(const value of ['-1','1.5','NaN','Infinity','1e2','0x10','',' ','1x','9007199254740992'])
  for(const target of ['global','爸爸'])invalid.push(['limit',target,value]);
 for(const args of invalid)assert.throws(()=>manageAI(store,args),/^Error: Usage:/);
 assert.deepEqual(store.settings(),settings);assert.deepEqual(store.members(),members);
});
test('AI status prints only controls and daily usage, including disabled members',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const owner=seedFamily(store,'爸爸'),member=addMember(store,'妈妈','手机').member;
 store.setSettings({...store.settings(),paused:true,globalWrites:42,globalPhotos:123});
 store.editMember(member.id,{enabled:false,photoLimit:37,writeLimit:8});
 const insert=store.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 const today=new Date().toISOString().slice(0,10);
 insert.run(member.id,'failed','private-fingerprint',today,4,1,'model','failed',Date.now(),9,'UPSTREAM');
 insert.run(member.id,'success','private-fingerprint',today,0,1,'model','completed',Date.now(),7,null);
 assert.equal(manageAI(store,['status']),[
  'AI：已暂停',
  '全家每日上限：文案 42 次，照片 123 张；今日文案 1 次，调用 2 次。',
  '「爸爸」：管理者，已启用；每日文案 20 次，照片 100 张；今日文案 0 次，调用 0 次。',
  '「妈妈」：家人，已停用；每日文案 8 次，照片 37 张；今日文案 1 次，调用 2 次。',
  '每日 UTC 00:00 重置；失败不占文案／照片额度，但计入调用次数（每人 200 次／全家 1000 次）。',
 ].join('\n'));
 assert.ok(!manageAI(store,['status']).includes(owner.token));
});
