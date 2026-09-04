import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-mobile-api-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "mobile-api-setup-token";
process.env.AUTH_SECRET = "mobile-api-test-secret-with-sufficient-entropy";
process.env.AUTH_SIGNIN_RATE_LIMIT_MAX = "100";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { session, user } = await import("@/db/schema/auth");
const { family, person } = await import("@/db/schema/family");
const { memoryEvent } = await import("@/db/schema/memory");
const { performSetup } = await import("@/lib/auth/setup");
const { getAuth } = await import("@/lib/auth/auth");
const { addPerson, completeOnboarding, listPeople } = await import(
  "@/lib/family/service"
);
const { createTextInboxItem, getInboxEntry, listInbox } = await import(
  "@/lib/inbox/service"
);
const { confirmInboxEntry } = await import("@/lib/memories/service");
const { GET: syncGet } = await import("@/app/api/mobile/v1/sync/route");
const { POST: textCapturePost } = await import(
  "@/app/api/mobile/v1/captures/text/route"
);
const { POST: imageUploadPost } = await import("@/app/api/upload/image/route");
const { POST: mediaUploadPost } = await import("@/app/api/upload/media/route");
const { GET: homeGet } = await import("@/app/api/mobile/v1/home/route");
const { GET: inboxGet } = await import("@/app/api/mobile/v1/inbox/route");
const { PATCH: inboxPatch } = await import(
  "@/app/api/mobile/v1/inbox/[id]/route"
);
const { POST: inboxConfirmPost } = await import(
  "@/app/api/mobile/v1/inbox/[id]/confirm/route"
);
const { POST: inboxMergePost } = await import(
  "@/app/api/mobile/v1/inbox/merge/route"
);
const { GET: memoryGet, PATCH: memoryPatch } = await import(
  "@/app/api/mobile/v1/memories/[id]/route"
);
const { GET: searchGet } = await import("@/app/api/mobile/v1/search/route");
const { POST: contributionPost } = await import(
  "@/app/api/mobile/v1/memories/[id]/contributions/route"
);
const { PATCH: contributionPatch } = await import(
  "@/app/api/mobile/v1/contributions/[id]/route"
);

const email = "mobile@example.com";
const password = "a-long-mobile-test-password";
let bearerToken = "";
let editorToken = "";
let contributorToken = "";
let viewerToken = "";
let foreignToken = "";
let editorPersonId = "";
let viewerPersonId = "";

