import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { family } from '@/db/schema/family';
import { user, session } from '@/db/schema/auth';
import { memoryEvent, memoryEventAsset, memoryEventReader } from '@/db/schema/memory';
import { asset } from '@/db/schema/asset';
import { draft, draftItem } from '@/db/schema/draft';
import { emptyDraftContent } from '@/lib/drafts/model';
import { collectDraftArchive, parseDraftArchive } from '@/lib/drafts/archive';
import { PUT } from '@/app/api/mobile/v1/drafts/[id]/route';
import { GET as listDrafts } from '@/app/api/mobile/v1/drafts/route';
import { POST as publish } from '@/app/api/mobile/v1/drafts/[id]/publish/route';
import { POST as submit } from '@/app/api/mobile/v1/drafts/[id]/submit/route';
import { PATCH as edit } from '@/app/api/mobile/v1/memories/[id]/route';
import { POST as create } from '@/app/api/uploads/route';
import { PATCH as chunk, HEAD } from '@/app/api/uploads/[id]/route';
import { POST as complete } from '@/app/api/uploads/[id]/complete/route';
const db = getDb();
db.insert(family).values({ id: 'family', name: '编辑测试' }).run();
for (const id of ['a', 'b']) {
  db.insert(user).values({ id, name: id, email: `${id}@fixture.invalid`, role: 'admin', familyId: 'family' }).run();
  db.insert(session).values({ id: randomUUID(), userId: id, token: `atomic-${id}`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const req = (method: string, body?: unknown, actor = 'a') => new Request('http://localhost/api/test', { method, headers: { authorization: `Bearer atomic-${actor}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const route = (id: string) => ({ params: Promise.resolve({ id }) });
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000','hex');
async function fixture() {
  const target = randomUUID(), id = randomUUID(), captureId = randomUUID(), mutationId = randomUUID();
  db.insert(memoryEvent).values({ id: target, familyId: 'family', title: '原来', bodyText: '原文', occurredAt: new Date(), visibility: 'private', createdByUserId: 'a' }).run();
  const content = { ...emptyDraftContent(), visibility: 'private', items: [{ id: randomUUID(), assetId: null, localCaptureRef: captureId, caption: '新照片' }] };
  const registration = { purpose: 'memory_edit', editTargetMemoryId: target, expectedRevision: 0, mutationId, content };
  const saved = await PUT(req('PUT', registration), route(id));
  expect(saved.status).toBe(200);
  const declaration = { captureId, filename: 'edit.png', declaredMime: 'image/png', totalBytes: png.length, lastModified: null, source: 'native', importSessionId: null, draftId: id };
  const response = await create(req('POST', declaration)); expect(response.status).toBe(201);
  const uploadId = (await response.json()).uploadId as string;
  return { target, id, registration, content, declaration, uploadId };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await chunk(new Request('http://localhost/api/test', { method: 'PATCH', headers: { authorization: 'Bearer atomic-a', 'content-type': 'application/offset+octet-stream', 'content-length': String(png.length), 'upload-offset': '0' }, body: png }), route(f.uploadId));
  expect(response.status).toBe(204);
  const done = await complete(req('POST'), route(f.uploadId)); expect(done.ok).toBe(true);
  return (await done.json()).assetId as string;
}
function patch(f: Awaited<ReturnType<typeof fixture>>, assetId: string) {
  return { expectedRevision: 0, mutationId: randomUUID(), title: '改好的标题', bodyText: '改好的全文', visibility: 'members', readerUserIds: ['b'], coverAssetId: assetId, editDraftId: f.id, editDraftRevision: 1, appendItems: f.content.items.map(i => ({ ...i, assetId })) };
}
it('staging is immutable, author/target scoped, private and excluded from normal drafts or submission', async () => {
  const f = await fixture();
  expect((await PUT(req('PUT', f.registration), route(f.id))).status).toBe(200);
  expect((await PUT(req('PUT', { ...f.registration, content: { ...f.content, title: '换了' } }), route(f.id))).status).toBe(409);
  expect((await PUT(req('PUT', { ...f.registration, purpose: 'capture', editTargetMemoryId: null }), route(f.id))).status).toBe(409);
  expect((await PUT(req('PUT', f.registration, 'b'), route(randomUUID()))).status).toBe(404);
  expect((await PUT(req('PUT', { ...f.registration, content: { ...f.content, visibility: 'family' } }), route(randomUUID()))).status).toBe(400);
  expect(JSON.stringify(await (await listDrafts(req('GET'))).json())).not.toContain(f.id);
  for (const handler of [publish, submit]) expect((await handler(req('POST', { expectedRevision: 1 }), route(f.id))).status).toBe(409);
});
it('one commit saves media/body/cover/readers; response-loss replay after another edit never replays the first write', async () => {
  const f = await fixture(), assetId = await upload(f), input = patch(f, assetId);
  const original = db.select().from(asset).where(eq(asset.id, assetId)).get()!;
  expect(original).toMatchObject({ visibility: 'private', createdByUserId: 'a' });
  const saved = await edit(req('PATCH', input), route(f.target)); expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ atomicEditVersion: 1, titleRevision: 1, bodyText: input.bodyText, coverAssetId: assetId, visibility: 'members', mutationReceipt: { mutationId: input.mutationId, resultRevision: 1, replayed: false } });
  expect(db.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, f.target)).all()).toHaveLength(1);
  expect(db.select().from(memoryEventReader).where(eq(memoryEventReader.memoryEventId, f.target)).all().map(r => r.userId)).toEqual(['b']);
  expect(db.select().from(draftItem).where(eq(draftItem.draftId, f.id)).all()).toEqual([]);
  expect(db.select().from(draft).where(eq(draft.id, f.id)).get()?.status).toBe('applied');
  expect(db.select().from(asset).where(eq(asset.id, assetId)).get()).toEqual(original);
  expect(readFileSync(path.join(process.env.DATA_DIR!, original.storageKey))).toEqual(png);
  expect((await HEAD(req('HEAD'), route(f.uploadId))).status).toBe(200);
  expect((await complete(req('POST'), route(f.uploadId))).ok).toBe(true);
  expect((await create(req('POST', { ...f.declaration, captureId: randomUUID() }))).status).toBe(409);
  const later = await edit(req('PATCH', { expectedRevision: 1, mutationId: randomUUID(), bodyText: '后来又补了一句' }), route(f.target)); expect(later.status).toBe(200);
  const replay = await edit(req('PATCH', input), route(f.target)); expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ titleRevision: 2, bodyText: '后来又补了一句', mutationReceipt: { resultRevision: 1, replayed: true } });
  expect(db.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, f.target)).all()).toHaveLength(1);
  expect((await edit(req('PATCH', { ...input, bodyText: '篡改重放' }), route(f.target))).status).toBe(409);
});
it('invalid readers, conflict or wrong receipt leaves all fields and staged references untouched', async () => {
  const f = await fixture(), assetId = await upload(f), input = patch(f, assetId);
  for (const [body, status] of [[{ ...input, readerUserIds: ['missing'] }, 400], [{ ...input, expectedRevision: 99 }, 409], [{ ...input, appendItems: [{ ...input.appendItems[0], localCaptureRef: randomUUID() }] }, 409]] as const) {
    expect((await edit(req('PATCH', body), route(f.target))).status).toBe(status);
    expect(db.select().from(memoryEvent).where(eq(memoryEvent.id, f.target)).get()).toMatchObject({ title: '原来', bodyText: '原文', titleRevision: 0, visibility: 'private', coverAssetId: null });
    expect(db.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, f.target)).all()).toEqual([]);
    expect(db.select().from(draftItem).where(eq(draftItem.draftId, f.id)).all()).toHaveLength(1);
  }
});
it('target deletion and current role revocation stop pending transfers and atomic apply', async () => {
  const f = await fixture();
  db.update(user).set({ role: 'viewer' }).where(eq(user.id, 'a')).run();
  expect((await HEAD(req('HEAD'), route(f.uploadId))).status).toBe(403);
  db.update(user).set({ role: 'admin' }).where(eq(user.id, 'a')).run();
  db.update(memoryEvent).set({ deletedAt: new Date() }).where(eq(memoryEvent.id, f.target)).run();
  expect((await HEAD(req('HEAD'), route(f.uploadId))).status).toBe(404);
  expect((await edit(req('PATCH', { expectedRevision: 0, mutationId: randomUUID(), bodyText: '不能写' }), route(f.target))).status).toBe(404);
});
it('archive v2 keeps completed staged originals and intent, rejects downgrade and fails closed without a target', async () => {
  const f = await fixture(), assetId = await upload(f);
  const archive = collectDraftArchive('family', new Set([f.target])).find(d => d.id === f.id)!;
  expect(archive).toMatchObject({ purpose: 'memory_edit', editTargetMemoryId: f.target, status: 'editing', items: [{ assetId }] });
  const refs = { assets: new Set([assetId]), events: new Set([f.target]), people: new Set<string>(), inbox: new Set<string>() };
  expect(parseDraftArchive([archive], refs, 2)[0]).toEqual(archive);
  expect(() => parseDraftArchive([archive], refs, 1)).toThrow('purpose');
  expect(() => parseDraftArchive([{ ...archive, visibility: 'family' }], refs, 2)).toThrow();
  const orphan = collectDraftArchive('family', new Set()).find(d => d.id === f.id)!;
  expect(orphan).toMatchObject({ purpose: 'memory_edit', editTargetMemoryId: null, status: 'discarded' });
  expect(parseDraftArchive([orphan], { ...refs, events: new Set() }, 2)[0].purpose).toBe('memory_edit');
});
it('staging originals cannot bypass atomic apply via the library, a normal draft or an independent cover patch', async () => {
  const f = await fixture(), assetId = await upload(f);
  const { authorizeApiFamilyRequest } = await import('@/lib/authz/context');
  const { addLibraryAssetsToMemory } = await import('@/lib/assets/library');
  const { deleteLibraryAsset } = await import('@/lib/assets/deletion');
  const { createCollection, addAssetsToCollection, getCollection } = await import('@/lib/collections/service');
  const auth = await authorizeApiFamilyRequest(req('GET').headers, 'event:write');
  if (!auth.ok) throw new Error('fixture auth');
  expect(() => addLibraryAssetsToMemory(auth.context, [assetId], f.target)).toThrow('edit_original_staged');
  expect(() => deleteLibraryAsset(auth.context, assetId, true)).toThrow('asset_in_use');
  const album = createCollection(auth.context, '不能提前分享');
  expect(() => addAssetsToCollection(auth.context, album, getCollection(auth.context, album).revision, [assetId])).toThrow('source_unavailable');
  expect(getCollection(auth.context, album).items).toEqual([]);
  expect((await PUT(req('PUT', { expectedRevision: 0, mutationId: randomUUID(), content: { ...emptyDraftContent(), items: [{ id: randomUUID(), assetId, localCaptureRef: null, caption: '' }] } }), route(randomUUID()))).status).toBe(403);
  expect((await edit(req('PATCH', { expectedRevision: 0, mutationId: randomUUID(), coverAssetId: assetId }), route(f.target))).status).toBe(400);
  expect(db.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, f.target)).all()).toEqual([]);
  expect((await edit(req('PATCH', patch(f, assetId)), route(f.target))).status).toBe(200);
});
it('a rejected widening rolls back provisional body, cover, media links, readers and staging seal', async () => {
  const f = await fixture(), assetId = await upload(f), input = patch(f, assetId);
  const oldAsset = db.select().from(asset).where(eq(asset.id, assetId)).get()!, other = randomUUID();
  db.insert(asset).values({ ...oldAsset, id: other, sha256: randomUUID().replaceAll('-', '').padEnd(64, 'a'), createdByUserId: 'b', visibility: 'private' }).run();
  db.insert(memoryEventAsset).values({ id: randomUUID(), familyId: 'family', memoryEventId: f.target, assetId: other, sortOrder: 0 }).run();
  expect((await edit(req('PATCH', { ...input, visibility: 'family', readerUserIds: [] }), route(f.target))).status).toBe(403);
  expect(db.select().from(memoryEvent).where(eq(memoryEvent.id, f.target)).get()).toMatchObject({ title: '原来', bodyText: '原文', titleRevision: 0, visibility: 'private', coverAssetId: null });
  expect(db.select().from(memoryEventAsset).where(eq(memoryEventAsset.memoryEventId, f.target)).all().map(r => r.assetId)).toEqual([other]);
  expect(db.select().from(memoryEventReader).where(eq(memoryEventReader.memoryEventId, f.target)).all()).toEqual([]);
  expect(db.select().from(draft).where(eq(draft.id, f.id)).get()?.status).toBe('editing');
});
