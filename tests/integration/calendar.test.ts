import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-calendar-"));
process.env.DATA_DIR = dir;
process.env.INITIAL_SETUP_TOKEN = "calendar-setup";
process.env.AUTH_SECRET = "calendar-test-secret";
const { performSetup } = await import("@/lib/auth/setup");
const { getDb, closeDatabase } = await import("@/db");
const { user, session } = await import("@/db/schema/auth");
const { family, person } = await import("@/db/schema/family");
const { memoryEvent, memoryEventAsset, memoryEventParticipant } =
  await import("@/db/schema/memory");
const { memoryEventTag } = await import("@/db/schema/suggestion");
const { asset } = await import("@/db/schema/asset");
const { contribution } = await import("@/db/schema/contribution");
const { completeOnboarding, getUserBinding, listPeople } =
  await import("@/lib/family/service");
const { getTimelinePage, getTimelineFacets } =
  await import("@/lib/memories/service");
const { getCalendarMonth, getBrowsePage } =
  await import("@/lib/memories/calendar");
const { GET } = await import("@/app/api/mobile/v1/calendar/route");
const { generateYearBook } = await import("@/lib/books/service");
if (
  !(
    await performSetup({
      token: "calendar-setup",
      displayName: "虚构爸爸",
      email: "calendar@example.test",
      password: "calendar-test-password",
    })
  ).ok
)
  throw new Error("setup");
const db = getDb(),
  admin = db.select().from(user).get()!;
