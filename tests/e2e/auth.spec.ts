import { expect, test } from "@playwright/test";

// 必须与 scripts/e2e-server.mjs 的默认值保持一致
const SETUP_TOKEN = process.env.INITIAL_SETUP_TOKEN ?? "e2e-setup-token";
const ADMIN = {
  displayName: "管理员",
  email: "admin@example.com",
  password: "e2e-admin-password",
};

test.describe.configure({ mode: "serial" });

test("A: 未登录访问 /timeline 自动跳转 /login", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page).toHaveURL(/\/login/);
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

test("B2: 正确 token 完成初始化并登录进入受保护首页", async ({ page }) => {
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

  // 登录 → 进入受保护首页
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/\/[^/]*$/); // 回到 /
  await expect(
    page.getByRole("heading", { level: 1, name: "家庭时间胶囊" }),
  ).toBeVisible();
  await expect(page.getByText("随处记录，统一归档。")).toBeVisible();
  // 页头显示当前用户
  await expect(page.getByText(ADMIN.displayName)).toBeVisible();

  // 已登录用户访问 /login 应回首页
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { level: 1, name: "家庭时间胶囊" }),
  ).toBeVisible();
});

test("C: 初始化完成后 /setup 失效（跳回 /login，无法创建第二个 admin）", async ({
  page,
}) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("初始化令牌")).toHaveCount(0);
});

test("D: 退出登录后受保护页面跳回 /login", async ({ page }) => {
  // 重新登录
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "家庭时间胶囊" })).toBeVisible();

  // 退出
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);

  // 受保护页面再次跳回 /login
  await page.goto("/capsules");
  await expect(page).toHaveURL(/\/login/);
});
