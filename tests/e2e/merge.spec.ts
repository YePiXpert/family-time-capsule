import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Slice 2（PRD §23）：5 张照片 → 勾选 → 合并为一个 MemoryEvent
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.com", password: "e2e-admin-password" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
}

test("上传 5 张照片合并为一个事件", async ({ page }) => {
  await login(page);

  // 5 个字节各不相同的 JPEG
  const base = readFileSync(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  const files = [1, 2, 3, 4, 5].map((n) => ({
    name: `出游${n}.jpg`,
    mimeType: "image/jpeg",
    buffer: Buffer.concat([base, Buffer.from([n])]),
  }));

  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(files);
  await expect(page.getByText("已保存，等待整理").first()).toBeVisible();
  await expect(page.getByText("已保存，等待整理")).toHaveCount(5);

  // 收件箱全选 → 合并
  await page.goto("/inbox");
  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(5);
  for (const box of await checkboxes.all()) await box.check();

  await page.getByLabel("合并事件标题").fill("八月的一次出游");
  await page.getByRole("button", { name: "合并" }).click();

  // 一个事件，5 份素材
  await expect(page).toHaveURL(/\/memories\//);
  await expect(page.getByRole("heading", { name: "八月的一次出游" })).toBeVisible();
  await expect(page.getByText("原始资料（5）")).toBeVisible();

  // 收件箱已清空
  await page.goto("/inbox");
  await expect(page.getByText("没有待整理的内容")).toBeVisible();
});
