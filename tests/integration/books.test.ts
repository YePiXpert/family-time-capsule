import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "@/lib/family/context";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-books-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "books-setup-token";
process.env.AUTH_SECRET = "books-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import("@/lib/family/service");
const { ingestImage } = await import("@/lib/assets/ingest");
const { createInboxItemForAsset, getInboxEntry } = await import("@/lib/inbox/service");
const { confirmInboxEntry } = await import("@/lib/memories/service");
const {
  createStoryDraft,
  publishStory,
  periodForKind,
  collectStoryMaterial,
  collectTranscriptMaterial,
  planDeterministicDraft,
} = await import("@/lib/stories/service");
const { generateStoryBook, generateYearBook } = await import("@/lib/books/service");
const { wrapText } = await import("@/lib/books/layout");

const setup = await performSetup({
  token: "books-setup-token",
  displayName: "爸爸",
  email: "dad-books@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");
const admin = getDb().select({ id: userTable.id }).from(userTable).get();
if (!admin) throw new Error("admin missing");
const adminId = admin.id;
const onboarding = await completeOnboarding(adminId, {
  familyName: "书籍测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-08-10",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const binding = await getUserBinding(adminId);
if (
  !binding.familyTimezone ||
  binding.childLaterUnlockAge === null ||
  binding.personId === null
) {
  throw new Error("binding incomplete");
}
const adminTimezone = binding.familyTimezone;
const adminUnlockAge = binding.childLaterUnlockAge;
const adminPersonId = binding.personId;

const context: FamilyContext = {
  userId: adminId,
  userName: "爸爸",
  familyId,
  personId: adminPersonId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: binding.isGuardian,
  familyTimezone: adminTimezone,
  childLaterUnlockAge: adminUnlockAge,
};

const fixtures = path.join(__dirname, "..", "fixtures");
let ingestSerial = 0;
async function makeEventAt(title: string, occurredAt: Date) {
  ingestSerial += 1;
  const stored = await ingestImage({
    familyId,
    createdByUserId: adminId,
    filename: `${title}.jpg`,
    declaredMime: "image/jpeg",
    buffer: Buffer.concat([
      readFileSync(path.join(fixtures, "sample-exif.jpg")),
      Buffer.from([ingestSerial]),
    ]),
    clientLastModifiedMs: null,
  });
  if (stored.status !== "stored") throw new Error("ingest failed");
  const item = await createInboxItemForAsset(familyId, stored.asset);
  const entry = (await getInboxEntry(familyId, item.id))!;
  const ev = await confirmInboxEntry(familyId, entry, { title, occurredAt });
  if (!ev.ok) throw new Error("confirm failed");
  return ev.eventId;
}

describe("M6：换行排版", () => {
  it("CJK 逐字折行；拉丁词不拆", () => {
    const lines = wrapText("小满今天第一次翻身了 hello world", 200, 34);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const latin = wrapText("beautiful moment", 200, 34);
    for (const line of latin) {
      expect(line.startsWith("beautiful") || line.startsWith("moment")).toBe(true);
    }
  });
});

describe("M6：故事书 PDF/EPUB", () => {
  let storyId = "";

  it("已发布故事生成结构合法的 PDF（无内部 URL）", async () => {
    const eventId = await makeEventAt(
      "出生那几天",
      new Date("2026-08-11T02:00:00.000Z"),
    );
    const { addFact, createContribution } = await import("@/lib/contributions/service");
    await addFact(familyId, eventId, "小满出生时六斤八两。");
    await createContribution(familyId, {
      memoryEventId: eventId,
      authorPersonId: adminPersonId,
      recordedByUserId: adminId,
      rawText: "那天凌晨我数着走廊的灯等她出生。",
      visibility: "family",
    });
    const anchor = new Date("2026-08-12T00:00:00.000Z");
    const period = periodForKind("weekly", anchor);
    const plans = planDeterministicDraft(
      collectStoryMaterial(familyId, period),
      collectTranscriptMaterial(familyId, period),
    );
    const created = createStoryDraft(
      context,
      { kind: "weekly", anchor, title: "出生的那一周" },
      plans,
    );
    if (!created.ok) throw new Error("draft failed");
    storyId = created.storyId;
    expect(await publishStory(context, storyId)).toEqual({ ok: true });

    const pdf = await generateStoryBook(familyId, storyId, "pdf", "书籍测试家庭");
    if (!pdf.ok) throw new Error("pdf failed");
    const bytes = pdf.buffer;
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.subarray(-6).toString("latin1")).toContain("%%EOF");
    const text = bytes.toString("latin1");
    expect(text).toContain("/Type /Catalog");
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(1);
    // 内部鉴权 URL 绝不出现
    expect(text).not.toContain("/api/media");
    expect(pdf.filename.endsWith(".pdf")).toBe(true);
  });

  it("EPUB：mimetype 首位不压缩、OPF/nav/章节齐全、媒体内嵌", async () => {
    const epub = await generateStoryBook(familyId, storyId, "epub", "书籍测试家庭");
    if (!epub.ok) throw new Error("epub failed");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(epub.buffer);

    // mimetype 首位且未压缩
    const firstEntryName = Object.keys(zip.files)[0];
    expect(firstEntryName).toBe("mimetype");
    expect(await zip.file("mimetype")!.async("string")).toBe("application/epub+zip");
    expect(zip.file("META-INF/container.xml")).toBeTruthy();
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("<dc:title>出生的那一周</dc:title>");
    expect(opf).toContain('properties="nav"');
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    expect(nav).toContain('epub:type="toc"');
    const chapter = await zip.file("OEBPS/chapter0.xhtml")!.async("string");
    expect(chapter).toContain("出生的那一周");
    expect(chapter).not.toContain("/api/media");
    expect(epub.filename.endsWith(".epub")).toBe(true);
  });

  it("未发布故事拒绝成书", async () => {
    const result = await generateStoryBook(familyId, "missing-story", "pdf", "家");
    expect(result).toEqual({ ok: false, error: "story_not_found" });
  });
});

describe("M6：年度书（含内嵌媒体）", () => {
  it("事件成书：PDF 含 DCTDecode 图像；EPUB 有 images/ 条目", async () => {
    await makeEventAt("百日宴", new Date("2026-11-18T02:00:00.000Z"));

    const pdf = await generateYearBook(familyId, 2026, "pdf", "书籍测试家庭");
    if (!pdf.ok) throw new Error("year pdf failed");
    expect(pdf.buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = pdf.buffer.toString("latin1");
    expect((text.match(/\/DCTDecode/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain("/api/media");

    const epub = await generateYearBook(familyId, 2026, "epub", "书籍测试家庭");
    if (!epub.ok) throw new Error("year epub failed");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(epub.buffer);
    const names = Object.keys(zip.files);
    const imageEntries = names.filter((n) => n.startsWith("OEBPS/images/"));
    expect(imageEntries.length).toBeGreaterThanOrEqual(1);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('media-type="image/jpeg"');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it("无事件的年份拒绝成书", async () => {
    expect(await generateYearBook(familyId, 1999, "pdf", "家")).toEqual({
      ok: false,
      error: "no_events",
    });
  });
});
