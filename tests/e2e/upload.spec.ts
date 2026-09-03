import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ADMIN, ensureBootstrap, ensureLogin } from "./helpers";

// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap）
test.describe.configure({ mode: "serial" });

test("上传照片：保存成功、重复明确提示、收件箱可见、未登录端点拒绝", async ({
  page,
}) => {
  await ensureBootstrap(page);
  await page.goto("/capture");

  const file = path.join(__dirname, "..", "fixtures", "sample-exif.jpg");
  const input = page.locator('section[aria-label="照片"] input[type="file"]');
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/upload/image", async (route) => {
    await responseGate;
    await route.continue();
  });
  await input.setInputFiles(file);
  await expect(
    page.getByRole("progressbar", { name: "sample-exif.jpg 上传进度" }),
  ).toBeVisible();
  releaseResponse?.();
  await expect(page.getByText("已保存，等待整理")).toBeVisible();
  await page.unroute("**/api/upload/image");

  // 相同文件再传一次：提示已存在原件
  await input.setInputFiles(file);
  await expect(page.getByText("已存在相同原件")).toBeVisible();

  // 上传的内容进入收件箱（不直接进时间轴）
  await page.goto("/inbox");
  await expect(page.getByText("sample-exif.jpg")).toBeVisible();
  await expect(page.getByText("照片内嵌时间")).toBeVisible();

  // 登录 cookie 不能替代同源校验。
  const crossOriginResp = await page.request.post("/api/upload/image", {
    headers: { Origin: "https://attacker.example" },
    multipart: {
      file: {
        name: "cross-origin.jpg",
        mimeType: "image/jpeg",
        buffer: readFileSync(
          path.join(__dirname, "..", "fixtures", "sample.jpg"),
        ),
      },
    },
  });
  expect(crossOriginResp.status()).toBe(403);

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

test("原生 Bearer 补传：设备 UUID 幂等且进入同一个 Web 收件箱", async ({ page }) => {
  await ensureBootstrap(page);
  const signInResponse = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      email: ADMIN.email,
      password: ADMIN.password,
      rememberMe: true,
    },
  });
  const signInText = await signInResponse.text();
  expect(
    signInResponse.status(),
    `native sign-in failed: ${signInText}`,
  ).toBe(200);
  const signInBody = JSON.parse(signInText) as { token?: unknown };
  const tokenHeader = signInResponse.headers()["set-auth-token"];
  const bearerToken =
    tokenHeader ?? (typeof signInBody.token === "string" ? signInBody.token : null);
  expect(bearerToken).toEqual(expect.any(String));

  const captureId = "e815cd31-fb83-4233-b5ca-e17cbcd64158";
  const bytes = readFileSync(
    path.join(__dirname, "..", "fixtures", "sample-exif-offset.jpg"),
  );
  const upload = (filename: string, body = bytes) =>
    page.request.post("/api/upload/image", {
      headers: { Authorization: `Bearer ${bearerToken}` },
      multipart: {
        captureId,
        filename,
        lastModified: "1788422400000",
        file: { name: filename, mimeType: "image/jpeg", buffer: body },
      },
    });

  const first = await upload("native-device-photo.jpg");
  expect(first.status()).toBe(201);
  expect(await first.json()).toMatchObject({ status: "stored" });

  const retry = await upload("native-device-photo-retry.jpg");
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toMatchObject({ status: "duplicate" });

  const conflict = await upload(
    "native-device-conflict.jpg",
    readFileSync(path.join(__dirname, "..", "fixtures", "sample.jpg")),
  );
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toEqual({ error: "capture_id_conflict" });

  await page.goto("/inbox");
  const nativeCard = page.locator("article").filter({
    hasText: "native-device-photo.jpg",
  });
  await expect(nativeCard).toHaveCount(1);
  await nativeCard.getByLabel("事件标题").fill("原生客户端同步闭环");
  await nativeCard.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page).toHaveURL(/\/memories\//u);
  await expect(
    page.getByRole("heading", { level: 1, name: "原生客户端同步闭环" }),
  ).toBeVisible();

  const syncResponse = await page.request.get("/api/mobile/v1/sync?limit=50", {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  expect(syncResponse.status()).toBe(200);
  const sync = (await syncResponse.json()) as {
    apiVersion: number;
    events: Array<{
      title: string;
      cover: null | { path: string };
    }>;
  };
  expect(sync.apiVersion).toBe(1);
  const syncedEvent = sync.events.find(
    (event) => event.title === "原生客户端同步闭环",
  );
  expect(syncedEvent).toBeDefined();
  expect(syncedEvent?.cover?.path).toMatch(/^\/api\/media\//u);

  const coverResponse = await page.request.get(syncedEvent!.cover!.path, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  expect(coverResponse.status()).toBe(200);
  expect((await coverResponse.body()).byteLength).toBeGreaterThan(0);

  const nativeSignOut = await page.request.post("/api/auth/sign-out", {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Origin: new URL(page.url()).origin,
      "Content-Type": "application/json",
    },
    data: {},
  });
  expect(nativeSignOut.status()).toBe(200);
  const expiredSync = await page.request.get("/api/mobile/v1/sync", {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  expect(expiredSync.status()).toBe(401);
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
