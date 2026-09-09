import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

test("大字显示保持相同三个入口和设置分组，偏好在刷新后保留", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureBootstrap(page);
  for (const mode of ["simple", "standard"]) {
    await page.goto("/settings");
    await page.locator("summary").filter({ hasText: "显示与辅助" }).click();
    await page.getByRole("button", { name: mode === "simple" ? "大字显示" : "标准显示", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-display-mode", mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-display-mode", mode);
    for (const label of ["家人和账号", "存储与同步", "备份与恢复", "显示与辅助"]) await expect(page.locator("summary").filter({ hasText: label })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/timeline$/);
    const nav = page.getByRole("navigation", { name: "一级导航" });
    await expect(nav.locator(".bottom-nav-item")).toHaveText(["成长", "成长册", "我的"]);
    await expect(page.getByRole("link", { name: "设置", exact: true }).first()).toBeVisible();
    await expect(page.getByText(/待处理.*条/)).toHaveCount(0);
  }
});
