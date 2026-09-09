import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, expect, it } from 'vitest';
const directory = mkdtempSync(path.join(tmpdir(), 'ftc-growth-'));
process.env.DATA_DIR = directory;
process.env.AUTH_SECRET = 'growth-fixture-secret-only';
process.env.INITIAL_SETUP_TOKEN = 'growth-setup';
const { getDb, closeDatabase } = await import('@/db');
const { performSetup } = await import('@/lib/auth/setup');
const { user } = await import('@/db/schema/auth');
const { person } = await import('@/db/schema/family');
const { memoryEvent } = await import('@/db/schema/memory');
const { completeOnboarding, getUserBinding } = await import('@/lib/family/service');
const { saveDraft, publishDraft } = await import('@/lib/drafts/service');
const { emptyDraftContent } = await import('@/lib/drafts/model');
const { getGrowthOverview, openGrowthBook } = await import('@/lib/growth/service');
const { createContribution } = await import('@/lib/contributions/service');
const books = await import('@/lib/books/projects/service');
expect((await performSetup({token:'growth-setup',displayName:'爸爸',email:'growth@fixture.invalid',password:'fictional-password'})).ok).toBe(true);
const actor = getDb().select().from(user).get()!;
await completeOnboarding(actor.id,{familyName:'测试家庭',timezone:'Asia/Shanghai',childDisplayName:'小美',childBirthDate:'2026-01-31',selfDisplayName:'爸爸',selfRelationToChild:'爸爸'});
const binding = await getUserBinding(actor.id);
const context = {...binding,userId:actor.id,userName:actor.name,familyId:binding.familyId!,familyTimezone:binding.familyTimezone!,childLaterUnlockAge:binding.childLaterUnlockAge!};
const child = getDb().select().from(person).all().find(p=>p.isChild)!;
function memory(text:string, occurredAt:string, extra = {}) {
  const draft = saveDraft(context,randomUUID(),0,randomUUID(),{...emptyDraftContent(),text,occurredAt,occurredAtPrecision:'date_only',...extra});
  return publishDraft(context,draft.id,draft.revision).memoryEventId!;
}
const early = memory('出生那天抱着你','2026-01-31T00:00:00Z');
const later = memory('窗边的午后','2026-02-27T15:59:00Z');
const next = memory('第二个月的开始','2026-02-27T16:00:00Z');
const privateId = memory('私密句子','2026-02-02T00:00:00Z',{visibility:'private'});
const unknown = memory('日期待补','2026-02-02T00:00:00Z',{occurredAtPrecision:'unknown'});
const beforeBirth = memory('爷爷的旧照片','1980-02-02T00:00:00Z');
const adult = memory('爸爸自己的回忆','2026-02-02T00:00:00Z',{participantIds:[context.personId]});
afterAll(()=>{closeDatabase();rmSync(directory,{recursive:true,force:true});});
it('defaults the child only for relevant records and respects explicit adults',()=>{
  const row=(id:string)=>getDb().select().from(memoryEvent).where(eq(memoryEvent.id,id)).get()!;
  expect(row(early).childPersonId).toBe(child.id);
  expect(row(beforeBirth).childPersonId).toBeNull();
  expect(row(adult).childPersonId).toBeNull();
  expect(row(next).childPersonId).toBe(child.id);
});
it('selects family-visible day-precise memories inside birthday month boundaries',()=>{
  // An explicitly adult-only record must not fall through the legacy sole-child rule.
  expect(getGrowthOverview(context).memoryCount).toBe(2);
  const book = openGrowthBook(context);
  expect(book.title).toBe('小美的第一个月');
  expect(book.startDate).toBe('2026-01-31');
  expect(book.endDate).toBe('2026-02-27');
  expect(book.sources.filter(s=>s.kind==='memory').map(s=>s.memoryEventId).sort()).toEqual([early,later].sort());
  expect(book.sources.some(s=>[privateId,unknown,next,adult].includes(s.memoryEventId!))).toBe(false);
  expect(book.blocks.filter(b=>b.kind==='date').map(b=>book.sourceStates[b.sourceIds[0]!]!.occurredAt)).toEqual([...book.blocks.filter(b=>b.kind==='date').map(b=>book.sourceStates[b.sourceIds[0]!]!.occurredAt)].sort());
  expect(openGrowthBook(context).revision).toBe(book.revision);
});
it('adds new records and signed family words once, preserving edits and removed pages',async()=>{
  let book = openGrowthBook(context);
  const removed = book.sources.find(s=>s.memoryEventId===later)!.id;
  book = books.saveBookProject(context,book.id,book.revision,{...book,subtitle:'愿你慢慢长大',title:'我们手改的书名',blocks:book.blocks.filter(b=>!b.sourceIds.includes(removed))});
  const middle = memory('第一次握紧手指','2026-02-10T00:00:00Z');
  expect((await createContribution(context.familyId,{memoryEventId:early,authorPersonId:context.personId!,recordedByUserId:actor.id,rawText:'爸爸记得那天很温暖'})).ok).toBe(true);
  expect((await createContribution(context.familyId,{memoryEventId:early,authorPersonId:context.personId!,recordedByUserId:actor.id,rawText:'私密话不能进书',visibility:'private'})).ok).toBe(true);
  const reopened = openGrowthBook(context);
  expect(reopened.id).toBe(book.id);
  expect(reopened.subtitle).toBe('愿你慢慢长大');
  expect(reopened.title).toBe('我们手改的书名');
  expect(reopened.blocks.some(b=>b.sourceIds.includes(removed))).toBe(false);
  expect(reopened.sources.some(s=>s.memoryEventId===middle)).toBe(true);
  expect(reopened.blocks.filter(b=>b.text==='爸爸记得那天很温暖')).toHaveLength(1);
  expect(reopened.blocks.some(b=>b.text.includes('私密话不能进书'))).toBe(false);
  expect(openGrowthBook(context).revision).toBe(reopened.revision);
});
it('redacts sources after access changes and rechecks a stale principal',()=>{
  getDb().update(memoryEvent).set({visibility:'private'}).where(eq(memoryEvent.id,early)).run();
  const book = openGrowthBook(context);
  const source = book.sources.find(s=>s.memoryEventId===early)!;
  expect(book.sourceStates[source.id].available).toBe(false);
  getDb().insert(user).values({...actor,id:randomUUID(),email:'backup@fixture.invalid',familyId:context.familyId,role:'admin'}).run();
  getDb().update(user).set({disabledAt:new Date()}).where(eq(user.id,actor.id)).run();
  try { expect(()=>openGrowthBook(context)).toThrow(); } finally {getDb().update(user).set({disabledAt:null}).where(eq(user.id,actor.id)).run();}
  getDb().update(person).set({birthDate:null}).where(eq(person.id,child.id)).run();
  expect(getGrowthOverview(context).pendingBirthday).toBe(true);
  expect(()=>openGrowthBook(context)).toThrow('child_birthday_required');
});
