import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import JSZip from "jszip";
const race = vi.hoisted(() => ({ afterMedia: null as (() => void) | null, afterStat: null as (() => void) | null, afterArtifact: null as (() => void) | null, media: null as Response | null }));
vi.mock("@/app/api/media/[assetId]/route", async importOriginal => {
  const actual = await importOriginal<typeof import("@/app/api/media/[assetId]/route")>();
  return { ...actual, GET: async (...args: Parameters<typeof actual.GET>) => {
    const response = await actual.GET(...args);
    if (race.afterMedia) { race.media = response; const mutate = race.afterMedia; race.afterMedia = null; mutate(); }
    return response;
  } };
});
vi.mock("@/lib/books/render/jobs", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/books/render/jobs")>();
  return { ...actual, readableBookArtifact: async (...args: Parameters<typeof actual.readableBookArtifact>) => {
    const result = await actual.readableBookArtifact(...args);
    if (race.afterArtifact) { const mutate = race.afterArtifact; race.afterArtifact = null; mutate(); }
    return result;
  } };
});
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: async (...args: Parameters<typeof actual.stat>) => {
    const info = await actual.stat(...args);
    if (race.afterStat && String(args[0]).includes("book-renders")) { const mutate = race.afterStat; race.afterStat = null; mutate(); }
    return info;
  } };
});
const root = mkdtempSync(path.join(tmpdir(), "ftc-reading-package-"));
process.env.DATA_DIR = root;
process.env.INITIAL_SETUP_TOKEN = "fictional-reading";
process.env.AUTH_SECRET = "fictional-reading-secret";
delete process.env.AI_API_KEY;
const { getDb, closeDatabase } = await import("@/db");
await (
  await import("@/lib/auth/setup")
).performSetup({
  token: "fictional-reading",
  displayName: "虚构阅读管理员",
  email: "reading@example.test",
  password: "fictional-reading-password",
});
const { user } = await import("@/db/schema/auth"),
  { memoryEventAsset } = await import("@/db/schema/memory"),
  { contribution } = await import("@/db/schema/contribution");
const actor = getDb().select().from(user).get()!,
  family = await import("@/lib/family/service");
await family.completeOnboarding(actor.id, {
  familyName: "虚构阅读家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小雨",
  childBirthDate: "2024-01-31",
  selfDisplayName: "爸爸",
  selfRelationToChild: "爸爸",
});
const binding = await family.getUserBinding(actor.id),
  context = {
    ...binding,
    userId: actor.id,
    userName: actor.name,
    familyId: binding.familyId!,
    familyTimezone: binding.familyTimezone!,
    childLaterUnlockAge: binding.childLaterUnlockAge!,
  };
const inbox = await import("@/lib/inbox/service"),
  entry = await inbox.createTextInboxItem(context.familyId, "虚构阅读素材原文"),
  confirmed = await (
    await import("@/lib/memories/service")
  ).confirmInboxEntry(
    context.familyId,
    (await inbox.getInboxEntry(context.familyId, entry.id))!,
    { title: "虚构窗边来信", occurredAt: new Date("2024-02-01T01:00:00Z") },
  );
if (!confirmed.ok) throw Error("confirm");
const eventId = confirmed.eventId;
const ingest = await import("@/lib/assets/ingest"),
  audioBytes = readFileSync(
    path.join(process.cwd(), "tests/fixtures/sample.wav"),
  );
const image = await ingest.ingestImage({
    familyId: context.familyId,
    createdByUserId: actor.id,
    filename: "fictional-reading.jpg",
    declaredMime: "image/jpeg",
    buffer: await (
      await import("sharp")
    )
      .default(
        Buffer.from(
          `<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="600" fill="#edd9ba"/><rect x="150" y="100" width="600" height="350" rx="20" fill="#c3c8a4"/><circle cx="350" cy="240" r="65" fill="#c78a68"/><circle cx="550" cy="270" r="45" fill="#deab83"/><path d="M280 390 Q350 290 420 390 M495 390 Q550 325 605 390" fill="#a77057"/></svg>`,
        ),
      )
      .jpeg()
      .toBuffer(),
  }),
  audio = await ingest.ingestMedia({
    familyId: context.familyId,
    createdByUserId: actor.id,
    kind: "audio",
    filename: "fictional-family-voice.wav",
    declaredMime: "audio/wav",
    buffer: audioBytes,
  });
