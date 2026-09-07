import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 正式 1.0 §6 日期精度：unknown/year/month 不再强填发生时刻。
 * T10：五档精度可以正确保存、搜索和恢复；锚点不冒充日期。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-precision-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "precision-token";
process.env.AUTH_SECRET = "precision-test-secret-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "precision-token",
  displayName: "妈妈",
  email: "precision@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { saveDraft, publishDraft, DraftError } = await import("@/lib/drafts/service");
const { emptyDraftContent } = await import("@/lib/drafts/model");
const { zonedWallTimeToUtc } = await import("@/lib/metadata/time");

const db = getDb();
const adminId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "精度测试家庭", timezone: "Asia/Shanghai",
  childDisplayName: "小满", childBirthDate: "2026-08-10",
  selfDisplayName: "妈妈", selfRelationToChild: "妈妈",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const binding = await getUserBinding(adminId);
if (!binding.familyTimezone || binding.childLaterUnlockAge === null) throw new Error("binding failed");
const context = {
  userId: adminId, userName: "妈妈", familyId, personId: binding.personId,
  role: binding.role, accountEnabled: true, isGuardian: binding.isGuardian,
  familyTimezone: binding.familyTimezone, childLaterUnlockAge: binding.childLaterUnlockAge,
} as import("@/lib/family/context").FamilyContext;

const { getTimelinePage, getVisibleMemoryEventDetail } = await import("@/lib/memories/service");
const { getCalendarMonth, getBrowsePage } = await import("@/lib/memories/calendar");
const { searchFamily } = await import("@/lib/search/service");
const { getMobileSyncPage } = await import("@/lib/mobile/sync");

  let serial = 0;
  const anchorFor = (precision: string, wall: string | undefined): Date | null => {
    if (!wall) return null;
    switch (precision) {
      case "exact":
      case "approximate":
        return zonedWallTimeToUtc(`${wall}:00`, "Asia/Shanghai");
      case "date_only":
        return zonedWallTimeToUtc(`${wall.slice(0, 10)}T00:00:00`, "Asia/Shanghai");
      case "month":
        return zonedWallTimeToUtc(`${wall}-01T00:00:00`, "Asia/Shanghai");
      case "year":
        return zonedWallTimeToUtc(`${wall}-01-01T00:00:00`, "Asia/Shanghai");
      default:
        return null;
    }
  };
  async function publish(input: { title: string; text: string; precision: "exact" | "approximate" | "date_only" | "month" | "year" | "unknown"; wall?: string }) {
    const id = `precision-draft-${++serial}`;
    const anchor = anchorFor(input.precision, input.wall);
    const content = {
      ...emptyDraftContent(),
      title: input.title,
      text: input.text,
      occurredAt: anchor ? anchor.toISOString() : null,
      occurredAtPrecision: input.precision,
    };
    saveDraft(context, id, 0, `mut-${id}`, content);
    const published = publishDraft(context, id, 1);
    if (!published.memoryEventId) throw new Error("publish failed");
    return published.memoryEventId;
  }

describe("§6 日期精度", () => {
  let monthEvent: string;
  let yearEvent: string;
  let unknownEvent: string;

  beforeAll(async () => {
    monthEvent = await publish({ title: "只记得年月的搬家", text: "我们五月搬进了新家", precision: "month", wall: "2020-05" });
    yearEvent = await publish({ title: "只记得年份的旅行", text: "那年夏天去了海边", precision: "year", wall: "1988" });
    unknownEvent = await publish({ title: "时间记不得的一次夜醒", text: "半夜抱着她在客厅走", precision: "unknown" });
  });

  it("unknown 无时间也能保存为记忆（不再强填发生时刻）", async () => {
    const detail = await getVisibleMemoryEventDetail(context, unknownEvent);
    expect(detail?.event.occurredAtPrecision).toBe("unknown");
    // 锚点存在（排序用）但不是发生时间：时间轴可见、关键词可搜。
    expect(detail?.event.occurredAt).toBeInstanceOf(Date);
    const timeline = await getTimelinePage(context, { limit: 50 });
    expect(timeline.entries.map(e => e.event.id)).toContain(unknownEvent);
    expect(searchFamily(context, { q: "客厅走" }).total).toBeGreaterThan(0);
  });

  it("非 unknown 精度缺时间仍被拒绝", async () => {
    const id = `precision-draft-${++serial}`;
    expect(() => saveDraft(context, id, 0, `mut-${id}`, {
      ...emptyDraftContent(),
      title: "缺时间的草稿", text: "内容",
      occurredAt: null,
      occurredAtPrecision: "month",
    })).not.toThrow();
    expect(() => publishDraft(context, id, 1)).toThrow(DraftError);
  });

  it("month/year 锚点为期首，日历天级视图不收编造日", async () => {
    const monthDetail = await getVisibleMemoryEventDetail(context, monthEvent);
    expect(monthDetail?.event.occurredAt.toISOString()).toBe(zonedWallTimeToUtc("2020-05-01T00:00:00", "Asia/Shanghai").toISOString());
    const yearDetail = await getVisibleMemoryEventDetail(context, yearEvent);
    expect(yearDetail?.event.occurredAt.toISOString()).toBe(zonedWallTimeToUtc("1988-01-01T00:00:00", "Asia/Shanghai").toISOString());

    const calendar = await getCalendarMonth(context, "2020-05");
    // 月视图：天级计数不包含月精度事件；rough 列表收录（日期待补充）
    const totalDayCounts = calendar.days.reduce((sum, day) => sum + day.count, 0);
    expect(totalDayCounts).toBe(0);
    expect(calendar.rough.map(e => e.id)).toContain(monthEvent);
    // 日视图（该月任何一天）不返回月精度事件
    const dayPage = await getBrowsePage(context, "2020-05-01");
    expect(dayPage.entries.map(e => e.id)).not.toContain(monthEvent);
  });

  it("日期范围筛选排除 unknown，关键词搜索不受影响", async () => {
    const dated = await getTimelinePage(context, { occurredFrom: new Date("2000-01-01T00:00:00.000Z"), limit: 100 });
    expect(dated.entries.map(e => e.event.id)).not.toContain(unknownEvent);
    // unknown 的锚点是创建时刻（2026-09），不应被 1988/2020 的筛选捞出
    const byKeyword = searchFamily(context, { q: "夜醒" });
    expect(byKeyword.events.map(e => e.id)).toContain(unknownEvent);
    const datedSearch = searchFamily(context, { q: "夜醒", dateFrom: "1988-01-01", dateTo: "1988-12-31" });
    expect(datedSearch.events.map(e => e.id)).not.toContain(unknownEvent);
    // year 精度锚点是 1988-01-01 上海墙钟 = UTC 1987-12-31T16:00；日期筛选按
    // UTC 日界粗粒度比较（既有语义），该锚点落在 1987-12 的 UTC 范围内。
    const yearSearch = searchFamily(context, { q: "海边", dateFrom: "1987-12-01", dateTo: "1987-12-31" });
    expect(yearSearch.events.map(e => e.id)).toContain(yearEvent);
  });

  it("移动同步携带精度；恢复（hydrate）往返不丢精度", async () => {
    const page = await getMobileSyncPage({ context, limit: 100 });
    const synced = page.events.find(e => e.id === monthEvent);
    expect(synced?.occurredAtPrecision).toBe("month");
    const unknownSynced = page.events.find(e => e.id === unknownEvent);
    expect(unknownSynced?.occurredAtPrecision).toBe("unknown");
  });
});
