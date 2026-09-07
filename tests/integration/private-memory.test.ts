import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 正式 1.0 §5 私密记忆：对象级读者（仅自己/指定成员/家庭）全链路隔离。
 * T07 仅自己可见的记忆其他家人无法经列表/详情/搜索/同步/媒体发现；
 * T08 指定成员分享与撤销；T09 私密新素材从上传起不进入全家可见窗口。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-private-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "private-token";
process.env.AUTH_SECRET = "private-memory-test-secret-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "private-token",
  displayName: "作者A",
  email: "author@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { family: familyTable } = await import("@/db/schema/family");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { saveDraft, publishDraft } = await import("@/lib/drafts/service");

const db = getDb();
const authorId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(authorId, {
  familyName: "读者模型家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "作者A",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;

// 第二个成员 B（editor）与第三个成员 C（admin，非作者，验证管理员不是旁路）。
function addUser(name: string, role: string) {
  const id = `user-${name}`;
  db.insert(userTable).values({
    id,
    name,
    email: `${name}@private.example.com`,
    emailVerified: true,
    role,
    familyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();
  return id;
}
const memberB = addUser("b-editor", "editor");
const adminC = addUser("c-admin", "admin");

const {
  getTimelinePage,
  getVisibleMemoryEventDetail,
  updateMemoryEvent,
  updateMemoryEventVisibility,
} = await import("@/lib/memories/service");
const { searchFamily } = await import("@/lib/search/service");
const { getMobileSyncPage } = await import("@/lib/mobile/sync");
const { getCalendarMonth } = await import("@/lib/memories/calendar");
const { canReadContributionAsset } = await import("@/lib/authz/contribution-access");
const { listLibraryAssets } = await import("@/lib/assets/library");

async function contextFor(userId: string) {
  const binding = await getUserBinding(userId);
  if (!binding.familyId || !binding.familyTimezone || binding.childLaterUnlockAge === null) {
    throw new Error("binding unavailable");
  }
  return {
    userId,
    userName: userId,
    familyId: binding.familyId,
    personId: binding.personId,
    role: binding.role,
    accountEnabled: binding.accountEnabled,
    isGuardian: binding.isGuardian,
    familyTimezone: binding.familyTimezone,
    childLaterUnlockAge: binding.childLaterUnlockAge,
  } as import("@/lib/family/context").FamilyContext;
}

let authorContext: import("@/lib/family/context").FamilyContext;
let memberContext: import("@/lib/family/context").FamilyContext;
let adminContext: import("@/lib/family/context").FamilyContext;

beforeAll(async () => {
  authorContext = await contextFor(authorId);
  memberContext = await contextFor(memberB);
  adminContext = await contextFor(adminC);
});

const fixtures = path.join(__dirname, "..", "fixtures");
let salt = 0;
async function privateImage(uploader: string, label: string) {
  const stored = await ingestImage({
    familyId,
    createdByUserId: uploader,
    filename: `${label}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([readFileSync(path.join(fixtures, "sample-exif.jpg")), Buffer.from([++salt])]),
    clientLastModifiedMs: null,
    visibility: "private",
  });
  if (stored.status !== "stored") throw new Error("private store failed");
  return stored.asset.id;
}

async function publishMemory(input: {
  author: import("@/lib/family/context").FamilyContext;
  title: string;
  text: string;
  visibility: "family" | "members" | "private";
  readerUserIds?: string[];
  assetId?: string;
}) {
  const draftId = `draft-${++salt}`;
  const { emptyDraftContent } = await import("@/lib/drafts/model");
  const content = {
    ...emptyDraftContent(),
    title: input.title,
    text: input.text,
    occurredAt: "2026-09-05T10:00:00.000Z",
    visibility: input.visibility,
    readerUserIds: input.readerUserIds ?? [],
    ...(input.assetId ? { items: [{ id: `item-${++salt}`, assetId: input.assetId, localCaptureRef: null, caption: "" }] } : {}),
  };
  saveDraft(input.author, draftId, 0, `mut-${draftId}`, content);
  const published = publishDraft(input.author, draftId, 1);
  if (!published.memoryEventId) throw new Error("publish failed");
  return { eventId: published.memoryEventId, draftId };
}

describe("§5 私密记忆：对象级读者", () => {
  it("T07 仅自己可见的记忆：其他家人无法经时间轴/详情/搜索/同步/媒体发现", async () => {
    const assetId = await privateImage(authorId, "私密照片");
    const { eventId } = await publishMemory({
      author: authorContext, title: "只属于作者的记录", text: "夜里发烧的护理记录",
      visibility: "private", assetId,
    });

    // 作者可见
    expect((await getVisibleMemoryEventDetail(authorContext, eventId))?.event.title).toBe("只属于作者的记录");
    expect((await getTimelinePage(authorContext, { limit: 50 })).entries.map(e => e.event.id)).toContain(eventId);

    // 成员 B：列表/详情/搜索/同步都不可见
    expect(await getVisibleMemoryEventDetail(memberContext, eventId)).toBeUndefined();
    expect((await getTimelinePage(memberContext, { limit: 50 })).entries.map(e => e.event.id)).not.toContain(eventId);
    const bSearch = searchFamily(memberContext, { q: "夜里发烧" });
    expect(bSearch.total).toBe(0);
    const bSync = await getMobileSyncPage({ context: memberContext, limit: 100 });
    expect(bSync.events.map(e => e.id)).not.toContain(eventId);
    // 日历计数不包含
    const bCalendar = await getCalendarMonth(memberContext, "2026-09");
    expect(JSON.stringify(bCalendar)).not.toContain(eventId);
    // 媒体与资料库不可读
    expect(await canReadContributionAsset(
      (await import("@/lib/authz/contribution-access")).createContributionAccessSnapshot(memberContext), assetId,
    )).toBe(false);
    expect((await listLibraryAssets(memberContext, { limit: 100 })).entries.map(e => e.id)).not.toContain(assetId);

    // 作者本人媒体可读
    expect(await canReadContributionAsset(
      (await import("@/lib/authz/contribution-access")).createContributionAccessSnapshot(authorContext), assetId,
    )).toBe(true);
    // 作者能在自己的资料库看到私密原件；家人不能
    expect((await listLibraryAssets(authorContext, { limit: 100 })).entries.map(e => e.id)).toContain(assetId);

    // 管理员 C 不是旁路：私密事件对非作者管理员不可见
    expect(await getVisibleMemoryEventDetail(adminContext, eventId)).toBeUndefined();
    expect(searchFamily(adminContext, { q: "夜里发烧" }).total).toBe(0);

    // 事件编辑守卫：B（editor, event:write）不能编辑不可见事件
    const denied = await updateMemoryEvent(familyId, eventId, memberB, { title: "改标题" }, { role: "editor", accountEnabled: true });
    expect(denied.ok).toBe(false);
    // 作者可以编辑自己的私密事件
    const allowed = await updateMemoryEvent(familyId, eventId, authorId, { title: "只属于作者的记录（改）" }, { role: "admin", accountEnabled: true });
    expect(allowed.ok).toBe(true);
  });

  it("T08 指定成员分享与撤销：授权后可见，撤销后立即失效", async () => {
    const { eventId } = await publishMemory({
      author: authorContext, title: "指定成员可见的记录", text: "给 B 看的家事安排",
      visibility: "private",
    });
    // 扩大读者：private → members(B)
    const current = (await getVisibleMemoryEventDetail(authorContext, eventId))!.event;
    const grant = await updateMemoryEventVisibility(authorContext, eventId, "members", [memberB], current.titleRevision);
    expect(grant.ok).toBe(true);
    // B 现在可见（详情/搜索/时间轴）
    expect((await getVisibleMemoryEventDetail(memberContext, eventId))?.event.title).toBe("指定成员可见的记录");
    expect(searchFamily(memberContext, { q: "家事安排" }).total).toBeGreaterThan(0);
    expect((await getTimelinePage(memberContext, { limit: 50 })).entries.map(e => e.event.id)).toContain(eventId);
    // 未列入的 C（admin）仍不可见
    expect(await getVisibleMemoryEventDetail(adminContext, eventId)).toBeUndefined();

    // 读者管理仅作者：C 不能改可见性
    const byAdmin = await updateMemoryEventVisibility(adminContext, eventId, "family", [], 0);
    expect(byAdmin.ok).toBe(false);
    // 撤销：members → private
    const afterGrant = (await getVisibleMemoryEventDetail(authorContext, eventId))!.event;
    const revoke = await updateMemoryEventVisibility(authorContext, eventId, "private", [], afterGrant.titleRevision);
    expect(revoke.ok).toBe(true);
    expect(await getVisibleMemoryEventDetail(memberContext, eventId)).toBeUndefined();
    expect(searchFamily(memberContext, { q: "家事安排" }).total).toBe(0);
    expect((await getTimelinePage(memberContext, { limit: 50 })).entries.map(e => e.event.id)).not.toContain(eventId);
    // 旧版本号被拒（冲突显式暴露）
    const stale = await updateMemoryEventVisibility(authorContext, eventId, "members", [memberB], 0);
    expect(stale).toMatchObject({ ok: false, error: "conflict" });
    // 非法读者被拒
    const invalid = await updateMemoryEventVisibility(authorContext, eventId, "members", ["user-not-in-family"], afterGrant.titleRevision + 5);
    expect(invalid.ok).toBe(false);
  });

  it("T09 私密原件上传不进入全家可见窗口；重复上传不能探测他人私密原件", async () => {
    const bytes = Buffer.concat([readFileSync(path.join(fixtures, "sample-exif.jpg")), Buffer.from([++salt, 0x50])]);
    // B 上传与 A 私密原件相同字节：不会撞上 A 的原件（去重与授权分离）
    const aPrivate = await ingestImage({ familyId, createdByUserId: authorId, filename: "a-private.jpg", declaredMime: "image/jpeg", buffer: bytes, clientLastModifiedMs: null, visibility: "private" });
    const bSame = await ingestImage({ familyId, createdByUserId: memberB, filename: "b-same-bytes.jpg", declaredMime: "image/jpeg", buffer: bytes, clientLastModifiedMs: null, visibility: "private" });
    expect(aPrivate.status).toBe("stored");
    expect(bSame.status).toBe("stored");
    // 家人 B 看不到 A 的私密原件；自己的能看到
    const bLibrary = (await listLibraryAssets(memberContext, { limit: 100 })).entries.map(e => e.id);
    if (aPrivate.status === "stored") expect(bLibrary).not.toContain(aPrivate.asset.id);
    if (bSame.status === "stored") expect(bLibrary).toContain(bSame.asset.id);

    // 上传路由（HTTP 层）：visibility=private 不建收件箱条目
    const { POST: imageUploadPost } = await import("@/app/api/upload/image/route");
    const { session: sessionTable } = await import("@/db/schema/auth");
    const { randomUUID } = await import("node:crypto");
    const authorToken = `private-route-${randomUUID()}`;
    await db.insert(sessionTable).values({
      id: randomUUID(),
      token: authorToken,
      userId: authorId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const form = new FormData();
    form.append("file", new File([Buffer.concat([readFileSync(path.join(fixtures, "sample-exif.jpg")), Buffer.from([++salt, 0x51])])], "route-private.jpg", { type: "image/jpeg" }));
    form.append("visibility", "private");
    const request = new Request("http://localhost/api/upload/image", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        host: "localhost",
        authorization: `Bearer ${authorToken}`,
        // 路由在解析 formData 前按 Content-Length 拒绝超限，测试提供与
        // URLSession/OkHttp 一致的有限传输契约。
        "content-length": String(readFileSync(path.join(fixtures, "sample-exif.jpg")).byteLength + 4096),
      },
      body: form,
    });
    const response = await imageUploadPost(request);
    expect(response.status).toBe(201);
    const body = await response.json() as { assetId: string; inboxItemId: string | null };
    expect(body.inboxItemId).toBeNull();
    // 私密上传的原件对 B 不可读，也不出现在 B 的资料库
    expect(await canReadContributionAsset(
      (await import("@/lib/authz/contribution-access")).createContributionAccessSnapshot(memberContext), body.assetId,
    )).toBe(false);
    expect((await listLibraryAssets(memberContext, { limit: 100 })).entries.map(e => e.id)).not.toContain(body.assetId);
  });

  it("历史家庭事件保持全家可见（迁移语义）；family 草稿仍走家庭收件箱聚合", async () => {
    const { createTextInboxItem, getInboxEntry } = await import("@/lib/inbox/service");
    const { confirmInboxEntry } = await import("@/lib/memories/service");
    const item = await createTextInboxItem(familyId, "家庭共有的老记录");
    const entry = (await getInboxEntry(familyId, item.id))!;
    const result = await confirmInboxEntry(familyId, entry, { title: "家庭共有的老记录" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await getVisibleMemoryEventDetail(memberContext, result.eventId))?.event.visibility).toBe("family");
    expect((await getTimelinePage(memberContext, { limit: 50 })).entries.map(e => e.event.id)).toContain(result.eventId);

    const familyDraft = await publishMemory({ author: authorContext, title: "全家可见的新记录", text: "给全家的信", visibility: "family" });
    expect((await getVisibleMemoryEventDetail(memberContext, familyDraft.eventId))?.event.title).toBe("全家可见的新记录");
  });
});
