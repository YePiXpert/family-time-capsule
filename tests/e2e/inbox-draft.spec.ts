import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ADMIN, addFamilyMember, ensureBootstrap, ensureLogin } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Web 先收进来会保存并回填全部草稿字段", async ({ page }) => {
  await ensureBootstrap(page);
  await addFamilyMember(page, "外婆", "外婆");
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("傍晚和外婆一起看云。");
  await page.getByLabel("标题").fill("窗边看云");
  await page.getByLabel("发生时间").fill("2026-08-12T18:30");
  await page.getByLabel("地点").fill("家里窗边");
  await page.getByLabel("外婆", { exact: true }).check();
  await page.getByRole("button", { name: /先收进来/u }).click();
  await expect(page.getByText("已收进收件箱")).toBeVisible();

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
