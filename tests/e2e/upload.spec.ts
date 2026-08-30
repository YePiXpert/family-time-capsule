import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureBootstrap, ensureLogin } from "./helpers";

// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap）
test.describe.configure({ mode: "serial" });

test("上传照片：保存成功、重复明确提示、收件箱可见、未登录端点拒绝", async ({
  page,
}) => {
  await ensureBootstrap(page);
  await page.goto("/capture");

  const file = path.join(__dirname, "..", "fixtures", "sample-exif.jpg");
  const input = page.locator('section[aria-label="照片"] input[type="file"]');
  await input.setInputFiles(file);
  await expect(page.getByText("已保存，等待整理")).toBeVisible();

  // 相同文件再传一次：提示已存在原件
  await input.setInputFiles(file);
  await expect(page.getByText("已存在相同原件")).toBeVisible();

  // 上传的内容进入收件箱（不直接进时间轴）
  await page.goto("/inbox");
  await expect(page.getByText("sample-exif.jpg")).toBeVisible();
  await expect(page.getByText("照片内嵌时间")).toBeVisible();

  // 未登录时媒体与上传端点必须拒绝（私有媒体不存在匿名 URL）
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);
  const mediaResp = await page.request.get(
    "/api/media/00000000-0000-0000-0000-000000000000",
  );
  expect(mediaResp.status()).toBe(401);
  const uploadResp = await page.request.post("/api/upload/image", {
    multipart: {
      file: {
        name: "x.jpg",
        mimeType: "image/jpeg",
        buffer: readFileSync(path.join(__dirname, "..", "fixtures", "sample.jpg")),
      },
    },
  });
  expect(uploadResp.status()).toBe(401);
});

test("HEIC 上传：原件保存、收件箱显示不可预览占位 + 下载入口", async ({ page }) => {
  // 每个测试是独立 context → 幂等登录
  await ensureLogin(page);
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles({
      name: "IMG_0001.HEIC",
      mimeType: "image/heic", // iOS Safari 上传 HEIC 时的声明；桌面 Chromium 路径方式给不出
      buffer: readFileSync(path.join(__dirname, "..", "fixtures", "sample.heic")),
    });
  await expect(page.getByText("已保存，等待整理")).toBeVisible();

  await page.goto("/inbox");
  // HEIC 卡片：不渲染 <img>，而是占位说明 + 下载原件
  await expect(page.getByText("HEIC 照片").first()).toBeVisible();
  await expect(
    page.getByText("原件已安全保存，当前浏览器可能无法直接预览").first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "下载 / 打开原件" }).first()).toBeVisible();
});
