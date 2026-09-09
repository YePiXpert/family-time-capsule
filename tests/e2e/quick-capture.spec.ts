import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureBootstrap } from "./helpers";
import { QUICK_CAPTURE_AI_ENV } from "./helpers/capture-ai";

let provider: Server, calls = 0, refuse = false;
// This journey shares consent and queue state; retrying the whole group against
// its already-mutated server would test a different starting condition.
test.describe.configure({ mode: "serial", retries: 0 });
test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls++;
    response.setHeader("content-type", "application/json");
    if (refuse) { response.writeHead(401); response.end(JSON.stringify({ error: { message: "synthetic refusal" } })); return; }
    if (request.url?.includes("audio/transcriptions")) {
      response.end(JSON.stringify({ text: "今天在窗边给绿植浇水。", language: "zh", segments: [{ start: 0, end: 0.2, text: "今天在窗边给绿植浇水。" }] }));
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const content = body.model === "capture-vision-fixture" ? "【描述】窗边有一盆绿色植物。\n【图中文字】无。" : JSON.stringify({ title: "窗边的绿植与浇水声", locationText: null, occurredAt: null, timePrecision: "approximate", tags: ["绿植"], personNames: [], facts: [] });
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }));
  });
  await new Promise<void>(resolve => provider.listen(3997, "127.0.0.1", resolve));
});
test.afterAll(async () => { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); });
async function workOnce() {
  const result = await promisify(execFile)(process.execPath, [".next/ops/worker.mjs", "--once"], {
    cwd: process.cwd(), env: { ...process.env, ...QUICK_CAPTURE_AI_ENV, DATA_DIR: path.join(process.cwd(), "data/e2e-quick-capture"), AUTH_SECRET: "e2e-test-auth-secret-0123456789abcdef" }, timeout: 30000,
  });
  return result.stdout + (result.stdout.includes("[ai-worker] failed")
    ? `\n${JSON.stringify(dbRead(db => db.prepare("select job_type, status, last_error_code from ai_job").all()))}` : "");
}
function dbRead<T>(read: (db: Database.Database) => T): T {
  const db = new Database(path.join(process.cwd(), "data/e2e-quick-capture/db/capsule.sqlite"), { readonly: true });
  try { return read(db); } finally { db.close(); }
}

test("choose photos and save without filling any field or enabling AI; same-day EXIF is a date, absent metadata remains unknown", async ({ page }) => {
  await ensureBootstrap(page);
  for (const filename of ["sample-exif.jpg", "sample.jpg"]) {
    await page.goto("/capture");
    await expect(page.getByLabel("标题", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("发生时间", { exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await page.getByLabel("添加照片、视频、录音或文档").setInputFiles(path.join(__dirname, "../fixtures", filename));
    await expect(page.locator("main ol > li")).toHaveCount(1);
    await expect(page.getByText("保存后按已有授权在后台整理，不影响原件。")).toHaveCount(0);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (width === 375) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.getByRole("button", { name: "保存", exact: true })).toBeInViewport();
      }
      await page.screenshot({ path: `test-results/quick-capture-${width}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
    const href = (await page.getByRole("link", { name: "查看这条记忆" }).getAttribute("href"))!;
    const eventId = href.split("/").at(-1)!;
    expect(dbRead(db => db.prepare("select occurred_at_precision from memory_event where id=?").get(eventId))).toEqual({ occurred_at_precision: filename === "sample-exif.jpg" ? "date_only" : "unknown" });
    expect(dbRead(db => db.prepare("select count(*) n from memory_event_asset where memory_event_id=?").get(eventId))).toEqual({ n: 1 });
  }
  expect(calls).toBe(0);
  expect(dbRead(db => db.prepare("select count(*) n from ai_job").get())).toEqual({ n: 0 });
});

test("one save survives a lost response, runs real queued image/audio/text HTTP steps and presents an adoptable title", async ({ page }) => {
  test.setTimeout(90000);
  await ensureBootstrap(page);
  await page.goto("/settings/ai");
  for (const name of ["文字整理与信息建议", "图片与视频画面理解", "音频与视频音轨转录"]) {
    const card = page.locator("article", { has: page.getByRole("heading", { name }) });
    await card.getByLabel("允许系统自动处理明确标为“家人可见”的内容").check();
    await card.getByRole("button", { name: "同意启用这项外部处理" }).click();
    await expect(card.getByText("可使用")).toBeVisible();
  }
  await page.goto("/capture");
  await page.getByLabel("添加照片、视频、录音或文档").setInputFiles(["sample-exif.jpg", "sample.wav"].map(name => path.join(__dirname, "../fixtures", name)));
  const before = dbRead(db => (db.prepare("select count(*) n from memory_event").get() as { n: number }).n);
  let committed = false;
  await page.route("**/api/mobile/v1/drafts/*/publish", async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true); committed = true;
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeEnabled();
  expect(dbRead(db => db.prepare("select count(*) n from memory_event").get())).toEqual({ n: before + 1 });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
  expect(dbRead(db => db.prepare("select count(*) n from ai_job").get())).toEqual({ n: 3 });
  expect(calls).toBe(0);
  await page.getByText("AI 帮我起名", { exact: true }).click();
  await page.getByText("修改标题与审核 AI 建议", { exact: true }).click();
  for (let i = 0; i < 3; i++) expect(await workOnce()).toContain("[ai-worker] completed");
  await expect(page.getByText("AI 建议：窗边的绿植与浇水声", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "采用", exact: true })).toBeEnabled();
  expect(calls).toBe(3);
  expect(dbRead(db => db.prepare("select count(*) n from memory_event").get())).toEqual({ n: before + 1 });
  expect(dbRead(db => db.prepare("select title from memory_event order by rowid desc limit 1").get())).toEqual({ title: "一段家庭记忆" });
  // Transcript and non-title suggestions are reviewable without inventing dates.
  await page.getByText("查看录音文字", { exact: true }).click();
  await expect(page.getByText("今天在窗边给绿植浇水。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "采用", exact: true }).click();
  await expect(page.getByRole("button", { name: "撤销这次采用" })).toBeVisible();
  expect(dbRead(db => db.prepare("select title from memory_event order by rowid desc limit 1").get())).toEqual({ title: "窗边的绿植与浇水声" });
  expect(dbRead(db => db.prepare("select count(*) n from asset where original_asset_id is null and visibility <> 'private'").get())).toEqual({ n: 0 });
});

test("failed AI still leaves the saved memory readable; private save never requests processing", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("今天只想先把这件事记下来。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
  await page.getByText("AI 帮我起名", { exact: true }).click();
  refuse = true;
  try { expect(await workOnce()).toContain("[ai-worker] failed"); } finally { refuse = false; }
  await expect(page.getByText("整理服务拒绝了请求", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page.locator("main")).toContainText("今天只想先把这件事记下来。");
  const count = calls;
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("仅自己可见的记录");
  await page.locator("summary").filter({ hasText: "全家可见" }).click();
  await page.getByLabel("保存后的读者").selectOption("private");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
  expect(calls).toBe(count);
  expect(await workOnce()).toContain("[ai-worker] idle");
});
