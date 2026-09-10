import { waitForCapture, setCaptureMetadata, submitCaptureForReview } from "./helpers/capture";
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
  await page.goto("/capture"); await waitForCapture(page);
  await page
    .locator('input[type="file"]').first()
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await submitCaptureForReview(page);
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
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill(body);
  await waitForCapture(page); await setCaptureMetadata(page, { title: title });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  await page.getByRole("button", { name: "保存" }).click();
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
    await other.reload(); await waitForCapture(other);
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

test("家人讲述撤为私密后，旧事实和来源引文从其他管理员的阅读、编辑和搜索消失", async ({ page, browser, baseURL }) => {
  await ensureBootstrap(page);
  const statement = "合成暗号苔藓纸船";
  const quote = "只在讲述来源中出现的合成引文";
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill("这件事的正文仍然与家人分享。");
  await waitForCapture(page); await setCaptureMetadata(page, { title: "事实来源权限示例" });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "全家", exact: true }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page).toHaveURL(/\/memories\/[^/?]+/);
  const memoryUrl = new URL(page.url()).pathname;
  const eventId = memoryUrl.split("/").at(-1)!;
  await page.getByRole("link", { name: "编辑档案", exact: true }).click();
  await page.getByLabel("新增事实").fill(statement);
  await page.getByRole("button", { name: "添加事实", exact: true }).click();
  await expect(page.getByRole("region", { name: "已确认事实" })).toContainText(statement);
  const token = randomUUID(), voiceId = randomUUID();
  const dbPath = path.join(process.cwd(), "data/e2e-edit/db/capsule.sqlite");
  const db = new Database(dbPath);
  try {
    const actor = db.prepare("select family_id,person_id from user where email='admin@example.com'").get() as { family_id: string; person_id: string };
    db.prepare("insert into user(id,name,email,role,family_id,created_at,updated_at) values ('fact-admin-c','另一位事实读者','fact-c@fixture.invalid','admin',?,unixepoch(),unixepoch())").run(actor.family_id);
    db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,'fact-admin-c',unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(), token);
    db.prepare("insert into contribution(id,memory_event_id,author_person_id,raw_text,visibility,created_at,updated_at) values (?,?,?,?,'family',unixepoch(),unixepoch())").run(voiceId, eventId, actor.person_id, quote);
    db.prepare("update fact_source set source_type='contribution',source_id=?,quote=? where fact_id in (select id from fact where memory_event_id=?)").run(voiceId, quote, eventId);
  } finally { db.close(); }
  const otherContext = await browser.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  try {
    const other = await otherContext.newPage();
    await other.goto(`${memoryUrl}?mode=edit`);
    await expect(other.getByRole("region", { name: "已确认事实" })).toContainText(statement);
    const withdraw = new Database(dbPath);
    try { withdraw.prepare("update contribution set visibility='private' where id=?").run(voiceId); }
    finally { withdraw.close(); }
    for (const url of [memoryUrl, `${memoryUrl}?mode=edit`]) {
      const response = await other.goto(url);
      await expect(other.getByRole("heading", { name: "事实来源权限示例", exact: true })).toBeVisible();
      await expect(other.locator("main")).not.toContainText(statement);
      expect(await response!.text()).not.toContain(statement);
      expect(await response!.text()).not.toContain(quote);
    }
    await other.goto(`/search?q=${encodeURIComponent("苔藓纸船")}`);
    await expect(other.locator("main")).not.toContainText(statement);
    await page.goto(`${memoryUrl}?mode=edit`);
    await expect(page.getByRole("region", { name: "已确认事实" })).toContainText(statement);
    await page.getByRole("region", { name: "已确认事实" }).getByText("来源（1）", { exact: true }).click();
    await expect(page.getByRole("region", { name: "已确认事实" })).toContainText(quote);
  } finally { await otherContext.close(); }
});

