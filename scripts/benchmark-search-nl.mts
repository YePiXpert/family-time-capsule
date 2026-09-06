/**
 * 自然语言辅助检索 vs 关键词基线 的 Recall@K / 误召回评测（M7 / FIND-4）。
 *
 * 白皮书要求：先报告相对关键词基线的 Recall@K 与误召回，再决定是否值得
 * 更重的索引方案。本脚本在隔离 DATA_DIR 中构造合成家庭语料，分别跑
 * “原句直接作为关键词”与“自然语言计划(可注入 fake/真实 assistant)”两条
 * 路径，输出对比表。不使用真实家庭数据；真实模型评测需授权 Key 与
 * ~200 份许可样本（见 docs/release-1.0/BLOCKERS.md BLK-8）。
 *
 * 用法：
 *   DATA_DIR=$(mktemp -d) npm run benchmark -- scripts/benchmark-search-nl.mts
 *   # 或带真实 assistant（默认 deterministic fake）:
 *   DATA_DIR=... npm run benchmark -- scripts/benchmark-search-nl.mts --json
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "ftc-nlbench-"));
process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET ??= "nlbench-secret-0123456789abcdef";

const { getDb, closeDatabase } = await import("../db/index.ts");
const { family: familyTable, person: personTable } = await import("../db/schema/family.ts");
const { memoryEvent } = await import("../db/schema/memory.ts");
const { user: userTable } = await import("../db/schema/auth.ts");
const { indexMemoryEvent, searchFamily } = await import("../lib/search/service.ts");
const { DeterministicFakeMemoryAssistant } = await import("../lib/ai/fake.ts");
const {
  expandNaturalLanguageQuery,
  planToSearchParams,
} = await import("../lib/search/natural-language.ts");

const now = new Date();
const familyId = "nlbench-family";
const userId = "nlbench-user";

const db = getDb();
db.insert(familyTable).values({ id: familyId, name: "评测家庭", timezone: "Asia/Shanghai", createdAt: now, updatedAt: now }).run();
db.insert(userTable).values({ id: userId, name: "评测", email: "nlbench@example.test", emailVerified: true, role: "owner", createdAt: now, updatedAt: now }).run();
db.insert(personTable).values({ id: "child-1", familyId, displayName: "小满", isChild: true, birthDate: "2023-06-01", createdAt: now, updatedAt: now }).run();
const childPersonId = "child-1";

const context = {
  userId, userName: "评测", familyId, personId: null,
  role: "owner" as const, accountEnabled: true, isGuardian: false,
  familyTimezone: "Asia/Shanghai", childLaterUnlockAge: 18,
};

type Seed = { id: string; title: string; text: string; date: string };
const seeds: Seed[] = [
  { id: "e1", title: "公园放风筝", text: "四月的风很好，全家去公园的草地上放风筝，风筝飞得很高。", date: "2026-04-11T15:00:00Z" },
  { id: "e2", title: "海边挖沙", text: "夏天的海边，孩子光脚在沙滩上挖了一下午的沙堡。", date: "2026-07-19T09:30:00Z" },
  { id: "e3", title: "第一次发烧", text: "夜里孩子发烧，全家紧张地量体温、贴退热贴，第二天好转。", date: "2025-12-03T02:00:00Z" },
  { id: "e4", title: "外婆的饺子", text: "过年时外婆教孩子包饺子，面粉撒了一桌子，笑声不断。", date: "2026-02-16T11:00:00Z" },
  { id: "e5", title: "幼儿园第一天", text: "背上小书包走进幼儿园教室，孩子挥手说再见没有哭。", date: "2026-09-01T08:00:00Z" },
  { id: "e6", title: "雨天读绘本", text: "下雨的周末窝在沙发里，一口气读了五本恐龙绘本。", date: "2026-05-23T14:00:00Z" },
];

for (const seed of seeds) {
  db.insert(memoryEvent).values({
    id: seed.id, familyId, title: seed.title, childPersonId,
    occurredAt: new Date(seed.date), timezone: "Asia/Shanghai",
    createdAt: now, updatedAt: now,
  }).run();
  indexMemoryEvent({ id: seed.id, familyId, title: `${seed.title} ${seed.text}`, childPersonId });
}

type Query = { query: string; relevant: string[] };
const queries: Query[] = [
  { query: "找一张春天在户外放风筝的记忆", relevant: ["e1"] },
  { query: "孩子在海边玩沙子", relevant: ["e2"] },
  { query: "小孩生病发烧的那天晚上", relevant: ["e3"] },
  { query: "过年和外婆一起包饺子", relevant: ["e4"] },
  { query: "刚上幼儿园的时候", relevant: ["e5"] },
  { query: "下雨天在家看恐龙书", relevant: ["e6"] },
];

function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  const top = retrieved.slice(0, k);
  return relevant.filter((id) => top.includes(id)).length / relevant.length;
}

function evaluate(lookup: (query: string) => string[]) {
  const recalls = [1, 3, 5].map((k) => {
    const values = queries.map((q) => recallAtK(lookup(q.query), q.relevant, k));
    return { k, recall: values.reduce((a, b) => a + b, 0) / values.length };
  });
  const falsePositives = queries.flatMap((q) =>
    lookup(q.query).filter((id) => !q.relevant.includes(id)),
  );
  return { recalls, falsePositives };
}

// 基线：用户的原句整句作为 FTS 关键词（AND 语义，长句通常命中不足）。
const baseline = evaluate((query) =>
  searchFamily(context, { q: query }).events.map((e) => e.id),
);

// 辅助路径：fake assistant 的确定性输出不可控，这里直接用“人工理想计划”
// 模拟一个正确转换的模型（上限评测）；真实模型需 live Key（BLK-1）。
const idealPlan = evaluate((query) => {
  const seed = queries.find((q) => q.query === query)!;
  const terms = seed.relevant
    .map((id) => seeds.find((s) => s.id === id)!.title)
    .join(" ");
  return searchFamily(context, { q: terms }).events.map((e) => e.id);
});

// 真实调用路径冒烟：fake assistant 不支持可控 JSON → 必须失败关闭而非报错。
const fakeAssistant = new DeterministicFakeMemoryAssistant();
let fakeFailedClosed = 0;
for (const q of queries) {
  const expansion = await expandNaturalLanguageQuery(fakeAssistant, q.query);
  if (!expansion.ok) fakeFailedClosed += 1;
}

const asJson = process.argv.includes("--json");
const report = {
  dataset: { events: seeds.length, queries: queries.length },
  baseline,
  idealPlanUpperBound: idealPlan,
  fakeAssistantFailedClosed: `${fakeFailedClosed}/${queries.length}`,
  note: "理想计划是模型正确转换时的上限；真实模型 Recall@K 需授权 Key 后在同一脚本上运行（BLK-1/BLK-8）。",
};
console.log(asJson ? JSON.stringify(report, null, 2) : require("node:util").inspect(report, { depth: 4 }));

if (!process.env.DATA_DIR) {
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
}
