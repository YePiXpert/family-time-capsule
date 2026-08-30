import { expect, test } from "@playwright/test";
import path from "node:path";
import { addFamilyMember, ensureBootstrap } from "./helpers";

// Slice 4（PRD §23）：爸爸 + 外婆两份 Contribution，独立保存独立显示
// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap）
test.describe.configure({ mode: "serial" });

test("同一事件的多人视角独立保存与显示", async ({ page }) => {
  await ensureBootstrap(page);

  // 自建一个事件（上传 EXIF 照片并确认）
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await expect(page.getByText("已保存，等待整理")).toBeVisible();
  await page.goto("/inbox");
  await page.getByLabel("事件标题").fill("外婆哼的歌");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { name: "外婆哼的歌" })).toBeVisible();

  // 添加没有账号的外婆
  await addFamilyMember(page, "外婆", "外婆");

  // 回到事件页
  await page.goto("/timeline");
  await page.getByRole("link", { name: /外婆哼的歌/ }).click();

  // 爸爸的讲述
  await page.getByLabel("谁在讲述").selectOption({ label: "爸爸" });
  await page
    .getByPlaceholder("TA 想说的那段话……")
    .fill("那天上午阳光很好，她一直盯着窗帘看。");
  await page.getByRole("button", { name: "保存这段讲述" }).click();
  await expect(
    page.getByText("那天上午阳光很好，她一直盯着窗帘看。").first(),
  ).toBeVisible();

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
  await page.getByLabel("新增事实").fill("2026-08-10 小满出生，体重 3200 克。");
  await page.getByRole("button", { name: "添加事实" }).click();
  await expect(
    page.getByText("2026-08-10 小满出生，体重 3200 克。").first(),
  ).toBeVisible();
});
