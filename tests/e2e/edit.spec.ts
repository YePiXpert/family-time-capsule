import { expect, test } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { ensureBootstrap, ensureLogin } from "./helpers";

// RH-003：事件编辑 E2E（独立 project / 独立 DATA_DIR）
test.describe.configure({ mode: "serial" });

test("创建 8/10 事件 → 修改为 8/11 → 时间轴移动、年龄变化", async ({ page }) => {
  await ensureBootstrap(page);

  // 上传 EXIF 8/10 照片并确认成事件
  await page.goto("/capture");
  await page
    .locator('input[type="file"]').first()
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await page.getByRole("button", { name: "先收进来，交给家人整理" }).click(); await expect(page.getByText("已收进收件箱。整件事的草稿可以继续整理。", { exact: true })).toBeVisible();
  await page.goto("/inbox");
  await page.getByLabel("事件标题").fill("八月中旬的一个上午");
  await page.getByLabel("年龄参考人物（可选）").selectOption({ label: "小满" });
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

test("私密未知时间记忆：作者添加事实、移入回收站、恢复和清除，其他管理员看不到", async ({ page, browser, baseURL }) => {
  await ensureBootstrap(page);
  const title = "仅自己的旧信记忆";
  const body = "不知道哪一年，外公把一封旧信留给我。";
  const fact = "旧信放在蓝色盒子里。";
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill(body);
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page.getByLabel("时间记得多清楚").selectOption("unknown");
  await page.getByLabel("保存后的读者").selectOption("private");
  await page.getByRole("button", { name: "保存为一条记忆" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page).toHaveURL(/\/memories\/[^/?]+/);
  const memoryUrl = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "编辑档案", exact: true }).click();
  await page.getByLabel("新增事实").fill(fact);
  await page.getByRole("button", { name: "添加事实", exact: true }).click();
  await expect(page.getByRole("region", { name: "已确认事实" })).toContainText(fact);

  // Only the isolated edit project gets this synthetic second account/session.
  const token = randomUUID();
  const db = new Database(path.join(process.cwd(), "data/e2e-edit/db/capsule.sqlite"));
  try {
    const family = db.prepare("select id from family").get() as { id: string };
    db.prepare("insert into user(id,name,email,role,family_id,created_at,updated_at) values ('trash-admin-c','另一位管理员','trash-c@fixture.invalid','admin',?,unixepoch(),unixepoch())").run(family.id);
    db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,'trash-admin-c',unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(), token);
  } finally { db.close(); }
  const otherContext = await browser.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  try {
    const other = await otherContext.newPage();
    await other.goto("/trash");
    await expect(other.getByRole("navigation", { name: "一级导航" })).toBeVisible();
    const moveToTrash = async () => {
      await page.getByRole("button", { name: "移到回收站", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "移到回收站", exact: true }).click();
      await expect.poll(async () => (await page.request.get(`/api/mobile/v1${memoryUrl}`)).status()).toBe(404);
      await page.goto("/trash");
    };
    await moveToTrash();
    const entry = page.getByRole("list", { name: "回收站列表" }).getByRole("listitem").filter({ hasText: title });
    await expect(entry).toBeVisible();
    await other.reload();
    await expect(other.locator("main")).not.toContainText(title);
    expect((await other.request.get(`/api/mobile/v1${memoryUrl}`)).status()).toBe(404);
    await entry.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(entry).toHaveCount(0);
    await page.goto(memoryUrl);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(body);
    await expect(page.getByRole("region", { name: "已确认事实" })).toContainText(fact);
    await expect(page.locator("main")).toContainText("时间不确定");
    expect((await (await page.request.get(`/api/mobile/v1${memoryUrl}`)).json()).occurredAtPrecision).toBe("unknown");
    await page.getByRole("link", { name: "编辑档案", exact: true }).click();
    await moveToTrash();
    await entry.getByLabel("确认彻底清除").check();
    await entry.getByRole("button", { name: "彻底清除", exact: true }).click();
    await expect(entry).toHaveCount(0);
    expect((await page.request.get(`/api/mobile/v1${memoryUrl}`)).status()).toBe(404);
  } finally { await otherContext.close(); }
});
