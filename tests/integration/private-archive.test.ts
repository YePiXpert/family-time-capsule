import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import JSZip from "jszip";
import type { FamilyContext } from "@/lib/family/context";
import type { ArchivePrivacy } from "@/lib/export/privacy.mjs";
const dirs = Array.from({ length: 5 }, () => mkdtempSync(path.join(tmpdir(), "ftc-private-archive-")));
process.env.DATA_DIR = dirs[0];
process.env.AUTH_SECRET = "synthetic-private-archive-secret";
process.env.INITIAL_SETUP_TOKEN = "private-archive-setup";
const source = await import("@/db");
const { family } = await import("@/db/schema/family");
const { user } = await import("@/db/schema/auth");
const { emptyDraftContent } = await import("@/lib/drafts/model");
const drafts = await import("@/lib/drafts/service");
const books = await import("@/lib/books/projects/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { buildActorExport, buildDisasterExport } = await import("@/lib/export/service");
const root = "family-time-capsule-export";
afterAll(() => { source.closeDatabase(); dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); });
it("R08/R09: actor archives exclude hidden graphs and restore private bodies, account readers, personal books and submitted review receipts without guessing identities", async () => {
  const db = source.getDb();
  db.insert(family).values({ id: "family", name: "合成隐私归档家庭", timezone: "UTC" }).run();
  for (const id of ["a", "b", "c"]) db.insert(user).values({ id, name: "同名家人", email: `${id}@fixture.invalid`, familyId: "family", role: id === "b" ? "viewer" : "admin" }).run();
  const a: FamilyContext = { familyId: "family", userId: "a", userName: "同名家人", personId: null, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 };
  const c = { ...a, userId: "c" };
  const photo = async (filename: string) => {
    const result = await ingestImage({ familyId: "family", createdByUserId: "a", filename, declaredMime: "image/jpeg", buffer: readFileSync(path.join(__dirname, "../fixtures", filename)), clientLastModifiedMs: null, visibility: "private" });
    if (result.status !== "stored") throw new Error(result.status);
    return result.asset.id;
  };
  const privatePhoto = await photo("sample-exif.jpg"), reviewPhoto = await photo("sample.jpg"), unsubmittedPhoto = await photo("sample-exif-offset.jpg");
  const body = "不详日期的紫藤信件\n\n这是只有作者保管的完整第二段。";
  const save = (text: string, visibility: "private" | "members" | "family", assetId?: string) => drafts.saveDraft(a, randomUUID(), 0, randomUUID(), { ...emptyDraftContent(), title: "标题与正文不同", text, visibility, occurredAtPrecision: "unknown", readerUserIds: visibility === "members" ? ["b"] : [], items: assetId ? [{ id: randomUUID(), assetId, localCaptureRef: null, caption: "原始说明" }] : [] });
  save("还未提交的全家草稿", "family", unsubmittedPhoto);
  const privateDraft = save(body, "private", privatePhoto), sharedDraft = save("指定账号才能读的正文", "members");
  const privateEvent = drafts.publishDraft(a, privateDraft.id, privateDraft.revision).memoryEventId!;
  const sharedEvent = drafts.publishDraft(a, sharedDraft.id, sharedDraft.revision).memoryEventId!;
  db.run(sql`delete from draft where id=${privateDraft.id}`);
  const reviewDraft = save("已经提交的说明", "family", reviewPhoto);
  const submitted = drafts.submitDraftForReview(a, reviewDraft.id, reviewDraft.revision);
  drafts.saveDraft(a, reviewDraft.id, submitted.revision, randomUUID(), { ...reviewDraft, text: "尚未提交的绝密修改" });
  const bookId = books.createBookProject(a, "私人的紫藤书", "letters", "personal");
  const book = books.getBookProject(a, bookId), ref = books.newBookSource("memory", privateEvent);
  books.saveBookProject(a, bookId, book.revision, { ...book, sources: [ref], blocks: [{ id: randomUUID(), chapterId: book.chapters[0].id, kind: "text", text: body, caption: "", layout: { breakBefore: false, fit: "contain", focus: Array.from({ length: 4 }, () => ({ x: 0.5, y: 0.5 })) }, sourceIds: [ref.id] }] });
  expect(() => books.getBookProject(c, bookId)).toThrow("not_found");
  const own = await buildActorExport(a), other = await buildActorExport(c), disaster = await buildDisasterExport("family");
  const ownBytes = readFileSync(own.filePath), otherBytes = readFileSync(other.filePath);
  const ownZip = await JSZip.loadAsync(ownBytes), otherZip = await JSZip.loadAsync(otherBytes);
  const security = JSON.parse(await ownZip.file(`${root}/privacy.json`)!.async("string")) as ArchivePrivacy;
  const ownerPrincipal = security.events.find(e => e.id === privateEvent)!.owner!;
  const readerPrincipal = security.events.find(e => e.id === sharedEvent)!.readers[0];
  expect(ownerPrincipal).not.toBe(readerPrincipal);
  expect(security.principals).toHaveLength(2);
  expect(security.books.find(b => b.id === bookId)?.owner).toBe(ownerPrincipal);
  const otherText = (await Promise.all(Object.values(otherZip.files).filter(f => !f.dir && /\.(json|md)$/.test(f.name)).map(f => f.async("string")))).join("\n");
  for (const forbidden of ["紫藤", "指定账号才能读", "尚未提交的绝密修改", privateEvent, privatePhoto, unsubmittedPhoto, bookId]) expect(otherText).not.toContain(forbidden);
  expect(otherText).toContain("已经提交的说明");
  expect(JSON.parse(await otherZip.file(`${root}/drafts.json`)!.async("string"))).toEqual([]);
  expect(JSON.parse(await otherZip.file(`${root}/privacy.json`)!.async("string")).reviewAssets).toContainEqual({ inboxItemId: reviewDraft.id, assetId: reviewPhoto });
  for (const file of [own.filePath, other.filePath, disaster.filePath]) {
    const checked = spawnSync(process.execPath, ["scripts/verify-export.mjs", file], { cwd: process.cwd(), encoding: "utf8" });
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  }
  source.closeDatabase();
  async function target(index: number) {
    process.env.DATA_DIR = dirs[index]; vi.resetModules();
    const database = await import("@/db");
    await (await import("@/lib/auth/setup")).performSetup({ token: "private-archive-setup", displayName: "新维护者", email: "restore@fixture.invalid", password: "synthetic-password" });
    const operator = database.getDb().get<{ id: string }>(sql`select id from user`)!;
    return { database, operator, restore: await import("@/lib/restore/service") };
  }
  const first = await target(1);
  const priorGeneration = first.database.getDb().get<{ generation: string }>(sql`select generation from sync_state where id='instance'`)!.generation;
  const instanceService = await import("@/lib/instance/service");
  const priorInstance = await instanceService.getInstanceId();
  try {
    // Every malformed v2 archive fails before family/ownership writes.
    for (const tamper of ["reader", "visibility", "downgrade", "book-owner"]) {
      const zip = await JSZip.loadAsync(ownBytes), privacy = JSON.parse(await zip.file(`${root}/privacy.json`)!.async("string"));
      if (tamper === "reader") privacy.events.find((e: { id: string }) => e.id === sharedEvent).readers = ["missing-principal"];
      if (tamper === "visibility") privacy.drafts.find((d: { id: string }) => d.id === sharedDraft.id).visibility = "private";
      if (tamper === "book-owner") privacy.books[0].owner = null;
      if (tamper === "downgrade") { const manifest = JSON.parse(await zip.file(`${root}/manifest.json`)!.async("string")); manifest.exportVersion = 1; manifest.fileCount--; zip.file(`${root}/manifest.json`, JSON.stringify(manifest)); }
      zip.file(`${root}/privacy.json`, JSON.stringify(privacy));
      await expect(first.restore.restoreFromZip(await zip.generateAsync({ type: "nodebuffer" }), first.operator.id)).rejects.toBeDefined();
      expect(first.database.getDb().all(sql`select id from family`)).toEqual([]);
      expect(first.database.getDb().get<{ generation: string }>(sql`select generation from sync_state where id='instance'`)!.generation).toBe(priorGeneration);
    }
    await first.restore.restoreFromZip(ownBytes, first.operator.id);
    const tdb = first.database.getDb();
    expect(tdb.get<{ generation: string }>(sql`select generation from sync_state where id='instance'`)!.generation).not.toBe(priorGeneration);
    expect(await instanceService.getInstanceId()).toBe(priorInstance);
    tdb.run(sql`update user set family_id='family' where id=${first.operator.id}`);
    const operatorContext = { ...a, userId: first.operator.id, role: "owner" as const };
    const memories = await import("@/lib/memories/service"), access = await import("@/lib/authz/contribution-access");
    expect(await memories.getVisibleMemoryEventDetail(operatorContext, privateEvent)).toBeUndefined();
    expect(await access.canReadContributionAsset(access.createContributionAccessSnapshot(operatorContext), privatePhoto)).toBe(false);
    const recovered = await import("@/lib/restore/principals");
    expect(recovered.listRestoredPrincipals("family").every(p => p.state === "unresolved")).toBe(true);
    const placeholder = recovered.listRestoredPrincipals("family").find(p => p.archivePrincipalId === ownerPrincipal)!.userId;
    try { tdb.run(sql`update user set disabled_at=null where id=${placeholder}`); throw new Error("unexpected_enable"); }
    catch (error) { expect(error).toMatchObject({ cause: { message: "unresolved_restore_principal" } }); }
    expect(tdb.get<{ disabled_at: number | null }>(sql`select disabled_at from user where id=${placeholder}`)?.disabled_at).not.toBeNull();
    const { user: targetUser } = await import("@/db/schema/auth");
    tdb.insert(targetUser).values({ id: "actual-a", name: "同名家人", email: "actual-a@fixture.invalid", familyId: "family", role: "editor" }).run();
    tdb.insert(targetUser).values({ id: "actual-b", name: "同名家人", email: "actual-b@fixture.invalid", familyId: "family", role: "viewer" }).run();
    const restoredA = { ...a, userId: "actual-a", role: "editor" as const }, restoredB = { ...a, userId: "actual-b", role: "viewer" as const };
    expect(await memories.getVisibleMemoryEventDetail(restoredA, privateEvent)).toBeUndefined();
    const bind = spawnSync(process.execPath, ["--conditions=react-server", "--import=tsx", "scripts/restore-principals.ts", "--family", "family", "--bind", ownerPrincipal, "--to", "actual-a", "--operator", first.operator.id], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATA_DIR: dirs[1] } });
    expect(bind.status, bind.stdout + bind.stderr).toBe(0);
    expect(JSON.parse(bind.stdout)).toEqual({ state: "bound", changed: true });
    expect(recovered.bindRestoredPrincipal("family", ownerPrincipal, "actual-a", first.operator.id).changed).toBe(false);
    expect(() => recovered.bindRestoredPrincipal("family", ownerPrincipal, "actual-b", first.operator.id)).toThrow("already_bound");
    expect((await memories.getVisibleMemoryEventDetail(restoredA, privateEvent))?.sourceNotes.map(n => n.rawText)).toEqual([body]);
    expect(await access.canReadContributionAsset(access.createContributionAccessSnapshot(restoredA), privatePhoto)).toBe(true);
    expect(await memories.getVisibleMemoryEventDetail(restoredB, sharedEvent)).toBeUndefined();
    recovered.bindRestoredPrincipal("family", readerPrincipal, "actual-b", first.operator.id);
    expect((await memories.getVisibleMemoryEventDetail(restoredB, sharedEvent))?.sourceNotes.map(n => n.rawText)).toEqual(["指定账号才能读的正文"]);
    expect((await import("@/lib/drafts/service")).getDraft(restoredA, sharedDraft.id).readerUserIds).toEqual(["actual-b"]);
    expect((await import("@/lib/books/projects/service")).getBookProject(restoredA, bookId).blocks[0].text).toBe(body);
    const current = (await memories.getVisibleMemoryEventDetail(restoredA, sharedEvent))!.event;
    expect((await memories.updateMemoryEventVisibility(restoredA, sharedEvent, "private", [], current.titleRevision)).ok).toBe(true);
    expect(await memories.getVisibleMemoryEventDetail(restoredB, sharedEvent)).toBeUndefined();
    expect(tdb.all(sql`pragma foreign_key_check`)).toEqual([]);
  } finally { first.database.closeDatabase(); }
  const second = await target(2);
  try {
    await second.restore.restoreFromZip(otherBytes, second.operator.id);
    second.database.getDb().run(sql`update user set family_id='family' where id=${second.operator.id}`);
    const access = await import("@/lib/authz/contribution-access");
    expect(await access.canReadContributionAsset(access.createContributionAccessSnapshot({ ...a, userId: second.operator.id, role: "owner" }), reviewPhoto)).toBe(true);
    expect(second.database.getDb().all(sql`select id from draft`)).toEqual([]);
    expect(second.database.getDb().get<{ raw_text: string }>(sql`select raw_text from inbox_item where id=${reviewDraft.id}`)?.raw_text).toBe("已经提交的说明");
  } finally { second.database.closeDatabase(); }
  const third = await target(3);
  try {
    const empty = await JSZip.loadAsync(ownBytes), memories = JSON.parse(await empty.file(`${root}/memories.json`)!.async("string"));
    memories.find((m: { id: string }) => m.id === sharedEvent).bodyText = "";
    empty.file(`${root}/memories.json`, JSON.stringify(memories));
    await third.restore.restoreFromZip(await empty.generateAsync({ type: "nodebuffer" }), third.operator.id, { principalBindings: { [ownerPrincipal]: third.operator.id } });
    expect(third.database.getDb().get(sql`select body_text from memory_event where id=${sharedEvent}`)).toEqual({ body_text: "" });
    expect(third.database.getDb().get(sql`select created_by_user_id from memory_event where id=${privateEvent}`)).toEqual({ created_by_user_id: third.operator.id });
  } finally { third.database.closeDatabase(); }
  const legacyTarget = await target(4);
  try {
    const legacy = await JSZip.loadAsync(ownBytes);
    const manifest = JSON.parse(await legacy.file(`${root}/manifest.json`)!.async("string"));
    manifest.exportVersion = 1; manifest.fileCount--;
    for (const name of ["capsules.json", "contribution-requests.json", "contribution-request-submissions.json", "contribution-portal-submissions.json", "review-periods.json", "review-period-events.json"]) legacy.file(`${root}/${name}`, "[]");
    manifest.fileCount += 6;
    legacy.file(`${root}/manifest.json`, JSON.stringify(manifest)); legacy.remove(`${root}/privacy.json`);
    const memories = JSON.parse(await legacy.file(`${root}/memories.json`)!.async("string"));
    for (const m of memories) delete m.bodyText;
    legacy.file(`${root}/memories.json`, JSON.stringify(memories));
    await legacyTarget.restore.restoreFromZip(await legacy.generateAsync({ type: "nodebuffer" }), legacyTarget.operator.id);
    const tdb = legacyTarget.database.getDb();
    tdb.run(sql`update user set family_id='family' where id=${legacyTarget.operator.id}`);
    expect((await import("@/lib/memories/service")).getVisibleMemoryEventDetail({ ...a, role: "owner", userId: legacyTarget.operator.id }, sharedEvent)).toBeUndefined();
    const access = await import("@/lib/authz/contribution-access");
    expect(await access.canReadContributionAsset(access.createContributionAccessSnapshot({ ...a, role: "owner", userId: legacyTarget.operator.id }), unsubmittedPhoto)).toBe(false);
    expect(tdb.get(sql`select body_text,visibility from memory_event where id=${sharedEvent}`)).toEqual({ body_text: "指定账号才能读的正文", visibility: "private" });
  } finally { legacyTarget.database.closeDatabase(); }
});
