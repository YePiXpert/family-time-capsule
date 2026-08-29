import { expect, test } from "@playwright/test";

// Slice 4（PRD §23）：爸爸 + 外婆两份 Contribution，独立保存独立显示
// 前置：auth.spec 已添加「外婆」Person；av.spec（字母序在前）已创建事件「外婆哼的歌」
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.com", password: "e2e-admin-password" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
}

test("同一事件的多人视角独立保存与显示", async ({ page }) => {
  await login(page);
  await page.goto("/timeline");
  await page.getByRole("link", { name: /外婆哼的歌/ }).click();
  await expect(page.getByRole("heading", { name: "外婆哼的歌" })).toBeVisible();

  // 爸爸的讲述（默认家庭成员里有「爸爸」）
  await page.getByLabel("谁在讲述").selectOption({ label: "爸爸" });
  await page
    .getByPlaceholder("TA 想说的那段话……")
    .fill("那天上午阳光很好，她一直盯着窗帘看。");
  await page.getByRole("button", { name: "保存这段讲述" }).click();
  await expect(page.getByText("那天上午阳光很好，她一直盯着窗帘看。").first()).toBeVisible();

  // 外婆的讲述（外婆没有登录账号，Person 存在即可）
  await page.getByLabel("谁在讲述").selectOption({ label: "外婆" });
  await page
    .getByPlaceholder("TA 想说的那段话……")
    .fill("外婆说这孩子的眉毛长得像她妈妈小时候。");
  await page.getByLabel("可见范围").selectOption("child_later");
  await page.getByRole("button", { name: "保存这段讲述" }).click();
  await expect(
    page.getByText("外婆说这孩子的眉毛长得像她妈妈小时候。").first(),
  ).toBeVisible();

  // 两份视角都按作者独立成块
  await expect(page.getByRole("heading", { level: 3, name: "爸爸" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "外婆" })).toBeVisible();
  await expect(page.getByText("留给孩子将来").first()).toBeVisible();

  // 编辑爸爸的定稿不影响外婆的文本
  const dadBlock = page.locator("article", { hasText: "那天上午阳光很好" });
  await dadBlock
    .getByLabel("编辑 爸爸 的讲述")
    .fill("那天上午阳光很好，她盯着窗帘看了很久，还笑了一声。");
  await dadBlock.getByRole("button", { name: "修改这段讲述" }).click();
  await expect(
    page.getByText("那天上午阳光很好，她盯着窗帘看了很久，还笑了一声。").first(),
  ).toBeVisible();
  await expect(
    page.getByText("外婆说这孩子的眉毛长得像她妈妈小时候。").first(),
  ).toBeVisible();

  // 手工添加一条已确认事实
  await page
    .getByLabel("新增事实")
    .fill("2026-08-10 小满出生，体重 3200 克。");
  await page.getByRole("button", { name: "添加事实" }).click();
  await expect(page.getByText("2026-08-10 小满出生，体重 3200 克。").first()).toBeVisible();
});
