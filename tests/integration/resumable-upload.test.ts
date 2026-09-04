import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-resumable-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "resumable-setup-token";
process.env.AUTH_SECRET = "resumable-test-secret-with-enough-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { asset } = await import("@/db/schema/asset");
const { session, user } = await import("@/db/schema/auth");
const { family, person } = await import("@/db/schema/family");
const { importSession, importSessionItem, uploadSession } = await import("@/db/schema/import");
const { inboxItem } = await import("@/db/schema/inbox");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const { getAssetStorage } = await import("@/lib/assets/storage");
const { cancelUpload, cleanupExpiredUploads, createImportSession } = await import(
  "@/lib/imports/service"
);
const { POST: createPost } = await import("@/app/api/uploads/route");
const { HEAD: uploadHead, PATCH: uploadPatch } = await import(
  "@/app/api/uploads/[id]/route"
);
const { POST: completePost } = await import(
  "@/app/api/uploads/[id]/complete/route"
);

const setup = await performSetup({
  token: "resumable-setup-token",
  displayName: "爸爸",
  email: "resumable@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = (await getDb().select().from(user))[0];
const onboarding = await completeOnboarding(admin.id, {
  familyName: "续传测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;

async function principal(role: "viewer" | "admin", familyValue = familyId) {
  const now = new Date();
  const personId = randomUUID();
  const userId = randomUUID();
  const token = `${role}-${randomUUID()}`;
  await getDb().insert(person).values({
    id: personId,
    familyId: familyValue,
    displayName: role,
    isChild: false,
    isGuardian: false,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(user).values({
    id: userId,
    name: role,
    email: `${userId}@example.test`,
    emailVerified: true,
    role,
    familyId: familyValue,
    personId,
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

const adminToken = await principal("admin");
const viewerToken = await principal("viewer");
const foreignFamilyId = randomUUID();
await getDb().insert(family).values({
  id: foreignFamilyId,
  name: "另一个家庭",
  timezone: "Asia/Shanghai",
  createdAt: new Date(),
  updatedAt: new Date(),
});
const foreignToken = await principal("admin", foreignFamilyId);

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
  "hex",
);

function auth(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function createUpload(input: {
  token?: string;
  captureId?: string;
  bytes?: number;
  mime?: string;
  filename?: string;
  importSessionId?: string | null;
}) {
  const captureId = input.captureId ?? randomUUID();
  const response = await createPost(
    new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: auth(input.token ?? adminToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        captureId,
        filename: input.filename ?? "memory.png",
        declaredMime: input.mime ?? "image/png",
        totalBytes: input.bytes ?? PNG.byteLength,
        lastModified: null,
        source: "native",
        importSessionId: input.importSessionId ?? null,
      }),
    }),
  );
  return { response, body: await response.json(), captureId };
}

async function patch(uploadId: string, offset: number, bytes: Buffer, token = adminToken) {
  return uploadPatch(
    new Request(`http://localhost/api/uploads/${uploadId}`, {
      method: "PATCH",
      headers: auth(token, {
        "content-type": "application/offset+octet-stream",
        "content-length": String(bytes.byteLength),
        "upload-offset": String(offset),
      }),
      body: Uint8Array.from(bytes),
    }),
    { params: Promise.resolve({ id: uploadId }) },
  );
}

async function complete(uploadId: string, token = adminToken) {
  return completePost(
    new Request(`http://localhost/api/uploads/${uploadId}/complete`, {
      method: "POST",
      headers: auth(token),
    }),
    { params: Promise.resolve({ id: uploadId }) },
  );
}

describe("durable resumable upload protocol", () => {
  it("finishes five chunks, resumes after HEAD, and makes complete idempotent", async () => {
    const created = await createUpload({});
    expect(created.response.status).toBe(201);
    const uploadId = created.body.uploadId as string;
    const chunks = [
      PNG.subarray(0, 6),
      PNG.subarray(6, 12),
      PNG.subarray(12, 18),
      PNG.subarray(18, 24),
      PNG.subarray(24),
    ];
    let offset = 0;
    for (const chunk of chunks.slice(0, 3)) {
      const response = await patch(uploadId, offset, chunk);
      expect(response.status).toBe(204);
      offset = Number(response.headers.get("upload-offset"));
    }

    const resumed = await uploadHead(
      new Request(`http://localhost/api/uploads/${uploadId}`, { headers: auth(adminToken) }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get("upload-offset")).toBe("18");

    const replay = await patch(uploadId, 12, chunks[2]);
    expect(replay.status).toBe(204);
    expect(replay.headers.get("upload-replayed")).toBe("true");
    expect(replay.headers.get("upload-offset")).toBe("18");

    const wrong = await patch(uploadId, 19, Buffer.from([0]));
    expect(wrong.status).toBe(409);
    expect(wrong.headers.get("upload-offset")).toBe("18");

    for (const chunk of chunks.slice(3)) {
      const response = await patch(uploadId, offset, chunk);
      expect(response.status).toBe(204);
      offset = Number(response.headers.get("upload-offset"));
    }
    expect(offset).toBe(PNG.byteLength);

    const finalized = await complete(uploadId);
    expect(finalized.status).toBe(201);
    const result = await finalized.json();
    expect(result).toMatchObject({
      status: "stored",
      bytes: PNG.byteLength,
      sha256: createHash("sha256").update(PNG).digest("hex"),
    });
    const assetRow = (
      await getDb().select().from(asset).where(eq(asset.id, result.assetId))
    )[0];
    expect(getAssetStorage().read(assetRow.storageKey).equals(PNG)).toBe(true);

    // Simulate a lost complete response: retry returns the exact same result.
    const retried = await complete(uploadId);
    expect(retried.status).toBe(201);
    expect(await retried.json()).toEqual(result);
    expect(
      (await getDb().select({ value: count() }).from(asset).where(eq(asset.id, result.assetId)))[0].value,
    ).toBe(1);
    expect(
      (await getDb().select({ value: count() }).from(inboxItem).where(eq(inboxItem.id, result.inboxItemId)))[0].value,
    ).toBe(1);
  });

  it("rejects replayed different content, oversize writes, and incomplete complete", async () => {
    const replayCase = await createUpload({ filename: "replay.png" });
    const replayId = replayCase.body.uploadId as string;
    expect((await patch(replayId, 0, PNG.subarray(0, 10))).status).toBe(204);
    const mismatch = await patch(replayId, 0, Buffer.alloc(10, 0xff));
    expect(mismatch.status).toBe(409);
    expect(mismatch.headers.get("upload-offset")).toBe("10");

    const incomplete = await complete(replayId);
    expect(incomplete.status).toBe(409);
    expect((await incomplete.json()).error).toBe("upload_incomplete");

    const small = await createUpload({ bytes: 4, filename: "small.png" });
    const tooMany = await patch(small.body.uploadId as string, 0, PNG.subarray(0, 5));
    expect(tooMany.status).toBe(413);
    expect((await tooMany.json()).error).toBe("exceeds_declared_size");
  });

  it("resumes the same durable capture and rejects changed declarations", async () => {
    const captureId = randomUUID();
    const created = await createUpload({ captureId, filename: "restart.png" });
    const uploadId = created.body.uploadId as string;
    expect((await patch(uploadId, 0, PNG.subarray(0, 11))).status).toBe(204);

    const retriedCreate = await createUpload({ captureId, filename: "restart.png" });
    expect(retriedCreate.response.status).toBe(200);
    expect(retriedCreate.body).toMatchObject({ uploadId, uploadOffset: 11 });
    const conflict = await createUpload({ captureId, filename: "other-name.png" });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error).toBe("capture_id_conflict");

    const recovered = await uploadHead(
      new Request(`http://localhost/api/uploads/${uploadId}`, { headers: auth(adminToken) }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("upload-offset")).toBe("11");
  });

  it("rolls a short request body back to its confirmed offset", async () => {
    const created = await createUpload({});
    const uploadId = created.body.uploadId as string;
    const response = await uploadPatch(
      new Request(`http://localhost/api/uploads/${uploadId}`, {
        method: "PATCH",
        headers: auth(adminToken, {
          "content-type": "application/offset+octet-stream",
          "content-length": "5",
          "upload-offset": "0",
        }),
        body: Uint8Array.from(PNG.subarray(0, 3)),
      }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(response.status).toBe(400);
    const head = await uploadHead(
      new Request(`http://localhost/api/uploads/${uploadId}`, { headers: auth(adminToken) }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(head.headers.get("upload-offset")).toBe("0");
  });

  it("rejects MIME disguise without creating an Asset", async () => {
    const fake = Buffer.from("MZ executable bytes");
    const created = await createUpload({ bytes: fake.byteLength, filename: "fake.png" });
    const uploadId = created.body.uploadId as string;
    expect((await patch(uploadId, 0, fake)).status).toBe(204);
    const before = (await getDb().select({ value: count() }).from(asset))[0].value;
    const response = await complete(uploadId);
    expect(response.status).toBe(415);
    expect((await response.json()).error).toBe("content_mismatch");
    expect((await getDb().select({ value: count() }).from(asset))[0].value).toBe(before);
  });

  it("hides sessions across families and rejects viewers", async () => {
    const created = await createUpload({});
    const uploadId = created.body.uploadId as string;
    const foreign = await uploadHead(
      new Request(`http://localhost/api/uploads/${uploadId}`, { headers: auth(foreignToken) }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(foreign.status).toBe(404);
    expect((await patch(uploadId, 0, PNG.subarray(0, 4), foreignToken)).status).toBe(404);
    expect((await createUpload({ token: viewerToken })).response.status).toBe(403);
  });

  it("stores an inert PDF document with its exact original hash", async () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const created = await createUpload({
      bytes: pdf.byteLength,
      filename: "family-notes.pdf",
      mime: "application/pdf",
    });
    expect((await patch(created.body.uploadId as string, 0, pdf)).status).toBe(204);
    const response = await complete(created.body.uploadId as string);
    expect(response.status).toBe(201);
    const result = await response.json();
    const row = (
      await getDb().select().from(asset).where(eq(asset.id, result.assetId))
    )[0];
    expect(row).toMatchObject({
      type: "document",
      mimeType: "application/pdf",
      originalFilename: "family-notes.pdf",
      sha256: createHash("sha256").update(pdf).digest("hex"),
    });
    expect(getAssetStorage().read(row.storageKey).equals(pdf)).toBe(true);
  });

  it("persists the relational ImportSession item through completion", async () => {
    const batch = await createImportSession({
      familyId,
      createdByUserId: admin.id,
      source: "web",
      defaultTitle: "旧照片",
    });
    const created = await createUpload({ importSessionId: batch.id, filename: "batch.png" });
    const uploadId = created.body.uploadId as string;
    await patch(uploadId, 0, PNG);
    const done = await (await complete(uploadId)).json();
    const item = (
      await getDb()
        .select()
        .from(importSessionItem)
        .where(eq(importSessionItem.uploadSessionId, uploadId))
    )[0];
    expect(item).toMatchObject({
      familyId,
      importSessionId: batch.id,
      uploadSessionId: uploadId,
      assetId: done.assetId,
      inboxItemId: done.inboxItemId,
      status: "completed",
    });
    expect(
      (await getDb().select().from(importSession).where(eq(importSession.id, batch.id)))[0],
    ).toMatchObject({ totalCount: 1, completedCount: 1, failedCount: 0, status: "reviewing" });
  });

  it("recovers both directions of database/disk offset drift", async () => {
    const created = await createUpload({});
    const uploadId = created.body.uploadId as string;
    expect((await patch(uploadId, 0, PNG.subarray(0, 12))).status).toBe(204);
    await getDb()
      .update(uploadSession)
      .set({ receivedBytes: 3 })
      .where(eq(uploadSession.id, uploadId));
    let head = await uploadHead(
      new Request(`http://localhost/api/uploads/${uploadId}`, { headers: auth(adminToken) }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(head.headers.get("upload-offset")).toBe("12");

    const row = (
      await getDb().select().from(uploadSession).where(eq(uploadSession.id, uploadId))
    )[0];
    truncateSync(getAssetStorage().resolveUploadPath(row.tempStorageKey), 7);
    head = await uploadHead(
      new Request(`http://localhost/api/uploads/${uploadId}`, { headers: auth(adminToken) }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(head.headers.get("upload-offset")).toBe("7");
    expect(
      (await getDb().select().from(uploadSession).where(eq(uploadSession.id, uploadId)))[0]
        .receivedBytes,
    ).toBe(7);
  });

  it("expires partials in a bounded sweep and never removes completed originals", async () => {
    const partial = await createUpload({});
    const partialId = partial.body.uploadId as string;
    expect((await patch(partialId, 0, PNG.subarray(0, 8))).status).toBe(204);
    const partialRow = (
      await getDb().select().from(uploadSession).where(eq(uploadSession.id, partialId))
    )[0];
    await getDb()
      .update(uploadSession)
      .set({ expiresAt: new Date(0) })
      .where(eq(uploadSession.id, partialId));
    expect(await cleanupExpiredUploads({ now: new Date(), limit: 1 })).toBe(1);
    expect(existsSync(getAssetStorage().resolveUploadPath(partialRow.tempStorageKey))).toBe(false);
    expect(
      (await getDb().select().from(uploadSession).where(eq(uploadSession.id, partialId)))[0].status,
    ).toBe("expired");

    const completed = await createUpload({});
    const completedId = completed.body.uploadId as string;
    expect((await patch(completedId, 0, PNG)).status).toBe(204);
    const done = await (await complete(completedId)).json();
    const stored = (
      await getDb().select().from(asset).where(eq(asset.id, done.assetId))
    )[0];
    await getDb().run(sql`UPDATE upload_session SET expires_at = 0 WHERE id = ${completedId}`);
    await cleanupExpiredUploads({ now: new Date(), limit: 100 });
    expect(getAssetStorage().exists(stored.storageKey)).toBe(true);
  });

  it("deduplicates identical bytes across capture ids into one Asset and InboxItem", async () => {
    const unique = Buffer.concat([PNG, Buffer.from("dedupe-case")]);
    const first = await createUpload({ bytes: unique.byteLength, filename: "dedupe.png" });
    await patch(first.body.uploadId as string, 0, unique);
    const firstDone = await (await complete(first.body.uploadId as string)).json();

    const second = await createUpload({ bytes: unique.byteLength, filename: "copy.png" });
    await patch(second.body.uploadId as string, 0, unique);
    const secondResponse = await complete(second.body.uploadId as string);
    const secondDone = await secondResponse.json();
    expect(secondDone.status).toBe("duplicate");
    expect(secondDone.assetId).toBe(firstDone.assetId);
    expect(secondDone.inboxItemId).toBe(firstDone.inboxItemId);
    expect(
      (await getDb().select({ value: count() }).from(asset).where(and(eq(asset.familyId, familyId), eq(asset.sha256, firstDone.sha256))))[0].value,
    ).toBe(1);
  });

  it("enforces independent family active-count and temporary-space quotas", async () => {
    const activeBefore = (
      await getDb()
        .select({ value: count() })
        .from(uploadSession)
        .where(
          and(
            eq(uploadSession.familyId, familyId),
            sql`${uploadSession.status} in ('created', 'uploading')`,
          ),
        )
    )[0].value;
    const activeIds: string[] = [];
    for (let index = activeBefore; index < 20; index++) {
      const created = await createUpload({ filename: `active-${index}.png` });
      expect(created.response.status).toBe(201);
      activeIds.push(created.body.uploadId as string);
    }
    const blocked = await createUpload({ filename: "active-overflow.png" });
    expect(blocked.response.status).toBe(429);
    expect(blocked.body.error).toBe("too_many_active_uploads");
    for (const id of activeIds) await cancelUpload(familyId, id);

    const quotaIds: string[] = [];
    for (let index = 0; index < 10; index++) {
      const created = await createUpload({
        token: foreignToken,
        filename: `quota-${index}.mp4`,
        mime: "video/mp4",
        bytes: 500 * 1024 * 1024,
      });
      expect(created.response.status).toBe(201);
      quotaIds.push(created.body.uploadId as string);
    }
    const quotaBlocked = await createUpload({
      token: foreignToken,
      filename: "quota-overflow.pdf",
      mime: "application/pdf",
      bytes: 200 * 1024 * 1024,
    });
    expect(quotaBlocked.response.status).toBe(413);
    expect(quotaBlocked.body.error).toBe("temporary_storage_quota");
    for (const id of quotaIds) await cancelUpload(foreignFamilyId, id);
  });
});
