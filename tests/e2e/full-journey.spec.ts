import { expect, test } from "@playwright/test";
import path from "node:path";
import { addFamilyMember, ensureBootstrap, ensureLogin } from "./helpers";

/**
 * 完整用户旅程（RH-006 保留）：
 * setup → onboarding → 上传 → 收件箱确认 → 时间轴 → 多人视角 → 胶囊 →
 * 导出 → 登出安全。
 * 本 project（journey）独占一个 DATA_DIR，与功能 spec 互不依赖。
 */
test.describe.configure({ mode: "serial" });

test("完整旅程：从初始化到导出与登出", async ({ page }) => {
  await ensureBootstrap(page);

  // 1) 上传旧照片（EXIF 8/10）
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await expect(page.getByText("已保存，等待整理")).toBeVisible();

  // 2) 收件箱确认
  await page.goto("/inbox");
  await page.getByLabel("事件标题").fill("八月中旬的一个上午");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByText("出生当天")).toBeVisible();

  // 3) 时间轴正确日期
  await page.goto("/timeline");
  const link = page.getByRole("link", { name: /八月中旬的一个上午/ });
  await expect(link).toBeVisible();
  await expect(link.getByText("2026年8月10日")).toBeVisible();

  // 4) 多人视角
  await addFamilyMember(page, "外婆", "外婆");
  await page.goto("/timeline");
  await page.getByRole("link", { name: /八月中旬的一个上午/ }).click();
  await page.getByLabel("谁在讲述").selectOption({ label: "爸爸" });
  await page
    .getByPlaceholder("TA 想说的那段话……")
    .fill("她盯着窗帘看了一上午。");
  await page.getByRole("button", { name: "保存这段讲述" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "爸爸" })).toBeVisible();

  // 5) 胶囊封存
  await page.goto("/capsules");
  await page.getByLabel("胶囊标题").fill("写给一岁的你");
  await page.getByLabel("开启条件").selectOption("date");
  await page.getByLabel("开启日期").fill("2027-08-10");
  await page.getByRole("button", { name: "创建胶囊" }).click();
  await page.getByLabel("记忆事件").selectOption({ label: "八月中旬的一个上午" });
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "封存胶囊" }).click();
  await expect(page.getByText("内容已封存。", { exact: false }).first()).toBeVisible();

  // 6) 导出 + 哈希验证
  const resp = await page.request.get("/api/export");
  expect(resp.status()).toBe(200);
  const zipBuffer = Buffer.from(await resp.body());
  const { default: JSZip } = await import("jszip");
  const { createHash } = await import("node:crypto");
  const zip = await JSZip.loadAsync(zipBuffer);
  const manifest = JSON.parse(
    await zip.file("family-time-capsule-export/manifest.json")!.async("string"),
  );
  expect(manifest.assets.length).toBeGreaterThanOrEqual(1);
  for (const entry of manifest.assets) {
    const buf = await zip
      .file(`family-time-capsule-export/${entry.relativePath}`)!
      .async("nodebuffer");
    expect(createHash("sha256").update(buf).digest("hex")).toBe(entry.sha256);
  }

  // 7) 登出安全：事件页、真实媒体、导出、上传全部不可访问
  await page.goto("/timeline");
  const href = await page
    .getByRole("link", { name: /八月中旬的一个上午/ })
    .getAttribute("href");
  const mediaSrc = await page
    .locator("img[src*='/api/media/']")
    .first()
    .getAttribute("src");

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto(href!);
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get(mediaSrc!)).status()).toBe(401);
  expect((await page.request.get("/api/export")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/upload/image", {
        multipart: {
          file: {
            name: "x.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.alloc(0),
          },
        },
      })
    ).status(),
  ).toBe(401);
});

test("上传端点拒绝伪装文件（内容与声明不符）", async ({ page }) => {
  await ensureLogin(page);

  const resp = await page.request.post("/api/upload/image", {
    multipart: {
      file: {
        name: "malware.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.concat([
          Buffer.from("MZ\x90\x00"),
          Buffer.alloc(128, 0x41),
        ]),
      },
    },
  });
  expect(resp.status()).toBe(415);
  const body = await resp.json();
  expect(body.error).toBe("content_mismatch");
});
