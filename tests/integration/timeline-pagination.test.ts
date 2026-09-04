import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-timeline-page-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "timeline-page-token";
process.env.AUTH_SECRET = "timeline-page-secret";

const { performSetup } = await import("@/lib/auth/setup");
const setup = await performSetup({
  token: "timeline-page-token",
  displayName: "管理员",
  email: "timeline-page@example.test",
  password: "timeline-page-password",
});
if (!setup.ok) throw new Error("setup failed");

const { closeDatabase, getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { memoryEvent, memoryEventAsset, memoryEventParticipant } = await import("@/db/schema/memory");
const { asset } = await import("@/db/schema/asset");
const { memoryEventTag } = await import("@/db/schema/suggestion");
const { completeOnboarding, listPeople } = await import("@/lib/family/service");
const { getTimelineFacets, getTimelinePage } = await import("@/lib/memories/service");

const db = getDb();
const admin = (await db.select({ id: user.id }).from(user))[0]!;
const onboarding = await completeOnboarding(admin.id, {
  familyName: "分页家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2020-01-01",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error("onboarding failed");

const familyId = onboarding.familyId;
const child = (await listPeople(familyId)).find((person) => person.isChild);
if (!child) throw new Error("child missing");

const base = Date.UTC(2030, 0, 1);
await db.insert(memoryEvent).values(
  Array.from({ length: 125 }, (_, index) => ({
    id: `page-event-${String(index).padStart(3, "0")}`,
    familyId,
    childPersonId: child.id,
    title: `事件 ${index}`,
    // Every three rows share a timestamp to prove the id tie-breaker is stable.
    occurredAt: new Date(base - Math.floor(index / 3) * 86_400_000),
    occurredAtPrecision: "exact",
    status: "confirmed",
    ageDays: index,
    createdAt: new Date(base + index),
    updatedAt: new Date(base + index),
  })),
);

afterAll(() => {
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("timeline keyset pagination", () => {
  it("walks 125 events without a 100-row cap, gaps, or duplicates", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await getTimelinePage(familyId, { cursor, limit: 17 });
      pages += 1;
      expect(page.entries.length).toBeLessThanOrEqual(17);
      ids.push(...page.entries.map((entry) => entry.event.id));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pages).toBe(8);
    expect(ids).toHaveLength(125);
    expect(new Set(ids).size).toBe(125);
    expect(ids.slice(0, 3)).toEqual([
      "page-event-002",
      "page-event-001",
      "page-event-000",
    ]);
    expect(ids.slice(-2)).toEqual(["page-event-124", "page-event-123"]);
  });

  it("caps caller-supplied page size and treats malformed cursors as first page", async () => {
    const capped = await getTimelinePage(familyId, { limit: 10_000 });
    expect(capped.entries).toHaveLength(50);
    expect(capped.nextCursor).toBeTruthy();

    const malformed = await getTimelinePage(familyId, {
      cursor: "not-an-opaque-cursor",
      limit: 3,
    });
    expect(malformed.entries.map((entry) => entry.event.id)).toEqual([
      "page-event-002",
      "page-event-001",
      "page-event-000",
    ]);
  });

  it("uses a tuple range for deep-page keyset scans without a temporary sort", async () => {
    const indexes = (await db.all(
      sql.raw("PRAGMA index_list('memory_event')"),
    )) as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain(
      "memory_family_status_cursor_idx",
    );

    const cursorSeconds = Math.floor((base - 20 * 86_400_000) / 1000);
    const plan = (await db.all(sql`
      EXPLAIN QUERY PLAN
      SELECT id
        FROM memory_event
       WHERE family_id = ${familyId}
         AND status = 'confirmed'
         AND (occurred_at, id) < (${cursorSeconds}, ${"page-event-060"})
    ORDER BY occurred_at DESC, id DESC
       LIMIT 26
    `)) as Array<{ detail: string }>;
    expect(
      plan.some((step) =>
        step.detail.includes("memory_family_status_cursor_idx"),
      ),
    ).toBe(true);
    expect(
      plan.some((step) => step.detail.includes("(occurred_at,id)<(?,?)")),
    ).toBe(true);
    expect(
      plan.some((step) => step.detail.includes("USE TEMP B-TREE")),
    ).toBe(false);
  });

  it("filters by date, person, media and tag without leaving the family scope", async () => {
    const now = new Date();
    await db.insert(asset).values({
      id: "timeline-filter-image",
      familyId,
      type: "image",
      originalFilename: "filter.jpg",
      mimeType: "image/jpeg",
      bytes: 10,
      sha256: "f".repeat(64),
      storageKey: "originals/filter.jpg",
      capturedAt: new Date(base),
      importedAt: now,
      timeSource: "user_confirmed",
      createdByUserId: admin.id,
      createdAt: now,
    });
    await db.insert(memoryEventAsset).values({
      id: "timeline-filter-asset-link",
      familyId,
      memoryEventId: "page-event-002",
      assetId: "timeline-filter-image",
      createdAt: now,
    });
    await db.insert(memoryEventParticipant).values({
      id: "timeline-filter-person-link",
      familyId,
      memoryEventId: "page-event-002",
      personId: child.id,
      createdAt: now,
    });
    await db.insert(memoryEventTag).values({
      id: "timeline-filter-tag-link",
      familyId,
      memoryEventId: "page-event-002",
      tag: "第一次",
      createdAt: now,
    });

    const page = await getTimelinePage(familyId, {
      personId: child.id,
      mediaType: "image",
      tag: "第一次",
      occurredFrom: new Date(base - 1000),
      occurredBefore: new Date(base + 1000),
    });
    expect(page.entries.map((entry) => entry.event.id)).toEqual(["page-event-002"]);
    expect(page.entries[0]?.tags).toEqual(["第一次"]);
    const facets = await getTimelineFacets(familyId);
    expect(facets.tags).toEqual(["第一次"]);
    expect(facets.years).toContain(2030);
  });
});