if (image.status !== "stored" || audio.status !== "stored")
  throw Error("ingest");
getDb()
  .insert(memoryEventAsset)
  .values(
    [image.asset.id, audio.asset.id].map((assetId) => ({
      id: randomUUID(),
      familyId: context.familyId,
      memoryEventId: eventId,
      assetId,
    })),
  )
  .run();
const voiceId = randomUUID();
getDb()
  .insert(contribution)
  .values({
    id: voiceId,
    memoryEventId: eventId,
    authorPersonId: context.personId!,
    rawText: "虚构家人的声音",
    audioAssetId: audio.asset.id,
    visibility: "family",
  })
  .run();
const books = await import("@/lib/books/projects/service"),
  renders = await import("@/lib/books/render/jobs"),
  id = books.createBookProject(context, "虚构精选阅读包", "growth", "family");
let book = (await import("@/lib/books/projects/select")).addBookSelections(
  context,
  id,
  1,
  [{ kind: "memory", id: eventId }],
);
book = books.saveBookProject(context, id, book.revision, {
  ...book,
  subtitle:
    '用户文字 <script>window.leak=true</script> & <img src="https://example.test/track">',
});
afterAll(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
});
let jobId = "";
it("actual queued ZIP embeds selectable content, local styles/images and byte-identical allowed audio without scripts or online dependencies", async () => {
  const job = renders.requestBookRender(
    context,
    id,
    book.revision,
    "reading_zip",
  );
  jobId = job.id;
  expect(await renders.runBookWorkerOnce()).toBe("succeeded");
  const file = await renders.readableBookArtifact(context, job.id),
    zip = await JSZip.loadAsync(readFileSync(file.path));
  const html = await zip.file("index.html")!.async("string");
  expect(html).toContain("精选阅读包");
  expect(html).toContain("虚构阅读素材原文");
  expect(html).toContain("不是完整可恢复备份");
  expect(html).toContain("无法远程收回");
  expect(html).toContain("&lt;script&gt;window.leak=true&lt;/script&gt;");
  expect(html).not.toContain("<script");
  expect(html).not.toMatch(/(?:src|href)="https?:/);
  expect(html).not.toContain("/api/");
  expect(html).not.toContain("Bearer");
  expect(html).toContain('preload="none"');
  expect(zip.file("style.css")).toBeTruthy();
  expect(zip.file("sources.txt")).toBeTruthy();
  const files = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  expect(files.some((n) => n.startsWith("images/") && n.endsWith(".jpg"))).toBe(
    true,
  );
  const media = files.find(
    (n) => n.startsWith("media/") && n.endsWith(".wav"),
  )!;
  expect(media).toBeTruthy();
  expect(
    createHash("sha256")
      .update(await zip.file(media)!.async("nodebuffer"))
      .digest("hex"),
  ).toBe(createHash("sha256").update(audioBytes).digest("hex"));
  expect(files).not.toContain("manifest.json");
  expect(files.every((n) => !n.includes("..") && !n.startsWith("/"))).toBe(
    true,
  );
});
it("authenticated reading manifests and ranged files enforce current audience, digest and family", async () => {
  const { session } = await import("@/db/schema/auth"),
    token = randomUUID();
  getDb()
    .insert(session)
    .values({
      id: randomUUID(),
      userId: actor.id,
      token,
      expiresAt: new Date(Date.now() + 3600000),
    })
    .run();
  const headers = { authorization: `Bearer ${token}` },
    api = await import("@/app/api/reading/[kind]/[id]/route"),
    files = await import("@/app/api/reading/[kind]/[id]/files/[assetId]/route"),
    params = Promise.resolve({ kind: "book", id });
  const result = await api.GET(
    new Request(`http://localhost/api/reading/book/${id}`, { headers }),
    { params },
  );
  expect(result.status).toBe(200);
  const manifest = await result.json();
  expect(manifest.userId).toBe(actor.id);
  expect(manifest.media).toHaveLength(2);
  expect(
    manifest.media.find((m: { id: string }) => m.id === audio.asset.id).author,
  ).toBe("爸爸");
  expect(JSON.stringify(manifest)).not.toContain(token);
  expect(JSON.stringify(manifest)).not.toContain(root);
  const url = `http://localhost/api/reading/book/${id}/files/${audio.asset.id}?digest=${manifest.digest}`,
    fileParams = Promise.resolve({ kind: "book", id, assetId: audio.asset.id });
  const response = await files.GET(
    new Request(url, { headers: { ...headers, range: "bytes=0-31" } }),
    { params: fileParams },
  );
  expect(response.status).toBe(206);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(
    audioBytes.subarray(0, 32),
  );
  expect(
    (
      await files.GET(
        new Request(url.replace(manifest.digest, "0".repeat(64)), { headers }),
        { params: fileParams },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await api.GET(new Request(`http://localhost/api/reading/book/${id}`), {
        params,
      })
    ).status,
  ).toBe(401);
  const foreign = randomUUID(),
    foreignToken = randomUUID();
  getDb()
    .insert(user)
    .values({
      id: foreign,
      name: "另一虚构管理员",
      email: "other-reading@example.test",
      role: "admin",
    })
    .run();
  await family.completeOnboarding(foreign, {
    familyName: "另一阅读家庭",
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
      userId: foreign,
      token: foreignToken,
      expiresAt: new Date(Date.now() + 3600000),
    })
    .run();
  expect(
    (
      await api.GET(
        new Request(`http://localhost/api/reading/book/${id}`, {
          headers: { authorization: `Bearer ${foreignToken}` },
        }),
        { params },
      )
    ).status,
  ).toBe(404);
  getDb()
    .update(contribution)
    .set({ visibility: "private" })
    .where(eq(contribution.id, voiceId))
    .run();
  expect(
    (await files.GET(new Request(url, { headers }), { params: fileParams }))
      .status,
  ).toBe(409);
  const changed = await (
    await api.GET(
      new Request(`http://localhost/api/reading/book/${id}`, { headers }),
      { params },
    )
  ).json();
  expect(changed.media.map((m: { id: string }) => m.id)).not.toContain(
    audio.asset.id,
  );
  getDb()
    .update(contribution)
    .set({ visibility: "family" })
    .where(eq(contribution.id, voiceId))
    .run();
});
function setSourceVisibility(visibility: "family" | "private") {
  const connection = new Database(path.join(root, "db/capsule.sqlite"));
  try { connection.prepare("update memory_event set visibility=?,created_by_user_id=? where id=?").run(visibility, visibility === "private" ? actor.id : null, eventId); }
  finally { connection.close(); }
}
it("rechecks the package after real media read and cancels bytes when another connection withdraws its source", async () => {
  const { session } = await import("@/db/schema/auth"), token = randomUUID();
  getDb().insert(session).values({ id: randomUUID(), userId: actor.id, token, expiresAt: new Date(Date.now() + 3600000) }).run();
  const { getReadingManifest } = await import("@/lib/reading/service");
  const files = await import("@/app/api/reading/[kind]/[id]/files/[assetId]/route");
  const manifest = getReadingManifest(context, "book", id);
  race.afterMedia = () => setSourceVisibility("private");
  try {
    const result = await files.GET(new Request(`http://localhost/api/reading/book/${id}/files/${audio.asset.id}?digest=${manifest.digest}`, { headers: { authorization: `Bearer ${token}`, range: "bytes=0-31" } }), { params: Promise.resolve({ kind: "book", id, assetId: audio.asset.id }) });
    expect(race.media?.status).toBe(206); // actual media route authorized this independently shared original
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: "source_unavailable" });
    expect(race.media?.bodyUsed).toBe(true); // denied prepared stream is disposed
  } finally {
    await race.media?.body?.cancel().catch(() => {});
    race.afterMedia = null; race.media = null; setSourceVisibility("family");
  }
});
it.each(["afterStat", "afterArtifact"] as const)("rechecks rendered ZIP access at %s before the HTTP handler returns bytes", async boundary => {
  const { session } = await import("@/db/schema/auth"), token = randomUUID();
  getDb().insert(session).values({ id: randomUUID(), userId: actor.id, token, expiresAt: new Date(Date.now() + 3600000) }).run();
  const { GET } = await import("@/app/api/books/renders/[id]/download/route");
  race[boundary] = () => setSourceVisibility("private");
  let result: Response | undefined;
  try {
    result = await GET(new Request(`http://localhost/api/books/renders/${jobId}/download`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: jobId }) });
    expect(race[boundary]).toBeNull(); // the real filesystem/helper boundary completed
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: "source_unavailable" });
  } finally { await result?.body?.cancel().catch(() => {}); race[boundary] = null; setSourceVisibility("family"); }
});
it("downloads a real rendered archive whose editable title contains an unpaired Unicode surrogate", async () => {
  const unicodeId = books.createBookProject(context, "合成 Unicode", "growth", "family");
  const original = books.getBookProject(context, unicodeId);
  const unicodeBook = books.saveBookProject(context, unicodeId, original.revision, { ...original, title: "合成\ud800作品" });
  const queued = renders.requestBookRender(context, unicodeId, unicodeBook.revision, "reading_zip");
  expect(await renders.runBookWorkerOnce()).toBe("succeeded");
  const { session } = await import("@/db/schema/auth"), token = randomUUID();
  getDb().insert(session).values({ id: randomUUID(), userId: actor.id, token, expiresAt: new Date(Date.now() + 3600000) }).run();
  const { GET } = await import("@/app/api/books/renders/[id]/download/route");
  const result = await GET(new Request(`http://localhost/api/books/renders/${queued.id}/download`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: queued.id }) });
  expect(result.status).toBe(200);
  expect(decodeURIComponent(result.headers.get("content-disposition")!)).toContain("合成�作品.zip");
  const bytes = await result.arrayBuffer();
  expect(bytes.byteLength).toBe(renders.getBookRender(context, queued.id).bytes);
  expect((await JSZip.loadAsync(bytes)).file("index.html")).not.toBeNull();
});
it("extracted file:// package renders images and local CSS with networking disabled and user scripts inert", async () => {
  const { chromium } = await import("@playwright/test"),
    { pathToFileURL } = await import("node:url");
  const file = await renders.readableBookArtifact(context, jobId),
    zip = await JSZip.loadAsync(readFileSync(file.path)),
    dir = path.join(root, "unpacked");
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const target = path.join(dir, entry.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, await entry.async("nodebuffer"));
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ offline: true }),
      page = await ctx.newPage(),
      network: string[] = [];
    page.on("request", (req) => {
      if (/^https?:/.test(req.url())) network.push(req.url());
    });
    await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
    expect(await page.locator("img").count()).toBeGreaterThan(0);
    expect(
      await page
        .locator("img")
        .evaluateAll((images) =>
          images.every((i) => (i as HTMLImageElement).naturalWidth > 0),
        ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgb(255, 250, 244)");
    expect(await page.evaluate(() => "leak" in window)).toBe(false);
    expect(network).toEqual([]);
    await page.screenshot({
      path: "/tmp/ftc-m7-offline-reading.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});
it("tightening a supplementary voice invalidates the old ZIP and excludes its original from a newly generated package", async () => {
  getDb()
    .update(contribution)
    .set({ visibility: "private" })
    .where(eq(contribution.id, voiceId))
    .run();
  expect(renders.getBookRender(context, jobId).downloadable).toBe(false);
  await expect(renders.readableBookArtifact(context, jobId)).rejects.toThrow(
    "source_changed",
  );
  const next = renders.requestBookRender(
    context,
    id,
    book.revision,
    "reading_zip",
  );
  expect(next.id).not.toBe(jobId);
  expect(await renders.runBookWorkerOnce()).toBe("succeeded");
  const file = await renders.readableBookArtifact(context, next.id),
    zip = await JSZip.loadAsync(readFileSync(file.path));
  expect(
    Object.keys(zip.files).some(
      (n) => n.startsWith("media/") && !zip.files[n]!.dir,
    ),
  ).toBe(false);
  expect(await zip.file("index.html")!.async("string")).not.toContain(
    "fictional-family-voice.wav",
  );
});
