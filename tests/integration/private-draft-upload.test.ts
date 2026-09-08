import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
const { __resetAuthInstanceForTests } = await import('@/lib/auth/auth');
const { getDb, closeDatabase } = await import('@/db');
const { family } = await import('@/db/schema/family');
const { user, session } = await import('@/db/schema/auth');
const { asset } = await import('@/db/schema/asset');
const { inboxItem } = await import('@/db/schema/inbox');
const { emptyDraftContent } = await import('@/lib/drafts/model');
const { PUT, DELETE: discard } = await import('@/app/api/mobile/v1/drafts/[id]/route');
const { POST: create } = await import('@/app/api/uploads/route');
const { PATCH, HEAD, DELETE } = await import('@/app/api/uploads/[id]/route');
const { POST: complete } = await import('@/app/api/uploads/[id]/complete/route');
const { POST: retry } = await import('@/app/api/uploads/[id]/retry/route');
const db = getDb();
db.insert(family).values({id:'family',name:'合成测试'}).run();
for (const id of ['a','b']) {
  db.insert(user).values({id,name:id,email:`${id}@fixture.invalid`,role:'admin',familyId:'family'}).run();
  db.insert(session).values({id:randomUUID(),userId:id,token:`token-${id}`,expiresAt:new Date(Date.now()+3600000)}).run();
}
const req = (actor: string, method: string, body?: unknown) => new Request('http://localhost/api/uploads', {method,headers:{authorization:`Bearer token-${actor}`,'content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
const route = (id:string) => ({params:Promise.resolve({id})});
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000','hex');
async function fixture(visibility = 'private') {
  const id = randomUUID(), captureId = randomUUID();
  const content = {...emptyDraftContent(),text:'时间不详的私密记录',visibility,occurredAtPrecision:'unknown',items:[{id:randomUUID(),assetId:null,localCaptureRef:captureId,caption:''}]};
  expect((await PUT(req('a','PUT',{content,expectedRevision:0,mutationId:randomUUID()}),route(id))).status).toBe(200);
  const declaration = {captureId,filename:'private.png',declaredMime:'image/png',totalBytes:png.length,lastModified:null,source:'native',importSessionId:null,draftId:id};
  const started = await create(req('a','POST',declaration));
  expect(started.status).toBe(201);
  return {id,captureId,declaration,uploadId:(await started.json()).uploadId as string};
}
async function chunk(uploadId:string, bytes=png, offset=0, actor='a') {
  return PATCH(new Request('http://localhost/api/uploads',{method:'PATCH',headers:{authorization:`Bearer token-${actor}`,'content-type':'application/offset+octet-stream','content-length':String(bytes.length),'upload-offset':String(offset)},body:bytes}),route(uploadId));
}
it('R04/R05: every unpublished draft original stays owner-private, with an asset receipt and no family inbox, including lost complete and restart', async () => {
  for (const visibility of ['private','family']) {
    const f = await fixture(visibility);
    expect((await chunk(f.uploadId,png.subarray(0,12))).status).toBe(204);
    closeDatabase(); __resetAuthInstanceForTests();
    expect((await HEAD(req('a','HEAD'),route(f.uploadId))).headers.get('upload-offset')).toBe('12');
    expect((await chunk(f.uploadId,png.subarray(12),12)).status).toBe(204);
    const result = await complete(req('a','POST'),route(f.uploadId));
    expect(result.ok).toBe(true);
    const receipt = await result.json();
    expect(receipt.inboxItemId).toBeNull();
    expect(getDb().select().from(asset).where(eq(asset.id,receipt.assetId)).get()).toMatchObject({visibility:'private',createdByUserId:'a'});
    expect(getDb().select().from(inboxItem).all()).toHaveLength(0);
    closeDatabase(); __resetAuthInstanceForTests();
    expect(await (await complete(req('a','POST'),route(f.uploadId))).json()).toEqual(receipt);
    expect((await (await create(req('a','POST',f.declaration))).json()).assetId).toBe(receipt.assetId);
  }
});
it('R07: another family admin cannot inspect, append, retry, complete, cancel or adopt the upload', async () => {
  const f=await fixture();
  for(const handler of [HEAD,DELETE,complete,retry]) expect((await handler(req('b',handler===HEAD?'HEAD':'POST'),route(f.uploadId))).status).toBe(404);
  expect((await chunk(f.uploadId,png,0,'b')).status).toBe(404);
  expect((await create(req('b','POST',f.declaration))).status).toBe(404);
  expect((await discard(req('a','DELETE',{expectedRevision:1}),route(f.id))).status).toBe(200);
  expect((await chunk(f.uploadId)).status).toBe(409);
  expect((await complete(req('a','POST'),route(f.uploadId))).status).toBe(409);
});

it('only explicit handoff lets another family member preview originals; cleanup still works after deleting a draft',async()=>{
  const {POST:submit}=await import('@/app/api/mobile/v1/drafts/[id]/submit/route');
  const {GET:media}=await import('@/app/api/media/[assetId]/route');
  const {cleanupExpiredUploads}=await import('@/lib/imports/service');
  const {uploadSession}=await import('@/db/schema/import');
  const f=await fixture('family');
  expect((await chunk(f.uploadId)).status).toBe(204);
  const receipt=await (await complete(req('a','POST'),route(f.uploadId))).json();
  const assetRoute={params:Promise.resolve({assetId:receipt.assetId})};
  expect((await media(req('b','GET'),assetRoute)).status).toBe(404);
  const {GET:readDraft}=await import('@/app/api/mobile/v1/drafts/[id]/route');
  const content=await (await readDraft(req('a','GET'),route(f.id))).json();
  content.items[0].assetId=receipt.assetId;
  expect((await PUT(req('a','PUT',{content,expectedRevision:1,mutationId:randomUUID()}),route(f.id))).status).toBe(200);
  expect((await media(req('b','GET'),assetRoute)).status).toBe(404);
  expect((await submit(req('a','POST',{expectedRevision:2}),route(f.id))).status).toBe(200);
  const shared=await media(req('b','GET'),assetRoute);
  expect(shared.status).toBe(200); expect(Buffer.from(await shared.arrayBuffer())).toEqual(png);
  const abandoned=await fixture(); await chunk(abandoned.uploadId,png.subarray(0,12));
  expect((await discard(req('a','DELETE',{expectedRevision:1}),route(abandoned.id))).status).toBe(200);
  getDb().update(uploadSession).set({expiresAt:new Date(0)}).where(eq(uploadSession.id,abandoned.uploadId)).run();
  expect(await cleanupExpiredUploads()).toBeGreaterThanOrEqual(1);
  expect(getDb().select().from(uploadSession).where(eq(uploadSession.id,abandoned.uploadId)).get()?.status).toBe('expired');
  const missing=randomUUID();
  expect((await HEAD(req('a','HEAD'),route(missing))).status).toBe(404);
  expect(existsSync(path.join(process.env.DATA_DIR!,'uploads','.locks',`${missing}.lock`))).toBe(false);
});
it('recovers a completed legacy public receipt without relabeling it private, and narrows an unfinished legacy transfer',async()=>{
  for(const finish of [true,false]) {
    const captureId=randomUUID(),id=randomUUID();
    const declaration={captureId,filename:'legacy.png',declaredMime:'image/png',totalBytes:png.length,lastModified:null,source:'native',importSessionId:null};
    const started=await (await create(req('a','POST',declaration))).json();
    await chunk(started.uploadId);
    if(finish)expect((await complete(req('a','POST'),route(started.uploadId))).ok).toBe(true);
    const content={...emptyDraftContent(),visibility:'private',text:'旧队列',items:[{id:randomUUID(),assetId:null,localCaptureRef:captureId,caption:''}]};
    expect((await PUT(req('a','PUT',{content,expectedRevision:0,mutationId:randomUUID()}),route(id))).status).toBe(200);
    const rebound=await create(req('a','POST',{...declaration,draftId:id}));
    expect(rebound.status).toBe(200);
    const receipt=await (await complete(req('a','POST'),route(started.uploadId))).json();
    expect(getDb().select().from(asset).where(eq(asset.id,receipt.assetId)).get()?.visibility).toBe(finish?'family':'private');
    expect(receipt.inboxItemId === null).toBe(!finish);
  }
});

it('stages new originals after a review submission without exposing them or letting a stale review close the draft', async () => {
  const { POST: submit } = await import('@/app/api/mobile/v1/drafts/[id]/submit/route');
  const { GET: readDraft } = await import('@/app/api/mobile/v1/drafts/[id]/route');
  const { GET: media } = await import('@/app/api/media/[assetId]/route');
  const { getInboxEntry, updateInboxDraft, discardInboxItem } = await import('@/lib/inbox/service');
  const { confirmInboxEntry } = await import('@/lib/memories/service');
  const f = await fixture('family');
  await chunk(f.uploadId);
  const receipt = await (await complete(req('a','POST'), route(f.uploadId))).json();
  const content = await (await readDraft(req('a','GET'), route(f.id))).json();
  content.items[0].assetId = receipt.assetId;
  expect((await PUT(req('a','PUT',{content,expectedRevision:1,mutationId:randomUUID()}),route(f.id))).status).toBe(200);
  expect((await submit(req('a','POST',{expectedRevision:2}),route(f.id))).status).toBe(200);
  const oldReview = (await getInboxEntry('family',f.id))!;
  const captureId = randomUUID(), bytes = Buffer.concat([png,Buffer.from('new-original')]);
  content.text = '尚未重新交给家人的新增正文';
  content.items.push({id:randomUUID(),assetId:null,localCaptureRef:captureId,caption:''});
  expect((await PUT(req('a','PUT',{content,expectedRevision:3,mutationId:randomUUID()}),route(f.id))).status).toBe(200);
  const descriptor = await (await create(req('a','POST',{...f.declaration,captureId,totalBytes:bytes.length}))).json();
  expect((await chunk(descriptor.uploadId,bytes)).status).toBe(204);
  const second = await (await complete(req('a','POST'),route(descriptor.uploadId))).json();
  content.items[1].assetId = second.assetId;
  expect((await PUT(req('a','PUT',{content,expectedRevision:4,mutationId:randomUUID()}),route(f.id))).status).toBe(200);
  expect((await getInboxEntry('family',f.id))?.item.rawText).toBe(oldReview.item.rawText);
  const secondRoute = {params:Promise.resolve({assetId:second.assetId})};
  expect((await media(req('b','GET'),secondRoute)).status).toBe(404);
  expect(await confirmInboxEntry('family',oldReview)).toEqual({ok:false,error:'conflict'});
  expect(await updateInboxDraft('family',f.id,{title:'不能覆盖未提交的作者版本'})).toBeUndefined();
  expect(await discardInboxItem('family',f.id)).toBe(false);
  expect((await (await readDraft(req('a','GET'),route(f.id))).json()).status).toBe('editing');
  expect((await submit(req('a','POST',{expectedRevision:5}),route(f.id))).status).toBe(200);
  expect((await media(req('b','GET'),secondRoute)).status).toBe(200);
  expect(await confirmInboxEntry('family',oldReview)).toEqual({ok:false,error:'conflict'});
  const renewed = (await getInboxEntry('family',f.id))!;
  expect(renewed.item.rawText).toBe(content.text);
  expect(renewed.assets).toHaveLength(2);
  expect((await confirmInboxEntry('family',renewed)).ok).toBe(true);
});
