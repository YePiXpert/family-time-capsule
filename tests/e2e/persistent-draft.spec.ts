import { startCaptureDraft, readCaptureDraft, waitForCapture, setCaptureMetadata } from "./helpers/capture";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ensureBootstrap } from "./helpers";

test("long-lived mixed Web draft: offline save, closed page recovery, removal, one memory and one copy of each original", async ({ page, context }) => {
  await ensureBootstrap(page);
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill("外公说年轻时在江边划船，今天录下来。正文检索词竹篙。");
  await waitForCapture(page); await setCaptureMetadata(page, { title: "外公的江边往事" });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: new Date("1980-08-12T18:30:00+08:00").toISOString() });
  await page.locator('input[type="file"]').first().setInputFiles(["sample-exif.jpg", "sample.jpg", "sample.wav"].map(name => path.join(__dirname, "../fixtures", name)));
  await expect(page.getByText("3 份原件已保存在本机", { exact: false })).toBeVisible();
  const before = await (await page.request.get("/api/mobile/v1/sync")).json();
  expect(before.events).toHaveLength(0);
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: /^本机已保存 ·/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "本机已保存 ·" })).toBeVisible();
  await page.close();
  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto("/capture"); await waitForCapture(reopened);
  await expect(reopened.getByLabel("写下这一刻")).toHaveValue("外公说年轻时在江边划船，今天录下来。正文检索词竹篙。");
  expect((await readCaptureDraft(reopened)).content.title).toBe("外公的江边往事");
  await expect(reopened.locator("main ol > li")).toHaveCount(3);
  await expect(reopened.locator("audio")).toHaveCount(1);
  // Removal is directly available; the original remains preserved locally.
  const preserved = await readCaptureDraft(reopened);
  await reopened.locator("main ol > li").nth(1).getByRole("button", { name: "移除", exact: true }).click();
  expect((await readCaptureDraft(reopened)).content.coverItemId).toBe(preserved.content.coverItemId);
  await reopened.getByRole("button", { name: "保存" }).click();
  await expect(reopened.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
  const link = await reopened.getByRole("link", { name: "查看这条记忆" }).getAttribute("href");
  const id = link!.split("/").at(-1)!;
  const memory = await (await reopened.request.get(`/api/mobile/v1/memories/${id}`)).json();
  expect(memory.assets.map((a: { type: string }) => a.type)).toEqual(["image", "audio"]);
  expect(memory.childPersonId).toBeNull();
  expect((await (await reopened.request.get("/api/mobile/v1/sync")).json()).events).toHaveLength(1);
  await reopened.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(reopened.getByRole("heading", { name: "外公的江边往事", level: 1 })).toBeVisible();
  await expect(reopened.locator("main")).not.toContainText(/个月|出生当天/);
  await reopened.goto("/search?q=" + encodeURIComponent("竹篙"));
  await expect(reopened.getByRole("link", { name: /外公的江边往事/ })).toBeVisible();
});

test("an imported MOV without browser MIME previews, saves its exact bytes and plays from the server", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  const videoPath = test.info().outputPath("import.mov");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xe8bca9:s=96x64:r=12:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath]);
  const bytes = readFileSync(videoPath);
  await page.getByLabel("写下这一刻").fill("小美回家路上的视频");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "home.mov", mimeType: "", buffer: bytes });
  await expect(page.locator("main video")).toHaveCount(1);
  await page.locator("main video").evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); });
  await waitForCapture(page);
  await setCaptureMetadata(page, { occurredAt: new Date("2026-09-08T10:00:00+08:00").toISOString() });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const link = page.getByRole("link", { name: "查看这条记忆" });
  await expect(link).toBeVisible();
  const id = (await link.getAttribute("href"))!.split("/").at(-1)!;
  const memory = await (await page.request.get(`/api/mobile/v1/memories/${id}`)).json();
  expect(memory.assets).toHaveLength(1);
  expect(memory.assets[0]).toMatchObject({ type: "video", mimeType: "video/quicktime" });
  const original = await page.request.get(`/api/media/${memory.assets[0].id}`);
  expect(await original.body()).toEqual(bytes);
  const range = await page.request.get(`/api/media/${memory.assets[0].id}`, { headers: { Range: "bytes=0-63" } });
  expect(range.status()).toBe(206);
  expect(await range.body()).toEqual(bytes.subarray(0, 64));
  await link.click();
  await page.getByRole("button", { name: /^打开阅读器：/ }).first().click();
  await expect.poll(() => page.locator("dialog video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator("dialog video").evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); });
});

for (const { filename, mime, format } of [
  { filename: "dvd.mpg", mime: "video/mpeg", format: "dvd" },
  { filename: "transport.ts", mime: "video/mp2t", format: "mpegts" },
]) test(`${filename} survives a rejected start and retries the same draft into playable video with audio`, async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  const input = test.info().outputPath(filename);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xabcdef:s=96x64:r=25:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:v", "mpeg2video", "-c:a", "ac3", "-shortest", "-f", format, input]);
  const bytes = readFileSync(input);
  await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "application/octet-stream", buffer: bytes });
  await expect(page.getByText("当前设备不能直接播放这个视频。", { exact: false })).toBeVisible();
  // Model the old server's 415 response, then keep exactly the same preserved draft.
  await page.route("**/api/uploads", route => route.fulfill({ status: 415, contentType: "application/json", body: JSON.stringify({ error: "mime_not_allowed" }) }), { times: 1 });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("服务器尚不支持这个文件格式", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  const link = page.getByRole("link", { name: "查看这条记忆" });
  await expect(link).toBeVisible();
  const id = (await link.getAttribute("href"))!.split("/").at(-1)!;
  const memory = await (await page.request.get(`/api/mobile/v1/memories/${id}`)).json();
  expect(memory.assets[0]).toMatchObject({ type: "video", mimeType: mime });
  expect(await (await page.request.get(`/api/media/${memory.assets[0].id}`)).body()).toEqual(bytes);
  await expect.poll(async () => {
    execFileSync(process.execPath, [".next/ops/worker.mjs", "--once"], { env: { ...process.env, DATA_DIR: path.join(process.cwd(), "data/e2e-persistent-draft"), AUTH_SECRET: "e2e-test-auth-secret-0123456789abcdef" }, timeout: 30000 });
    const result = await (await page.request.get(`/api/media/${memory.assets[0].id}/derivations`)).json();
    return result.jobs.find((job: { kind: string }) => job.kind === "transcode")?.status;
  }, { timeout: 30000 }).toBe("succeeded");
  await link.click();
  await page.getByRole("button", { name: /^打开阅读器：/ }).first().click();
  await expect.poll(() => page.locator("dialog video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator("dialog video").evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); });
});

test("unfinished records are recoverable from pending work and clearing needs confirmation", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("没有写完的私密旧记录");
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  const original = await readCaptureDraft(page);
  await startCaptureDraft(page);
  await page.getByLabel("写下这一刻").fill("另一份未完成记录");
  await readCaptureDraft(page);
  await page.goto("/pending");
  await page.getByRole("link", { name: /没有写完的私密旧记录/ }).click();
  await expect(page.getByLabel("写下这一刻")).toHaveValue("没有写完的私密旧记录");
  expect((await readCaptureDraft(page)).id).toBe(original.id);
  await expect(page.getByRole("button", { name: "仅自己", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main details")).toHaveCount(0);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await expect(page.getByLabel("写下这一刻")).toHaveValue("没有写完的私密旧记录");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await expect(page.getByLabel("写下这一刻")).toHaveValue("");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
});
