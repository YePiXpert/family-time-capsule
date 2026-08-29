import { expect, test } from "@playwright/test";

// E2E 8（#018）：logout 后，私有媒体与事件页面均不可访问
// 文件名排序保证其最后执行（此时已有真实 assetId / eventId 可复用）
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.com", password: "e2e-admin-password" };

test("登出后：事件页跳登录、真实媒体 401、导出 401", async ({ page }) => {
  // 登录拿一个真实事件页与媒体地址
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();

  await page.goto("/timeline");
  // 选一个带图片封面的事件（纯文字事件没有媒体地址可抓）
  const eventWithImage = page
    .getByRole("link")
    .filter({ has: page.locator("img") })
    .first();
  const href = await eventWithImage.getAttribute("href");
  expect(href).toMatch(/\/memories\//);

  await page.goto(href!);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // 抓一个真实媒体 URL（图片或音视频源）
  const mediaSrc =
    (await page.locator("img[src*='/api/media/']").first().getAttribute("src")) ??
    (await page
      .locator("audio[src*='/api/media/'], video[src*='/api/media/']")
      .first()
      .getAttribute("src"));
  expect(mediaSrc).toMatch(/\/api\/media\//);

  // 登出
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);

  // 1) 事件直链 → 跳登录
  await page.goto(href!);
  await expect(page).toHaveURL(/\/login/);

  // 2) 真实媒体 URL → 401（不是 200，更不是内容）
  const mediaResp = await page.request.get(mediaSrc!);
  expect(mediaResp.status()).toBe(401);
  expect((await mediaResp.text()).length).toBeLessThan(100); // 无内容泄露

  // 3) 导出 → 401
  expect((await page.request.get("/api/export")).status()).toBe(401);
  // 4) 上传端点 → 401
  expect(
    (
      await page.request.post("/api/upload/image", {
        multipart: {
          file: {
            name: "x.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from([]),
          },
        },
      })
    ).status(),
  ).toBe(401);
});

test("空数据库冷启动路径回顾（每次 e2e 运行即验证）", async ({ page }) => {
  // e2e webServer 每次运行前清空 data/e2e：空 DATA_DIR → Next 启动 →
  // 迁移自动应用 → /setup 初始化 → 登录 → onboarding → 全功能可用。
  // 该路径由 auth.spec（A/B1/B2）与本套件其他 spec 共同覆盖；
  // 此处仅断言服务器仍健康。
  const resp = await page.request.get("/login");
  expect(resp.status()).toBe(200);
});

test("上传端点拒绝伪装文件（内容与声明不符）", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();

  const resp = await page.request.post("/api/upload/image", {
    multipart: {
      file: {
        name: "malware.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(128, 0x41)]),
      },
    },
  });
  expect(resp.status()).toBe(415);
  const body = await resp.json();
  expect(body.error).toBe("content_mismatch");
});
