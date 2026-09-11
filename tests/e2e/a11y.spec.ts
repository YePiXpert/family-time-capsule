import { expect, test } from "@playwright/test";
import { ensureBootstrap, ensureLogin } from "./helpers";
import { journalColors } from "../../mobile/src/design/tokens";

const rgb = (hex: string) => `rgb(${hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16)).join(", ")})`;

/**
 * NAV-9 可访问性收口（GLM-C）：
 * - 键盘可完成高价值操作（登录、主导航），不只依赖鼠标/手势；
 * - prefers-reduced-motion 时过渡与动画被压到近零；
 * - 高频触控目标 ≥44px；图标按钮有可读名称（读屏可用）。
 */

test.describe.configure({ mode: "serial" });

test("仅用键盘完成登录（Tab/Enter）", async ({ page }) => {
  await ensureBootstrap(page);
  // 退出到登录页，随后全程只用键盘完成登录
  await page.goto("/settings");
  const logout = page.getByRole("button", { name: "退出", exact: true });
  if (await logout.isVisible()) {
    await logout.click();
    await expect(page).toHaveURL(/\/login/);
  } else {
    await page.goto("/login");
  }

  const email = page.getByLabel("邮箱");
  await email.focus();
  await page.keyboard.type("admin@example.com");
  // Tab 进入密码框后继续只用键盘
  await page.keyboard.press("Tab");
  await page.keyboard.type("e2e-admin-password");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
});

test("减少动态偏好下过渡近零；主导航键盘可达", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ensureBootstrap(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/timeline$/);
  const motion = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(".ui-button-primary") ?? document.querySelector<HTMLElement>("a[class*=button]");
    return {
      duration: button ? getComputedStyle(button).transitionDuration : "missing",
      reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
  expect(motion.reduce).toBe(true);
  expect(motion.duration === "missing" ? 0 : Number.parseFloat(motion.duration)).toBeLessThanOrEqual(0.001);

  // Tab 链条能落到主导航链接，Enter 仍然导航（不是只能点按）
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("href") ?? ""}`);
    if (tag.startsWith("A:/timeline")) {
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/timeline$/);
      return;
    }
  }
  test.info().annotations.push({ type: "note", description: "未在 Tab 链中找到 /timeline 导航链接" });
  throw new Error("键盘无法到达主导航链接");
});

test("高频触控目标 ≥44px；图标按钮有可读名称", async ({ page }) => {
  await ensureLogin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/timeline$/);
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".bottom-nav-item")].map((item) => item.getBoundingClientRect().height),
  );
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);

  await expect(page.getByRole("link", { name: "搜索家庭记忆" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
});

test("journal colors survive CSP; layouts remain readable from phone to desktop", async ({ page }) => {
  await ensureLogin(page);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/timeline");
    const appearance = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth > innerWidth,
      headings: document.querySelectorAll("main h1").length,
      motion: getComputedStyle(document.querySelector(".growth-hero")!).animationDuration,
    }));
    expect(appearance.background).toBe(rgb(journalColors.paper));
    expect(appearance.overflow).toBe(false);
    expect(appearance.headings).toBe(1);
    expect(parseFloat(appearance.motion)).toBeLessThanOrEqual(0.001);
  }
});

test("production glass renders in Chromium and respects reduced transparency", async ({ page, context }) => {
  await ensureLogin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/timeline");
  // The production CSS optimizer previously kept only the Safari-prefixed property.
  const surfaces = page.locator(".bottom-navigation-inner, .floating-capture");
  await expect(surfaces).toHaveCount(2);
  for (const surface of await surfaces.all()) {
    expect(await surface.evaluate(node => getComputedStyle(node).backdropFilter)).toContain("blur(20px)");
  }
  expect(await page.locator(".bottom-navigation").evaluate(node => getComputedStyle(node).backdropFilter)).toBe("none");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  const cardFill = rgb(journalColors.card);
  for (const surface of await surfaces.all()) {
    // Chromium applies a changed media preference on its next rendering frame.
    await expect.poll(() => surface.evaluate(node => ({ blur: getComputedStyle(node).backdropFilter, fill: getComputedStyle(node).backgroundColor }))).toEqual({ blur: "none", fill: cardFill });
  }
});
