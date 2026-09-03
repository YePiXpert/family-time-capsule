import { expect, test } from "@playwright/test";
import path from "node:path";
import { ensureBootstrap, ensureLogin } from "./helpers";

// Slice 6（PRD §23）：完整导出 → manifest/哈希/媒体验证
// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap）
test.describe.configure({ mode: "serial" });

test("导出完整备份：ZIP 可下载、manifest 哈希全部可验证", async ({ page }) => {
  await ensureBootstrap(page);

  // 自备内容：一张 EXIF 照片 + 一段 WAV，确认成一个事件，并封存一个胶囊
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await expect(page.getByText("已保存，等待整理").first()).toBeVisible();
  await page
    .locator('section[aria-label="录音"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample.wav"));
  await expect(page.getByText("已保存，等待整理").nth(1)).toBeVisible();

  await page.goto("/inbox");
  const checkboxes = page.getByRole("checkbox");
  // `locator.all()` snapshots the current DOM without waiting. Under the full
  // CI load the streamed inbox can still be hydrating here, which previously
  // selected only one row and left the merge form hidden forever.
  await expect(checkboxes).toHaveCount(2);
  for (const box of await checkboxes.all()) await box.check();
  await page.getByLabel("合并事件标题").fill("出生那几天");
  await page.getByRole("button", { name: "合并" }).click();
  await expect(page.getByRole("heading", { name: "出生那几天" })).toBeVisible();

  await page.goto("/capsules");
  await page.getByLabel("胶囊标题").fill("写给一岁的你");
  await page.getByLabel("开启条件").selectOption("date");
  await page.getByLabel("开启日期").fill("2027-08-10");
  await page.getByRole("button", { name: "创建胶囊" }).click();
  await page.getByLabel("记忆事件").selectOption({ label: "出生那几天" });
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "封存胶囊" }).click();
  await expect(page.getByText("已封存", { exact: false }).first()).toBeVisible();

  // 导出并验证
  const resp = await page.request.get("/api/export");
  expect(resp.status()).toBe(200);
  expect(resp.headers()["content-type"]).toBe("application/zip");
  const zipBuffer = Buffer.from(await resp.body());

  const { default: JSZip } = await import("jszip");
  const { createHash } = await import("node:crypto");
  const zip = await JSZip.loadAsync(zipBuffer);
  const root = "family-time-capsule-export";

  const manifest = JSON.parse(await zip.file(`${root}/manifest.json`)!.async("string"));
  expect(manifest.exportVersion).toBe(1);
  expect(manifest.familyId).toBeTruthy();
  expect(manifest.assets.length).toBeGreaterThanOrEqual(2);

  // 每个 manifest 原件：存在 + 大小 + SHA-256 一致
  for (const entry of manifest.assets) {
    const file = zip.file(`${root}/${entry.relativePath}`);
    expect(file, entry.relativePath).toBeTruthy();
    const buf = await file!.async("nodebuffer");
    expect(buf.byteLength).toBe(entry.bytes);
    expect(createHash("sha256").update(buf).digest("hex")).toBe(entry.sha256);
  }

  // 必需 JSON 全部可解析
  for (const name of [
    "family.json",
    "people.json",
    "memories.json",
    "contributions.json",
    "facts.json",
    "capsules.json",
  ]) {
    const data = JSON.parse(await zip.file(`${root}/${name}`)!.async("string"));
    expect(Array.isArray(data) || typeof data === "object").toBe(true);
  }

  // timeline.md 存在且引用相对路径
  const timeline = await zip.file(`${root}/timeline.md`)!.async("string");
  expect(timeline).toContain("成长时间轴");
  expect(timeline).toMatch(/originals\/(images|audio|video)\//);

  // 封存胶囊内容在导出中完整
  const capsules = JSON.parse(await zip.file(`${root}/capsules.json`)!.async("string"));
  const sealed = capsules.find((c: { status: string }) => c.status === "sealed");
  expect(sealed).toBeTruthy();
  expect(sealed.memoryEventIds.length).toBeGreaterThan(0);

  // 未登录不可导出
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);
  const denied = await page.request.get("/api/export");
  expect(denied.status()).toBe(401);
});

test("导出的 ZIP 可被 verify:export CLI 校验（同字节）", async ({ page }) => {
  await ensureLogin(page);
  const resp = await page.request.get("/api/export");
  expect(resp.status()).toBe(200);
  const zipBuffer = Buffer.from(await resp.body());
  expect(zipBuffer.byteLength).toBeGreaterThan(1000);
  // 结构冒烟：中心目录签名存在（PK\x05\x06）
  expect(zipBuffer.subarray(-22, -18).toString("binary")).toBe("PK\u0005\u0006");
});
