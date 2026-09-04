import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

test("每周回顾从收件箱重点生成有来源的无 AI 草稿", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("周四傍晚一起在公园放风筝。");
  await page.getByLabel("标题").fill("公园放风筝");
  await page.getByLabel("发生时间").fill("2026-09-03T18:30");
  await page.getByRole("button", { name: /先收进来/u }).click();
  await expect(page.getByText("已收进收件箱")).toBeVisible();
  await page.goto("/inbox");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "公园放风筝" })).toBeVisible();

  await page.goto("/review");
  await expect(page).toHaveURL(/\/review\/2026-08-31$/u);
  await expect(page.getByRole("heading", { level: 1, name: "每周回顾" })).toBeVisible();
  const event = page.locator("article", { hasText: "公园放风筝" });
  await event.getByRole("button", { name: "选为重点" }).click();
  await expect(event.getByRole("button", { name: "取消重点" })).toBeVisible();
  await page.getByRole("button", { name: "不用 AI，生成有来源的周记草稿" }).click();
  await expect(page.getByText("本周期已有一份来源可追溯的故事草稿")).toBeVisible();
  await page.getByRole("button", { name: "完成本周回顾" }).click();
  await expect(page.getByText("已完成")).toBeVisible();
  await page.getByRole("link", { name: "打开周记草稿" }).click();
  await expect(page.getByText(/公园放风筝/u).first()).toBeVisible();
  await expect(page.getByText("来自 家庭记忆").first()).toBeVisible();
});