test("编辑六档时间和正文，过期页面保存保留输入并拒绝覆盖", async ({ page, context }) => {
  await ensureBootstrap(page);
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill("原始的记忆正文");
  await waitForCapture(page); await setCaptureMetadata(page, { title: "需要编辑的旧事" });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page).toHaveURL(/\/memories\/[^/?]+/);
  const memoryPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "编辑档案", exact: true }).click();
  const form = page.getByRole("form", { name: "编辑事件" });
  await expect(form.getByLabel(/真实发生时间/)).toBeDisabled();
  await expect(form.getByLabel(/真实发生时间/)).toHaveValue("");
  for (const [precision, wall] of [["year", "1988"], ["month", "1988-05"], ["date_only", "1988-05-03"], ["approximate", "1988-05-03T10:12"], ["exact", "1988-05-03T10:12"], ["unknown", ""]]) {
    await form.getByLabel("时间精度").selectOption(precision);
    if (wall) await form.getByLabel(/真实发生时间/).fill(wall);
    const before = Number(await form.locator('[name="expectedRevision"]').inputValue());
    await form.getByLabel("记忆正文").fill(`已保存的正文 ${precision}`);
    await form.getByRole("button", { name: "保存修改" }).click();
    await expect(form.locator('[name="expectedRevision"]')).toHaveValue(String(before + 1));
    const response = await context.request.get(`/api/mobile/v1${memoryPath}`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ occurredAtPrecision: precision });
  }
  const newer = await context.newPage();
  await newer.goto(`${memoryPath}?mode=edit`);
  const newerForm = newer.getByRole("form", { name: "编辑事件" });
  await newerForm.getByLabel("标题", { exact: true }).fill("另一页已保存的新标题");
  await newerForm.getByRole("button", { name: "保存修改" }).click();
  await expect(newerForm.getByText("已保存。时间轴与年龄已更新。")).toBeVisible();
  await form.getByLabel("标题", { exact: true }).fill("旧页面尚未保存的标题");
  await form.getByLabel("记忆正文").fill("冲突后不能丢失的正文输入");
  await form.getByRole("button", { name: "保存修改" }).click();
  await expect(form.getByRole("alert")).toContainText("你的输入已保留");
  await expect(form.getByLabel("标题", { exact: true })).toHaveValue("旧页面尚未保存的标题");
  await expect(form.getByLabel("记忆正文")).toHaveValue("冲突后不能丢失的正文输入");
  await newer.goto(memoryPath);
  await expect(newer.getByRole("heading", { name: "另一页已保存的新标题", exact: true })).toBeVisible();
  await expect(newer.getByText("已保存的正文 unknown", { exact: true })).toBeVisible();
  await expect(newer.getByText("时间不确定", { exact: true }).first()).toBeVisible();
  await form.getByRole("button", { name: "收起", exact: true }).click();
  await page.getByRole("button", { name: "修改这件事", exact: true }).click();
  await expect(form.getByLabel("标题", { exact: true })).toHaveValue("另一页已保存的新标题");
  await expect(form.getByLabel("记忆正文")).toHaveValue("已保存的正文 unknown");
  await form.getByLabel("记忆正文").fill("核对最新版本后重新保存");
  await form.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(async () => (await (await context.request.get(`/api/mobile/v1${memoryPath}`)).json()).bodyText).toBe("核对最新版本后重新保存");
  await newer.close();
});

