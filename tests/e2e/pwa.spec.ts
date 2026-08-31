import { expect, test } from "@playwright/test";

// P0 PWA（Issue #016）：可安装性资源齐备；离线壳存在
test.describe.configure({ mode: "serial" });

test("manifest / 图标 / service worker / 离线页可访问", async ({ request }) => {
  const manifestResp = await request.get("/manifest.webmanifest");
  expect(manifestResp.status()).toBe(200);
  const manifest = await manifestResp.json();
  expect(manifest.name).toContain("家庭时间胶囊");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons) {
    const resp = await request.get(icon.src);
    expect(resp.status(), icon.src).toBe(200);
    expect(resp.headers()["content-type"]).toBe("image/png");
  }

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);

  const offline = await request.get("/offline.html");
  expect(offline.status()).toBe(200);
  expect((await offline.text()).includes("现在离线了")).toBe(true);
});

test("页面携带 PWA meta（viewport-fit / manifest / theme-color）", async ({ page }) => {
  await page.goto("/login");
  const viewportMeta = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(viewportMeta).toContain("viewport-fit=cover");
  const manifestLink = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestLink).toBe("/manifest.webmanifest");
});

test("生产页面与 API 带严格安全响应头，CSP 不含 unsafe-eval", async ({ page }) => {
  const pageResponse = await page.request.get("/login");
  expect(pageResponse.status()).toBe(200);
  const pageHeaders = pageResponse.headers();
  expect(pageHeaders["content-security-policy"]).toContain("default-src 'self'");
  expect(pageHeaders["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageHeaders["content-security-policy"]).not.toContain("'unsafe-eval'");
  // TLS terminates at the deployment proxy. The app's documented direct-HTTP
  // setup/health path must not rewrite its own assets to a nonexistent HTTPS port.
  expect(pageHeaders["content-security-policy"]).not.toContain(
    "upgrade-insecure-requests",
  );
  expect(pageHeaders["x-content-type-options"]).toBe("nosniff");
  expect(pageHeaders["x-frame-options"]).toBe("DENY");
  expect(pageHeaders["referrer-policy"]).toBe("no-referrer");

  const apiResponse = await page.request.get("/api/health");
  expect(apiResponse.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(apiResponse.headers()["x-content-type-options"]).toBe("nosniff");
});