const onboard = await completeOnboarding(admin.id, {
  familyName: "虚构日历家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小雨",
  childBirthDate: "2026-01-31",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboard.ok) throw new Error("onboard");
const binding = await getUserBinding(admin.id);
const context: FamilyContext = {
  userId: admin.id,
  userName: admin.name,
  familyId: onboard.familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone!,
  childLaterUnlockAge: binding.childLaterUnlockAge!,
};
const child = (await listPeople(context.familyId)).find((p) => p.isChild)!;
function event(id: string, at: string) {
  db.insert(memoryEvent)
    .values({
      id,
      familyId: context.familyId,
      childPersonId: child.id,
      title: `虚构记忆 ${id}`,
      occurredAt: new Date(at),
      status: "confirmed",
    })
    .run();
}
event("new-year", "2025-12-31T16:30:00Z");
event("old-year", "2025-12-31T15:59:59Z");
for (let i = 0; i < 35; i++)
  event(`jan-${i.toString().padStart(2, "0")}`, "2026-01-02T12:00:00Z");
event("hidden-deleted", "2026-01-02T12:00:00Z");
db.update(memoryEvent)
  .set({ deletedAt: new Date() })
  .where(eq(memoryEvent.id, "hidden-deleted"))
  .run();
event("hidden-draft", "2026-01-02T12:00:00Z");
db.update(memoryEvent)
  .set({ status: "draft" })
  .where(eq(memoryEvent.id, "hidden-draft"))
  .run();
afterAll(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
describe("calendar real database and API", () => {
  it("aggregates family-local days and stable cursors without drafts, deleted rows or duplicates", async () => {
    const month = await getCalendarMonth(context, "2026-01");
    expect(
      (await getTimelineFacets(context.familyId, context.familyTimezone)).years,
    ).toContain(2026);
    expect(month.days).toHaveLength(31);
    expect(month.days.find((d) => d.date === "2026-01-01")?.count).toBe(1);
    expect(month.days.find((d) => d.date === "2026-01-02")?.count).toBe(35);
    const first = await getBrowsePage(context, "2026-01-02");
    const next = await getBrowsePage(
      context,
      "2026-01-02",
      {},
      first.nextCursor,
    );
    expect(first.entries).toHaveLength(30);
    expect(next.entries).toHaveLength(5);
    expect(
      new Set([...first.entries, ...next.entries].map((e) => e.id)).size,
    ).toBe(35);
    expect(next.nextCursor).toBeNull();
  });
  it("uses person/tag/document filters consistently in list and counts", async () => {
    const aid = randomUUID();
    db.insert(asset)
      .values({
        id: aid,
        familyId: context.familyId,
        type: "document",
        mimeType: "text/plain",
        bytes: 1,
        sha256: "a".repeat(64),
        storageKey: `originals/${aid}.txt`,
        originalFilename: "虚构.txt",
        importedAt: new Date(),
        timeSource: "import_time",
        createdByUserId: admin.id,
      })
      .run();
    db.insert(memoryEventAsset)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        memoryEventId: "new-year",
        assetId: aid,
      })
      .run();
    db.insert(memoryEventParticipant)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        memoryEventId: "new-year",
        personId: child.id,
      })
      .run();
    db.insert(memoryEventTag)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        memoryEventId: "new-year",
        tag: "新年",
      })
      .run();
    const filters = { person: child.id, media: "document", tag: "新年" };
    expect(
      (await getCalendarMonth(context, "2026-01", filters)).days.reduce(
        (sum, d) => sum + d.count,
        0,
      ),
    ).toBe(1);
    expect(
      (await getBrowsePage(context, "2026-01", filters)).entries.map(
        (e) => e.id,
      ),
    ).toEqual(["new-year"]);
  });
  it("removes unreadable media from counts and covers, including derivatives, without revealing private sources", async () => {
    const mother = randomUUID();
    db.insert(person)
      .values({
        id: mother,
        familyId: context.familyId,
        displayName: "虚构妈妈",
      })
      .run();
    const aid = randomUUID(),
      derived = randomUUID();
    db.insert(asset)
      .values({
        id: aid,
        familyId: context.familyId,
        type: "image",
        mimeType: "image/jpeg",
        bytes: 1,
        sha256: "b".repeat(64),
        storageKey: `originals/${aid}.jpg`,
        originalFilename: "虚构.jpg",
        importedAt: new Date(),
        timeSource: "import_time",
        createdByUserId: admin.id,
      })
      .run();
    db.insert(asset)
      .values({
        id: derived,
        familyId: context.familyId,
        type: "image",
        mimeType: "image/jpeg",
        bytes: 1,
        sha256: "c".repeat(64),
        storageKey: `derivatives/${derived}.jpg`,
        originalFilename: "preview.jpg",
        importedAt: new Date(),
        timeSource: "import_time",
        createdByUserId: admin.id,
        originalAssetId: aid,
        derivativeType: "preview",
      })
      .run();
    db.insert(memoryEventAsset)
      .values({
        id: randomUUID(),
        familyId: context.familyId,
        memoryEventId: "new-year",
        assetId: aid,
      })
      .run();
    db.update(memoryEvent)
      .set({ coverAssetId: derived })
      .where(eq(memoryEvent.id, "new-year"))
      .run();
    const cid = randomUUID();
    db.insert(contribution)
      .values({
        id: cid,
        memoryEventId: "new-year",
        authorPersonId: mother,
        rawText: "私密原文",
        visibility: "private",
        audioAssetId: aid,
      })
      .run();
    expect(
      (
        await getCalendarMonth(context, "2026-01", { media: "image" })
      ).days.reduce((sum, d) => sum + d.count, 0),
    ).toBe(0);
    expect(
      (await getTimelinePage(context, { mediaType: "image" })).entries,
    ).toEqual([]);
    expect(
      (await getCalendarMonth(context, "2026-01")).days.flatMap(
        (d) => d.covers,
      ),
    ).toEqual([]);
    db.update(contribution)
      .set({ visibility: "family" })
      .where(eq(contribution.id, cid))
      .run();
    expect(
      (
        await getCalendarMonth(context, "2026-01", { media: "image" })
      ).days.reduce((sum, d) => sum + d.count, 0),
    ).toBe(1);
    expect(
      (await getCalendarMonth(context, "2026-01")).days.flatMap(
        (d) => d.covers,
      ),
    ).toHaveLength(1);
    expect(
      (await getTimelinePage(context, { mediaType: "image" })).entries.map(
        (e) => e.coverAssetId,
      ),
    ).toEqual([derived]);
  });
  it("moves a changed event across midnight immediately and includes the family-local year in EPUB", async () => {
    // Remove fake metadata-only cover before exercising the real EPUB publisher.
    db.update(memoryEvent)
      .set({ coverAssetId: null })
      .where(eq(memoryEvent.id, "new-year"))
      .run();
    const result = await generateYearBook(
      context.familyId,
      2026,
      "epub",
      "虚构家庭",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const zip = await (await import("jszip")).default.loadAsync(result.buffer);
    const text = (
      await Promise.all(
        Object.values(zip.files)
          .filter((f) => f.name.endsWith(".xhtml"))
          .map((f) => f.async("string")),
      )
    ).join("\n");
    expect(text).toContain("虚构记忆 new-year");
    expect(text).not.toContain("虚构记忆 old-year");
    expect(text).toContain("2026年1月1日");
    db.update(memoryEvent)
      .set({ occurredAt: new Date("2026-01-01T16:00:00Z") })
      .where(eq(memoryEvent.id, "new-year"))
      .run();
    const m = await getCalendarMonth(context, "2026-01");
    expect(m.days[0]?.count).toBe(0);
    expect(m.days[1]?.count).toBe(36);
  });
  it("authorizes actual API requests and refuses family overrides, invalid days and cross-family data", async () => {
    expect(
      (
        await GET(
          new Request("http://localhost/api/mobile/v1/calendar?month=2026-01"),
        )
      ).status,
    ).toBe(401);
    const token = randomUUID();
    db.insert(session)
      .values({
        id: randomUUID(),
        token,
        userId: admin.id,
        expiresAt: new Date(Date.now() + 3600000),
      })
      .run();
    const headers = { authorization: `Bearer ${token}` };
    const response = await GET(
      new Request("http://localhost/api/mobile/v1/calendar?month=2026-01", {
        headers,
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).days).toHaveLength(31);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/mobile/v1/calendar?month=2026-01&familyId=other",
            { headers },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/mobile/v1/calendar?month=2026-02&date=2026-02-30",
            { headers },
          ),
        )
      ).status,
    ).toBe(400);
    const fid = randomUUID();
    db.insert(family)
      .values({ id: fid, name: "另一个虚构家庭", timezone: "Asia/Shanghai" })
      .run();
    await expect(
      getCalendarMonth({ ...context, familyId: fid }, "2026-01"),
    ).rejects.toThrow("forbidden");
  });
});
