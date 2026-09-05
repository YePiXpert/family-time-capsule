import {
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import JSZip from "jszip";
import { afterAll, expect, it } from "vitest";
const root = mkdtempSync(path.join(tmpdir(), "ftc-publication-"));
process.env.DATA_DIR = root;
process.env.INITIAL_SETUP_TOKEN = "publication-test";
process.env.AUTH_SECRET = "publication-test-secret";
delete process.env.AI_API_KEY;
const { getDb, closeDatabase } = await import("@/db");
await (
  await import("@/lib/auth/setup")
).performSetup({
  token: "publication-test",
  displayName: "虚构出版管理员",
  email: "publication@example.test",
  password: "publication-test-password",
});
const { user, session } = await import("@/db/schema/auth"),
  { person } = await import("@/db/schema/family"),
  { memoryEvent, memoryEventAsset } = await import("@/db/schema/memory"),
  { contribution } = await import("@/db/schema/contribution"),
  { bookRenderJob } = await import("@/db/schema/book-render-job");
const actor = getDb().select().from(user).get()!,
  familyService = await import("@/lib/family/service");
await familyService.completeOnboarding(actor.id, {
  familyName: "虚构出版家庭",
  timezone: "America/New_York",
  childDisplayName: "小雨",
  childBirthDate: "2024-02-29",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
const binding = await familyService.getUserBinding(actor.id),
  context = {
    ...binding,
    userId: actor.id,
    userName: actor.name,
    familyId: binding.familyId!,
    familyTimezone: binding.familyTimezone!,
    childLaterUnlockAge: binding.childLaterUnlockAge!,
  };
const { createTextInboxItem, getInboxEntry } =
    await import("@/lib/inbox/service"),
  { confirmInboxEntry } = await import("@/lib/memories/service");
const note = await createTextInboxItem(
    context.familyId,
    "虚构家庭的原始记录，春天一起读信。",
  ),
  entry = await getInboxEntry(context.familyId, note.id),
  confirmed = await confirmInboxEntry(context.familyId, entry!, {
    title: "虚构家庭春日来信",
    occurredAt: new Date("2024-03-01T05:30:00Z"),
  });
if (!confirmed.ok) throw new Error("confirm");
const eventId = confirmed.eventId;
const picture = await sharp(
  Buffer.from(
    '<svg width="2400" height="1800"><rect width="2400" height="1800" fill="#f1dfc2"/><circle cx="900" cy="850" r="600" fill="#819d88"/><rect x="1400" y="350" width="500" height="1100" fill="#c67660"/></svg>',
  ),
)
  .jpeg()
  .toBuffer();
const ingested = await (
  await import("@/lib/assets/ingest")
).ingestImage({
  familyId: context.familyId,
  createdByUserId: actor.id,
  filename: "fictional-publication.jpg",
  declaredMime: "image/jpeg",
  buffer: picture,
});
if (ingested.status !== "stored") throw new Error("ingest");
const assetId = ingested.asset.id;
getDb()
  .insert(memoryEventAsset)
  .values({
    id: randomUUID(),
    familyId: context.familyId,
    memoryEventId: eventId,
    assetId,
  })
  .run();
getDb()
  .insert(contribution)
  .values({
    id: randomUUID(),
    memoryEventId: eventId,
    authorPersonId: context.personId!,
    rawText: "绝不能进入家庭出版物的私密测试原文",
    visibility: "private",
  })
  .run();
const books = await import("@/lib/books/projects/service"),
  { addBookSelections } = await import("@/lib/books/projects/select"),
  renders = await import("@/lib/books/render/jobs");
const id = books.createBookProject(
  context,
  "三十二页虚构图文成长册",
  "growth",
  "family",
);
let book = addBookSelections(context, id, 1, [{ kind: "memory", id: eventId }]);
const imageBlock = book.blocks.find((b) => b.kind === "image")!;
book = books.saveBookProject(context, id, book.revision, {
  ...book,
  coverAssetId: assetId,
  blocks: Array.from({ length: 32 }, (_, i) => ({
    ...imageBlock,
    id: randomUUID(),
    text: `第${i + 1}封虚构家书：春天，我们在窗边一起读信。Mixed English 中文与闰日，真实文字可以搜索。`,
    caption: `虚构插图说明 ${i + 1}`,
    layout: {
      ...imageBlock.layout,
      breakBefore: true,
      fit: i % 2 ? "cover" : "contain",
    },
  })),
});
const token = randomUUID();
getDb()
  .insert(session)
  .values({
    id: randomUUID(),
    userId: actor.id,
    token,
    expiresAt: new Date(Date.now() + 3600000),
  })
  .run();
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const { POST } = await import("@/app/api/books/projects/[id]/renders/route"),
  { GET: download } =
    await import("@/app/api/books/renders/[id]/download/route");
afterAll(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
});
function command(program: string, args: string[]) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(
    result.status,
    result.stdout + result.stderr + String(result.error || ""),
  ).toBe(0);
  return result.stdout;
}
let pdfId = "",
  epubId = "";
it("queued publication runs in a real isolated renderer; 30+ page PDF extracts Chinese, every page renders within bounds, EPUBCheck passes", async () => {
  const created = await POST(
    new Request(`http://localhost/api/books/projects/${id}/renders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ format: "pdf", revision: book.revision }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(created.status).toBe(202);
  const job = await created.json();
  pdfId = job.id;
  expect(job.status).toBe("queued");
  expect(renders.requestBookRender(context, id, book.revision, "pdf").id).toBe(
    pdfId,
  );
  const outcomes = await Promise.all([
    renders.runBookWorkerOnce(),
    renders.runBookWorkerOnce(),
  ]);
  expect(
    outcomes.sort(),
    JSON.stringify(renders.getBookRender(context, pdfId)),
  ).toEqual(["idle", "succeeded"]);
  expect(
    getDb()
      .select()
      .from(bookRenderJob)
      .where(eq(bookRenderJob.id, pdfId))
      .get()?.attempt,
  ).toBe(1);
  const pdf = renders.getBookRender(context, pdfId);
  expect(pdf.status, pdf.errorCode ?? "").toBe("succeeded");
  expect(pdf.pages).toBeGreaterThan(30);
  expect(pdf.pages).toBeLessThanOrEqual(200);
  expect(pdf.downloadable).toBe(true);
  const artifact = await renders.readableBookArtifact(context, pdfId),
    response = await download(
      new Request(`http://localhost/api/books/renders/${pdfId}/download`, {
        headers,
      }),
      { params: Promise.resolve({ id: pdfId }) },
    );
  expect(response.status).toBe(200);
  expect((await response.arrayBuffer()).byteLength).toBe(pdf.bytes);
  const extracted = command("pdftotext", [artifact.path, "-"]);
  for (let i = 1; i <= 32; i++)
    expect(extracted.replace(/\s/g, "")).toContain(`第${i}封虚构家书`);
  expect(extracted).toContain("Mixed English");
  expect(extracted).not.toContain("绝不能进入家庭出版物");
  expect(extracted).not.toContain("/api/");
  expect(extracted).not.toContain(token);
  const bbox = command("pdftotext", ["-bbox", artifact.path, "-"]);
  const pageElements = [
    ...bbox.matchAll(
      /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g,
    ),
  ];
  expect(pageElements).toHaveLength(pdf.pages!);
  for (const [, width, height, body] of pageElements) {
    const words = [
      ...body!.matchAll(
        /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">/g,
      ),
    ];
    expect(words.length).toBeGreaterThan(0);
    for (const [, x1, y1, x2, y2] of words) {
      expect(Number(x1)).toBeGreaterThanOrEqual(0);
      expect(Number(y1)).toBeGreaterThanOrEqual(0);
      expect(Number(x2)).toBeLessThanOrEqual(Number(width));
      expect(Number(y2)).toBeLessThanOrEqual(Number(height));
    }
  }
  command("pdftoppm", [
    "-r",
    "60",
    "-png",
    artifact.path,
    path.join(root, "page"),
  ]);
  const files = readdirSync(root)
    .filter((n) => /^page-\d+\.png$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  expect(files).toHaveLength(pdf.pages!);
  const tiles = [];
  for (const [index, file] of files.entries()) {
    const stats = await sharp(path.join(root, file)).stats();
    expect(stats.channels[0]!.stdev, `blank page ${index + 1}`).toBeGreaterThan(
      5,
    );
    tiles.push({
      input: await sharp(path.join(root, file))
        .resize(210, 300, { fit: "contain", background: "white" })
        .png()
        .toBuffer(),
      left: (index % 6) * 210,
      top: Math.floor(index / 6) * 300,
    });
  }
  await sharp({
    create: {
      width: 1260,
      height: Math.ceil(files.length / 6) * 300,
      channels: 3,
      background: "#dedede",
    },
  })
    .composite(tiles)
    .png()
    .toFile("/tmp/ftc-publication-contact.png");
  epubId = renders.requestBookRender(context, id, book.revision, "epub").id;
  expect(await renders.runBookWorkerOnce()).toBe("succeeded");
  const epub = await renders.readableBookArtifact(context, epubId);
  command("epubcheck", [epub.path]);
  const zip = await JSZip.loadAsync(readFileSync(epub.path));
  expect(await zip.file("mimetype")!.async("string")).toBe(
    "application/epub+zip",
  );
  const xhtml = await zip.file("OEBPS/chapter-0.xhtml")!.async("string");
  expect(xhtml).toContain("第32封虚构家书");
  expect(xhtml).toContain("<img");
  expect(xhtml).not.toContain("/api/");
  expect(xhtml).not.toContain("绝不能进入家庭出版物");
  writeFileSync(
    "/tmp/ftc-publication-verification.json",
    JSON.stringify({
      pdfPages: pdf.pages,
      pdfBytes: pdf.bytes,
      epubBytes: epub.row.bytes,
      textExtraction: "passed",
      pageBboxes: "all in bounds",
      renderedPages: files.length,
      epubcheck: "passed",
    }),
  );
}, 120000);
it("long mixed text paginates without clipping; excessive pages and unsupported glyphs fail with recoverable jobs", async () => {
  const id = books.createBookProject(
    context,
    "虚构长文来信",
    "letters",
    "family",
  );
  let doc = books.getBookProject(context, id);
  const block = {
    id: randomUUID(),
    chapterId: doc.chapters[0]!.id,
    kind: "quote" as const,
    text: "虚构家书的长段落，中文标点与 Mixed English words 一起换行。\n".repeat(
      120,
    ),
    caption: "长文结束后保留署名",
    layout: imageBlock.layout,
    sourceIds: [],
  };
  doc = books.saveBookProject(context, id, doc.revision, {
    ...doc,
    pageSize: "A4",
    blocks: [block],
  });
  let job = renders.requestBookRender(context, id, doc.revision, "pdf");
  expect(await renders.runBookWorkerOnce()).toBe("succeeded");
  const file = await renders.readableBookArtifact(context, job.id);
  const extracted = command("pdftotext", [file.path, "-"]);
  expect(extracted.match(/虚构家书的长段落/g) || []).toHaveLength(120);
  expect(extracted).toContain("长文结束后保留署名");
  expect(renders.getBookRender(context, job.id).pages).toBeGreaterThan(3);
  doc = books.saveBookProject(context, id, doc.revision, {
    ...doc,
    blocks: Array.from({ length: 201 }, () => ({
      ...block,
      id: randomUUID(),
      text: "虚构单页",
      layout: { ...block.layout, breakBefore: true },
    })),
  });
  job = renders.requestBookRender(context, id, doc.revision, "pdf");
  expect(await renders.runBookWorkerOnce()).toBe("failed");
  expect(renders.getBookRender(context, job.id).errorCode).toBe(
    "page_limit_exceeded",
  );
  expect(renders.getBookRender(context, job.id).downloadable).toBe(false);
  doc = books.saveBookProject(context, id, doc.revision, {
    ...doc,
    blocks: [{ ...block, text: String.fromCodePoint(0x10ffff) }],
  });
  job = renders.requestBookRender(context, id, doc.revision, "pdf");
  expect(await renders.runBookWorkerOnce()).toBe("failed");
  expect(renders.getBookRender(context, job.id).errorCode).toBe(
    "unsupported_glyph_U10FFFF",
  );
  expect(books.getBookProject(context, id).blocks[0]?.text).toBe(
    String.fromCodePoint(0x10ffff),
  );
}, 120000);
it("cancel stops an actual child and retry preserves idempotency; source drift and tighter permissions deny old downloads", async () => {
  const alternate = books.createBookProject(
    context,
    "取消测试虚构册",
    "growth",
    "family",
  );
  const doc = addBookSelections(context, alternate, 1, [
    { kind: "memory", id: eventId },
  ]);
  const queued = renders.requestBookRender(
    context,
    alternate,
    doc.revision,
    "pdf",
  );
  const running = renders.runBookWorkerOnce();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await renders.changeBookRender(context, queued.id, "cancel");
  await running;
  expect(renders.getBookRender(context, queued.id).status).toBe("cancelled");
  await renders.changeBookRender(context, queued.id, "retry");
  expect(await renders.runBookWorkerOnce()).toBe("succeeded");
  expect(
    renders.requestBookRender(context, alternate, doc.revision, "pdf").id,
  ).toBe(queued.id);
  getDb()
    .update(memoryEvent)
    .set({ title: "来源后来有了新标题" })
    .where(eq(memoryEvent.id, eventId))
    .run();
  expect(renders.getBookRender(context, pdfId).downloadable).toBe(false);
  const stale = await download(
    new Request(`http://localhost/api/books/renders/${pdfId}/download`, {
      headers,
    }),
    { params: Promise.resolve({ id: pdfId }) },
  );
  expect(stale.status).toBe(409);
  expect(books.getBookProject(context, id).blocks[0]?.text).toContain(
    "第1封虚构家书",
  );
  const next = renders.requestBookRender(context, id, book.revision, "pdf");
  expect(next.id).not.toBe(pdfId);
  await renders.changeBookRender(context, next.id, "cancel");
  getDb()
    .insert(contribution)
    .values({
      id: randomUUID(),
      memoryEventId: eventId,
      authorPersonId: context.personId!,
      rawText: "私密关联的历史音频引用",
      audioAssetId: assetId,
      visibility: "private",
    })
    .run();
  expect(() =>
    renders.requestBookRender(context, id, book.revision, "pdf"),
  ).toThrow("source_unavailable");
  expect(
    (
      await download(
        new Request(`http://localhost/api/books/renders/${epubId}/download`, {
          headers,
        }),
        { params: Promise.resolve({ id: epubId }) },
      )
    ).status,
  ).toBe(409);
  const other = randomUUID();
  getDb()
    .insert(person)
    .values({
      id: other,
      familyId: context.familyId,
      displayName: "另一位虚构家人",
    })
    .run();
  const foreignContext = { ...context, personId: other };
  expect(() => renders.getBookRender(foreignContext, pdfId)).toThrow(
    "forbidden",
  );
  expect(getDb().select().from(bookRenderJob).all().length).toBeGreaterThan(0);
}, 120000);

it("a real authenticated administrator in another family cannot enumerate, create or download these render jobs", async () => {
  const foreignUser = randomUUID(),
    foreignToken = randomUUID();
  getDb()
    .insert(user)
    .values({
      id: foreignUser,
      name: "另一虚构家庭管理员",
      email: "foreign-publication@example.test",
      role: "admin",
    })
    .run();
  await familyService.completeOnboarding(foreignUser, {
    familyName: "独立虚构家庭",
    timezone: "Asia/Shanghai",
    childDisplayName: "小月",
    childBirthDate: "2024-01-31",
    selfDisplayName: "妈妈",
    selfRelationToChild: "妈妈",
  });
  getDb()
    .insert(session)
    .values({
      id: randomUUID(),
      userId: foreignUser,
      token: foreignToken,
      expiresAt: new Date(Date.now() + 3600000),
    })
    .run();
  const foreignHeaders = {
    authorization: `Bearer ${foreignToken}`,
    "content-type": "application/json",
  };
  const { GET: list } =
    await import("@/app/api/books/projects/[id]/renders/route");
  const { GET: status } = await import("@/app/api/books/renders/[id]/route");
  expect(
    (
      await list(
        new Request(`http://localhost/api/books/projects/${id}/renders`, {
          headers: foreignHeaders,
        }),
        { params: Promise.resolve({ id }) },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await POST(
        new Request(`http://localhost/api/books/projects/${id}/renders`, {
          method: "POST",
          headers: foreignHeaders,
          body: JSON.stringify({ revision: book.revision, format: "pdf" }),
        }),
        { params: Promise.resolve({ id }) },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await status(
        new Request(`http://localhost/api/books/renders/${pdfId}`, {
          headers: foreignHeaders,
        }),
        { params: Promise.resolve({ id: pdfId }) },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await download(
        new Request(`http://localhost/api/books/renders/${pdfId}/download`, {
          headers: foreignHeaders,
        }),
        { params: Promise.resolve({ id: pdfId }) },
      )
    ).status,
  ).toBe(404);
});