test("作者通过网页分享私密图文音给 B，C 看不到，撤销后 B 详情和 Range 失效", async ({ page, browser }) => {
  await ensureBootstrap(page);
  const db = new Database(path.join(process.cwd(), "data/e2e-edit/db/capsule.sqlite"));
  const bToken = randomUUID(); const cToken = randomUUID();
  try {
    const family = db.prepare("select id from family").get() as { id: string };
    for (const [id, name, token] of [["share-b", "接收家人B", bToken], ["share-c", "未选管理员C", cToken]]) {
      db.prepare("insert into person(id,family_id,display_name,created_at,updated_at) values (?,?,?,unixepoch(),unixepoch())").run(`person-${id}`, family.id, name);
      db.prepare("insert into user(id,name,email,role,family_id,person_id,created_at,updated_at) values (?,?,?,'admin',?,?,unixepoch(),unixepoch())").run(id, name, `${id}@fixture.invalid`, family.id, `person-${id}`);
      db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,?,unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(), token, id);
    }
  } finally { db.close(); }
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill("旧盒子里两张照片和一段原声，具体时间记不清了。");
  await waitForCapture(page); await setCaptureMetadata(page, { title: "通过网页明确分享的私密旧事" });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles(["sample.png", "sample-exif.jpg", "sample.wav"].map(name => path.join(__dirname, "../fixtures", name)));
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page).toHaveURL(/\/memories\/[^/?]+/);
  const memoryPath = new URL(page.url()).pathname;
  const id = memoryPath.split("/").at(-1)!;
  const apiPath = `/api/mobile/v1/memories/${id}`;
  const author = await (await page.request.get(apiPath)).json();
  expect(author.assets).toHaveLength(3);
  const b = await browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${bToken}` } });
  const c = await browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${cToken}` } });
  const reader = await b.newPage();
  try {
    expect((await b.request.get(new URL(apiPath, page.url()).href)).status()).toBe(404);
    expect((await c.request.get(new URL(apiPath, page.url()).href)).status()).toBe(404);
    await page.getByRole("button", { name: "管理分享", exact: true }).click();
    const share = page.getByRole("form", { name: "修改记忆读者" });
    await share.getByLabel("谁可以阅读这件事").selectOption("members");
    await share.getByLabel("接收家人B", { exact: true }).check();
    await share.getByRole("button", { name: "保存分享设置" }).click();
    await expect(page.getByRole("status", { name: "" }).filter({ hasText: "分享设置已保存。" })).toBeVisible();
    await reader.goto(new URL(memoryPath, page.url()).href);
    await expect(reader.getByRole("heading", { name: "通过网页明确分享的私密旧事", exact: true })).toBeVisible();
    await expect(reader.getByText("旧盒子里两张照片和一段原声，具体时间记不清了。", { exact: true })).toBeVisible();
    await expect(reader.getByRole("button", { name: "管理分享", exact: true })).toHaveCount(0);
    for (const asset of author.assets) {
      expect((await b.request.get(new URL(`/api/media/${asset.id}`, page.url()).href, { headers: { range: "bytes=0-11" } })).status()).toBe(206);
      expect((await c.request.get(new URL(`/api/media/${asset.id}`, page.url()).href, { headers: { range: "bytes=0-11" } })).status()).toBe(404);
    }
    expect((await c.request.get(new URL(apiPath, page.url()).href)).status()).toBe(404);
    expect((await b.request.post(new URL(`${apiPath}/sharing`, page.url()).href, { data: { visibility: "family", readerUserIds: [], expectedRevision: 1, mutationId: randomUUID() } })).status()).toBe(403);
    await page.getByRole("button", { name: "管理分享", exact: true }).click();
    expect((await page.request.patch(apiPath, { data: { locationText: "另一端修改", expectedRevision: 1, mutationId: randomUUID() } })).status()).toBe(200);
    await share.getByLabel("谁可以阅读这件事").selectOption("private");
    await share.getByRole("button", { name: "保存分享设置" }).click();
    await expect(share.getByRole("alert")).toContainText("选择已保留");
    await expect(share.getByLabel("谁可以阅读这件事")).toHaveValue("private");
    await share.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "管理分享", exact: true }).click();
    await expect(share.getByLabel("谁可以阅读这件事")).toHaveValue("members");
    await share.getByLabel("谁可以阅读这件事").selectOption("private");
    await share.getByRole("button", { name: "保存分享设置" }).click();
    await expect(page.getByText("当前读者：仅自己", { exact: true })).toBeVisible();
    expect((await b.request.get(new URL(apiPath, page.url()).href)).status()).toBe(404);
    const revoked = await reader.reload(); await waitForCapture(reader);
    const html = await revoked!.text();
    expect(html).not.toContain("通过网页明确分享的私密旧事");
    expect(html).not.toContain("旧盒子里两张照片和一段原声");
    for (const asset of author.assets) expect((await b.request.get(new URL(`/api/media/${asset.id}`, page.url()).href, { headers: { range: "bytes=0-11" } })).status()).toBe(404);
  } finally { await b.close(); await c.close(); }
});
