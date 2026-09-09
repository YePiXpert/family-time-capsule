import { expandCaptureOptions, submitCaptureForReview } from "./helpers/capture";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ADMIN, addFamilyMember, ensureBootstrap, ensureLogin } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Web 先收进来会保存并回填全部草稿字段", async ({ page }) => {
  await ensureBootstrap(page);
  await addFamilyMember(page, "外婆", "外婆");
  await page.goto("/capture"); await expandCaptureOptions(page);
  await page.getByLabel("写下这一刻").fill("傍晚和外婆一起看云。");
  await expandCaptureOptions(page); await page.getByLabel("标题").fill("窗边看云");
  await expandCaptureOptions(page); await page.getByLabel("发生时间").fill("2026-08-12T18:30");
  await expandCaptureOptions(page); await page.getByLabel("地点").fill("家里窗边");
  await page.getByLabel("外婆", { exact: true }).check();
  await submitCaptureForReview(page);

  await page.goto("/inbox");
  const card = page.locator("article").filter({ hasText: "傍晚和外婆一起看云" });
  await expect(card.getByLabel("事件标题")).toHaveValue("窗边看云");
  await expect(card.getByLabel("发生时间（可选）")).toHaveValue("2026-08-12T18:30");
  await expect(card.getByLabel("事件地点")).toHaveValue("家里窗边");
  await expect(card.getByLabel("外婆", { exact: true })).toBeChecked();
  const nativeInbox = await page.request.get("/api/mobile/v1/inbox");
  expect(nativeInbox.status()).toBe(200);
  const nativeBody = (await nativeInbox.json()) as {
    entries: Array<{
      title: string;
      occurredAtWall: string | null;
      locationText: string | null;
      participantPersonIds: string[];
    }>;
  };
  expect(nativeBody.entries).toContainEqual(expect.objectContaining({
    title: "窗边看云",
    occurredAtWall: "2026-08-12T18:30",
    locationText: "家里窗边",
    participantPersonIds: expect.arrayContaining([expect.any(String)]),
  }));
  await card.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page).toHaveURL(/\/memories\//u);
  await expect(page.getByRole("heading", { level: 1, name: "窗边看云" })).toBeVisible();
  await expect(page.getByText("家里窗边")).toBeVisible();
  await expect(page.locator('section[aria-label="参与人物"]')).toContainText("外婆");
});

