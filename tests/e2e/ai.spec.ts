import { expandCaptureOptions, submitCaptureForReview } from "./helpers/capture";
import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

test.describe.configure({ mode: "serial" });

test("外部 AI 披露、逐能力同意与关闭", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/settings");
  await page.locator("summary").filter({ hasText: "显示与辅助" }).click();
  await page.getByRole("link", { name: "AI 整理与隐私" }).click();

  await expect(
    page.getByRole("heading", { name: "AI 整理与隐私" }),
  ).toBeVisible();
  await expect(page.getByText("E2E local-compatible mock")).toBeVisible();
  await expect(page.getByText("会离开本机进程")).toBeVisible();
  await expect(page.getByText("Model：e2e-text-model")).toBeVisible();
  await expect(page.getByText("e2e-not-a-real-provider-key")).toHaveCount(0);

  const textCard = page.locator("article", {
    has: page.getByRole("heading", { name: "文字整理与信息建议" }),
  });
  await expect(textCard.getByText("等待同意")).toBeVisible();
  await textCard
    .getByLabel("允许系统自动处理明确标为“家人可见”的内容")
    .check();
  await textCard
    .getByRole("button", { name: "同意启用这项外部处理" })
    .click();
  await expect(textCard.getByText("可使用")).toBeVisible();
  await expect(
    textCard.getByRole("button", { name: "关闭这项外部处理" }),
  ).toBeVisible();

  await textCard
    .getByRole("button", { name: "关闭这项外部处理" })
    .click();
  await expect(textCard.getByText("等待同意")).toBeVisible();
  await expect(page.getByText("还没有 AI 任务")).toBeVisible();
});

test("所选文字的整理入口创建真实任务，可取消并重试而不阻碍阅读", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/settings/ai");
  const textCard = page.locator("article", { has: page.getByRole("heading", { name: "文字整理与信息建议" }) });
  await textCard.getByRole("button", { name: "同意启用这项外部处理" }).click();
  await expect(textCard.getByText("可使用")).toBeVisible();
  await page.goto("/capture"); await expandCaptureOptions(page);
  await page.getByPlaceholder("想说点什么？也可以不写，直接保存素材。").fill("清晨在窗边给绿植浇水。");
  await submitCaptureForReview(page);

  await page.goto("/inbox");
  await page.getByText("AI 帮我起名", { exact: true }).click();
  await page.getByRole("button", { name: "生成标题建议", exact: true }).click();
  await expect(page.getByText("依据已准备好，等待起名", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成标题建议", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(page.getByText("任务已取消", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试失败步骤", exact: true }).click();
  await expect(page.getByText("依据已准备好，等待起名", { exact: true })).toBeVisible();
  await expect(page.getByLabel("事件标题")).toHaveValue("清晨在窗边给绿植浇水");
  // No worker or live model runs in this scenario. Revoking consent stops the pending retry.
  await page.goto("/settings/ai");
  await textCard.getByRole("button", { name: "关闭这项外部处理" }).click();
  await expect(textCard.getByText("等待同意")).toBeVisible();
});
