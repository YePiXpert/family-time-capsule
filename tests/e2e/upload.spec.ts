import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// 与 auth.spec.ts 共享同一实例状态：B2 完成后数据库已有管理员+家庭
test.describe.configure({ mode: "serial" });

const ADMIN = {
  email: "admin@example.com",
  password: "e2e-admin-password",
};

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  // (protected) 布局独有的导航——登录页同名 h1 会造成假通过，必须等真正进入受保护区域
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
}

test("上传照片：保存成功、重复明确提示", async ({ page }) => {
  await login(page);
  await page.goto("/capture");

  const file = path.join(__dirname, "..", "fixtures", "sample-exif.jpg");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(file);
  await expect(page.getByText("已保存，等待整理")).toBeVisible();

  // 相同文件再传一次：提示已存在原件
  await input.setInputFiles(file);
  await expect(page.getByText("已存在相同原件")).toBeVisible();

  // 未登录时媒体与上传端点必须拒绝（私有媒体不存在匿名 URL）
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);
  const mediaResp = await page.request.get("/api/media/00000000-0000-0000-0000-000000000000");
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
