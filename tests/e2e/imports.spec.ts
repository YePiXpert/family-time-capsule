import { expect, test } from "@playwright/test";
import { ensureBootstrap } from "./helpers";

test.describe.configure({ mode: "serial" });

test("100 项队列在首个上传前持久化，失败后刷新仍可看到全部文件", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/imports");
  await page.route("**/api/uploads", (route) => route.abort("failed"));
  await page.getByLabel("选择多份文件").setInputFiles(Array.from({ length: 100 }, (_, index) => ({
    name: `durable-queue-${index}.txt`, mimeType: "text/plain", buffer: Buffer.from(`家庭文字 ${index}`),
  })));
  await expect(page.getByText("durable-queue-99.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/本轮可上传项已处理/)).toBeVisible({ timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(`/api/imports/${id}`);
  const detail = await response.json();
  expect(detail.session.totalCount).toBe(100);
  expect(detail.items).toHaveLength(100);
  expect(detail.items.every((item: { upload: unknown }) => item.upload === null)).toBe(true);
  await page.reload();
  await expect(page.getByText("durable-queue-99.txt", { exact: true })).toBeVisible();
});

test("批量导入：文档与照片逐项续传、刷新后保留服务器进度并进入 Inbox", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/imports");
  await expect(page.getByRole("heading", { level: 1, name: "批量导入中心" })).toBeVisible();

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
    "hex",
  );
  await page.getByLabel("选择多份文件").setInputFiles([
    { name: "batch-photo.png", mimeType: "image/png", buffer: png },
    { name: "note-one.txt", mimeType: "text/plain", buffer: Buffer.from("第一份家庭文字") },
    { name: "note-two.md", mimeType: "text/markdown", buffer: Buffer.from("# 第二份家庭文字") },
    { name: "archive.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF\n") },
  ]);
  await expect(page.getByText("batch-photo.png")).toBeVisible();
  await page.getByRole("button", { name: "开始导入" }).click();
  await expect(page.getByText(/本轮可上传项已处理/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/u);
  await expect(page.getByText("服务器已完成 4/4")).toBeVisible();

  await page.reload();
  await expect(page.getByText("刷新不会丢服务器进度")).toBeVisible();
  await expect(page.getByText("已入箱").first()).toBeVisible();

  await page.getByRole("link", { name: "去收件箱整理" }).click();
  for (const filename of ["batch-photo.png", "note-one.txt", "archive.pdf"]) {
    await expect(page.getByRole("article").filter({ hasText: filename }).first()).toBeVisible();
  }
});
