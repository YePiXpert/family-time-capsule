import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";
import Database from "better-sqlite3";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  await event.getByText("补充真实信息", { exact: true }).click();
  const edit = event.getByRole("form", { name: "补充真实信息" });
  await edit.getByLabel("地点", { exact: true }).fill("公园南门");
  await edit.getByRole("button", { name: "保存人工补充" }).click();
  await expect(edit.getByRole("status")).toHaveText("已保存人工补充。");
  await expect(edit.locator('[name="expectedRevision"]')).toHaveValue("1");
  const newer = await page.context().newPage();
  await newer.goto(page.url());
  const newerEvent = newer.locator("article", { hasText: "公园放风筝" });
  await newerEvent.getByText("补充真实信息", { exact: true }).click();
  const newerEdit = newerEvent.getByRole("form", { name: "补充真实信息" });
  await newerEdit.getByLabel("地点", { exact: true }).fill("已确认的新地点");
  await newerEdit.getByRole("button", { name: "保存人工补充" }).click();
  await expect(newerEdit.getByRole("status")).toHaveText("已保存人工补充。");
  await edit.getByLabel("地点", { exact: true }).fill("冲突后保留的回顾输入");
  await edit.getByRole("button", { name: "保存人工补充" }).click();
  await expect(edit.getByRole("alert")).toContainText("你的输入已保留");
  await expect(edit.getByLabel("地点", { exact: true })).toHaveValue("冲突后保留的回顾输入");
  await newer.close();
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

test("故事真实组装与发布遵循来源范围，撤权后网页、搜索与手机 HTTP 同时失效", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("合成向日葵的一次私人记录。");
  await page.getByLabel("标题", { exact: true }).fill("故事的私人来源");
  await page.getByLabel("发生时间", { exact: true }).fill("2028-09-14T12:00");
  await page.getByLabel("保存后的读者").selectOption("private");
  await expect(page.getByRole("status").filter({ hasText: "本机已保存 ·" })).toBeVisible();
  await page.getByRole("button", { name: "保存为一条记忆" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page).toHaveURL(/\/memories\/[^/]+$/);
  const eventId = page.url().split("/").at(-1)!;
  await page.getByLabel("新增事实").fill("合成向日葵长出了第三片叶子。");
  await page.getByRole("button", { name: "添加事实", exact: true }).click();
  await expect(page.getByText("合成向日葵长出了第三片叶子。", { exact: true })).toBeVisible();
  async function assemble() {
    await page.goto("/stories");
    await page.getByLabel("故事类型").selectOption("monthly");
    await page.getByLabel("时间段内的任一天").fill("2028-09-14");
    await page.getByRole("button", { name: "直接组装草稿", exact: true }).click();
  }
  await assemble();
  await expect(page.getByText("这个时间段还没有可用的已确认内容（事实/讲述/转录）。", { exact: true })).toBeVisible();
  const db = new Database(path.join(process.cwd(), "data/e2e-review/db/capsule.sqlite"));
  try {
    // Current-event sharing UI is a separate pending flow; mutate only this isolated fixture.
    db.prepare("update memory_event set visibility='family' where id=?").run(eventId);
    await assemble();
    await expect(page.getByText("草稿已创建。", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /2028 年 9 月的故事/ }).click();
    await expect(page).toHaveURL(/\/stories\/[^/]+$/);
    const storyId = page.url().split("/").at(-1)!;
    await page.getByRole("link", { name: "编辑故事", exact: true }).click();
    await page.getByRole("button", { name: "发布故事", exact: true }).click();
    await expect(page.getByRole("heading", { name: "把这篇故事带走", exact: true })).toBeVisible();
    await expect(page.getByRole("paragraph").filter({ hasText: "合成向日葵长出了第三片叶子。" })).toBeVisible();
    const family = db.prepare("select id from family").get() as { id: string };
    const token = randomUUID();
    db.prepare("insert into user(id,name,email,role,family_id,created_at,updated_at) values ('story-c','未选管理员','story-c@fixture.invalid','admin',?,unixepoch(),unixepoch())").run(family.id);
    db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,'story-c',unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(), token);
    const endpoint = `/api/mobile/v1/library/stories/${storyId}`;
    expect((await page.request.get(endpoint, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(200);
    db.prepare("update memory_event set visibility='private' where id=?").run(eventId);
    expect((await page.request.get(endpoint, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(404);
    // A streamed Next response can send headers before notFound resolves.
    const hidden = await page.reload();
    expect(await hidden!.text()).not.toContain("合成向日葵长出了第三片叶子。");
    await expect(page.getByRole("heading", { name: "这里没有这段记忆", exact: true })).toBeVisible();
    await page.goto("/stories"); await expect(page.locator(`a[href='/stories/${storyId}']`)).toHaveCount(0);
    await page.goto("/search?q=合成向日葵"); await expect(page.locator(`a[href='/stories/${storyId}']`)).toHaveCount(0);
  } finally { db.close(); }
});
