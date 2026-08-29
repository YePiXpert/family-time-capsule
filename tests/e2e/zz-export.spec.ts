import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import JSZip from "jszip";

// Slice 6（PRD §23）：完整导出 → manifest/哈希/媒体验证
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.com", password: "e2e-admin-password" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
}

test("导出完整备份：ZIP 可下载、manifest 哈希全部可验证", async ({ page }) => {
  await login(page);

  const resp = await page.request.get("/api/export");
  expect(resp.status()).toBe(200);
  expect(resp.headers()["content-type"]).toBe("application/zip");
  const zipBuffer = Buffer.from(await resp.body());

  const zip = await JSZip.loadAsync(zipBuffer);
  const root = "family-time-capsule-export";

  const manifest = JSON.parse(await zip.file(`${root}/manifest.json`)!.async("string"));
  expect(manifest.exportVersion).toBe(1);
  expect(manifest.familyId).toBeTruthy();
  expect(manifest.assets.length).toBeGreaterThanOrEqual(7); // 前面各 spec 上传的原件

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

  // 封存胶囊内容在导出中完整（前面 capsule.spec 封存过一个）
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
