import { expect, type Page } from "@playwright/test";
import { ADMIN } from "../helpers";

/**
 * ID-10 step-up：可读档案导出要求 10 分钟内的登录或密码复核。
 * 定位必须限定在「可读档案导出」面板内——设置页的删除账号区域同样有
 * 「当前密码」输入框，裸定位会错抓（CI run 34056721388 的失败原因）。
 */
export async function grantExportStepUp(page: Page) {
  await page.goto("/settings");
  await page.locator("summary").filter({ hasText: "备份与恢复" }).click();
  const panel = page.getByRole("region", { name: "可读档案导出" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  const link = panel.getByRole("link", { name: "导出可读档案 ZIP" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const passwordInput = panel.getByPlaceholder("当前密码");
    const which = await Promise.race([
      passwordInput.waitFor({ state: "visible", timeout: 20_000 }).then(() => "form" as const),
      link.waitFor({ state: "visible", timeout: 20_000 }).then(() => "ready" as const),
    ]);
    if (which === "ready") return;
    await passwordInput.fill(ADMIN.password);
    await panel.getByRole("button", { name: "确认密码并导出" }).click();
    const error = panel.getByText("密码不正确，未通过复核。");
    const outcome = await Promise.race([
      link.waitFor({ state: "visible", timeout: 15_000 }).then(() => "ok" as const),
      error.waitFor({ state: "visible", timeout: 15_000 }).then(() => "error" as const),
    ]);
    if (outcome === "ok") return;
    await page.waitForTimeout(500);
  }
  await expect(link).toBeVisible();
}
