import { expect, test } from "@playwright/test";
import path from "node:path";
import { ensureBootstrap, ensureLogin } from "./helpers";

// RH-003：事件编辑 E2E（独立 project / 独立 DATA_DIR）
test.describe.configure({ mode: "serial" });

test("创建 8/10 事件 → 修改为 8/11 → 时间轴移动、年龄变化", async ({ page }) => {
  await ensureBootstrap(page);

  // 上传 EXIF 8/10 照片并确认成事件
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await expect(page.getByText("已保存，等待整理")).toBeVisible();
  await page.goto("/inbox");
  await page.getByLabel("事件标题").fill("八月中旬的一个上午");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();

  // 初始：8/10 + 出生当天
  await expect(page.getByText("2026年8月10日 09:30").first()).toBeVisible();
  await expect(page.getByText("出生当天")).toBeVisible();

  // 打开编辑表单
  await page.getByRole("button", { name: "修改这件事" }).click();
  const form = page.locator('form[aria-label="编辑事件"]');

  // 修改时间到 8/11 09:30（家庭时区墙钟）
  await form.getByLabel(/真实发生时间/).fill("2026-08-11T09:30");
  await form.getByLabel("时间精度").selectOption("date_only");
  await form.getByLabel(/地点（可选）/).fill("北京 · 家里");
  await form.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("已保存。时间轴与年龄已更新。")).toBeVisible();

  // 事件页：新日期 + 第 1 天（8/11 对 8/10 生日）+ 地点
  await expect(page.getByText("2026年8月11日").first()).toBeVisible();
  await expect(page.getByText("第 1 天")).toBeVisible();
  await expect(page.getByText("北京 · 家里")).toBeVisible();

  // 时间轴：出现在 8/11，旧日期 8/10 不再出现（本工作区唯一事件）
  await page.goto("/timeline");
  const link = page.getByRole("link", { name: /八月中旬的一个上午/ });
  await expect(link).toBeVisible();
  await expect(link.getByText("2026年8月11日")).toBeVisible();
  await expect(link.getByText("2026年8月10日")).toHaveCount(0);
  await expect(page.getByText("2026年8月10日")).toHaveCount(0);

  // 年龄同步变化
  await expect(link.getByText("第 1 天")).toBeVisible();
});

test("编辑参与人与孩子档案（安全校验下的正常路径）", async ({ page }) => {
  await ensureLogin(page);

  // 添加外婆
  const { addFamilyMember } = await import("./helpers");
  await addFamilyMember(page, "外婆", "外婆");

  await page.goto("/timeline");
  await page.getByRole("link", { name: /八月中旬的一个上午/ }).click();
  await page.getByRole("button", { name: "修改这件事" }).click();
  const form = page.locator('form[aria-label="编辑事件"]');

  // 勾选外婆（孩子必选不可去，表单不提供去勾）
  await form.getByLabel("外婆", { exact: true }).check();
  await form.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("已保存。时间轴与年龄已更新。")).toBeVisible();

  // 参与人显示外婆
  await expect(page.getByText("外婆（孩子）", { exact: false })).toHaveCount(0); // 外婆不是孩子
  await expect(
    page.locator('section[aria-label="参与人物"]', { hasText: "外婆" }),
  ).toBeVisible();
});