test("原生草稿在 Web 不修改直接确认后保持一致", async ({ page }) => {
  await ensureLogin(page);
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: new URL(page.url()).origin },
    data: { email: ADMIN.email, password: ADMIN.password, rememberMe: true },
  });
  const body = (await signIn.json()) as { token?: string };
  const token = signIn.headers()["set-auth-token"] ?? body.token;
  expect(token).toEqual(expect.any(String));
  const sync = await page.request.get("/api/mobile/v1/sync", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const syncBody = (await sync.json()) as {
    people: Array<{ id: string; displayName: string; isChild: boolean }>;
  };
  const grandmother = syncBody.people.find((person) => person.displayName === "外婆")!;
  const captureId = randomUUID();
  expect((await page.request.post("/api/mobile/v1/captures/text", {
    headers: { Authorization: `Bearer ${token}` },
    data: { id: captureId, text: "原生端写下的草稿正文" },
  })).status()).toBe(201);
  expect((await page.request.patch(`/api/mobile/v1/inbox/${captureId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: "原生端整理标题",
      occurredAtWall: "2026-08-13T19:05",
      locationText: "外婆家的阳台",
      participantPersonIds: [grandmother.id],
    },
  })).status()).toBe(200);

  await page.goto("/inbox");
  const card = page.locator("article").filter({ hasText: "原生端写下的草稿正文" });
  await expect(card.getByLabel("事件标题")).toHaveValue("原生端整理标题");
  await expect(card.getByLabel("发生时间（可选）")).toHaveValue("2026-08-13T19:05");
  await expect(card.getByLabel("事件地点")).toHaveValue("外婆家的阳台");
  await expect(card.getByLabel("外婆", { exact: true })).toBeChecked();
  await card.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "原生端整理标题" })).toBeVisible();
  await expect(page.getByText("外婆家的阳台")).toBeVisible();
  await expect(page.locator('section[aria-label="参与人物"]')).toContainText("外婆");
});

test("人工名称在 Web 与移动 API 间同步，并拒绝过期的确认表单", async ({ page }) => {
  await ensureLogin(page);
  const id = randomUUID();
  expect((await page.request.post("/api/mobile/v1/captures/text", { data: { id, text: "命名版本冲突测试的完整原文" } })).status()).toBe(201);
  await page.goto("/inbox");
  const card = page.locator("article").filter({ hasText: "命名版本冲突测试的完整原文" });
  await card.getByLabel("事件标题").fill("我还没确认的草稿");
  await card.getByText("修改标题与审核 AI 建议", { exact: true }).click();
  await card.getByLabel("人工标题", { exact: true }).fill("另一处保存的名称");
  await card.getByRole("button", { name: "保存人工名称" }).click();
  await expect(card.getByLabel("人工标题", { exact: true })).toHaveValue("另一处保存的名称");
  await expect.poll(async () => {
    const review = await page.request.get(`/api/mobile/v1/names?kind=inbox_item&id=${id}`);
    return (await review.json()).target.revision;
  }).toBe(1);
  await card.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(card.getByText("名称已被另一处修改，本次输入已保留，请核对后再确认。")).toBeVisible();
  await expect(card.getByLabel("事件标题")).toHaveValue("我还没确认的草稿");
  await page.reload(); await expandCaptureOptions(page);
  await expect(card.getByLabel("事件标题")).toHaveValue("另一处保存的名称");
  await card.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "另一处保存的名称" })).toBeVisible();
  const eventId = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByText("修改标题与审核 AI 建议", { exact: true }).click();
  await page.getByLabel("人工标题", { exact: true }).fill("归档后修改的名称");
  await page.getByRole("button", { name: "保存人工名称" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "归档后修改的名称" })).toBeVisible();
  const detail = await page.request.get(`/api/mobile/v1/memories/${eventId}`);
  expect(await detail.json()).toMatchObject({ title: "归档后修改的名称", titleSource: "manual", titleRevision: 1 });
  await expect(page.getByText("命名版本冲突测试的完整原文", { exact: true })).toBeVisible();
});

test("祖辈记忆不绑定孩子：创建、重开编辑、搜索和日历均显示真实日期", async ({ page }) => {
  await ensureLogin(page);
  await page.goto("/capture"); await expandCaptureOptions(page);
  await page.getByLabel("写下这一刻").fill("外公年轻时候在江边划船的故事。");
  await expandCaptureOptions(page); await page.getByLabel("标题", { exact: true }).fill("外公讲年轻时候的故事");
  await expandCaptureOptions(page); await page.getByLabel("发生时间", { exact: true }).fill("1980-08-12T18:30");
  await submitCaptureForReview(page);
  await page.goto("/inbox");
  const card = page.locator("article").filter({ hasText: "外公年轻时候在江边划船的故事" });
  await expect(card.getByLabel("年龄参考人物（可选）")).toHaveValue("");
  await card.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "外公讲年轻时候的故事" })).toBeVisible();
  const memoryUrl = page.url();
  await expect(page.locator("main")).not.toContainText(/出生前|个月|出生当天/);
  await page.getByRole("button", { name: "修改这件事" }).click();
  const form = page.getByRole("form", { name: "编辑事件" });
  await expect(form.locator('[name="childPersonId"]')).toHaveValue("");
  await form.getByLabel("标题", { exact: true }).fill("外公江边划船的故事");
  await form.getByRole("button", { name: /保存修改/ }).click();
  await expect(page.getByText("已保存。时间轴与年龄已更新。")).toBeVisible();
  await page.goto(memoryUrl);
  await expect(page.getByRole("heading", { level: 1, name: "外公江边划船的故事" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/出生前|个月|出生当天/);
  await page.goto("/search?q=" + encodeURIComponent("江边划船"));
  await expect(page.getByRole("link", { name: /外公江边划船的故事/ }).first()).toBeVisible();
  await page.goto("/timeline/calendar?month=1980-08&date=1980-08-12");
  await expect(page.getByRole("link", { name: /外公江边划船的故事/ })).toBeVisible();
});
