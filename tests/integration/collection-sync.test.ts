import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {eq} from "drizzle-orm";
import {afterAll,expect,it} from "vitest";
const directory=mkdtempSync(path.join(tmpdir(),"album-sync-"));
process.env.DATA_DIR=directory;process.env.AUTH_SECRET="album-sync-fixture-secret";process.env.INITIAL_SETUP_TOKEN="album-sync-fixture";
const {getDb,closeDatabase}=await import("@/db");
const {performSetup}=await import("@/lib/auth/setup");
const {user}=await import("@/db/schema/auth");
const {collection,collectionItem}=await import("@/db/schema/collection");
const {memoryEvent}=await import("@/db/schema/memory");
const {completeOnboarding,getUserBinding}=await import("@/lib/family/service");
const {saveDraft,publishDraft}=await import("@/lib/drafts/service");
const {emptyDraftContent}=await import("@/lib/drafts/model");
const {syncCollection}=await import("@/lib/collections/sync");
const {getCollection,setCollectionDeleted}=await import("@/lib/collections/service");
expect((await performSetup({token:"album-sync-fixture",displayName:"记录者",email:"album-sync@fixture.invalid",password:"fixture-password-123"})).ok).toBe(true);
const actor=getDb().select().from(user).get()!;
await completeOnboarding(actor.id,{familyName:"测试家庭",timezone:"Asia/Shanghai",childDisplayName:"",childBirthDate:"",selfDisplayName:"家人",selfRelationToChild:"家人"});
const binding=await getUserBinding(actor.id);
const context={...binding,userId:actor.id,userName:actor.name,familyId:binding.familyId!,familyTimezone:binding.familyTimezone!,childLaterUnlockAge:binding.childLaterUnlockAge!};
function memory(text:string){const d=saveDraft(context,randomUUID(),0,randomUUID(),{...emptyDraftContent(),text,occurredAt:"2026-09-01T08:00:00Z"});return publishDraft(context,d.id,d.revision).memoryEventId!;}
const one=memory("第一条"),two=memory("第二条");
afterAll(()=>{closeDatabase();rmSync(directory,{recursive:true,force:true});});
const create=()=>({mutationId:randomUUID(),target:{clientAlbumId:randomUUID(),title:"本机相册",publishMetadata:true as const},items:[{clientItemId:randomUUID(),memoryEventId:one}]});
it("replays lost creation and append replies exactly once, and rejects changed payloads",()=>{
  const command=create(),a=syncCollection(context,command);
  expect(syncCollection(context,command)).toEqual(a);
  expect(getDb().select().from(collection).all()).toHaveLength(1);
  expect(()=>syncCollection(context,{...command,target:{...command.target,title:"改名"}})).toThrow("mutation_reused");
  const add={mutationId:randomUUID(),target:{collectionId:a.id,baseRevision:a.revision},items:[{clientItemId:randomUUID(),memoryEventId:two}]};
  const b=syncCollection(context,add);expect(syncCollection(context,add)).toEqual(b);
  expect(getCollection(context,a.id).items.map(i=>i.memoryEventId)).toEqual([one,two]);
});
it("keeps invisible existing items during an additive sync and refuses unavailable new sources atomically",()=>{
  const a=syncCollection(context,create());
  const other=randomUUID();getDb().insert(user).values({...actor,id:other,email:`${other}@fixture.invalid`,familyId:context.familyId}).run();
  getDb().update(memoryEvent).set({visibility:"private",createdByUserId:other}).where(eq(memoryEvent.id,one)).run();
  try{
    expect(getCollection(context,a.id).items[0]!.source).toBeNull();
    const b=syncCollection(context,{mutationId:randomUUID(),target:{collectionId:a.id,baseRevision:a.revision},items:[{clientItemId:randomUUID(),memoryEventId:two}]});
    expect(getDb().select().from(collectionItem).where(eq(collectionItem.collectionId,a.id)).all().map(i=>i.memoryEventId)).toEqual([one,two]);
    expect(()=>syncCollection(context,{mutationId:randomUUID(),target:{collectionId:a.id,baseRevision:b.revision},items:[{clientItemId:randomUUID(),memoryEventId:one}]})).toThrow("source_unavailable");
    expect(getCollection(context,a.id).revision).toBe(b.revision);
  }finally{getDb().update(memoryEvent).set({visibility:"family",createdByUserId:actor.id}).where(eq(memoryEvent.id,one)).run();}
});
it("requires explicit metadata consent, preserves revisions on conflicts, and rechecks deletion on replay",()=>{
  const command=create();expect(()=>syncCollection(context,{...command,target:{...command.target,publishMetadata:false}})).toThrow("metadata_consent_required");
  const a=syncCollection(context,command);
  expect(()=>syncCollection(context,{mutationId:randomUUID(),target:{collectionId:a.id,baseRevision:a.revision-1},items:[{clientItemId:randomUUID(),memoryEventId:two}]})).toThrow("revision_conflict");
  setCollectionDeleted(context,a.id,a.revision,true);
  expect(()=>syncCollection(context,command)).toThrow("collection_deleted");
  expect(()=>syncCollection({...context,familyId:"foreign"},create())).toThrow("forbidden");
});
