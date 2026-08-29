import { expect, test } from "@playwright/test";
import path from "node:path";

// 依赖 auth.spec / upload.spec 已完成 setup + onboarding
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.com", password: "e2e-admin-password" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
}

test("旧照片后上传：确认后时间轴按真实发生时间（8/10）展示", async ({ page }) => {
  await login(page);

  // 上传一张 EXIF 拍摄于 2026-08-10 09:30 +08:00 的照片
  // （用 offset 夹具：与 upload.spec 的 sample-exif.jpg 字节不同，避免 SHA-256 撞重）
  await page.goto("/capture");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif-offset.jpg"));
  await expect(page.getByText("已保存，等待整理")).toBeVisible();

  // 收件箱确认（EXIF 照片显示拍摄时间 8 月 10 日）
  await page.goto("/inbox");
  await expect(page.getByText("照片内嵌时间")).toBeVisible();
  await page.getByLabel("事件标题").fill("八月中旬的一个上午");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();

  // 跳转到事件详情：真实时间 8 月 10 日 + 出生当天（孩子生日 2026-08-10）
  await expect(page).toHaveURL(/\/memories\//);
  await expect(page.getByText("2026年8月10日 09:30").first()).toBeVisible();
  await expect(page.getByText("出生当天")).toBeVisible();

  // 时间轴：事件出现在 8 月分组，日期为 8 月 10 日（不是导入日 8 月 29 日）
  await page.goto("/timeline");
  await expect(page.getByRole("link", { name: /八月中旬的一个上午/ })).toBeVisible();
  await expect(page.getByText("2026年8月10日").first()).toBeVisible();
  // 导入日期绝不能作为事件日期出现
  await expect(page.getByText("2026年8月29日")).toHaveCount(0);
});

test("事件详情页展示素材与参与人", async ({ page }) => {
  await login(page);
  await page.goto("/timeline");
  await page.getByRole("link", { name: /八月中旬的一个上午/ }).click();
  await expect(page.getByRole("heading", { name: "八月中旬的一个上午" })).toBeVisible();
  await expect(page.getByText("原始资料（1）")).toBeVisible();
  await expect(page.getByText("小满（孩子）")).toBeVisible();
});
