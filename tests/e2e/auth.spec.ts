import { expect, test } from "@playwright/test";
import { ADMIN, SETUP_TOKEN } from "./helpers";

// 认证与初始化（RH-006：本 project 独立 DATA_DIR，自包含执行）
test.describe.configure({ mode: "serial" });

test("A: 未登录访问 /timeline 自动跳转 /login", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page).toHaveURL(/\/login/);
});

test("B0: 未初始化时公开 HTTP 注册也被拒绝", async ({ page }) => {
  await page.goto("/setup");
  const resp = await page.request.post("/api/auth/sign-up/email", {
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(page.url()).origin,
    },
    data: {
      name: "attacker",
      email: "attacker-before-setup@example.com",
      password: "attacker-password-123",
    },
  });
  expect(resp.status()).toBe(403);
  await expect(page.getByLabel("初始化令牌")).toBeVisible();
});

test("B1: 错误 setup token 无法初始化", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("初始化令牌").fill("wrong-token");
  await page.getByLabel("显示名称").fill(ADMIN.displayName);
  await page.getByLabel("邮箱（登录用）").fill(ADMIN.email);
  await page.getByLabel("密码（至少 10 位）").fill(ADMIN.password);
  await page.getByLabel("确认密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "创建管理员" }).click();

  await expect(page.getByText("初始化令牌不正确")).toBeVisible();
  await expect(page).toHaveURL(/\/setup/);
});

test("B2: 正确 token 完成初始化并登录进入 onboarding", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("初始化令牌").fill(SETUP_TOKEN);
  await page.getByLabel("显示名称").fill(ADMIN.displayName);
  await page.getByLabel("邮箱（登录用）").fill(ADMIN.email);
  await page.getByLabel("密码（至少 10 位）").fill(ADMIN.password);
  await page.getByLabel("确认密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "创建管理员" }).click();

  // 初始化成功 → 跳到 /login 并提示
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("初始化完成")).toBeVisible();

  // 登录 → 尚无家庭，进入 /onboarding
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/\/onboarding/);

  // 完成 onboarding：创建家庭 + 女儿 + 自己
  await page.getByLabel("家庭名称").fill("我们一家");
  await page.getByLabel("孩子姓名").fill("小满");
  await page.getByLabel("出生日期（时间轴按它计算成长年龄）").fill("2026-08-10");
  await page.getByLabel("显示名称").fill("爸爸");
  await page.getByLabel("对孩子的称谓").fill("爸爸");
  await page.getByRole("button", { name: "创建家庭" }).click();

  // 进入受保护首页
  await expect(page).toHaveURL(/\/[^/]*$/);
  await expect(page.getByRole("heading", { level: 1, name: "我们一家" })).toBeVisible();
  await expect(page.getByRole("link", { name: "写一句" })).toBeVisible();
  await expect(page.getByText(ADMIN.displayName)).toBeVisible();

  // 已登录用户访问 /login 应回首页
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "我们一家" })).toBeVisible();

  // 家人页可以看到女儿与爸爸，并添加没有账号的外婆
  await page.goto("/family");
  await expect(page.getByText("小满")).toBeVisible();
  await expect(page.getByText("孩子", { exact: true })).toBeVisible();
  await page.getByLabel("姓名").fill("外婆");
  await page.getByLabel("对孩子的称谓").fill("外婆");
  await page.getByRole("button", { name: "添加家人" }).click();
  await expect(page.getByText("外婆").first()).toBeVisible();
});

test("C: 初始化完成后 /setup 失效（跳回 /login，无法创建第二个 admin）", async ({
  page,
}) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("初始化令牌")).toHaveCount(0);

  const resp = await page.request.post("/api/auth/sign-up/email", {
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(page.url()).origin,
    },
    data: {
      name: "attacker",
      email: "attacker-after-setup@example.com",
      password: "attacker-password-123",
    },
  });
  expect(resp.status()).toBe(403);
});

test("D: 退出登录后受保护页面跳回 /login", async ({ page }) => {
  // 重新登录
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();

  // 退出
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);

  // 受保护页面再次跳回 /login
  await page.goto("/capsules");
  await expect(page).toHaveURL(/\/login/);
});
