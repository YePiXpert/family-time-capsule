import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

// /review 重定向按家庭时区（默认 Asia/Shanghai、周一起始）取「当前周」。
// 硬编码日期会在每个周日/周一交界后失效，因此这里动态推导当前周的
// 周一（重定向目标）与周四（事件发生时间，保证落在同一回顾窗口内）。
function currentShanghaiWeek(): { monday: string; thursday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const today = new Date(
    `${value("year")}-${value("month")}-${value("day")}T00:00:00Z`,
  );
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - ((today.getUTCDay() - 1 + 7) % 7));
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  return {
    monday: monday.toISOString().slice(0, 10),
    thursday: thursday.toISOString().slice(0, 10),
  };
}

test("每周回顾从收件箱重点生成有来源的无 AI 草稿", async ({ page }) => {
  const { monday, thursday } = currentShanghaiWeek();
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("周四傍晚一起在公园放风筝。");
  await page.getByLabel("标题").fill("公园放风筝");
  await page.getByLabel("发生时间").fill(`${thursday}T18:30`);
  await page.getByRole("button", { name: /先收进来/u }).click();
  await expect(page.getByText("已收进收件箱")).toBeVisible();
  await page.goto("/inbox");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "公园放风筝" })).toBeVisible();

  await page.goto("/review");
  await expect(page).toHaveURL(new RegExp(`/review/${monday}$`, "u"));
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
