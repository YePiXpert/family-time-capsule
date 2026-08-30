import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureBootstrap } from "./helpers";

// Slice 3（PRD §23）：音频/视频/文字；FFmpeg 不可用时上传仍工作
// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap）
test.describe.configure({ mode: "serial" });

test("音频 + 视频 + 文字 → 各自确认成事件，页面渲染回放元素", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");

  // 上传音频（真实可播放 WAV）
  const wav = readFileSync(path.join(__dirname, "..", "fixtures", "sample.wav"));
  await page
    .locator('section[aria-label="录音"] input[type="file"]')
    .setInputFiles({ name: "外婆哼的歌.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.getByText("已保存，等待整理").first()).toBeVisible();

  // 上传视频（MOV：多数桌面浏览器不可直接解码 → 占位 + 下载入口）
  const mov = readFileSync(path.join(__dirname, "..", "fixtures", "sample.mov"));
  await page
    .locator('section[aria-label="视频"] input[type="file"]')
    .setInputFiles({ name: "第一次翻身.MOV", mimeType: "video/quicktime", buffer: mov });
  await expect(page.getByText("已保存，等待整理").nth(1)).toBeVisible();

  // 写文字
  await page
    .getByPlaceholder("今天想留下什么话？写给未来的她，或只是记下此刻。")
    .fill("小满今天自己扶着沙发站起来了。");
  await page.getByRole("button", { name: "写一段话" }).click();
  await expect(page.getByText("已收进收件箱。")).toBeVisible();

  // 收件箱：三条待整理
  await page.goto("/inbox");
  await expect(page.getByRole("checkbox")).toHaveCount(3);

  // 音频条目有 <audio> 回放控件
  await expect(page.locator("audio").first()).toBeVisible();

  // 逐条确认：先音频条目（按包含 audio 的卡片定位）
  const audioCard = page.locator("li", { has: page.locator("audio") });
  await audioCard.getByLabel("事件标题").fill("外婆哼的歌");
  await audioCard.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page).toHaveURL(/\/memories\//);
  await expect(page.getByRole("heading", { name: "外婆哼的歌" })).toBeVisible();
  await expect(page.locator("audio").first()).toBeVisible();

  // 回到收件箱确认视频条目（MOV 不可解码 → 显示安全保存占位）
  await page.goto("/inbox");
  const videoCard = page.locator("li", { hasText: "第一次翻身" });
  await videoCard.getByLabel("事件标题").fill("第一次翻身");
  await videoCard.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { name: "第一次翻身" })).toBeVisible();
  await expect(
    page.getByText("原件已安全保存，当前浏览器可能无法直接预览").first(),
  ).toBeVisible();

  // 最后确认文字条目
  await page.goto("/inbox");
  await page.getByLabel("事件标题").first().fill("自己站起来了");
  await page.getByRole("button", { name: "确认进入时间轴" }).first().click();
  await expect(
    page.getByRole("heading", { name: "自己站起来了" }),
  ).toBeVisible();

  // 时间轴三个事件都在
  await page.goto("/timeline");
  await expect(page.getByRole("link", { name: /外婆哼的歌/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /第一次翻身/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /自己站起来了/ })).toBeVisible();
});
