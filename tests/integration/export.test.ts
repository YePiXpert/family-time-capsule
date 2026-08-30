import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-export-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "export-setup-token";
process.env.AUTH_SECRET = "export-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const okSetup = await performSetup({
  token: "export-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
});
if (!okSetup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { completeOnboarding, addPerson, listPeople } = await import(
  "@/lib/family/service"
);
const { ingestImage, ingestMedia } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import(
  "@/lib/inbox/service"
);
const { confirmInboxEntry, mergeInboxEntries } = await import("@/lib/memories/service");
const { createContribution, addFact } = await import("@/lib/contributions/service");
const {
  createCapsule,
  sealCapsule,
  addCapsuleEvent,
} = await import("@/lib/capsules/service");
const { buildFamilyExport, ExportVerificationError } = await import(
  "@/lib/export/service"
);
const { getAssetStorage } = await import("@/lib/assets/storage");
const JSZip = (await import("jszip")).default;

const db = getDb();
const adminUserId = (await db.select({ id: userTable.id }).from(userTable))[0].id;
const onboarding = await completeOnboarding(adminUserId, {
  familyName: "我们一家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;

const fixtures = path.join(__dirname, "..", "fixtures");
const EXIF_JPG = readFileSync(path.join(fixtures, "sample-exif.jpg"));
const WAV = readFileSync(path.join(fixtures, "sample.wav"));

async function ingestN(n: number) {
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminUserId,
    filename: `照片${n}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([EXIF_JPG, Buffer.from([n])]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("store failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  return { asset: stored.asset, item };
}

// ---- 准备数据：合并事件（5 素材）、独立事件、文字、contribution、fact、封存胶囊 ----
const items: string[] = [];
for (let i = 1; i <= 5; i++) {
  const { item } = await ingestN(i);
  items.push(item.id);
}
const merged = await mergeInboxEntries(familyId, items, { title: "八月的一次出游" });
if (!merged.ok) throw new Error("merge failed");

const audio = await ingestMedia({
  familyId,
  createdByUserId: adminUserId,
  kind: "audio",
  filename: "外婆哼的歌.wav",
  declaredMime: "audio/wav",
  buffer: WAV,
  clientLastModifiedMs: null,
});
if (audio.status !== "stored") throw new Error("audio store failed");
const audioItem = await createInboxItemForAsset(familyId, audio.asset);
const audioEntry = (await getInboxEntry(familyId, audioItem.id))!;
const audioEvent = await confirmInboxEntry(familyId, audioEntry, { title: "外婆的歌" });
if (!audioEvent.ok) throw new Error("confirm failed");

await addPerson(familyId, { displayName: "外婆", relationToChild: "外婆" });
const people = await listPeople(familyId);
const grandma = people.find((p) => p.displayName === "外婆")!;
const contrib = await createContribution(familyId, {
  memoryEventId: merged.eventId,
  authorPersonId: grandma.id,
  rawText: "那天外婆抱着她不肯撒手。",
  visibility: "child_later",
});
if (!contrib.ok) throw new Error("contribution failed");
await addFact(familyId, merged.eventId, "2026-08-10 全家一起去了一次公园。");

const capsuleCreated = await createCapsule(familyId, {
  title: "写给一岁的你",
  unlockType: "date",
  unlockValue: "2027-08-10",
});
if (!capsuleCreated.ok) throw new Error("capsule failed");
await addCapsuleEvent(familyId, capsuleCreated.capsuleId, audioEvent.eventId);
await sealCapsule(familyId, capsuleCreated.capsuleId); // 未到期的封存胶囊

describe("完整导出（#014）", () => {
  it("导出 → 解压 → manifest/JSON/媒体齐全且哈希一致", async () => {
    const result = await buildFamilyExport(familyId);
    expect(result.assetCount).toBeGreaterThanOrEqual(6); // 5 图 + 1 音频
    expect(result.bytes).toBeGreaterThan(1000);

    const zip = await JSZip.loadAsync(readFileSync(result.filePath));
    const root = "family-time-capsule-export";

    // 必需 JSON 全部可解析
    const manifest = JSON.parse(
      await zip.file(`${root}/manifest.json`)!.async("string"),
    );
    const familyJson = JSON.parse(await zip.file(`${root}/family.json`)!.async("string"));
    const peopleJson = JSON.parse(await zip.file(`${root}/people.json`)!.async("string"));
    const memories = JSON.parse(await zip.file(`${root}/memories.json`)!.async("string"));
    const contributions = JSON.parse(
      await zip.file(`${root}/contributions.json`)!.async("string"),
    );
    const facts = JSON.parse(await zip.file(`${root}/facts.json`)!.async("string"));
    const capsules = JSON.parse(await zip.file(`${root}/capsules.json`)!.async("string"));
    const timelineMd = await zip.file(`${root}/timeline.md`)!.async("string");

    expect(manifest.exportVersion).toBe(1);
    expect(manifest.appVersion).toBe("0.1.2");
    expect(manifest.familyId).toBe(familyId);
    expect(familyJson.name).toBe("我们一家");
    expect(peopleJson.length).toBeGreaterThanOrEqual(3);

    // memories：合并事件有 5 个 asset、参与者
    const mergedEvent = memories.find((m: { title: string }) => m.title === "八月的一次出游");
    expect(mergedEvent.assetIds).toHaveLength(5);
    expect(mergedEvent.occurredAt).toBe("2026-08-10T01:30:00.000Z"); // EXIF 8/10

    expect(contributions.length).toBe(1);
    expect(contributions[0].rawText).toContain("不肯撒手");
    expect(facts.length).toBe(1);

    // 封存胶囊内容在导出中完整（export 始终包含）
    expect(capsules.length).toBe(1);
    expect(capsules[0].memoryEventIds).toHaveLength(1);
    expect(capsules[0].status).toBe("sealed");

    // timeline.md：相对路径引用 + 事件 + 讲述
    expect(timelineMd).toContain("# 我们一家 · 成长时间轴");
    expect(timelineMd).toContain("### 八月的一次出游");
    expect(timelineMd).toMatch(/\!\[[^\]]*\]\(originals\/images\/[0-9a-f-]+\.jpg\)/);
    expect(timelineMd).toContain("originals/audio/");
    expect(timelineMd).toContain("外婆说：");

    // manifest 每个原件：文件存在 + SHA-256 实际可验证
    for (const entry of manifest.assets) {
      const file = zip.file(`${root}/${entry.relativePath}`);
      expect(file, entry.relativePath).toBeTruthy();
      const buf = await file!.async("nodebuffer");
      expect(buf.byteLength).toBe(entry.bytes);
      const sha = createHash("sha256").update(buf).digest("hex");
      expect(sha).toBe(entry.sha256);
    }

    // 空目录占位
    expect(zip.file(`${root}/stories/.keep`)).toBeTruthy();
    expect(zip.file(`${root}/originals/documents/.keep`)).toBeTruthy();
  });

  it("原件被篡改 → 导出明确失败，不产出备份", async () => {
    const storage = getAssetStorage();
    // 找一个原件直接改写磁盘字节（模拟 bit rot / 篡改）
    const { getAsset } = await import("@/lib/assets/service");
    const all = await ingestN(99);
    const row = await getAsset(familyId, all.asset.id);
    const abs = storage.resolvePath(row!.storageKey);
    const fs = await import("node:fs");
    fs.writeFileSync(abs, Buffer.concat([readFileSync(abs), Buffer.from("tampered")]));

    await expect(buildFamilyExport(familyId)).rejects.toThrow(ExportVerificationError);
  });
});
