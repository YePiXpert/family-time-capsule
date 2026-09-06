import { expect, type Page } from "@playwright/test";
import { ADMIN } from "../helpers";

/**
 * ID-10 step-up：完整导出要求 10 分钟内的密码复核。
 * 管理员流程先在 /settings 完成密码确认，再发起 /api/export。
 * 设置页是流式渲染：必须等到「密码确认框」或「导出链接」其一出现再判断，
 * 不能用不等待的 isVisible()（负载下面板晚到会被误判为已复核）。
 */
export async function grantExportStepUp(page: Page) {
  await page.goto("/settings");
  const link = page.getByRole("link", { name: "导出完整备份 ZIP" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const passwordInput = page.getByPlaceholder("当前密码").first();
    const which = await Promise.race([
      passwordInput.waitFor({ state: "visible", timeout: 20_000 }).then(() => "form" as const),
      link.waitFor({ state: "visible", timeout: 20_000 }).then(() => "ready" as const),
    ]);
    if (which === "ready") return;
    await passwordInput.fill(ADMIN.password);
    await page.getByRole("button", { name: "确认密码并导出" }).click();
    const error = page.getByText("密码不正确，未通过复核。");
    const outcome = await Promise.race([
      link.waitFor({ state: "visible", timeout: 15_000 }).then(() => "ok" as const),
      error.waitFor({ state: "visible", timeout: 15_000 }).then(() => "error" as const),
    ]);
    if (outcome === "ok") return;
    await page.waitForTimeout(500);
  }
  await expect(link).toBeVisible();
}
