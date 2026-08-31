import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-media-access-"));
process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET = "media-access-test-secret-0123456789";

let currentContext: FamilyContext;

vi.doMock("@/lib/authz/context", () => ({
  authorizeApiFamilyRequest: async () => ({
    ok: true as const,
    context: currentContext,
  }),
}));

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
  vi.doUnmock("@/lib/authz/context");
});

const { getDb } = await import("@/db");
const { asset } = await import("@/db/schema/asset");
const { user: userTable } = await import("@/db/schema/auth");
const { contribution } = await import("@/db/schema/contribution");
const { family, person } = await import("@/db/schema/family");
const { memoryEvent } = await import("@/db/schema/memory");
const { storeDerivative, storeOriginal } = await import("@/lib/assets/service");
const { GET } = await import("@/app/api/media/[assetId]/route");

const db = getDb();
const familyAId = randomUUID();
const familyBId = randomUUID();
const authorPersonId = randomUUID();
const otherAdminPersonId = randomUUID();
const childAId = randomUUID();
const foreignPersonId = randomUUID();
const childBId = randomUUID();
const authorUserId = randomUUID();
const otherAdminUserId = randomUUID();
const unboundAdminUserId = randomUUID();
const foreignUserId = randomUUID();
const eventId = randomUUID();
const now = new Date("2026-08-31T08:00:00.000Z");

