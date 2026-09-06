import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * M2-d 访客限定阅读链接（ID-5）：创建/撤销/过期/范围隔离/媒体访问边界。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-read-grant-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "read-grant-setup-token";
process.env.AUTH_SECRET = "read-grant-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { collection, collectionItem } = await import("@/db/schema/collection");
const { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory");
const { asset } = await import("@/db/schema/asset");
const { person } = await import("@/db/schema/family");
const { user: userTable } = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding } = await import("@/lib/family/service");
const {
  createReadGrant,
  revokeReadGrant,
  listReadGrants,
  resolveReadGrant,
  listReadGrantEntries,
  readGrantIncludesAsset,
} = await import("@/lib/family/read-grants");

const PASSWORD = "read-grant-password-long";
const setup = await performSetup({
  token: "read-grant-setup-token",
  displayName: "妈妈",
  email: "owner@example.com",
  password: PASSWORD,
});
if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
const ownerUser = getDb()
  .select({ id: userTable.id })
  .from(userTable)
  .where(eq(userTable.email, "owner@example.com"))
  .all()[0];
if (!ownerUser) throw new Error("owner user missing");
const onboarding = await completeOnboarding(ownerUser.id, {
  familyName: "阅读链接家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2026-01-01",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;

function ownerContext() {
  return {
    userId: ownerUser.id,
    userName: "妈妈",
    familyId,
    personId: null,
    role: "owner" as const,
    accountEnabled: true as const,
    isGuardian: true,
    familyTimezone: "Asia/Shanghai",
    childLaterUnlockAge: 18,
  };
}

const childPersonRow = getDb()
  .select({ id: person.id })
  .from(person)
  .where(eq(person.familyId, familyId))
  .all()
  .find((row) => row);
const childPersonId = getDb()
  .select({ id: person.id, isChild: person.isChild })
  .from(person)
  .all()
  .find((row) => row.isChild)!.id;

const now = new Date();
const eventInScope = `evt-${randomUUID()}`;
const eventOutOfScope = `evt-${randomUUID()}`;
const assetInScope = `ast-${randomUUID()}`;
const assetOutOfScope = `ast-${randomUUID()}`;
const album = `col-${randomUUID()}`;
getDb().insert(memoryEvent).values({
  id: eventInScope, familyId, title: "周岁派对", occurredAt: now,
  childPersonId, createdAt: now, updatedAt: now,
}).run();
getDb().insert(memoryEvent).values({
  id: eventOutOfScope, familyId, title: "私密事件", occurredAt: now,
  childPersonId, createdAt: now, updatedAt: now,
}).run();
getDb().insert(asset).values({
  id: assetInScope, familyId, type: "image", originalFilename: "in.jpg",
  storageKey: "originals/images/in.jpg", bytes: 3, sha256: "a".repeat(64), timeSource: "manual", createdByUserId: ownerUser.id, mimeType: "image/jpeg",
  importedAt: now, createdAt: now,
}).run();
getDb().insert(asset).values({
  id: assetOutOfScope, familyId, type: "image", originalFilename: "out.jpg",
  storageKey: "originals/images/out.jpg", bytes: 3, sha256: "b".repeat(64), timeSource: "manual", createdByUserId: ownerUser.id, mimeType: "image/jpeg",
  importedAt: now, createdAt: now,
}).run();
getDb().insert(memoryEventAsset).values([
  { id: `mea-${randomUUID()}`, memoryEventId: eventInScope, assetId: assetInScope, familyId, createdAt: now },
  { id: `mea-${randomUUID()}`, memoryEventId: eventOutOfScope, assetId: assetOutOfScope, familyId, createdAt: now },
]).run();
getDb().insert(collection).values({
  id: album, familyId, kind: "album", title: "给外婆看的相册",
  createdAt: now, updatedAt: now,
}).run();
getDb().insert(collectionItem).values({
  id: `ci-${randomUUID()}`, familyId, collectionId: album,
  memoryEventId: eventInScope, caption: "吹蜡烛", position: 0,
}).run();

describe("访客限定阅读链接（ID-5）", () => {
  it("创建 → 解析 → 范围内资产可读、范围外不可读", async () => {
    const created = await createReadGrant(ownerContext(), {
      collectionId: album,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const resolved = resolveReadGrant(created.token);
    expect(resolved?.collectionTitle).toBe("给外婆看的相册");
    const entries = listReadGrantEntries(resolved!);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("周岁派对");
    expect(entries[0]!.assets.map((a) => a.assetId)).toEqual([assetInScope]);
    expect(readGrantIncludesAsset(resolved!, assetInScope)).toBe(true);
    expect(readGrantIncludesAsset(resolved!, assetOutOfScope)).toBe(false);

    // 令牌无效/伪造
    expect(resolveReadGrant("definitely-not-a-real-token-000")).toBeNull();
  });

  it("重复解析留痕；收回后立即失效", async () => {
    const created = await createReadGrant(ownerContext(), { collectionId: album });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(resolveReadGrant(created.token)).not.toBeNull();
    expect(resolveReadGrant(created.token)).not.toBeNull();
    const listed = listReadGrants(familyId);
    const grantRow = listed.find((row) => row.id === created.grantId);
    expect(grantRow?.viewCount).toBeGreaterThanOrEqual(2);

    expect(revokeReadGrant(ownerContext(), created.grantId)).toEqual({ ok: true });
    expect(resolveReadGrant(created.token)).toBeNull();
    expect(revokeReadGrant(ownerContext(), created.grantId)).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });

  it("过期时间不可签发；不存在/回收站相册不可授权", async () => {
    // 过去的到期时间直接拒绝签发
    const past = await createReadGrant(ownerContext(), {
      collectionId: album,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(past).toMatchObject({ ok: false, error: "invalid_input" });

    const missing = await createReadGrant(ownerContext(), {
      collectionId: "no-such-collection",
    });
    expect(missing).toMatchObject({ ok: false, error: "collection_not_found" });
  });

  it("viewer 不能创建阅读链接", async () => {
    const viewerId = `viewer-${randomUUID()}`;
    getDb().insert(userTable).values({
      id: viewerId, name: "查看者", email: `v-${viewerId}@example.com`,
      emailVerified: true, role: "viewer", familyId,
      createdAt: now, updatedAt: now,
    }).run();
    const viewerContext = {
      userId: viewerId, userName: "v", familyId, personId: null,
      role: "viewer" as const, accountEnabled: true as const,
      isGuardian: false, familyTimezone: "Asia/Shanghai", childLaterUnlockAge: 18,
    };
    await expect(
      createReadGrant(viewerContext, { collectionId: album }),
    ).rejects.toThrow(/family:manage/u);
  });
});
