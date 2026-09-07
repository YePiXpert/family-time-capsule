import { expect, test } from "@playwright/test";
import { chromium } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

/**
 * NAV-11/FAM-3 长辈免账号贡献向导：问题 → 录音 → 重听 → 提交；
 * 提交后明确「已经收到」，可以再说一段。访客不能因此读到家庭档案。
 * 录音走 Chromium 虚拟麦克风（fake device），不依赖真实硬件。
 */

test.describe.configure({ mode: "serial" });

test("长辈录音向导：录音、重听、提交、再说一段", async ({ page }) => {
  await ensureBootstrap(page);

  // 管理员创建投递箱
  await page.goto("/contributions");
  await page.getByLabel("投递箱标题").fill("请大家留下今天的声音");
  await page.getByLabel("投递箱说明").fill("用一分钟讲讲你最近遇到的一件事。");
  await page.getByRole("button", { name: "创建投递箱" }).click();
  const link = page.locator("p.break-all");
  await expect(link).toContainText("/contribute/");
  const portalUrl = (await link.textContent())?.trim();
  expect(portalUrl).toBeTruthy();

  // 访客浏览器（虚拟麦克风）打开链接
  const guestBrowser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  try {
    const guestContext = await guestBrowser.newContext({ permissions: ["microphone"] });
    const guest = await guestContext.newPage();
    await guest.goto(portalUrl!);
    await expect(guest.getByRole("heading", { name: "请大家留下今天的声音" })).toBeVisible();
    await expect(guest.getByText("用一分钟讲讲你最近遇到的一件事。")).toBeVisible();

    // 空提交被拦下，提示走录音路径
    await guest.getByRole("button", { name: "提交给家人" }).click();
    await expect(guest.getByText("请先录一段话，或写下一段文字。")).toBeVisible();

    // 问题 → 录音
    await guest.getByRole("button", { name: "开始录音" }).click();
    await expect(guest.getByText("正在录音……")).toBeVisible();
    await guest.waitForTimeout(1200);
    await guest.getByRole("button", { name: "停止录音" }).click();

    // 重听：录音可播放，确认或重来
    await expect(guest.getByLabel("刚录下的这段录音")).toBeVisible();
    await guest.getByRole("button", { name: "就用这段录音" }).click();
    await expect(guest.getByText("已保留这段录音")).toBeVisible();

    // 可选补充文字后提交
    await guest.getByLabel("补充的话（可选）").fill("这是外婆补充的一句话。");
    await guest.getByRole("button", { name: "提交给家人" }).click();
    await expect(guest.getByText("已经收到，谢谢！")).toBeVisible();

    // 再说一段：回到初始录音步骤，称呼与链接仍可复用
    await guest.getByRole("button", { name: "再说一段" }).click();
    await expect(guest.getByRole("button", { name: "开始录音" })).toBeVisible();

    // 访客页面不提供任何档案阅读入口
    await expect(guest.getByRole("navigation", { name: "一级导航" })).toHaveCount(0);
    await guestContext.close();
  } finally {
    await guestBrowser.close();
  }

  // 管理员侧：投递进入统计与收件箱
  await page.goto("/contributions");
  await expect(page.getByText("已提交 1/20 次")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("family-voice-", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("这是外婆补充的一句话。").first()).toBeVisible();
});
