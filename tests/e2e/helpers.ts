import { expect, type Page } from "@playwright/test";

/**
 * E2E workspace helper（RH-006）：
 * 每个 spec 运行在独立 project / 独立 DATA_DIR 上，
 * 因此每个 spec 都从零 bootstrap（setup → login → onboarding），
 * 不再依赖其他 spec 留下的状态或文件执行顺序。
 */

export const SETUP_TOKEN = process.env.INITIAL_SETUP_TOKEN ?? "e2e-setup-token";
export const ADMIN = {
  displayName: "管理员",
  email: "admin@example.com",
  password: "e2e-admin-password",
};
export const FAMILY = {
  name: "我们一家",
  childName: "小满",
  childBirthDate: "2026-08-10", // 时间轴年龄基准
};

export async function expectInApp(page: Page) {
  // (protected) 布局独有的导航——登录页同名 h1 会造成假通过
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
}

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expectInApp(page);
}

/**
 * 完整 bootstrap：/setup 初始化 → 登录 → /onboarding 建家庭（女儿+自己）。
 * 每个 spec 只需调用一次（ensureBootstrap 幂等）。
 */
export async function bootstrapWorkspace(page: Page) {
  await page.goto("/setup");
  await page.getByLabel("初始化令牌").fill(SETUP_TOKEN);
  await page.getByLabel("显示名称").fill(ADMIN.displayName);
  await page.getByLabel("邮箱（登录用）").fill(ADMIN.email);
  await page.getByLabel("密码（至少 10 位）").fill(ADMIN.password);
  await page.getByLabel("确认密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "创建管理员" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("初始化完成")).toBeVisible();

  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("家庭名称").fill(FAMILY.name);
  await page.getByLabel("孩子姓名").fill(FAMILY.childName);
  await page.getByLabel("出生日期（时间轴按它计算成长年龄）").fill(FAMILY.childBirthDate);
  await page.getByLabel("显示名称").fill("爸爸");
  await page.getByLabel("对孩子的称谓").fill("爸爸");
  await page.getByRole("button", { name: "创建家庭" }).click();
  await expectInApp(page);
}

let bootstrapped = false;
/** spec 内第一个测试调用；同一 spec 共享一次 bootstrap */
export async function ensureBootstrap(page: Page) {
  if (bootstrapped) {
    await ensureLogin(page);
    return;
  }
  await bootstrapWorkspace(page);
  bootstrapped = true;
}

/**
 * 幂等登录：Playwright 每个测试都是独立 context（无共享 cookie），
 * 因此每个需要会话的测试开头调用本函数。
 */
export async function ensureLogin(page: Page) {
  await page.goto("/");
  if (!/\/login/.test(page.url())) {
    await expectInApp(page);
    return;
  }
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expectInApp(page);
}

/** 重置标志（供需要从“未初始化”状态开始的 spec 使用） */
export function resetBootstrapFlag() {
  bootstrapped = false;
}

/** 添加一个没有账号的家庭成员（如外婆） */
export async function addFamilyMember(
  page: Page,
  name: string,
  relation: string,
) {
  await page.goto("/family");
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("对孩子的称谓").fill(relation);
  await page.getByRole("button", { name: "添加家人" }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}
