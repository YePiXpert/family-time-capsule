import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

test.describe.configure({ mode: "serial" });

test("外部 AI 披露、逐能力同意与关闭", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "AI 整理与隐私" }).click();

  await expect(
    page.getByRole("heading", { name: "AI 整理与隐私" }),
  ).toBeVisible();
  await expect(page.getByText("E2E local-compatible mock")).toBeVisible();
  await expect(page.getByText("会离开本机进程")).toBeVisible();
  await expect(page.getByText("Model：e2e-text-model")).toBeVisible();
  await expect(page.getByText("e2e-not-a-real-provider-key")).toHaveCount(0);

  const textCard = page.locator("article", {
    has: page.getByRole("heading", { name: "文字整理与故事草稿" }),
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