function mobileJsonRequest(
  url: string,
  method: "POST" | "PATCH",
  token: string,
  body: Record<string, unknown>,
): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function bearerRequest(url: string, token: string): Request {
  return new Request(url, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function addSessionPrincipal(input: {
  familyId: string;
  personId: string;
  role: "admin" | "editor" | "contributor" | "viewer";
  suffix: string;
}): Promise<string> {
  const now = new Date();
  const userId = randomUUID();
  const token = `${input.suffix}-${randomUUID()}`;
  await getDb().insert(user).values({
    id: userId,
    name: input.suffix,
    email: `${input.suffix}@mobile-api.example.com`,
    emailVerified: true,
    role: input.role,
    familyId: input.familyId,
    personId: input.personId,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return token;
}

function mobileUploadRequest(input: {
  endpoint: "image" | "media";
  token?: string;
  captureId?: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  lastModified?: number | null;
}): Request {
  const form = new FormData();
  form.append(
    "file",
    new File([Uint8Array.from(input.bytes)], input.filename, {
      type: input.mimeType,
    }),
  );
  form.append("filename", input.filename);
  if (input.lastModified !== null) {
    form.append("lastModified", String(input.lastModified ?? 1_788_422_400_000));
  }
  if (input.captureId) form.append("captureId", input.captureId);
  return new Request(`http://localhost/api/upload/${input.endpoint}`, {
    method: "POST",
    headers: {
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      // Native URLSession/OkHttp compute the complete multipart length before
      // sending. Route-level tests supply the same finite transport contract.
      "content-length": String(input.bytes.byteLength + 4096),
    },
    body: form,
  });
}

describe("native mobile API", () => {
  it("boots a family archive and issues a bearer-compatible session", async () => {
    expect(
      await performSetup({
        token: "mobile-api-setup-token",
        displayName: "妈妈",
        email,
        password,
      }),
    ).toEqual({ ok: true });
    const admin = (await getDb().select({ id: user.id }).from(user))[0];
    expect(admin).toBeDefined();
    expect(
      await completeOnboarding(admin!.id, {
        familyName: "小满家",
        timezone: "Asia/Shanghai",
        childDisplayName: "小满",
        childBirthDate: "2024-02-03",
        selfDisplayName: "妈妈",
        selfRelationToChild: "妈妈",
        selfIsGuardian: true,
      }),
    ).toMatchObject({ ok: true });

    const signedIn = await getAuth().api.signInEmail({
      body: { email, password },
    });
    bearerToken = signedIn.token;
    expect(bearerToken.length).toBeGreaterThan(20);
  });

  it("derives every family role and foreign-family access from live bearer bindings", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const editorPerson = await addPerson(admin.familyId!, {
      displayName: "舅舅",
      relationToChild: "舅舅",
    });
    const viewerPerson = await addPerson(admin.familyId!, {
      displayName: "朋友",
      relationToChild: "朋友",
    });
    const contributorPerson = await addPerson(admin.familyId!, {
      displayName: "姑姑",
      relationToChild: "姑姑",
    });
    if (!editorPerson.ok || !viewerPerson.ok || !contributorPerson.ok) throw new Error("people setup failed");
    editorPersonId = editorPerson.personId;
    viewerPersonId = viewerPerson.personId;
    editorToken = await addSessionPrincipal({
      familyId: admin.familyId!,
      personId: editorPersonId,
      role: "editor",
      suffix: "mobile-editor",
    });
    contributorToken = await addSessionPrincipal({
      familyId: admin.familyId!,
      personId: contributorPerson.personId,
      role: "contributor",
      suffix: "mobile-contributor",
    });
    viewerToken = await addSessionPrincipal({
      familyId: admin.familyId!,
      personId: viewerPersonId,
      role: "viewer",
      suffix: "mobile-viewer",
    });

    const now = new Date();
    const foreignFamilyId = randomUUID();
    const foreignChildId = randomUUID();
    const foreignAdultId = randomUUID();
    await getDb().insert(family).values({
      id: foreignFamilyId,
      name: "另一个家庭",
      timezone: "Asia/Shanghai",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(person).values([
      {
        id: foreignChildId,
        familyId: foreignFamilyId,
        displayName: "另一个孩子",
        isChild: true,
        birthDate: "2024-01-01",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: foreignAdultId,
        familyId: foreignFamilyId,
        displayName: "另一个管理员",
        isChild: false,
        isGuardian: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    foreignToken = await addSessionPrincipal({
      familyId: foreignFamilyId,
      personId: foreignAdultId,
      role: "admin",
      suffix: "mobile-foreign-admin",
    });

    const [adminHome, editorHome, contributorHome, viewerHome] = await Promise.all([
      homeGet(bearerRequest("http://localhost/api/mobile/v1/home", bearerToken)),
      homeGet(bearerRequest("http://localhost/api/mobile/v1/home", editorToken)),
      homeGet(bearerRequest("http://localhost/api/mobile/v1/home", contributorToken)),
      homeGet(bearerRequest("http://localhost/api/mobile/v1/home", viewerToken)),
    ]);
    expect([adminHome.status, editorHome.status, contributorHome.status, viewerHome.status]).toEqual([
      200,
      200,
      200,
      200,
    ]);
    await expect(adminHome.json()).resolves.toMatchObject({
      family: { name: "小满家" },
      capabilities: { canCapture: true },
    });
    await expect(editorHome.json()).resolves.toMatchObject({
      capabilities: { canCapture: true },
    });
    await expect(contributorHome.json()).resolves.toMatchObject({
      capabilities: { canCapture: true },
    });
    await expect(viewerHome.json()).resolves.toMatchObject({
      capabilities: { canCapture: false },
    });
    expect(viewerHome.headers.get("cache-control")).toBe("private, no-store");

    const syncViewers = await Promise.all(
      [bearerToken, editorToken, contributorToken, viewerToken].map(async (token) => {
        const response = await syncGet(bearerRequest("http://localhost/api/mobile/v1/sync", token));
        expect(response.status).toBe(200);
        return (await response.json()) as { viewer: Record<string, unknown> };
      }),
    );
    expect(syncViewers.map((body) => body.viewer)).toEqual([
      expect.objectContaining({ role: "admin", canCapture: true, canReviewInbox: true, canCreateContributions: true, canEditEvents: true }),
      expect.objectContaining({ role: "editor", canCapture: true, canReviewInbox: true, canCreateContributions: true, canEditEvents: true }),
      expect.objectContaining({ role: "contributor", canCapture: true, canReviewInbox: false, canCreateContributions: true, canEditEvents: false }),
      expect.objectContaining({ role: "viewer", canCapture: false, canReviewInbox: false, canCreateContributions: false, canEditEvents: false }),
    ]);
  });

  it("pages, edits and confirms inbox entries while viewer and cross-family writes fail closed", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const people = await listPeople(admin.familyId!);
    const childId = people.find((entry) => entry.isChild)!.id;
    const item = await createTextInboxItem(admin.familyId!, "需要整理的原生文字");
    await createTextInboxItem(admin.familyId!, "分页中的另一条素材");

    const firstPage = await inboxGet(
      bearerRequest("http://localhost/api/mobile/v1/inbox?limit=1", bearerToken),
    );
    expect(firstPage.status).toBe(200);
    const pageBody = (await firstPage.json()) as {
      entries: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(pageBody.entries).toHaveLength(1);
    expect(pageBody.nextCursor).toBeTruthy();

    const viewerPage = await inboxGet(
      bearerRequest("http://localhost/api/mobile/v1/inbox?limit=50", viewerToken),
    );
    expect(viewerPage.status).toBe(200);
    await expect(viewerPage.json()).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ id: item.id, title: "需要整理的原生文字" }),
      ]),
    });

    const viewerDenied = await inboxPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/inbox/${item.id}`,
        "PATCH",
        viewerToken,
        { title: "越权修改" },
      ),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(viewerDenied.status).toBe(403);
    const contributorDenied = await inboxPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/inbox/${item.id}`,
        "PATCH",
        contributorToken,
        { title: "贡献者越权整理" },
      ),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(contributorDenied.status).toBe(403);
    const foreignDenied = await inboxPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/inbox/${item.id}`,
        "PATCH",
        foreignToken,
        { title: "跨家庭修改" },
      ),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(foreignDenied.status).toBe(404);

    const occurredAt = "2026-09-01T08:30:00.000Z";
    const edited = await inboxPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/inbox/${item.id}`,
        "PATCH",
        editorToken,
        {
          title: "原生端整理完成",
          occurredAtWall: "2026-09-01T16:30",
          locationText: "外婆家",
          participantPersonIds: [editorPersonId],
        },
      ),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(edited.status).toBe(200);
    await expect(edited.json()).resolves.toMatchObject({
      entry: {
        id: item.id,
        title: "原生端整理完成",
        occurredAt,
        occurredAtWall: "2026-09-01T16:30",
        locationText: "外婆家",
        participantPersonIds: [editorPersonId],
      },
    });

    const confirmed = await inboxConfirmPost(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/inbox/${item.id}/confirm`,
        "POST",
        editorToken,
        {},
      ),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(confirmed.status).toBe(201);
    const confirmedBody = (await confirmed.json()) as { memoryEventId: string };
    const detail = await memoryGet(
      bearerRequest(
        `http://localhost/api/mobile/v1/memories/${confirmedBody.memoryEventId}`,
        bearerToken,
      ),
      { params: Promise.resolve({ id: confirmedBody.memoryEventId }) },
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: confirmedBody.memoryEventId,
      title: "原生端整理完成",
      occurredAt,
      occurredAtWall: "2026-09-01T16:30",
      locationText: "外婆家",
      participantPersonIds: expect.arrayContaining([childId, editorPersonId]),
      sourceNotes: [{ text: "需要整理的原生文字" }],
    });
  });

  it("merges inbox selections, edits memories, searches, and enforces event permissions", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const first = await createTextInboxItem(admin.familyId!, "合并片段甲");
    const second = await createTextInboxItem(admin.familyId!, "合并片段乙");
    const merged = await inboxMergePost(
      mobileJsonRequest(
        "http://localhost/api/mobile/v1/inbox/merge",
        "POST",
        editorToken,
        {
          itemIds: [first.id, second.id],
          title: "原生端合并记忆",
          occurredAtWall: "2026-09-01T23:55",
          participantPersonIds: [editorPersonId],
        },
      ),
    );
    expect(merged.status).toBe(201);
    const mergedBody = (await merged.json()) as { memoryEventId: string };

    const viewerWrite = await memoryPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${mergedBody.memoryEventId}`,
        "PATCH",
        viewerToken,
        { title: "viewer 不应成功" },
      ),
      { params: Promise.resolve({ id: mergedBody.memoryEventId }) },
    );
    expect(viewerWrite.status).toBe(403);
    const crossFamilyRead = await memoryGet(
      bearerRequest(
        `http://localhost/api/mobile/v1/memories/${mergedBody.memoryEventId}`,
        foreignToken,
      ),
      { params: Promise.resolve({ id: mergedBody.memoryEventId }) },
    );
    expect(crossFamilyRead.status).toBe(404);
    const crossFamilyWrite = await memoryPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${mergedBody.memoryEventId}`,
        "PATCH",
        foreignToken,
        { title: "跨家庭写入" },
      ),
      { params: Promise.resolve({ id: mergedBody.memoryEventId }) },
    );
    expect(crossFamilyWrite.status).toBe(404);

    const edited = await memoryPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${mergedBody.memoryEventId}`,
        "PATCH",
        editorToken,
        {
          title: "原生端合并后修改",
          occurredAtWall: "2026-09-02T00:05",
          locationText: "植物园",
        },
      ),
      { params: Promise.resolve({ id: mergedBody.memoryEventId }) },
    );
    expect(edited.status).toBe(200);
    await expect(edited.json()).resolves.toMatchObject({
      id: mergedBody.memoryEventId,
      title: "原生端合并后修改",
      occurredAt: "2026-09-01T16:05:00.000Z",
      occurredAtWall: "2026-09-02T00:05",
      locationText: "植物园",
    });

    const search = await searchGet(
      bearerRequest(
        "http://localhost/api/mobile/v1/search?q=%E5%8E%9F%E7%94%9F%E7%AB%AF%E5%90%88%E5%B9%B6%E5%90%8E%E4%BF%AE%E6%94%B9&limit=1",
        viewerToken,
      ),
    );
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({
      items: [
        {
          type: "memory",
          id: mergedBody.memoryEventId,
          title: "原生端合并后修改",
        },
      ],
    });
  });

  it("applies contribution visibility and author-owned editing on mobile detail", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const adminPersonId = admin.personId!;
    const childId = (await listPeople(admin.familyId!)).find((entry) => entry.isChild)!.id;
    const item = await createTextInboxItem(admin.familyId!, "讲述权限对应的记忆");
    const entry = (await getInboxEntry(admin.familyId!, item.id))!;
    const event = await confirmInboxEntry(admin.familyId!, entry, {
      title: "讲述可见性记忆",
    });
    if (!event.ok) throw new Error("event setup failed");

    const privateResponse = await contributionPost(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${event.eventId}/contributions`,
        "POST",
        bearerToken,
        {
          authorPersonId: adminPersonId,
          text: "管理员自己的私密讲述",
          visibility: "private",
        },
      ),
      { params: Promise.resolve({ id: event.eventId }) },
    );
    expect(privateResponse.status).toBe(201);
    const privateBody = (await privateResponse.json()) as { contributionId: string };

    const familyResponse = await contributionPost(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${event.eventId}/contributions`,
        "POST",
        editorToken,
        {
          authorPersonId: editorPersonId,
          text: "全家可见的讲述",
          visibility: "family",
        },
      ),
      { params: Promise.resolve({ id: event.eventId }) },
    );
    expect(familyResponse.status).toBe(201);

    const viewerCreate = await contributionPost(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${event.eventId}/contributions`,
        "POST",
        viewerToken,
        {
          authorPersonId: viewerPersonId,
          text: "viewer 不可新增",
          visibility: "family",
        },
      ),
      { params: Promise.resolve({ id: event.eventId }) },
    );
    expect(viewerCreate.status).toBe(403);

    const [adminDetail, viewerDetail] = await Promise.all([
      memoryGet(
        bearerRequest(
          `http://localhost/api/mobile/v1/memories/${event.eventId}`,
          bearerToken,
        ),
        { params: Promise.resolve({ id: event.eventId }) },
      ),
      memoryGet(
        bearerRequest(
          `http://localhost/api/mobile/v1/memories/${event.eventId}`,
          viewerToken,
        ),
        { params: Promise.resolve({ id: event.eventId }) },
      ),
    ]);
    const adminBody = (await adminDetail.json()) as {
      contributions: Array<{ id: string; text: string }>;
    };
    const viewerBody = (await viewerDetail.json()) as {
      contributions: Array<{ id: string; text: string }>;
    };
    expect(adminBody.contributions.map((item) => item.text)).toEqual(
      expect.arrayContaining(["管理员自己的私密讲述", "全家可见的讲述"]),
    );
    expect(viewerBody.contributions.map((item) => item.text)).toEqual([
      "全家可见的讲述",
    ]);

    const edited = await contributionPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/contributions/${privateBody.contributionId}`,
        "PATCH",
        bearerToken,
        { text: "私密讲述已修改" },
      ),
      { params: Promise.resolve({ id: privateBody.contributionId }) },
    );
    expect(edited.status).toBe(200);
    const crossFamilyEdit = await contributionPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/contributions/${privateBody.contributionId}`,
        "PATCH",
        foreignToken,
        { text: "跨家庭修改" },
      ),
      { params: Promise.resolve({ id: privateBody.contributionId }) },
    );
    expect(crossFamilyEdit.status).toBe(404);
    expect(childId).toBeTruthy();
  });

  it("never returns soft-deleted memories from home, detail or search", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const item = await createTextInboxItem(admin.familyId!, "只用于删除回归的唯一字样");
    const entry = (await getInboxEntry(admin.familyId!, item.id))!;
    const confirmed = await confirmInboxEntry(admin.familyId!, entry, {
      title: "已删除移动回归唯一字样",
    });
    if (!confirmed.ok) throw new Error("deleted event setup failed");
    await getDb()
      .update(memoryEvent)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where((await import("drizzle-orm")).eq(memoryEvent.id, confirmed.eventId));

    const detail = await memoryGet(
      bearerRequest(
        `http://localhost/api/mobile/v1/memories/${confirmed.eventId}`,
        bearerToken,
      ),
      { params: Promise.resolve({ id: confirmed.eventId }) },
    );
    expect(detail.status).toBe(404);
    const edit = await memoryPatch(
      mobileJsonRequest(
        `http://localhost/api/mobile/v1/memories/${confirmed.eventId}`,
        "PATCH",
        bearerToken,
        { title: "不应复活" },
      ),
      { params: Promise.resolve({ id: confirmed.eventId }) },
    );
    expect(edit.status).toBe(404);
    const home = await homeGet(
      bearerRequest("http://localhost/api/mobile/v1/home", bearerToken),
    );
    const homeBody = (await home.json()) as {
      recentMemories: Array<{ id: string }>;
      onThisDay: Array<{ id: string }>;
    };
    expect(homeBody.recentMemories.some((event) => event.id === confirmed.eventId)).toBe(false);
    expect(homeBody.onThisDay.some((event) => event.id === confirmed.eventId)).toBe(false);
    const search = await searchGet(
      bearerRequest(
        "http://localhost/api/mobile/v1/search?q=%E5%B7%B2%E5%88%A0%E9%99%A4%E7%A7%BB%E5%8A%A8%E5%9B%9E%E5%BD%92%E5%94%AF%E4%B8%80%E5%AD%97%E6%A0%B7",
        bearerToken,
      ),
    );
    const searchBody = (await search.json()) as { items: Array<{ id: string }> };
    expect(searchBody.items.some((event) => event.id === confirmed.eventId)).toBe(false);
  });

  it("returns a minimized timeline snapshot through Authorization bearer", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const item = await createTextInboxItem(
      admin.familyId!,
      "第一次在原生客户端看到时间轴。",
    );
    const entry = await getInboxEntry(admin.familyId!, item.id);
    expect(entry).toBeDefined();
    const confirmed = await confirmInboxEntry(admin.familyId!, entry!);
    expect(confirmed).toMatchObject({
      ok: true,
    });
    if (!confirmed.ok) throw new Error("mobile sync event setup failed");

    const response = await syncGet(
      new Request("http://localhost/api/mobile/v1/sync?limit=50", {
        headers: { authorization: `Bearer ${bearerToken}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as {
      apiVersion: number;
      family: { name: string };
      viewer: { canCapture: boolean };
      people: unknown[];
      events: Array<{ id: string; title: string; occurredAt: string; captureIds: string[] }>;
    };
    expect(body.apiVersion).toBe(1);
    expect(body.family.name).toBe("小满家");
    expect(body.viewer.canCapture).toBe(true);
    expect(body.people.length).toBeGreaterThanOrEqual(4);
    const nativeEvent = body.events.find(
      (event) => event.title === "第一次在原生客户端看到时间轴。",
    );
    expect(nativeEvent).toBeDefined();
    expect(new Date(nativeEvent!.occurredAt).toString()).not.toBe("Invalid Date");
    expect(nativeEvent).toMatchObject({
      id: confirmed.eventId,
      captureIds: [item.id],
    });
  });

  it("queues offline text idempotently and rejects an id reused for other content", async () => {
    const id = "8f181908-885d-4c65-b4cb-999ac07bd24c";
    const request = (text: string) =>
      new Request("http://localhost/api/mobile/v1/captures/text", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id, text }),
      });

    expect((await textCapturePost(request("离线写下的一句话"))).status).toBe(201);
    expect((await textCapturePost(request("离线写下的一句话"))).status).toBe(200);
    expect((await textCapturePost(request("同 ID 的其他内容"))).status).toBe(409);
    const inbox = await listInbox((await getDb().select().from(user))[0]!.familyId!);
    expect(inbox.filter((entry) => entry.item.id === id)).toHaveLength(1);
  });

  it("accepts native bearer photo, video and direct-audio uploads exactly once", async () => {
    const familyId = (await getDb().select().from(user))[0]!.familyId!;
    const image = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg"));
    const video = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.mp4"));
    const audio = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.wav"));
    const imageCaptureId = "6fc7bc1f-0235-4b58-bcd7-a0c4dc65d501";
    const videoCaptureId = "0208c79d-8959-4a9e-ad97-3b4c67359618";
    const audioCaptureId = "af58f87f-ffad-42f2-a697-f5960e14c6f1";

    const firstImage = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId: imageCaptureId,
        filename: "native-offline-photo.jpg",
        mimeType: "image/jpeg",
        bytes: image,
      }),
    );
    expect(firstImage.status).toBe(201);
    await expect(firstImage.json()).resolves.toMatchObject({ status: "stored" });

    const repeatedImage = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId: imageCaptureId,
        filename: "native-offline-photo-retry.jpg",
        mimeType: "image/jpeg",
        bytes: image,
      }),
    );
    expect(repeatedImage.status).toBe(200);
    await expect(repeatedImage.json()).resolves.toMatchObject({ status: "duplicate" });

    const firstVideo = await mediaUploadPost(
      mobileUploadRequest({
        endpoint: "media",
        token: bearerToken,
        captureId: videoCaptureId,
        filename: "native-offline-video.mp4",
        mimeType: "video/mp4",
        bytes: video,
      }),
    );
    expect(firstVideo.status).toBe(201);
    await expect(firstVideo.json()).resolves.toMatchObject({
      status: "stored",
      type: "video",
    });

    const firstAudio = await mediaUploadPost(
      mobileUploadRequest({
        endpoint: "media",
        token: bearerToken,
        captureId: audioCaptureId,
        filename: "native-direct-recording.wav",
        mimeType: "audio/wav",
        bytes: audio,
      }),
    );
    expect(firstAudio.status).toBe(201);
    await expect(firstAudio.json()).resolves.toMatchObject({
      status: "stored",
      type: "audio",
    });

    const inbox = await listInbox(familyId);
    expect(inbox.map((entry) => entry.item.id)).toEqual(
      expect.arrayContaining([imageCaptureId, videoCaptureId, audioCaptureId]),
    );
    expect(
      inbox.flatMap((entry) => entry.assets).filter((asset) => asset.sha256),
    ).toHaveLength(3);
    expect(
      inbox.flatMap((entry) => entry.assets).map((asset) => asset.originalFilename),
    ).toEqual(
      expect.arrayContaining([
        "native-offline-photo.jpg",
        "native-offline-video.mp4",
        "native-direct-recording.wav",
      ]),
    );

    const conflictingImage = readFileSync(
      path.join(process.cwd(), "tests/fixtures/sample-exif.jpg"),
    );
    const conflict = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId: imageCaptureId,
        filename: "different-content.jpg",
        mimeType: "image/jpeg",
        bytes: conflictingImage,
      }),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: "capture_id_conflict",
    });
  });

  it("recovers an inbox link when upload storage committed before the response", async () => {
    const admin = (await getDb().select().from(user))[0]!;
    const bytes = readFileSync(
      path.join(process.cwd(), "tests/fixtures/sample-exif-offset.jpg"),
    );
    const { ingestImage } = await import("@/lib/assets/ingest");
    const orphan = await ingestImage({
      familyId: admin.familyId!,
      createdByUserId: admin.id,
      filename: "interrupted-before-inbox.jpg",
      declaredMime: "image/jpeg",
      buffer: bytes,
      clientLastModifiedMs: 1_788_422_400_000,
    });
    expect(orphan.status).toBe("stored");

    const captureId = "d22b221a-875a-4639-9e6e-06764053d54d";
    const retry = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId,
        filename: "interrupted-before-inbox.jpg",
        mimeType: "image/jpeg",
        bytes,
      }),
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ status: "duplicate" });
    const recovered = await getInboxEntry(admin.familyId!, captureId);
    expect(recovered?.assets).toHaveLength(1);
    expect(recovered?.assets[0]?.originalFilename).toBe(
      "interrupted-before-inbox.jpg",
    );
  });

  it("keeps a native library PNG without reliable file time in needs_review", async () => {
    const familyId = (await getDb().select().from(user))[0]!.familyId!;
    const bytes = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.png"));
    const captureId = "ca65d36f-2d48-47da-8fa8-6d1f60dc9a20";
    const response = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        token: bearerToken,
        captureId,
        filename: "wechat-screenshot-no-exif.png",
        mimeType: "image/png",
        bytes,
        lastModified: null,
      }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      status: "stored",
      capturedAt: null,
      timeSource: "import_time",
    });
    const entry = await getInboxEntry(familyId, captureId);
    expect(entry?.item.status).toBe("needs_review");
    expect(entry?.assets[0]).toMatchObject({
      capturedAt: null,
      timeSource: "import_time",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("rejects native multipart uploads without a bearer session", async () => {
    const image = readFileSync(path.join(process.cwd(), "tests/fixtures/sample.jpg"));
    const response = await imageUploadPost(
      mobileUploadRequest({
        endpoint: "image",
        filename: "unauthorized.jpg",
        mimeType: "image/jpeg",
        bytes: image,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("does not expose family sync without a session", async () => {
    const response = await syncGet(
      new Request("http://localhost/api/mobile/v1/sync"),
    );
    expect(response.status).toBe(401);
  });
});
