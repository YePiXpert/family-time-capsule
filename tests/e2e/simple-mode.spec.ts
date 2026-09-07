import { expect, test, type Page } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

/**
 * NAV-11 大字简洁显示（长辈阅读模式）：
 * 设备级切换、简化首页只保留日常四件事、复杂入口隐藏但路由不变、
 * 随时可返回标准显示。权限不因显示模式改变。
 */

async function usePhone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}

test.describe.configure({ mode: "serial" });

test("切换到大字简洁显示：首页、导航与我的页简化，返回标准显示可恢复", async ({ page }) => {
  await usePhone(page);
  await ensureBootstrap(page);

  // 默认标准显示：首页有快速记录
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-display-mode", "standard");
  await expect(page.getByRole("region", { name: "快速记录" })).toBeVisible();

  // 在「我的」切换显示方式
  await page.goto("/more");
  await page.getByRole("button", { name: "大字简洁显示" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-mode", "simple");

  // 偏好按设备持久：刷新后仍是大字简洁
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-display-mode", "simple");

  // 简洁首页只保留四件事，空状态如实说明
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "最近的照片" })).toBeVisible();
  await expect(page.getByText("这里还没有最近的照片。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "听听家人的声音" })).toBeVisible();
  await expect(page.getByText("还没有家人的录音；说一段话，以后就能在这里听到。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近的故事" })).toBeVisible();
  await expect(page.getByRole("region", { name: "快速记录" })).toHaveCount(0);

  // 底部导航用直白动词，顶部有明确的返回入口
  await expect(
    page.getByRole("navigation", { name: "一级导航" }).getByText("说几句"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "返回标准显示" })).toBeVisible();

  // 简洁「我的」不再露出批量导入/备份等高级入口
  await page.goto("/more");
  await expect(page.getByText("批量导入")).toHaveCount(0);
  await expect(page.getByText("备份与导出")).toHaveCount(0);

  // 返回标准显示后完整功能恢复
  await page.getByRole("button", { name: "返回标准显示" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-mode", "standard");
  await expect(
    page.getByRole("link", { name: "批量导入 查看并继续持久化导入批次" }),
  ).toBeVisible();

  // 桌面侧栏同样简化：二级整理入口隐藏，仍可直接返回标准
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/more");
  await page.getByRole("button", { name: "大字简洁显示" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-mode", "simple");
  await expect(page.getByRole("navigation", { name: "整理与更多" })).toHaveCount(0);
  await page.getByRole("button", { name: "返回标准显示" }).click();
  await expect(page.getByRole("navigation", { name: "整理与更多" })).toBeVisible();

  // 收尾：恢复标准显示，避免影响同 project 内后续用例
  await page.goto("/more");
  if (await page.getByRole("button", { name: "返回标准显示" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "返回标准显示" }).click();
  }
});