db.insert(family)
  .values([
    {
      id: familyAId,
      name: "媒体授权家庭 A",
      timezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: familyBId,
      name: "媒体授权家庭 B",
      timezone: "Asia/Shanghai",
      childLaterUnlockAge: 18,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

db.insert(person)
  .values([
    {
      id: authorPersonId,
      familyId: familyAId,
      displayName: "作者",
      relationToChild: "爸爸",
      isChild: false,
      isGuardian: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: otherAdminPersonId,
      familyId: familyAId,
      displayName: "另一位管理员",
      relationToChild: "姑姑",
      isChild: false,
      isGuardian: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: childAId,
      familyId: familyAId,
      displayName: "孩子 A",
      isChild: true,
      isGuardian: false,
      birthDate: "2020-01-01",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: foreignPersonId,
      familyId: familyBId,
      displayName: "外部管理员",
      isChild: false,
      isGuardian: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: childBId,
      familyId: familyBId,
      displayName: "孩子 B",
      isChild: true,
      isGuardian: false,
      birthDate: "2020-01-01",
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

db.insert(userTable)
  .values([
    {
      id: authorUserId,
      name: "作者",
      email: "media-author@example.com",
      emailVerified: false,
      role: "admin",
      familyId: familyAId,
      personId: authorPersonId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: otherAdminUserId,
      name: "另一位管理员",
      email: "media-other-admin@example.com",
      emailVerified: false,
      role: "admin",
      familyId: familyAId,
      personId: otherAdminPersonId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: foreignUserId,
      name: "外部管理员",
      email: "media-foreign@example.com",
      emailVerified: false,
      role: "admin",
      familyId: familyBId,
      personId: foreignPersonId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: unboundAdminUserId,
      name: "未绑定人物的管理员",
      email: "media-unbound-admin@example.com",
      emailVerified: false,
      role: "admin",
      familyId: familyAId,
      personId: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

db.insert(memoryEvent)
  .values({
    id: eventId,
    familyId: familyAId,
    childPersonId: childAId,
    title: "媒体授权事件",
    occurredAt: now,
    occurredAtPrecision: "exact",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
  })
  .run();

function contextFor(input: {
  userId: string;
  familyId: string;
  personId: string | null;
  userName: string;
}): FamilyContext {
  return {
    ...input,
    role: "admin",
    accountEnabled: true,
    isGuardian: false,
    familyTimezone: "Asia/Shanghai",
    childLaterUnlockAge: 18,
  };
}

const authorContext = contextFor({
  userId: authorUserId,
  familyId: familyAId,
  personId: authorPersonId,
  userName: "作者",
});
const otherAdminContext = contextFor({
  userId: otherAdminUserId,
  familyId: familyAId,
  personId: otherAdminPersonId,
  userName: "另一位管理员",
});
const foreignContext = contextFor({
  userId: foreignUserId,
  familyId: familyBId,
  personId: foreignPersonId,
  userName: "外部管理员",
});
const unboundAdminContext = contextFor({
  userId: unboundAdminUserId,
  familyId: familyAId,
  personId: null,
  userName: "未绑定人物的管理员",
});

const originalBytes = Buffer.from("0123456789abcdef", "utf8");
const originalResult = await storeOriginal({
  familyId: familyAId,
  createdByUserId: authorUserId,
  type: "audio",
  originalFilename: "家庭录音.wav",
  mimeType: "audio/wav",
  buffer: originalBytes,
  extension: "wav",
  capturedAt: new Date("2026-08-30T10:00:00.000Z"),
  timeSource: "user_confirmed",
});
if (originalResult.status !== "stored") throw new Error("original seed failed");
const original = originalResult.asset;

const preview = await storeDerivative(familyAId, original.id, "preview", {
  mimeType: "audio/wav",
  extension: "wav",
  buffer: Buffer.from("preview-bytes", "utf8"),
});
if (!preview) throw new Error("preview seed failed");

// Historical databases may contain derivative-to-derivative chains. Media
// access must still resolve them to the same immutable original root.
const nestedWaveform = await storeDerivative(
  familyAId,
  preview.id,
  "waveform",
  {
    mimeType: "application/octet-stream",
    extension: "bin",
    buffer: Buffer.from("nested-waveform-bytes", "utf8"),
  },
);
if (!nestedWaveform) throw new Error("nested derivative seed failed");

const siblingThumbnail = await storeDerivative(
  familyAId,
  original.id,
  "thumbnail",
  {
    mimeType: "image/png",
    extension: "png",
    buffer: Buffer.from("sibling-thumbnail-bytes", "utf8"),
  },
);
if (!siblingThumbnail) throw new Error("sibling derivative seed failed");

const unrelatedResult = await storeOriginal({
  familyId: familyAId,
  createdByUserId: authorUserId,
  type: "audio",
  originalFilename: "无讲述引用.wav",
  mimeType: "audio/wav",
  buffer: Buffer.from("unrelated-family-media", "utf8"),
  extension: "wav",
  capturedAt: null,
  timeSource: "import_time",
});
if (unrelatedResult.status !== "stored") throw new Error("unrelated seed failed");
const unrelated = unrelatedResult.asset;

const parentsOnlyResult = await storeOriginal({
  familyId: familyAId,
  createdByUserId: authorUserId,
  type: "audio",
  originalFilename: "仅监护人可见.wav",
  mimeType: "audio/wav",
  buffer: Buffer.from("parents-only-family-media", "utf8"),
  extension: "wav",
  capturedAt: null,
  timeSource: "import_time",
});
if (parentsOnlyResult.status !== "stored") {
  throw new Error("parents-only seed failed");
}
const parentsOnlyAsset = parentsOnlyResult.asset;

const foreignResult = await storeOriginal({
  familyId: familyBId,
  createdByUserId: foreignUserId,
  type: "audio",
  originalFilename: "外部家庭.wav",
  mimeType: "audio/wav",
  buffer: Buffer.from("foreign-family-media", "utf8"),
  extension: "wav",
  capturedAt: null,
  timeSource: "import_time",
});
if (foreignResult.status !== "stored") throw new Error("foreign seed failed");
const foreignAsset = foreignResult.asset;

db.insert(contribution)
  .values([
    {
      id: randomUUID(),
      memoryEventId: eventId,
      authorPersonId,
      rawText: "全家可见的讲述",
      audioAssetId: original.id,
      visibility: "family",
      recordingMode: "legacy",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      memoryEventId: eventId,
      authorPersonId,
      rawText: "只有作者能看的讲述",
      audioAssetId: nestedWaveform.id,
      visibility: "private",
      recordingMode: "legacy",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      memoryEventId: eventId,
      authorPersonId,
      rawText: "只有作者和明确监护人能看的讲述",
      audioAssetId: parentsOnlyAsset.id,
      visibility: "parents",
      recordingMode: "legacy",
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

function mediaRequest(
  assetId: string,
  headers?: HeadersInit,
): Promise<Response> {
  return GET(new Request(`http://localhost/api/media/${assetId}`, { headers }), {
    params: Promise.resolve({ assetId }),
  });
}

describe.sequential("Contribution media route authorization", () => {
  it("serves the original and a byte range when every reference is visible", async () => {
    currentContext = authorContext;

    const full = await mediaRequest(original.id);
    expect(full.status).toBe(200);
    expect(full.headers.get("cache-control")).toBe("private, no-store");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(originalBytes);

    const range = await mediaRequest(original.id, { Range: "bytes=2-5" });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(
      `bytes 2-5/${originalBytes.byteLength}`,
    );
    expect(range.headers.get("content-length")).toBe("4");
    expect(Buffer.from(await range.arrayBuffer()).toString("utf8")).toBe("2345");
  });

  it("applies the same authorization to descendants and sibling derivatives", async () => {
    currentContext = authorContext;

    const nested = await mediaRequest(nestedWaveform.id);
    expect(nested.status).toBe(200);
    expect(Buffer.from(await nested.arrayBuffer()).toString("utf8")).toBe(
      "nested-waveform-bytes",
    );

    const sibling = await mediaRequest(siblingThumbnail.id);
    expect(sibling.status).toBe(200);
    expect(Buffer.from(await sibling.arrayBuffer()).toString("utf8")).toBe(
      "sibling-thumbnail-bytes",
    );
  });

  it("lets a family member read an asset with no Contribution reference", async () => {
    currentContext = otherAdminContext;

    const response = await mediaRequest(unrelated.id);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "unrelated-family-media",
    );
  });

  it("fails the whole root closed when one of multiple references is private", async () => {
    currentContext = otherAdminContext;

    for (const assetId of [
      original.id,
      preview.id,
      nestedWaveform.id,
      siblingThumbnail.id,
    ]) {
      const response = await mediaRequest(assetId, { Range: "bytes=0-1" });
      expect(response.status, assetId).toBe(404);
      expect(await response.text()).toBe("Not Found");
      expect(response.headers.get("content-range")).toBeNull();
    }

    // Authorization precedes Range validation, so even an invalid range must
    // not disclose the hidden asset's byte length through a 416 response.
    const invalidRange = await mediaRequest(original.id, {
      Range: "bytes=999999-",
    });
    expect(invalidRange.status).toBe(404);
    expect(invalidRange.headers.get("content-range")).toBeNull();
  });

  it("does not grant an administrator a private-content bypass", async () => {
    currentContext = otherAdminContext;
    expect(currentContext.role).toBe("admin");

    const response = await mediaRequest(nestedWaveform.id);
    expect(response.status).toBe(404);

    currentContext = unboundAdminContext;
    expect((await mediaRequest(nestedWaveform.id)).status).toBe(404);
    expect((await mediaRequest(original.id)).status).toBe(404);
  });

  it("does not treat a bound or unbound administrator as a guardian", async () => {
    currentContext = otherAdminContext;
    expect((await mediaRequest(parentsOnlyAsset.id)).status).toBe(404);

    currentContext = unboundAdminContext;
    expect((await mediaRequest(parentsOnlyAsset.id)).status).toBe(404);
  });

  it("returns 404 across the family boundary in both directions", async () => {
    currentContext = foreignContext;
    expect((await mediaRequest(original.id)).status).toBe(404);

    currentContext = authorContext;
    expect((await mediaRequest(foreignAsset.id)).status).toBe(404);
  });

  it("rechecks a captured principal and rejects it immediately after disable", async () => {
    currentContext = authorContext;
    expect((await mediaRequest(original.id)).status).toBe(200);

    db.update(userTable)
      .set({
        disabledAt: new Date("2026-08-31T09:00:00.000Z"),
        disabledByUserId: otherAdminUserId,
      })
      .where(eq(userTable.id, authorUserId))
      .run();
    try {
      expect((await mediaRequest(original.id)).status).toBe(404);
      expect((await mediaRequest(unrelated.id)).status).toBe(404);
    } finally {
      db.update(userTable)
        .set({ disabledAt: null, disabledByUserId: null })
        .where(eq(userTable.id, authorUserId))
        .run();
    }
  });

  it("fails closed when an asset row disappears before a read", async () => {
    currentContext = authorContext;
    const missingId = randomUUID();
    expect(
      db.select({ id: asset.id }).from(asset).where(eq(asset.id, missingId)).get(),
    ).toBeUndefined();
    expect((await mediaRequest(missingId)).status).toBe(404);
  });
});
