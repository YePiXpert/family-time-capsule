/**
 * 规模基准（M7）：构造 10,000 MemoryEvents + 50,000 asset 元数据行，
 * 测量 Timeline / Inbox / Search / Story 素材收集的耗时。
 *
 * 用法：npm run benchmark [-- --quick]（quick 用 1k/5k）
 * 结果写 stdout；docs/PERFORMANCE.md 记录方法学与数字。
 */
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const quick = process.argv.includes("--quick");
const EVENT_COUNT = quick ? 1_000 : 10_000;
const ASSET_COUNT = quick ? 5_000 : 50_000;

process.env.DATA_DIR = process.env.BENCHMARK_DATA_DIR ?? `benchmark-data-${Date.now()}`;
process.env.INITIAL_SETUP_TOKEN = "benchmark-setup-token";
process.env.AUTH_SECRET = "benchmark-secret";

const { closeDatabase, getDb } = await import("../db");
const { performSetup } = await import("../lib/auth/setup");
const { completeOnboarding } = await import("../lib/family/service");
const { getTimelinePage } = await import("../lib/memories/service");
const { getInboxPage } = await import("../lib/inbox/service");
const { searchFamily, rebuildSearchIndex } = await import("../lib/search/service");
const {
  collectStoryMaterial,
  collectTranscriptMaterial,
  periodForKind,
} = await import("../lib/stories/service");
const { memoryEvent } = await import("../db/schema/memory");
const { asset } = await import("../db/schema/asset");
const { person } = await import("../db/schema/family");
const { user } = await import("../db/schema/auth");
import type { FamilyContext } from "../lib/family/context";

const setup = await performSetup({
  token: "benchmark-setup-token",
  displayName: "基准",
  email: "bench@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select().from(user).get();
if (!admin) throw new Error("admin missing");
const on = await completeOnboarding(admin.id, {
  familyName: "基准家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2018-01-01",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
  selfIsGuardian: true,
});
if (!on.ok) throw new Error("onboarding failed");
const familyId = on.familyId;
const db = getDb();

const child = db.select().from(person).where(eq(person.isChild, true)).get();
if (!child) throw new Error("child missing");

const context: FamilyContext = {
  userId: admin.id,
  userName: "基准",
  familyId,
  personId: null,
  role: "admin",
  accountEnabled: true,
  isGuardian: false,
  familyTimezone: "Asia/Shanghai",
  childLaterUnlockAge: 18,
};

// —— 构造数据 ——
console.log(`构造 ${EVENT_COUNT} 个事件 / ${ASSET_COUNT} 条素材元数据…`);
const t0 = performance.now();

const now = new Date();
const baseTime = new Date(2018, 0, 1).getTime();
db.transaction((tx) => {
  for (let i = 0; i < EVENT_COUNT; i += 500) {
    const rows = Array.from(
      { length: Math.min(500, EVENT_COUNT - i) },
      (_, j) => {
        const index = i + j;
        return {
          id: randomUUID(),
          familyId,
          childPersonId: child.id,
          title: `基准事件 ${index}：第 ${Math.floor(index / 100)} 组`,
          occurredAt: new Date(baseTime + index * 3_600_000),
          occurredAtPrecision: "exact",
          locationText: null,
          coverAssetId: null,
          status: "confirmed",
          ageDays: index,
          createdAt: now,
          updatedAt: now,
        };
      },
    );
    tx.insert(memoryEvent).values(rows).run();
  }
});

db.transaction((tx) => {
  for (let i = 0; i < ASSET_COUNT; i += 500) {
    const rows = Array.from(
      { length: Math.min(500, ASSET_COUNT - i) },
      (_, j) => {
        const index = i + j;
        return {
          id: randomUUID(),
          familyId,
          type: "image" as const,
          originalFilename: `bench-${index}.jpg`,
          mimeType: "image/jpeg",
          bytes: 100_000,
          sha256: `${String(index).padStart(12, "0")}${"b".repeat(52)}`,
          storageKey: "originals/bench/shared-tiny.jpg",
          capturedAt: now,
          importedAt: now,
          timeSource: "file_metadata",
          width: 4000,
          height: 3000,
          durationMs: null,
          createdByUserId: admin.id,
          originalAssetId: null,
          derivativeType: null,
          createdAt: now,
        };
      },
    );
    tx.insert(asset).values(rows).run();
  }
});

console.log(`构造完成（${((performance.now() - t0) / 1000).toFixed(1)}s）`);

// —— 测量 ——
function bench(name: string, fn: () => unknown): void {
  fn(); // 预热
  const start = performance.now();
  fn();
  console.log(`${name}: ${(performance.now() - start).toFixed(1)} ms`);
}

async function benchAsync(name: string, fn: () => Promise<unknown>): Promise<void> {
  await fn();
  const start = performance.now();
  await fn();
  console.log(`${name}: ${(performance.now() - start).toFixed(1)} ms`);
}

const firstPage = await getTimelinePage(familyId, { limit: 30 });
bench("Timeline 首页（30 条）", () => void getTimelinePage(familyId, { limit: 30 }));
bench("Timeline 第二页（keyset 游标）", () =>
  void getTimelinePage(familyId, { limit: 30, cursor: firstPage.nextCursor }),
);

await benchAsync("Inbox 分页（空收件箱）", () =>
  getInboxPage(familyId, undefined, { limit: 50 }),
);

const indexStart = performance.now();
rebuildSearchIndex();
console.log(
  `搜索索引重建（${EVENT_COUNT} 事件）: ${((performance.now() - indexStart) / 1000).toFixed(1)} s`,
);

bench("搜索：3 字命中（事件标题）", () => searchFamily(context, { q: "基准事件" }));
bench("搜索：无命中", () => searchFamily(context, { q: "绝不存在的词组" }));
bench("搜索：2 字 + 日期过滤", () =>
  searchFamily(context, { q: "基准", dateFrom: "2018-01-01", dateTo: "2018-12-31" }),
);

const period = periodForKind("yearly", new Date(2018, 5, 1));
bench("Story 素材收集（全年）", () => {
  collectStoryMaterial(familyId, period);
  collectTranscriptMaterial(familyId, period);
});

closeDatabase();
console.log("基准完成。");
