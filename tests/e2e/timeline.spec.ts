import { expect, test } from "@playwright/test";
import path from "node:path";
import { ensureBootstrap, ensureLogin } from "./helpers";

// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap）
test.describe.configure({ mode: "serial" });

test("旧照片后上传：确认后时间轴按真实发生时间（8/10）展示", async ({ page }) => {
  await ensureBootstrap(page);

  // 上传一张 EXIF 拍摄于 2026-08-10 09:30 +08:00 的照片
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
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

  // 时间轴：事件出现在 8 月分组，日期为 8 月 10 日（不是导入日）
  await page.goto("/timeline");
  const link = page.getByRole("link", { name: /八月中旬的一个上午/ });
  await expect(link).toBeVisible();
  await expect(link.getByText("2026年8月10日")).toBeVisible();
});

test("事件详情页展示素材与参与人", async ({ page }) => {
  await ensureLogin(page);
  await page.goto("/timeline");
  await page.getByRole("link", { name: /八月中旬的一个上午/ }).click();
  await expect(page.getByRole("heading", { name: "八月中旬的一个上午" })).toBeVisible();
  await expect(page.getByText("原始资料（1）")).toBeVisible();
  await expect(page.getByText("小满（孩子）")).toBeVisible();
});

test("375px 五项导航无横向滚动且搜索可用键盘打开", async ({ page }) => {
  await ensureLogin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "一级导航" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);

  const search = page.getByRole("link", { name: "搜索家庭记忆" });
  await search.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("heading", { name: "搜索" })).toBeVisible();
});

test("记忆回顾与人物主页可以从产品界面进入", async ({ page }) => {
  await ensureLogin(page);

  await page.goto("/memories/resurfacing");
  await expect(page.getByRole("heading", { name: "记忆回顾" })).toBeVisible();
  await expect(page.getByRole("link", { name: "浏览完整时间轴" })).toBeVisible();

  await page.goto("/family");
  await page.getByRole("link", { name: `查看小满的人物主页` }).click();
  await expect(page.getByRole("heading", { name: "小满" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成长记忆" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "亲口讲述", exact: true })).toBeVisible();
});
